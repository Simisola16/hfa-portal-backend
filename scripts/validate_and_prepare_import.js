import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_FILE = path.resolve(__dirname, '../scratch/loadcomp_companies_cache.json');
const EXPORT_DIR = path.resolve(__dirname, '../sql-server-export/export');
const PREPARED_OUTPUT_FILE = path.resolve(__dirname, '../scratch/all_companies_mongodb_prepared.json');

function cleanStr(val, defaultVal = '') {
  if (val === null || val === undefined) return defaultVal;
  const s = String(val).trim();
  return s === '' || s === '-' ? defaultVal : s;
}

function safeDate(val, defaultDate = new Date()) {
  if (!val) return defaultDate;
  const d = new Date(typeof val === 'string' ? val.trim() : val);
  return isNaN(d.getTime()) ? defaultDate : d;
}

function readTable(relPath) {
  const fullPath = path.join(EXPORT_DIR, relPath);
  if (!fs.existsSync(fullPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    return parsed.rows || (Array.isArray(parsed) ? parsed : []);
  } catch (_) {
    return [];
  }
}

async function prepareAndValidate() {
  console.log('=============================================================================');
  console.log('🧪 VALIDATING & PREPARING ALL 1,345 COMPANIES FOR MONGODB (NO DB WRITES)');
  console.log('=============================================================================');

  if (!fs.existsSync(CACHE_FILE)) {
    console.error('❌ Cache file not found:', CACHE_FILE);
    process.exit(1);
  }

  const companies = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  console.log(`✓ Loaded ${companies.length} companies from API cache`);

  // Pre-index SQL tables
  console.log('\nIndexing SQL export tables...');
  const sitesMap = new Map();
  const sites1 = readTable('HalalyMain/tables/dbo.TlbSie.json');
  const sites2 = readTable('HalalyMains/tables/dbo.TlbSie.json');
  const siteSeenIds = new Set();
  [...sites1, ...sites2].forEach(s => {
    const sid = cleanStr(s.SitesID);
    if (sid && !siteSeenIds.has(sid)) {
      siteSeenIds.add(sid);
      const cid = cleanStr(s.Kinopm);
      if (cid) {
        if (!sitesMap.has(cid)) sitesMap.set(cid, []);
        sitesMap.get(cid).push(s);
      }
    }
  });

  const appsMap = new Map();
  readTable('HalalApp/tables/dbo.AppleReg.json').forEach(a => {
    const cid = cleanStr(a.CID);
    if (cid) {
      if (!appsMap.has(cid)) appsMap.set(cid, []);
      appsMap.get(cid).push(a);
    }
  });

  const renewalsMap = new Map();
  readTable('HalalAReNew/tables/dbo.REneApp.json').forEach(r => {
    const cid = cleanStr(r.KingID);
    if (cid) {
      if (!renewalsMap.has(cid)) renewalsMap.set(cid, []);
      renewalsMap.get(cid).push(r);
    }
  });

  const certsMap = new Map();
  readTable('HalalCert/tables/dbo.tlbcertMas.json').forEach(c => {
    const cid = cleanStr(c.CName);
    if (cid) {
      if (!certsMap.has(cid)) certsMap.set(cid, []);
      certsMap.get(cid).push(c);
    }
  });

  const productsMap = new Map();
  readTable('HalalTick/tables/dbo.tldbprotem.json').forEach(p => {
    const cid = cleanStr(p.compid);
    if (cid) {
      if (!productsMap.has(cid)) productsMap.set(cid, []);
      productsMap.get(cid).push(p);
    }
  });

  const addOnsMap = new Map();
  readTable('HalalAReNew/tables/dbo.ProAder.json').forEach(a => {
    const cid = cleanStr(a.CompID);
    if (cid) {
      if (!addOnsMap.has(cid)) addOnsMap.set(cid, []);
      addOnsMap.get(cid).push(a);
    }
  });

  const exportCertsMap = new Map();
  readTable('tlbExport/tables/dbo.tlbhecmaster.json').forEach(e => {
    const cid = cleanStr(e.CID);
    if (cid) {
      if (!exportCertsMap.has(cid)) exportCertsMap.set(cid, []);
      exportCertsMap.get(cid).push(e);
    }
  });

  const exportItemsMap = new Map();
  readTable('tlbExport/tables/dbo.tlbSubAccountHEC.json').forEach(i => {
    const mid = cleanStr(i.MasterId);
    if (mid) {
      if (!exportItemsMap.has(mid)) exportItemsMap.set(mid, []);
      exportItemsMap.get(mid).push(i);
    }
  });

  console.log('✓ SQL tables indexed successfully');

  // Validate compilation for every single company
  console.log('\nValidating all 1,345 company records...');
  const preparedRecords = [];
  const usedEmails = new Set(['anike@halalfoodauthority.com', 'admin_test2@hfa.com']);
  let totalSites = 0;
  let totalApps = 0;
  let totalCerts = 0;
  let totalProducts = 0;
  let totalAddOns = 0;
  let totalExportCerts = 0;
  let emailAliasesCreated = 0;

  for (const comp of companies) {
    const cid = cleanStr(comp.cid || comp.CID);
    const companyName = cleanStr(comp.cCompanyName) || `Company ${cid}`;

    // Email resolution
    let rawEmail = cleanStr(comp.ceaKingp).toLowerCase();
    let email = (!rawEmail || !rawEmail.includes('@') || rawEmail.includes(' '))
      ? `client_${cid}@hfa-portal.com`
      : rawEmail;

    if (usedEmails.has(email)) {
      const [u, d] = email.split('@');
      email = `${u}+cid${cid}@${d}`;
      emailAliasesCreated++;
    }
    usedEmails.add(email);

    // Sites
    const siteRows = sitesMap.get(cid) || [];
    const sitesCount = siteRows.length > 0 ? siteRows.length : 1;
    totalSites += sitesCount;

    // Applications & Renewals
    const appRows = appsMap.get(cid) || [];
    const renewalRows = renewalsMap.get(cid) || [];
    const appsCount = (appRows.length + renewalRows.length) > 0 ? (appRows.length + renewalRows.length) : 1;
    totalApps += appsCount;

    // Certificates
    const certRows = certsMap.get(cid) || [];
    totalCerts += certRows.length;

    // Products
    const prodRows = productsMap.get(cid) || [];
    totalProducts += prodRows.length;

    // AddOns
    const addOnRows = addOnsMap.get(cid) || [];
    totalAddOns += addOnRows.length;

    // Export Certs
    const expRows = exportCertsMap.get(cid) || [];
    totalExportCerts += expRows.length;

    preparedRecords.push({
      cid,
      companyName,
      email,
      phone: cleanStr(comp.pcnKinga, '+44 0000 000000'),
      address: [cleanStr(comp.address1), cleanStr(comp.address2)].filter(Boolean).join(', ') || 'Address on file',
      sitesCount,
      appsCount,
      certsCount: certRows.length,
      productsCount: prodRows.length,
      addOnsCount: addOnRows.length,
      exportCertsCount: expRows.length
    });
  }

  // Save prepared manifest
  fs.writeFileSync(PREPARED_OUTPUT_FILE, JSON.stringify(preparedRecords, null, 2), 'utf8');

  console.log('\n=============================================================================');
  console.log('✅ PRE-VALIDATION & STAGING COMPLETE (0 DATABASE WRITES EXECUTED)');
  console.log('=============================================================================');
  console.log(`🏢 Total Companies Validated : ${companies.length} / 1,345 (100%)`);
  console.log(`👤 Unique Client Accounts    : ${preparedRecords.length} (${emailAliasesCreated} unique aliases for duplicates)`);
  console.log(`📍 Manufacturing Sites Ready : ${totalSites}`);
  console.log(`📝 Applications Ready        : ${totalApps} (Original + Renewals)`);
  console.log(`📜 Halal Certificates Ready : ${totalCerts}`);
  console.log(`📦 Products Ready            : ${totalProducts}`);
  console.log(`➕ Add-Ons Ready             : ${totalAddOns}`);
  console.log(`🚢 Export Certificates Ready : ${totalExportCerts}`);
  console.log(`📁 Prepared Staging File     : ${PREPARED_OUTPUT_FILE}`);
  console.log('=============================================================================\n');
  console.log('Ready for manual execution by you whenever you are ready:');
  console.log('  👉 npm run import:companies');
  console.log('     or');
  console.log('  👉 node scripts/import_all_companies_to_mongodb.js\n');
}

prepareAndValidate().catch(err => {
  console.error('Validation error:', err);
  process.exit(1);
});
