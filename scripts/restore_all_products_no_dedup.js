import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dns from 'dns';

dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import User from '../models/User.js';
import Site from '../models/Site.js';
import Product from '../models/Product.js';

const EXPORT_DIR = path.resolve(__dirname, '../sql-server-export/export');

function cleanStr(val, defaultVal = '') {
  if (val === null || val === undefined) return defaultVal;
  const s = String(val).trim();
  return s === '' || s === '-' || s === 'None' || s === 'null' ? defaultVal : s;
}

function readSqlTable(relPath) {
  const fullPath = path.join(EXPORT_DIR, relPath);
  if (!fs.existsSync(fullPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    return parsed.rows || (Array.isArray(parsed) ? parsed : []);
  } catch (err) {
    return [];
  }
}

async function runRestore(dryRun = true) {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected to MongoDB (Mode: ${dryRun ? 'DRY-RUN' : 'LIVE RESTORE'}).\n`);

  // 1. Load Prolister
  const prolisterRows = readSqlTable('HaProlister/tables/dbo.Prolister.json');
  console.log(`Loaded ${prolisterRows.length} rows from HaProlister/dbo.Prolister.json`);

  // Group Prolister by CID
  const prolisterByCid = new Map();
  prolisterRows.forEach(p => {
    const cid = cleanStr(p.AppComp);
    if (cid) {
      if (!prolisterByCid.has(cid)) prolisterByCid.set(cid, []);
      prolisterByCid.get(cid).push(p);
    }
  });

  // 2. Load all sites from MongoDB
  const allSites = await Site.find({}).lean();
  const siteMap = new Map(); // "cid_citeId" -> site._id
  const defaultSiteMap = new Map(); // "cid" -> site._id
  const clientIdByCid = new Map();

  allSites.forEach(s => {
    const cid = cleanStr(s.client_code);
    const cIdStr = String(s.client_id);
    if (cid) {
      clientIdByCid.set(cid, cIdStr);
      if (!defaultSiteMap.has(cid)) defaultSiteMap.set(cid, s._id);

      const notes = s.notes || '';
      const sidMatch = notes.match(/SiteID:\s*(\w+)/i);
      if (sidMatch) {
        siteMap.set(`${cid}_${sidMatch[1].trim()}`, s._id);
      }
      siteMap.set(`${cid}_${s.name.toLowerCase().trim()}`, s._id);
    }
  });

  // Also check User notes for CID
  const allUsers = await User.find({ role: 'client' }).lean();
  allUsers.forEach(u => {
    const notes = u.notes || '';
    const email = u.email || '';
    const match = notes.match(/CID:\s*(\w+)/i) || email.match(/client_(\w+)@/i);
    if (match) {
      const cid = match[1].trim();
      if (!clientIdByCid.has(cid)) clientIdByCid.set(cid, String(u._id));
    }
  });

  // 3. Pre-load all existing products from MongoDB
  const existingProds = await Product.find({}, 'client_id site_id name code notes').lean();
  console.log(`Existing products in MongoDB: ${existingProds.length}`);

  // Create lookup set for existing products: "clientId_siteId_name_code"
  const existingProdKeys = new Set();
  const existingProIds = new Set();

  existingProds.forEach(p => {
    const cIdStr = String(p.client_id);
    const sIdStr = String(p.site_id || '');
    const name = cleanStr(p.name).toLowerCase();
    const code = cleanStr(p.code).toLowerCase();
    existingProdKeys.add(`${cIdStr}_${sIdStr}_${name}_${code}`);

    const notes = p.notes || '';
    const proIdMatch = notes.match(/ProID:\s*(\w+)/i);
    if (proIdMatch) {
      existingProIds.add(proIdMatch[1].trim());
    }
  });

  // 4. Find all products in SQL that need to be created/restored
  const toInsert = [];
  let alreadyExistingCount = 0;

  for (const [cid, pList] of prolisterByCid.entries()) {
    // Skip McCain Foods (CID 185) as it is already perfectly restored
    if (cid === '185') continue;

    const clientIdStr = clientIdByCid.get(cid);
    if (!clientIdStr) continue;

    const defaultSiteId = defaultSiteMap.get(cid);

    for (const p of pList) {
      const pName = cleanStr(p.ProName || p.pro_name || p.proname);
      if (!pName) continue;

      const pCode = cleanStr(p.ProCoder || p.procoder || p.ProID || p.proid);
      const proId = cleanStr(p.ProID);
      const citeId = cleanStr(p.CiteID);
      const siteName = cleanStr(p.SiteName).toLowerCase().trim();

      const assignedSiteId = siteMap.get(`${cid}_${citeId}`) || siteMap.get(`${cid}_${siteName}`) || defaultSiteId;
      const sIdStr = String(assignedSiteId || '');
      const key = `${clientIdStr}_${sIdStr}_${pName.toLowerCase()}_${pCode.toLowerCase()}`;

      if (existingProIds.has(proId) || existingProdKeys.has(key)) {
        alreadyExistingCount++;
        continue;
      }

      toInsert.push({
        client_id: new mongoose.Types.ObjectId(clientIdStr),
        site_id: assignedSiteId,
        name: pName,
        code: pCode,
        category: cleanStr(p.Status || p.category) || 'General',
        status: 'approved',
        product_type: 'General',
        ingredients: cleanStr(p.FileNamee) ? [cleanStr(p.FileNamee)] : [],
        barcode: pCode,
        halal_status: 'Halal Certified',
        notes: `Imported from legacy HFA database (ProID: ${proId})`,
        source: 'client'
      });
      existingProdKeys.add(key);
      if (proId) existingProIds.add(proId);
    }
  }

  console.log(`\n--- RESTORATION AUDIT SUMMARY ---`);
  console.log(`Already existing products: ${alreadyExistingCount}`);
  console.log(`New / Un-deduplicated products to restore: ${toInsert.length}`);

  if (!dryRun && toInsert.length > 0) {
    console.log(`\nWriting ${toInsert.length} products to MongoDB...`);
    const batchSize = 500;
    for (let i = 0; i < toInsert.length; i += batchSize) {
      const batch = toInsert.slice(i, i + batchSize);
      await Product.insertMany(batch);
      console.log(`  ✓ Inserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(toInsert.length / batchSize)}`);
    }
    console.log(`✅ Completed! New total products in MongoDB: ${await Product.countDocuments({})}`);
  }

  await mongoose.disconnect();
}

const isLive = process.argv.includes('--live');
runRestore(!isLive).catch(console.error);
