import fs from 'fs';
import readline from 'readline';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const filePath = path.resolve(__dirname, '../sql-server-export/export/HalalTick/tables/dbo.tlblogsit.json');
const cachePath = path.resolve(__dirname, '../scratch/loadcomp_companies_cache.json');

function cleanStr(val, defaultVal = '') {
  if (val === null || val === undefined) return defaultVal;
  const s = String(val).trim();
  return s === '' || s === '-' || s === 'None' || s === 'null' ? defaultVal : s;
}

function safeDate(val, defaultVal = null) {
  if (!val) return defaultVal;
  const d = new Date(typeof val === 'string' ? val.trim() : val);
  return isNaN(d.getTime()) ? defaultVal : d;
}

function normalizeName(str) {
  if (!str) return '';
  return str.toLowerCase()
    .replace(/\b(limited|ltd|plc|llc|gmbh|sa|srl|nv|co|corp|inc|bv|oy)\b/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

async function run() {
  console.log('=============================================================================');
  console.log('🚀 IMPORTING & SYNCING ALL 4,354 VALID LOGSHEETS TO MONGODB');
  console.log('=============================================================================');

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI missing in .env');

  console.log('Connecting to MongoDB on localhost...');
  await mongoose.connect(mongoUri);
  console.log(`✅ Connected to MongoDB: ${mongoose.connection.name}\n`);

  const { default: User } = await import('../models/User.js');
  const { default: Site } = await import('../models/Site.js');
  const { default: Application } = await import('../models/Application.js');
  const { default: ApplicationLogsheet } = await import('../models/ApplicationLogsheet.js');

  // Pre-load reference collections
  console.log('📦 Loading existing Users, Sites, and Applications from MongoDB...');
  const users = await User.find({ role: 'client' }).lean();
  const sites = await Site.find({}).lean();
  const apps = await Application.find({}).lean();

  console.log(`   ✓ ${users.length} Client Users loaded`);
  console.log(`   ✓ ${sites.length} Sites loaded`);
  console.log(`   ✓ ${apps.length} Applications loaded\n`);

  // Build lookups
  const userByName = new Map();
  const userByNorm = new Map();
  const userByEmail = new Map();
  const userByCid = new Map();

  users.forEach(u => {
    const cName = cleanStr(u.company_name).toLowerCase();
    const norm = normalizeName(u.company_name);
    const email = cleanStr(u.email).toLowerCase();

    if (cName) userByName.set(cName, u);
    if (norm) userByNorm.set(norm, u);
    if (email) userByEmail.set(email, u);

    const m = (u.notes || '').match(/CID:\s*(\w+)/i) || (u.email || '').match(/client_(\w+)@/i);
    if (m) userByCid.set(m[1].trim(), u);
  });

  if (fs.existsSync(cachePath)) {
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    cache.forEach(c => {
      const cid = cleanStr(c.cid || c.CID);
      const cName = cleanStr(c.cCompanyName || c.company_name || c.CompanyName).toLowerCase();
      const norm = normalizeName(c.cCompanyName || c.company_name || c.CompanyName);
      const email = cleanStr(c.ceaKingp || c.email || c.Email).toLowerCase();

      if (cid && !userByCid.has(cid)) {
        if (cName && userByName.has(cName)) userByCid.set(cid, userByName.get(cName));
        else if (norm && userByNorm.has(norm)) userByCid.set(cid, userByNorm.get(norm));
        else if (email && userByEmail.has(email)) userByCid.set(cid, userByEmail.get(email));
      }
    });
  }

  const sitesByClientId = new Map();
  const siteByCid = new Map();
  sites.forEach(s => {
    const cIdStr = String(s.client_id);
    if (!sitesByClientId.has(cIdStr)) sitesByClientId.set(cIdStr, []);
    sitesByClientId.get(cIdStr).push(s);

    if (s.client_code) siteByCid.set(String(s.client_code).trim(), s);
  });

  const appsByClientId = new Map();
  const appByAppNum = new Map();
  apps.forEach(a => {
    const cIdStr = String(a.client_id);
    if (!appsByClientId.has(cIdStr)) appsByClientId.set(cIdStr, []);
    appsByClientId.get(cIdStr).push(a);

    if (a.application_number) appByAppNum.set(a.application_number.toLowerCase().trim(), a);
  });

  // Stream parse dbo.tlblogsit.json
  console.log('⏳ Streaming 4,586 logsheets from SQL export...');
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 256 * 1024 });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let inRows = false;
  let totalParsed = 0;
  let binExcluded = 0;
  const validLogsheetDocs = [];
  const statusStats = {
    'Signed': 0,
    'Completed': 0,
    'Waiting For Certificate': 0,
    'Waiting for Signature': 0
  };

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!inRows) {
      if (trimmed.startsWith('"rows": [')) inRows = true;
      continue;
    }
    if (trimmed.startsWith('{') && (trimmed.endsWith('},') || trimmed.endsWith('}'))) {
      totalParsed++;
      const cleanJson = trimmed.endsWith(',') ? trimmed.slice(0, -1) : trimmed;
      try {
        const row = JSON.parse(cleanJson);
        const rawStatus = cleanStr(row.Statuss);

        // EXCLUDE BIN AS DIRECTED BY USER
        if (rawStatus === 'Bin' || rawStatus.toLowerCase() === 'bin') {
          binExcluded++;
          continue;
        }

        // Map status strictly according to user's instructions:
        // - "Done" -> "Signed"
        // - "Certificate Sent" -> "Completed"
        // - "Waiting for Signature" -> "Waiting for Signature"
        // - "Account Approval" / "Product(s) Review" / "Ready for Certificate" -> "Waiting For Certificate"
        let mappedStatus = 'Waiting for Signature';
        const lowerRaw = rawStatus.toLowerCase();
        if (lowerRaw === 'done') {
          mappedStatus = 'Signed';
        } else if (lowerRaw.includes('certificate sent') || lowerRaw === 'certficate sent') {
          mappedStatus = 'Completed';
        } else if (lowerRaw.includes('waiting for signature')) {
          mappedStatus = 'Waiting for Signature';
        } else if (
          lowerRaw.includes('ready for certificate') ||
          lowerRaw.includes('account approval') ||
          lowerRaw.includes('product')
        ) {
          mappedStatus = 'Waiting For Certificate';
        } else {
          // Fallback based on signatures
          if (row.ceoby || row.MufityBy || row.SchemBy || row.Singnaturee) {
            mappedStatus = 'Signed';
          } else {
            mappedStatus = 'Waiting for Signature';
          }
        }

        statusStats[mappedStatus] = (statusStats[mappedStatus] || 0) + 1;

        const ider = cleanStr(row.ider);
        const cid = cleanStr(row.CID);
        const compName = cleanStr(row.CName);
        const normComp = normalizeName(compName);
        const email = cleanStr(row.Conemail).toLowerCase();

        // Match user
        let matchedUser = (cid && userByCid.get(cid)) ||
          (compName && userByName.get(compName.toLowerCase())) ||
          (normComp && userByNorm.get(normComp)) ||
          (email && userByEmail.get(email)) || null;

        const clientId = matchedUser ? matchedUser._id : undefined;

        // Match site
        let matchedSite = null;
        if (matchedUser) {
          const userSites = sitesByClientId.get(String(matchedUser._id)) || [];
          if (userSites.length > 0) {
            const rawSiteName = cleanStr(row.SiteName).toLowerCase();
            matchedSite = userSites.find(s => cleanStr(s.name).toLowerCase() === rawSiteName) || userSites[0];
          }
        }
        if (!matchedSite && cid && siteByCid.has(cid)) {
          matchedSite = siteByCid.get(cid);
        }

        // Match application
        // Match application strictly by AppID if provided
        let matchedApp = null;
        const appId = cleanStr(row.AppID);
        if (appId) {
          matchedApp = appByAppNum.get(appId.toLowerCase()) ||
            appByAppNum.get(`app-${appId}-${cid}`.toLowerCase()) ||
            appByAppNum.get(`ren-${appId}-${cid}`.toLowerCase()) || null;
        }

        const logDoc = {
          legacy_id: ider,
          direct_ref: ider ? `LOG-${ider}` : undefined,
          source_type: 'application',
          logsheet_type: 'application',
          is_seed: true,
          confirmed: true,
          client_id: clientId,
          site_id: matchedSite ? matchedSite._id : undefined,
          application_id: matchedApp ? matchedApp._id : undefined,
          company_name: compName || (matchedUser ? matchedUser.company_name : 'Client Facility'),
          company_address: cleanStr(row.CAddress) || (matchedUser ? matchedUser.address : ''),
          manufacturing_address: cleanStr(row.ManufactAddss) || cleanStr(row.CAddress),
          site_name: cleanStr(row.SiteName) || (matchedSite ? matchedSite.name : (cleanStr(row.ManufactAddss) || 'Main Facility')),
          contact_person: cleanStr(row.ContactPerson) || (matchedUser ? matchedUser.full_name : ''),
          contact_email: email || (matchedUser ? matchedUser.email : ''),
          nature_of_business: cleanStr(row.NatureOFBus) || 'Food Processing',
          product_category: cleanStr(row.ProCate) || 'General',
          certificate_standard: cleanStr(row.ApplicationCategory) || 'HFA Standard',
          certificate_type: cleanStr(row.ApplicationType) || 'Halal Certification',
          issue_date: safeDate(row.IssDateOCert, null),
          expiry_date: safeDate(row.ExPiryDatCert, null),
          audit_type: cleanStr(row.AuditTy) || 'Annual',
          audit_date: safeDate(row.Audidate, null),
          auditors: cleanStr(row.Auditors) || '',
          ncs_close: cleanStr(row.NCsCloseifany) || '',
          docs_satisfactory: cleanStr(row.ADRAFS) || '',
          pork_free_statement: cleanStr(row.PFSSPPS) || '',
          reviewer_name: cleanStr(row.Name) || cleanStr(row.FoodTecName) || 'HFA Auditor',
          review_date: safeDate(row.ReDate, null),
          annual_certificate: row.AnCer && String(row.AnCer).toLowerCase().includes('y') ? 'Yes' : 'No',
          batch_certificate: row.BaCert && String(row.BaCert).toLowerCase().includes('y') ? 'Yes' : 'No',
          new_products_only: row.OnAddONePro && String(row.OnAddONePro).toLowerCase().includes('y') ? 'Yes' : 'No',
          new_site_line: row.AddONewSite && String(row.AddONewSite).toLowerCase().includes('y') ? 'Yes' : 'No',
          new_client: row.NewClite && String(row.NewClite).toLowerCase().includes('y') ? 'Yes' : 'No',
          agreement_signed: row.AgSig && String(row.AgSig).toLowerCase().includes('y') ? 'Yes' : 'No',
          status_date: safeDate(row.daOAgree, null),
          comment: cleanStr(row.Commenter) || cleanStr(row.Commenter1) || '',
          status: mappedStatus,
          // Signatures
          mufti_signature: row.Mufitysinf ? `data:image/png;base64,${row.Mufitysinf}` : (row.Singnaturee ? `data:image/png;base64,${row.Singnaturee}` : null),
          mufti_sign_name: cleanStr(row.MufityBy) || cleanStr(row.NameC) || 'Mufti Signatory',
          mufti_sign_date: safeDate(row.Mufitydate, safeDate(row.Datee, new Date())),
          ceo_signature: row.cebsing ? `data:image/png;base64,${row.cebsing}` : null,
          ceo_sign_name: cleanStr(row.ceoby) || cleanStr(row.NameC2) || 'CEO Signatory',
          ceo_sign_date: safeDate(row.ceodateby, safeDate(row.Datee, new Date())),
          manager_signature: row.SchemSing ? `data:image/png;base64,${row.SchemSing}` : null,
          manager_sign_name: cleanStr(row.SchemBy) || cleanStr(row.NameC3) || 'Scheme Manager',
          manager_sign_date: safeDate(row.SchemDate, safeDate(row.Datee, new Date())),
          mufti2_signature: row.Mufitysinf1 ? `data:image/png;base64,${row.Mufitysinf1}` : null,
          mufti2_sign_name: cleanStr(row.MufityBy1) || cleanStr(row.NameC4) || '',
          mufti2_sign_date: safeDate(row.Mufitydate1, null),
          created_at: safeDate(row.dayy, safeDate(row.Datee, new Date())),
          createdAt: safeDate(row.dayy, safeDate(row.Datee, new Date()))
        };

        validLogsheetDocs.push(logDoc);
      } catch (err) {}
    }
  }

  console.log(`\n📊 Extraction Summary:`);
  console.log(`   • Total SQL Rows Parsed: ${totalParsed}`);
  console.log(`   • Excluded 'Bin' Status: ${binExcluded}`);
  console.log(`   • Valid Logsheets to Import: ${validLogsheetDocs.length}\n`);

  console.log(`🎯 Status Breakdown of Valid Logsheets:`);
  for (const [st, c] of Object.entries(statusStats)) {
    console.log(`   • ${st.padEnd(25)}: ${c}`);
  }

  // Clear older seed logsheets to prevent stale/duplicate collisions
  console.log('\n🧹 Clearing old seed logsheets in MongoDB...');
  const delRes = await ApplicationLogsheet.deleteMany({ is_seed: true });
  console.log(`   ✓ Removed ${delRes.deletedCount} previous seed logsheet entries`);

  // Also purge any logsheets with 'Bin' status
  const binDelRes = await ApplicationLogsheet.deleteMany({ status: { $regex: /^bin$/i } });
  if (binDelRes.deletedCount > 0) {
    console.log(`   ✓ Purged ${binDelRes.deletedCount} previous logsheets with 'Bin' status`);
  }

  // Bulk Insert in batches of 500
  console.log('\n📥 Writing 4,354 structured logsheets into MongoDB in batches...');
  const BATCH_SIZE = 500;
  let insertedCount = 0;

  for (let i = 0; i < validLogsheetDocs.length; i += BATCH_SIZE) {
    const batch = validLogsheetDocs.slice(i, i + BATCH_SIZE);
    await ApplicationLogsheet.insertMany(batch, { ordered: false });
    insertedCount += batch.length;
    console.log(`   ✓ Inserted [${insertedCount}/${validLogsheetDocs.length}] logsheets...`);
  }

  // Also link application.logsheet_id where application_id was resolved
  console.log('\n🔗 Linking applications to their imported logsheets...');
  const linked = await ApplicationLogsheet.find({ application_id: { $ne: null } }, '_id application_id').lean();
  let linkCount = 0;
  for (const l of linked) {
    await Application.updateOne({ _id: l.application_id, logsheet_id: null }, { $set: { logsheet_id: l._id } });
    linkCount++;
  }
  console.log(`   ✓ Linked ${linkCount} applications to their respective logsheets.`);

  // Final Verification
  const totalInDb = await ApplicationLogsheet.countDocuments({});
  const finalStatusCounts = await ApplicationLogsheet.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ]);

  console.log('\n=============================================================================');
  console.log('✅ LOGSHEET IMPORT & SYNCHRONIZATION COMPLETE!');
  console.log('=============================================================================');
  console.log(`📋 Total Logsheets in MongoDB : ${totalInDb}`);
  console.log(`📊 Final Statuses in Database:`);
  finalStatusCounts.forEach(s => {
    console.log(`   • ${String(s._id).padEnd(25)}: ${s.count}`);
  });
  console.log('=============================================================================\n');

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error('Fatal error syncing logsheets:', err);
  process.exit(1);
});
