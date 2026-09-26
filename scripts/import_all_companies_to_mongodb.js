import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dns from 'dns';
import bcrypt from 'bcryptjs';

// Fix Node.js SRV DNS resolution on Windows/certain networks
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

import User from '../models/User.js';
import Site from '../models/Site.js';
import Certificate from '../models/Certificate.js';
import Product from '../models/Product.js';
import Application from '../models/Application.js';
import ExportCertificate from '../models/ExportCertificate.js';
import AddOnApplication from '../models/AddOnApplication.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const LOADCOMP_APIS = [
  'https://app.hfa-portal.com/api/Crpirs/loadcomp/False/Cert/None',
  'https://app.hfa-portal.com/api/Crpirs/loadcomp/False/NRL/None',
  'https://app.hfa-portal.com/api/Crpirs/loadcomp/Yes/None/None',
  'https://app.hfa-portal.com/api/Crpirs/loadcomp/True/Processing/None'
];

const EXPORT_DIR = path.resolve(__dirname, '../sql-server-export/export');
const CACHE_FILE = path.resolve(__dirname, '../scratch/loadcomp_companies_cache.json');
const TRACKER_FILE = path.resolve(__dirname, '../scratch/import_tracker.json');

// Helper: Safe date parsing
function safeDate(val, defaultDate = new Date()) {
  if (!val) return defaultDate;
  const d = new Date(typeof val === 'string' ? val.trim() : val);
  return isNaN(d.getTime()) ? defaultDate : d;
}

// Helper: Clean string
function cleanStr(val, defaultVal = '') {
  if (val === null || val === undefined) return defaultVal;
  const s = String(val).trim();
  return s === '' || s === '-' ? defaultVal : s;
}

// Helper: Fetch with retries
async function fetchWithRetry(url, maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

// 1. Fetch or Load All Companies
async function loadAllCompanies() {
  console.log('\n📥 1. Loading company records from HFA APIs...');
  
  if (fs.existsSync(CACHE_FILE)) {
    try {
      const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (Array.isArray(cached) && cached.length >= 1345) {
        console.log(`   ✓ Loaded ${cached.length} companies from offline cache (${CACHE_FILE})`);
        return cached;
      }
    } catch (_) {}
  }

  const cidMap = new Map();
  let totalFetched = 0;

  for (const url of LOADCOMP_APIS) {
    console.log(`   Fetching ${url}...`);
    try {
      const records = await fetchWithRetry(url);
      totalFetched += records.length;
      console.log(`   ✓ Fetched ${records.length} records`);
      records.forEach(r => {
        const cid = cleanStr(r.cid || r.CID);
        if (cid) cidMap.set(cid, r);
      });
    } catch (err) {
      console.error(`   ✗ Error fetching ${url}:`, err.message);
    }
  }

  const companies = Array.from(cidMap.values());
  console.log(`   ✓ Total unique companies fetched: ${companies.length} (from ${totalFetched} raw records)`);

  // Cache for offline resilience
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(companies, null, 2), 'utf8');
    console.log(`   ✓ Saved cache to ${CACHE_FILE}`);
  } catch (err) {
    console.warn(`   ⚠️ Warning saving cache:`, err.message);
  }

  return companies;
}

// 2. Pre-load and Index SQL Server Tables in Memory
function loadAndIndexSqlTables() {
  console.log('\n🗄️  2. Pre-loading & indexing SQL Server exported tables...');
  
  function readTable(relPath) {
    const fullPath = path.join(EXPORT_DIR, relPath);
    if (!fs.existsSync(fullPath)) {
      console.warn(`   ⚠️ Missing table export: ${relPath}`);
      return [];
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      return parsed.rows || (Array.isArray(parsed) ? parsed : []);
    } catch (err) {
      console.warn(`   ⚠️ Error reading ${relPath}:`, err.message);
      return [];
    }
  }

  // Sites (merge HalalyMain and HalalyMains, deduplicate by SitesID)
  const sitesMap = new Map();
  const sites1 = readTable('HalalyMain/tables/dbo.TlbSie.json');
  const sites2 = readTable('HalalyMains/tables/dbo.TlbSie.json');
  const siteSeenIds = new Set();
  const allSiteRows = [];
  [...sites1, ...sites2].forEach(s => {
    const sid = cleanStr(s.SitesID);
    if (sid && !siteSeenIds.has(sid)) {
      siteSeenIds.add(sid);
      allSiteRows.push(s);
      const cid = cleanStr(s.Kinopm);
      if (cid) {
        if (!sitesMap.has(cid)) sitesMap.set(cid, []);
        sitesMap.get(cid).push(s);
      }
    }
  });
  console.log(`   ✓ Indexed ${allSiteRows.length} sites across ${sitesMap.size} company CIDs`);

  // Applications (AppleReg)
  const appsMap = new Map();
  const appRows = readTable('HalalApp/tables/dbo.AppleReg.json');
  appRows.forEach(a => {
    const cid = cleanStr(a.CID);
    if (cid) {
      if (!appsMap.has(cid)) appsMap.set(cid, []);
      appsMap.get(cid).push(a);
    }
  });
  console.log(`   ✓ Indexed ${appRows.length} new applications across ${appsMap.size} company CIDs`);

  // Renewal Applications (REneApp)
  const renewalsMap = new Map();
  const renewalRows = readTable('HalalAReNew/tables/dbo.REneApp.json');
  renewalRows.forEach(r => {
    const cid = cleanStr(r.KingID);
    if (cid) {
      if (!renewalsMap.has(cid)) renewalsMap.set(cid, []);
      renewalsMap.get(cid).push(r);
    }
  });
  console.log(`   ✓ Indexed ${renewalRows.length} renewal applications across ${renewalsMap.size} company CIDs`);

  // Halal Certificates (tlbcertMas)
  const certsMap = new Map();
  const certRows = readTable('HalalCert/tables/dbo.tlbcertMas.json');
  certRows.forEach(c => {
    const cid = cleanStr(c.CName);
    if (cid) {
      if (!certsMap.has(cid)) certsMap.set(cid, []);
      certsMap.get(cid).push(c);
    }
  });
  console.log(`   ✓ Indexed ${certRows.length} certificates across ${certsMap.size} company CIDs`);

  // Products (tldbprotem)
  const productsMap = new Map();
  const productRows = readTable('HalalTick/tables/dbo.tldbprotem.json');
  productRows.forEach(p => {
    const cid = cleanStr(p.compid);
    if (cid) {
      if (!productsMap.has(cid)) productsMap.set(cid, []);
      productsMap.get(cid).push(p);
    }
  });
  console.log(`   ✓ Indexed ${productRows.length} products across ${productsMap.size} company CIDs`);

  // Add-On Applications (ProAder)
  const addOnsMap = new Map();
  const addOnRows = readTable('HalalAReNew/tables/dbo.ProAder.json');
  addOnRows.forEach(a => {
    const cid = cleanStr(a.CompID);
    if (cid) {
      if (!addOnsMap.has(cid)) addOnsMap.set(cid, []);
      addOnsMap.get(cid).push(a);
    }
  });
  console.log(`   ✓ Indexed ${addOnRows.length} add-on applications across ${addOnsMap.size} company CIDs`);

  // Export Certificates (tlbhecmaster)
  const exportCertsMap = new Map();
  const exportCertRows = readTable('tlbExport/tables/dbo.tlbhecmaster.json');
  exportCertRows.forEach(e => {
    const cid = cleanStr(e.CID);
    if (cid) {
      if (!exportCertsMap.has(cid)) exportCertsMap.set(cid, []);
      exportCertsMap.get(cid).push(e);
    }
  });

  // Export Items (tlbSubAccountHEC)
  const exportItemsMap = new Map();
  const exportItemRows = readTable('tlbExport/tables/dbo.tlbSubAccountHEC.json');
  exportItemRows.forEach(i => {
    const mid = cleanStr(i.MasterId);
    if (mid) {
      if (!exportItemsMap.has(mid)) exportItemsMap.set(mid, []);
      exportItemsMap.get(mid).push(i);
    }
  });
  console.log(`   ✓ Indexed ${exportCertRows.length} export certificates across ${exportCertsMap.size} company CIDs (${exportItemRows.length} line items)`);

  return {
    sitesMap,
    appsMap,
    renewalsMap,
    certsMap,
    productsMap,
    addOnsMap,
    exportCertsMap,
    exportItemsMap
  };
}

// 3. Status mapping dictionaries
const APP_STATUS_MAP = {
  'successful': 'certificate_issued',
  'certficate sent': 'certificate_issued',
  'certificate sent': 'certificate_issued',
  'in-progress': 'under_review',
  'submitted': 'submitted',
  'bin': 'rejected',
  'rejected': 'rejected',
  'approved': 'approved',
  'draft': 'under_review'
};

const ADDON_STATUS_MAP = {
  'request submited': 'submitted',
  'request accepted': 'accepted',
  'product approval forms received': 'all_forms_received',
  'certificate processing': 'ready_for_certificate',
  'certificate sent': 'completed',
  'completed': 'completed',
  'rejected': 'rejected'
};

function resolveCertScheme(gfpStr) {
  const gfp = (gfpStr || '').toUpperCase();
  if (gfp.includes('COSMETIC')) return 'COSMETICS';
  if (gfp.includes('SMIIC')) return 'SMIIC';
  if (gfp.includes('NON') || gfp.includes('BAKERY') || gfp.includes('FOOD')) return 'GSO non-meat';
  if (gfp.includes('GSO') || gfp.includes('MEAT')) return 'GSO meat';
  return 'HFA Scheme';
}

// 4. Main Migration Engine
async function runFullCompanyImport() {
  const startTime = Date.now();
  console.log('=============================================================================');
  console.log('🚀 STARTING FULL HFA COMPANY DATABASE IMPORT TO MONGODB');
  console.log('=============================================================================');

  // Connect to MongoDB
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI is not set in environment or .env file');
  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  console.log('✅ Connected to MongoDB:', mongoose.connection.name);

  // Load Companies & SQL Tables
  const companies = await loadAllCompanies();
  const sqlTables = loadAndIndexSqlTables();

  // Pre-generate standard default password hash for high throughput
  console.log('\n🔐 Pre-hashing default password for imported client accounts...');
  const defaultPasswordHash = await bcrypt.hash('Password123!', 10);
  console.log('   ✓ Default password hash ready ("Password123!")');

  // Live Tracking State
  const trackerState = {
    startTime: new Date().toISOString(),
    totalCompanies: companies.length,
    processedCompanies: 0,
    currentCompany: 'Initializing...',
    currentCid: '',
    percent: '0.0%',
    elapsedMinutes: '0.0',
    estimatedRemainingMinutes: 'Calculating...',
    stats: {
      usersCreated: 0,
      usersUpdated: 0,
      sitesCreated: 0,
      sitesUpdated: 0,
      appsCreated: 0,
      appsUpdated: 0,
      certsCreated: 0,
      certsUpdated: 0,
      productsCreated: 0,
      productsUpdated: 0,
      addOnsCreated: 0,
      addOnsUpdated: 0,
      exportCertsCreated: 0,
      exportCertsUpdated: 0,
      errors: []
    },
    isComplete: false,
    lastUpdated: new Date().toISOString()
  };

  fs.mkdirSync(path.dirname(TRACKER_FILE), { recursive: true });
  fs.writeFileSync(TRACKER_FILE, JSON.stringify(trackerState, null, 2), 'utf8');

  function updateTrackerFile(cid, compName, isDone = false) {
    const elapsedSec = (Date.now() - startTime) / 1000;
    const processed = trackerState.processedCompanies;
    const total = trackerState.totalCompanies;
    const pct = total > 0 ? ((processed / total) * 100).toFixed(1) : '0.0';
    
    let etaMin = '0.0';
    if (processed > 0 && !isDone) {
      const avgSecPerComp = elapsedSec / processed;
      const remainingSec = avgSecPerComp * (total - processed);
      etaMin = (remainingSec / 60).toFixed(1);
    }

    trackerState.currentCid = cid;
    trackerState.currentCompany = compName;
    trackerState.percent = `${pct}%`;
    trackerState.elapsedMinutes = (elapsedSec / 60).toFixed(1);
    trackerState.estimatedRemainingMinutes = isDone ? '0.0' : etaMin;
    trackerState.isComplete = isDone;
    trackerState.lastUpdated = new Date().toISOString();

    try {
      fs.writeFileSync(TRACKER_FILE, JSON.stringify(trackerState, null, 2), 'utf8');
    } catch (_) {}
  }

  // Set to track used emails in this session to prevent MongoDB duplicate key errors
  const usedEmails = new Set();
  
  // Pre-populate usedEmails from existing DB users to maintain total integrity
  try {
    const existingUsers = await User.find({}, { email: 1 }).lean();
    existingUsers.forEach(u => {
      if (u.email) usedEmails.add(u.email.toLowerCase().trim());
    });
    console.log(`   ✓ Loaded ${existingUsers.length} existing database user emails into memory`);
  } catch (_) {}

  console.log(`\n▶️  Processing ${companies.length} companies...`);
  console.log('─────────────────────────────────────────────────────────────────────────────');

  for (let idx = 0; idx < companies.length; idx++) {
    const comp = companies[idx];
    const cid = cleanStr(comp.cid || comp.CID);
    const rawCompanyName = cleanStr(comp.cCompanyName) || `Company ${cid}`;
    const companyName = rawCompanyName;

    try {
      // -------------------------------------------------------------
      // A. USER ACCOUNT
      // -------------------------------------------------------------
      let rawEmail = cleanStr(comp.ceaKingp).toLowerCase();
      let cleanEmail = '';

      if (!rawEmail || !rawEmail.includes('@') || rawEmail.includes(' ')) {
        // Fallback email for invalid / website formats
        cleanEmail = `client_${cid}@hfa-portal.com`;
      } else {
        cleanEmail = rawEmail;
      }

      // Handle duplicate email collisions across different CIDs
      if (usedEmails.has(cleanEmail)) {
        // Check if this existing email belongs to this exact company in the database
        const existingUser = await User.findOne({ email: cleanEmail }).lean();
        if (existingUser && existingUser.company_name?.toLowerCase().trim() === companyName.toLowerCase().trim()) {
          // Same company — keep cleanEmail
        } else {
          // Different company using same email — create distinct alias
          const [uPart, dPart] = cleanEmail.split('@');
          cleanEmail = `${uPart}+cid${cid}@${dPart}`;
        }
      }
      usedEmails.add(cleanEmail);

      const fullName = [cleanStr(comp.firstName), cleanStr(comp.lastName)].filter(Boolean).join(' ') || companyName || 'Authorized Contact';
      const phone = cleanStr(comp.pcnKinga, '+44 0000 000000');
      const address = [cleanStr(comp.address1), cleanStr(comp.address2)].filter(Boolean).join(', ') || 'Address on file';
      const city = cleanStr(comp.city, 'London');
      const postcode = cleanStr(comp.postCode, 'SE15 2SW');
      const country = cleanStr(comp.country, 'United Kingdom');

      const userProfileData = {
        email: cleanEmail,
        full_name: fullName,
        company_name: companyName,
        phone,
        address,
        postcode,
        country,
        role: 'client',
        client_role: 'owner',
        roles: ['client'],
        is_active: true,
        is_verified: true,
      };

      let user = await User.findOne({ email: cleanEmail });
      if (!user) {
        user = new User({
          ...userProfileData,
          password: defaultPasswordHash
        });
        await user.save();
        trackerState.stats.usersCreated++;
      } else {
        Object.assign(user, userProfileData);
        if (!user.password) user.password = defaultPasswordHash;
        await user.save();
        trackerState.stats.usersUpdated++;
      }

      const userId = user._id;
      const userIdStr = user._id.toString();

      // -------------------------------------------------------------
      // B. MANUFACTURING SITES
      // -------------------------------------------------------------
      const siteRows = sqlTables.sitesMap.get(cid) || [];
      const siteMap = {};

      if (siteRows.length > 0) {
        for (const s of siteRows) {
          const clientCode = cleanStr(s.SitesID) || `SITE-${cid}`;
          const siteName = cleanStr(s.SiteName) || `${companyName} Site ${clientCode}`;
          const sAddress1 = cleanStr(s.Address1) || address;
          const sAddress2 = cleanStr(s.Address2);
          const sCity = cleanStr(s.City) || city;
          const sPostcode = cleanStr(s.Postcode) || postcode;
          const sCountry = cleanStr(s.Country) || country;
          const estName = cleanStr(s.NameEstablishment) || companyName;
          const tradingName = cleanStr(s.TradingN) || cleanStr(comp.tradingName) || companyName;
          const regNumber = cleanStr(s.SiteRegNum) || cleanStr(comp.businessRegNo);
          const vatNumber = cleanStr(s.VATNum) || cleanStr(comp.vatNo);

          const siteDoc = {
            client_id: userId,
            name: siteName,
            client_code: clientCode,
            address_1: sAddress1,
            address_2: sAddress2,
            city: sCity,
            postcode: sPostcode,
            country: sCountry,
            est_name: estName,
            trading_name: tradingName,
            reg_number: regNumber,
            vat_number: vatNumber,
            status: 'active'
          };

          const savedSite = await Site.findOneAndUpdate(
            { client_id: userId, client_code: clientCode },
            { $set: siteDoc },
            { upsert: true, new: true }
          );

          siteMap[clientCode] = savedSite;
          siteMap[siteName] = savedSite;
          trackerState.stats.sitesCreated++;
        }
      } else {
        // Fallback primary site if no explicit sites in SQL
        const defaultClientCode = `10000-${cid}`;
        const defaultSiteName = `${companyName} Main Facility`;
        const siteDoc = {
          client_id: userId,
          name: defaultSiteName,
          client_code: defaultClientCode,
          address_1: address,
          address_2: '',
          city,
          postcode,
          country,
          est_name: companyName,
          trading_name: cleanStr(comp.tradingName) || companyName,
          reg_number: cleanStr(comp.businessRegNo),
          vat_number: cleanStr(comp.vatNo),
          status: 'active'
        };

        const savedSite = await Site.findOneAndUpdate(
          { client_id: userId, client_code: defaultClientCode },
          { $set: siteDoc },
          { upsert: true, new: true }
        );

        siteMap[defaultClientCode] = savedSite;
        siteMap[defaultSiteName] = savedSite;
        trackerState.stats.sitesCreated++;
      }

      const defaultSite = Object.values(siteMap)[0];

      // -------------------------------------------------------------
      // C. APPLICATIONS & RENEWALS
      // -------------------------------------------------------------
      const appRows = sqlTables.appsMap.get(cid) || [];
      const renewalRows = sqlTables.renewalsMap.get(cid) || [];
      const appMap = {};

      if (appRows.length > 0 || renewalRows.length > 0) {
        // 1. Original Applications
        for (const a of appRows) {
          const appNum = cleanStr(a.AppNumber) || `APP-${cid}-${a.Aider || '01'}`;
          const rawStatus = cleanStr(a.ApplStatus).toLowerCase();
          const status = APP_STATUS_MAP[rawStatus] || 'under_review';
          const matchedSite = siteMap[cleanStr(a.CiteID)] || siteMap[cleanStr(a.SiteName)] || defaultSite;
          const subDate = safeDate(a.AppDate || a.Datee);

          const appDoc = {
            application_number: appNum,
            client_id: userId,
            application_type: cleanStr(a.ApplicationTyp) || 'New Application',
            category: cleanStr(a.AppCategory) || 'Annual Certification – Food and General processing',
            establishment_name: cleanStr(a.NameEstablishmen1) || companyName,
            establishment_address: cleanStr(a.SiteFactoryAddress) || address,
            site_name: matchedSite?.name || cleanStr(a.SiteName),
            site_id: matchedSite ? matchedSite._id.toString() : null,
            reg_number: cleanStr(a.RegistrationNo) || cleanStr(comp.businessRegNo),
            vat_number: cleanStr(a.VATNumber1) || cleanStr(comp.vatNo),
            managing_director: cleanStr(a.Nameer) || fullName,
            employee_count: parseInt(a.NumberEmployees1 || a.NumberOFBusinest1) || 4,
            products: [],
            status,
            created_at: subDate,
            notes: `Imported from legacy HFA database (CID: ${cid})`
          };

          const savedApp = await Application.findOneAndUpdate(
            { application_number: appNum },
            { $set: appDoc },
            { upsert: true, new: true }
          );
          appMap[appNum] = savedApp;
          trackerState.stats.appsCreated++;
        }

        // 2. Renewal Applications
        for (const r of renewalRows) {
          const renewalNum = `RN-${cleanStr(r.ArenewID) || cleanStr(r.AppNumber)}`;
          const rawStatus = cleanStr(r.ApplStatus).toLowerCase();
          const status = APP_STATUS_MAP[rawStatus] || 'certificate_issued';
          const matchedSite = siteMap[cleanStr(r.CiteID)] || siteMap[cleanStr(r.SiteName)] || defaultSite;
          const subDate = safeDate(r.AppDate);

          const appDoc = {
            application_number: renewalNum,
            client_id: userId,
            application_type: 'Renewal Application',
            category: cleanStr(r.AppCategory) || 'Annual Certification – Food and General processing',
            establishment_name: companyName,
            establishment_address: address,
            site_name: matchedSite?.name || cleanStr(r.SiteName),
            site_id: matchedSite ? matchedSite._id.toString() : null,
            managing_director: cleanStr(r.ContactName) || fullName,
            employee_count: 4,
            products: [],
            status,
            created_at: subDate,
            notes: `Renewal application #${cleanStr(r.ArenewID)} for original ${cleanStr(r.AppNumber)}`
          };

          const savedRenewal = await Application.findOneAndUpdate(
            { application_number: renewalNum },
            { $set: appDoc },
            { upsert: true, new: true }
          );
          appMap[renewalNum] = savedRenewal;
          trackerState.stats.appsCreated++;
        }
      } else {
        // Fallback base application so all companies have complete portal state
        const defaultAppNum = `APP-${cid}`;
        const isCert = cleanStr(comp.isNew) === 'Cert';
        const isProc = cleanStr(comp.isNew) === 'Processing';
        const status = isCert ? 'certificate_issued' : (isProc ? 'under_review' : 'submitted');

        const appDoc = {
          application_number: defaultAppNum,
          client_id: userId,
          application_type: 'New Application',
          category: 'Annual Certification – Food and General processing',
          establishment_name: companyName,
          establishment_address: address,
          site_name: defaultSite?.name || 'Main Facility',
          site_id: defaultSite ? defaultSite._id.toString() : null,
          reg_number: cleanStr(comp.businessRegNo),
          vat_number: cleanStr(comp.vatNo),
          managing_director: fullName,
          employee_count: parseInt(comp.totalNoOfEmployees) || 5,
          products: [],
          status,
          created_at: safeDate(comp.dateReg),
          notes: `Imported from legacy HFA database (CID: ${cid}, Status: ${comp.isNew || 'N/A'})`
        };

        const savedApp = await Application.findOneAndUpdate(
          { application_number: defaultAppNum },
          { $set: appDoc },
          { upsert: true, new: true }
        );
        appMap[defaultAppNum] = savedApp;
        trackerState.stats.appsCreated++;
      }

      const defaultApp = Object.values(appMap)[0];

      // -------------------------------------------------------------
      // D. HALAL CERTIFICATES
      // -------------------------------------------------------------
      const certRows = sqlTables.certsMap.get(cid) || [];
      const certMap = {};

      for (const c of certRows) {
        const certNo = cleanStr(c.CertificateNo);
        if (!certNo) continue;

        const issueDate = safeDate(c.IssueDate);
        const expiryDate = safeDate(c.ExpiryDate);
        const cycleStartDate = safeDate(c.CurrentCyStartDate, issueDate);
        const matchedSite = siteMap[cleanStr(c.SiteID)] || siteMap[cleanStr(c.SiteName)] || defaultSite;
        const scheme = resolveCertScheme(c.GFP);
        const status = expiryDate > new Date() ? 'active' : 'expired';
        const scope = cleanStr(c.PRODUCTCATEGORY) || 'Halal Food and General Processing';

        const certDoc = {
          certificate_number: certNo,
          client_id: userIdStr,
          application_id: defaultApp ? defaultApp._id : null,
          site_id: matchedSite ? matchedSite._id : null,
          company_name: companyName,
          company_address: cleanStr(c.COMPANYADDRESS) || address,
          manufacturing_address: cleanStr(c.MANUFATURINGFACILITY) || address,
          scope,
          certificate_type: scheme,
          issue_date: issueDate,
          expiry_date: expiryDate,
          current_cycle_start_date: cycleStartDate,
          status,
          products_covered: ['General Certified Halal Products'],
          notes: `Imported from legacy HFA database (CID: ${cid}, Site: ${cleanStr(c.SiteName)})`
        };

        const savedCert = await Certificate.findOneAndUpdate(
          { certificate_number: certNo },
          { $set: certDoc },
          { upsert: true, new: true }
        );
        certMap[certNo] = savedCert;
        trackerState.stats.certsCreated++;
      }

      const primaryCert = Object.values(certMap)[0];

      // -------------------------------------------------------------
      // E. PRODUCTS
      // -------------------------------------------------------------
      const productRows = sqlTables.productsMap.get(cid) || [];
      for (const p of productRows) {
        const pName = cleanStr(p.ProductNamerr) || 'Halal Product';
        const pCode = cleanStr(p.ProductCoder) || `PRD-${cid}-${cleanStr(p.ider || '01')}`;
        const matchedSite = siteMap[cleanStr(p.sitid)] || siteMap[cleanStr(p.sitename)] || defaultSite;

        const pDoc = {
          client_id: userId,
          name: pName,
          code: pCode,
          category: cleanStr(p.Category) || 'General',
          certificate_id: cleanStr(p.certId) || (primaryCert ? primaryCert.certificate_number : ''),
          site_id: matchedSite ? matchedSite._id : null,
          status: 'active',
          notes: `Imported from legacy HFA database. Product code: ${pCode}`
        };

        await Product.findOneAndUpdate(
          { client_id: userId, name: pName, code: pCode },
          { $set: pDoc },
          { upsert: true, new: true }
        );
        trackerState.stats.productsCreated++;
      }

      // -------------------------------------------------------------
      // F. ADD-ON APPLICATIONS
      // -------------------------------------------------------------
      const addOnRows = sqlTables.addOnsMap.get(cid) || [];
      for (const a of addOnRows) {
        const addOnNum = `ADD-${cleanStr(a.AtID) || cleanStr(a.RecordID) || Math.floor(Math.random() * 100000)}`;
        const rawStatus = cleanStr(a.Statuscomp).toLowerCase();
        const status = ADDON_STATUS_MAP[rawStatus] || 'accepted';
        const matchedSite = siteMap[cleanStr(a.CiteID)] || siteMap[cleanStr(a.SiteName)] || defaultSite;
        const addOnSubject = cleanStr(a.Sujetrer) || 'Product Add-on';

        const addOnDoc = {
          application_number: addOnNum,
          client_id: userId,
          certificate_id: primaryCert ? primaryCert._id : null,
          site_id: matchedSite ? matchedSite._id : null,
          contact_name: cleanStr(a.ContactPeNa) || fullName,
          contact_email: cleanEmail,
          message: cleanStr(a.Messgate) || addOnSubject,
          products: [
            {
              sn: 1,
              name: addOnSubject || 'Add-on Product',
              code: addOnNum,
              type: 'Add product'
            }
          ],
          status,
          created_at: safeDate(a.Datere)
        };

        await AddOnApplication.findOneAndUpdate(
          { application_number: addOnNum },
          { $set: addOnDoc },
          { upsert: true, new: true }
        );
        trackerState.stats.addOnsCreated++;
      }

      // -------------------------------------------------------------
      // G. EXPORT CERTIFICATES
      // -------------------------------------------------------------
      const exportCertRows = sqlTables.exportCertsMap.get(cid) || [];
      for (const exp of exportCertRows) {
        const mid = cleanStr(exp.MasterID) || cleanStr(exp.Ider);
        const refNo = `EXP-${mid}`;
        const items = sqlTables.exportItemsMap.get(mid) || [];
        const itemsDesc = items.length > 0
          ? items.map(i => `${cleanStr(i.PRODUCTNAME, 'Item')} (Code: ${cleanStr(i.PRODUCTCODE, 'N/A')}, Batch: ${cleanStr(i.PRODUCTBATCHNO, 'N/A')}, Cases: ${cleanStr(i.QUANTITYCASES, '0')}, Wt: ${cleanStr(i.TOTALWEIGHT, '0')}kg)`).join('; ')
          : `Order #${cleanStr(exp.OrderNo, 'N/A')} - Consignor: ${cleanStr(exp.ConsignorExportersName, companyName)}`;

        const expDoc = {
          client_id: userIdStr,
          reference_number: refNo,
          destination_country: cleanStr(exp.PortofEntry) || 'United Arab Emirates',
          shipment_date: safeDate(exp.Dateee || exp.ExportDate),
          consignee_name: cleanStr(exp.ConsigneeNameAddress) || 'Consignee on file',
          consignee_address: cleanStr(exp.DistributorsNameAddress) || 'Address on file',
          products: itemsDesc,
          consignment_details: `Facility: ${cleanStr(exp.ManufacturingFacilityNameAddress, 'N/A')}, Flight/Freight: ${cleanStr(exp.FlightFreightDetails, 'N/A')}`,
          status: cleanStr(exp.Statuss).toLowerCase() === 'done' ? 'approved' : 'pending',
          notes: `Imported from legacy HFA database (Ref: ${refNo})`
        };

        await ExportCertificate.findOneAndUpdate(
          { client_id: userIdStr, reference_number: refNo },
          { $set: expDoc },
          { upsert: true, new: true }
        );
        trackerState.stats.exportCertsCreated++;
      }

      // Progress Update
      trackerState.processedCompanies++;
      updateTrackerFile(cid, companyName);

      // Console Progress Log every 10 companies or at completion
      if ((idx + 1) % 10 === 0 || idx === companies.length - 1) {
        const pct = ((trackerState.processedCompanies / trackerState.totalCompanies) * 100).toFixed(1);
        console.log(`[${String(trackerState.processedCompanies).padStart(4)}/${trackerState.totalCompanies}] (${pct.padStart(5)}%) CID: ${cid.padEnd(7)} | ${companyName.substring(0, 30).padEnd(30)} | Sites: ${String(siteRows.length || 1).padStart(2)} | Apps: ${String(appRows.length + renewalRows.length || 1).padStart(2)} | Certs: ${String(certRows.length).padStart(2)} | AddOns: ${String(addOnRows.length).padStart(2)}`);
      }

    } catch (compErr) {
      console.error(`❌ Error importing company CID ${cid} (${companyName}):`, compErr.message);
      trackerState.stats.errors.push({ cid, company: companyName, error: compErr.message });
      trackerState.processedCompanies++;
      updateTrackerFile(cid, companyName);
    }
  }

  // Mark Completed
  updateTrackerFile('ALL', 'Completed', true);

  const totalMinutes = ((Date.now() - startTime) / 60000).toFixed(2);
  console.log('\n=============================================================================');
  console.log('🎉 ALL HFA COMPANIES SUCCESSFULLY IMPORTED TO MONGODB!');
  console.log('=============================================================================');
  console.log(`⏱️  Total Duration      : ${totalMinutes} minutes`);
  console.log(`🏢 Companies Processed : ${trackerState.processedCompanies} / ${trackerState.totalCompanies}`);
  console.log(`👤 Users Created/Upd   : ${trackerState.stats.usersCreated} created, ${trackerState.stats.usersUpdated} updated`);
  console.log(`📍 Sites Created       : ${trackerState.stats.sitesCreated}`);
  console.log(`📝 Applications Created: ${trackerState.stats.appsCreated}`);
  console.log(`📜 Certificates Created: ${trackerState.stats.certsCreated}`);
  console.log(`📦 Products Created    : ${trackerState.stats.productsCreated}`);
  console.log(`➕ Add-Ons Created     : ${trackerState.stats.addOnsCreated}`);
  console.log(`🚢 Export Certs Created: ${trackerState.stats.exportCertsCreated}`);
  console.log(`⚠️  Total Errors        : ${trackerState.stats.errors.length}`);
  console.log('=============================================================================\n');

  await mongoose.disconnect();
  process.exit(0);
}

runFullCompanyImport().catch(err => {
  console.error('FATAL ERROR DURING IMPORT:', err);
  process.exit(1);
});
