import dns from 'dns';
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const COMP_REGIS_FILE = path.resolve(__dirname, '../sql-server-export/export/HalalyMains/tables/dbo.CompRegis.json');
const KING_CO_LO_FILE = path.resolve(__dirname, '../sql-server-export/export/HalalyMains/tables/dbo.KingCoLo.json');
const CACHE_FILE = path.resolve(__dirname, '../scratch/loadcomp_companies_cache.json');

async function runImportAndDateFix(dryRun = false) {
  console.log(`\n======================================================`);
  console.log(`  IMPORTING SUBUSERS & SYNCHRONIZING REGISTERED DATES`);
  console.log(`  Mode: ${dryRun ? 'DRY-RUN (Simulated)' : 'PRODUCTION COMMIT'}`);
  console.log(`======================================================\n`);

  if (!fs.existsSync(COMP_REGIS_FILE) || !fs.existsSync(KING_CO_LO_FILE)) {
    console.error('Missing required SQL Server export files!');
    process.exit(1);
  }

  const compRegis = JSON.parse(fs.readFileSync(COMP_REGIS_FILE, 'utf8')).rows;
  const kingCoLo = JSON.parse(fs.readFileSync(KING_CO_LO_FILE, 'utf8')).rows;
  const cache = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : [];

  console.log(`✓ Loaded ${compRegis.length} CompRegis records.`);
  console.log(`✓ Loaded ${kingCoLo.length} KingCoLo member records.`);
  console.log(`✓ Loaded ${cache.length} cached API records.`);

  // 1. Build date map and cipher-to-plain map
  const compDateByName = new Map();
  const compDateByCid = new Map();
  const compEmailByName = new Map();
  const cipherToPlain = new Map();

  compRegis.forEach(c => {
    const d = (c.DateReg || '').trim();
    const n = (c.CCompanyName || '').trim().toLowerCase();
    const cid = (c.CID || '').trim();
    if (d && n) compDateByName.set(n, d);
    if (d && cid) compDateByCid.set(cid, d);
  });

  cache.forEach(c => {
    const d = (c.dateReg || c.DateReg || '').trim();
    const n = (c.cCompanyName || c.CompanyName || '').trim().toLowerCase();
    const e = (c.ceaKingp || c.email || '').trim().toLowerCase();
    const cid = (c.cid || '').trim();
    if (d && n) compDateByName.set(n, d);
    if (d && cid) compDateByCid.set(cid, d);
    if (e && e.includes('@')) {
      if (n) compEmailByName.set(n, e);
      if (c.ceaKingp) cipherToPlain.set(c.ceaKingp, e);
    }
  });

  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000
  });
  console.log('✓ Connected to MongoDB Atlas.');

  const db = mongoose.connection.db;
  const usersCollection = db.collection('users');

  // -------------------------------------------------------------------
  // PART 1: UPDATE ALL MAIN COMPANY ACCOUNTS WITH REGISTERED DATES
  // -------------------------------------------------------------------
  console.log('\n--- PART 1: Updating Registered Dates on Main Company Accounts ---');
  const mainCompanies = await usersCollection.find({ role: 'client', parent_client_id: null }).toArray();
  console.log(`Auditing ${mainCompanies.length} main company accounts...`);

  let datesUpdated = 0;
  const bulkDateOps = [];
  for (const comp of mainCompanies) {
    const normName = (comp.company_name || '').trim().toLowerCase();
    const mainEmail = (comp.email || '').trim().toLowerCase();
    const rawDateStr = compDateByName.get(normName) || (comp.created_at ? comp.created_at.toISOString().split('T')[0] : '2020-01-01');
    const realDate = new Date(rawDateStr);

    if (!isNaN(realDate.getTime())) {
      bulkDateOps.push({
        updateOne: {
          filter: { _id: comp._id },
          update: {
            $set: {
              created_at: realDate,
              createdAt: realDate,
              updated_at: new Date()
            }
          }
        }
      });
      datesUpdated++;
    }
  }

  if (!dryRun && bulkDateOps.length > 0) {
    console.log(`Executing bulkWrite for ${bulkDateOps.length} date updates...`);
    await usersCollection.bulkWrite(bulkDateOps, { ordered: false });
  }
  console.log(`✓ Synchronized registered dates for ${datesUpdated} main company accounts.`);

  // -------------------------------------------------------------------
  // PART 2: IMPORT SUBUSERS / MEMBERS UNDER RESPECTIVE COMPANIES
  // -------------------------------------------------------------------
  console.log('\n--- PART 2: Importing Members from dbo.KingCoLo into Respective Companies ---');

  // Group KingCoLo by normalized company name
  const kingByCompName = new Map();
  kingCoLo.forEach(k => {
    const norm = (k.CompanyName || '').trim().toLowerCase();
    if (!kingByCompName.has(norm)) kingByCompName.set(norm, []);
    kingByCompName.get(norm).push(k);
  });

  const existingEmails = new Set(
    (await usersCollection.find({}, { projection: { email: 1 } }).toArray()).map(u => (u.email || '').toLowerCase())
  );

  const defaultSubuserPasswordHash = await bcrypt.hash('HfaClient@2026', 10);
  let subusersCreated = 0;
  let companiesWithSubusers = 0;
  const subuserDocs = [];

  for (const comp of mainCompanies) {
    const normName = (comp.company_name || '').trim().toLowerCase();
    const members = kingByCompName.get(normName) || [];
    const mainEmail = (comp.email || '').trim().toLowerCase();
    const rawDateStr = compDateByName.get(normName) || (comp.created_at ? comp.created_at.toISOString().split('T')[0] : '2020-01-01');
    const regDate = new Date(rawDateStr);

    if (members.length > 1) {
      companiesWithSubusers++;

      let ownerMatched = false;
      const otherMembers = [];

      for (const m of members) {
        const rawName = (m.FullName || '').trim();
        let mEmail = null;
        if (rawName.includes('@')) {
          mEmail = rawName.toLowerCase();
        } else if (cipherToPlain.has(m.EAddKing)) {
          mEmail = cipherToPlain.get(m.EAddKing).toLowerCase();
        }

        if (!ownerMatched && mEmail && mEmail === mainEmail) {
          ownerMatched = true;
        } else {
          otherMembers.push({ member: m, email: mEmail });
        }
      }

      // If no member matched the main email, the first member was the owner
      const subMembers = (!ownerMatched && otherMembers.length === members.length)
        ? otherMembers.slice(1)
        : otherMembers;

      for (const { member, email } of subMembers) {
        const rawName = (member.FullName || '').trim();
        let finalEmail = email;
        let finalName = rawName;

        if (rawName.includes('@')) {
          finalEmail = rawName.toLowerCase();
          finalName = rawName.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        }

        if (!finalEmail) {
          const domain = mainEmail.includes('@') ? mainEmail.split('@')[1] : 'hfa-client.org';
          const cleanNameSlug = (finalName || 'member').toLowerCase().replace(/[^a-z0-9]/g, '.');
          finalEmail = `${cleanNameSlug}.${member.IDE}@${domain}`;
        }

        finalEmail = finalEmail.trim().toLowerCase();

        // Check for duplicates
        if (existingEmails.has(finalEmail)) {
          finalEmail = `sub_${member.IDE}_${finalEmail}`;
        }
        existingEmails.add(finalEmail);

        const subuserDoc = {
          parent_client_id: comp._id,
          company_name: comp.company_name,
          full_name: finalName || 'Team Member',
          email: finalEmail,
          password: defaultSubuserPasswordHash,
          role: 'client',
          client_role: member.Status === 'Enable' ? 'admin' : 'viewer',
          is_active: member.Status !== 'Disable',
          is_verified: true,
          company_category: comp.company_category || 'certified',
          phone: comp.phone || '',
          address: comp.address || '',
          postcode: comp.postcode || '',
          country: comp.country || 'United Kingdom',
          created_at: regDate,
          createdAt: regDate,
          updated_at: new Date(),
          updatedAt: new Date()
        };

        subuserDocs.push(subuserDoc);
        subusersCreated++;
      }
    }
  }

  if (!dryRun && subuserDocs.length > 0) {
    console.log(`Inserting ${subuserDocs.length} sub-users via insertMany...`);
    await usersCollection.insertMany(subuserDocs, { ordered: false });
  }

  console.log(`\n✓ Companies with multiple members: ${companiesWithSubusers}`);
  console.log(`✓ Total sub-users inserted under respective companies: ${subusersCreated}`);

  // Verification audit
  const finalSubCount = await usersCollection.countDocuments({ parent_client_id: { $ne: null } });
  console.log(`\n======================================================`);
  console.log(`  AUDIT COMPLETE:`);
  console.log(`  - Subusers now in MongoDB: ${finalSubCount}`);
  console.log(`======================================================\n`);

  await mongoose.disconnect();
}

const isDry = process.argv.includes('--dry');
runImportAndDateFix(isDry).catch(console.error);
