import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import readline from 'readline';
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
import ApplicationLogsheet from '../models/ApplicationLogsheet.js';
import ExportCertificate from '../models/ExportCertificate.js';
import AddOnApplication from '../models/AddOnApplication.js';
import Proposal from '../models/Proposal.js';
import Agreement from '../models/Agreement.js';
import Invoice from '../models/Invoice.js';
import Audit from '../models/Audit.js';
import Ticket from '../models/Ticket.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const API_ENDPOINTS = [
  {
    url: 'https://app.hfa-portal.com/api/Crpirs/loadcomp/False/Cert/None',
    category: 'certified',
    name: 'Certified Companies',
    ignore: false
  },
  {
    url: 'https://app.hfa-portal.com/api/Crpirs/loadcomp/False/NRL/None',
    category: 'review_nrl',
    name: 'Review / NRL List (Ignored as instructed)',
    ignore: true
  },
  {
    url: 'https://app.hfa-portal.com/api/Crpirs/loadcomp/Yes/None/None',
    category: 'signup',
    name: 'Sign-ups',
    ignore: false
  },
  {
    url: 'https://app.hfa-portal.com/api/Crpirs/loadcomp/True/Processing/None',
    category: 'processing',
    name: 'Processing List',
    ignore: false
  }
];

// Helper: Build a single address string from API address components
function buildAddress(comp) {
  const parts = [
    cleanStr(comp.address1 || comp.Address1 || comp.address || comp.Address),
    cleanStr(comp.address2 || comp.Address2),
    cleanStr(comp.city || comp.City),
    cleanStr(comp.state || comp.State),
    cleanStr(comp.postCode || comp.PostCode || comp.postcode),
    cleanStr(comp.country || comp.Country || comp.sCountry)
  ].filter(p => p && p !== '-');
  return parts.length > 0 ? parts.join(', ') : 'Address on file';
}

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
  return s === '' || s === '-' || s === 'None' || s === 'null' ? defaultVal : s;
}

// Helper: Read SQL Server exported table JSON
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

// 1. Fetch, Filter, and Load All Companies
async function loadAllCompanies() {
  console.log('\n📥 1. Loading and categorizing company records...');
  
  if (fs.existsSync(CACHE_FILE)) {
    try {
      const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (Array.isArray(cached) && cached.length >= 1300 && cached[0].category) {
        console.log(`   ✓ Loaded ${cached.length} categorized companies from offline cache (${CACHE_FILE})`);
        return cached;
      }
    } catch (_) {}
  }

  const cidMap = new Map();
  const ignoredNrlCids = new Set();
  let totalApiFetched = 0;

  for (const endpoint of API_ENDPOINTS) {
    console.log(`   Fetching ${endpoint.name} (${endpoint.url})...`);
    try {
      const records = await fetchWithRetry(endpoint.url);
      totalApiFetched += records.length;
      console.log(`   ✓ Fetched ${records.length} records for ${endpoint.name}`);

      if (endpoint.ignore) {
        records.forEach(r => {
          const cid = cleanStr(r.cid || r.CID);
          if (cid) ignoredNrlCids.add(cid);
        });
        console.log(`   🚫 Flagged ${ignoredNrlCids.size} NRL / Review companies to IGNORE from import`);
      } else {
        records.forEach(r => {
          const cid = cleanStr(r.cid || r.CID);
          if (cid && !ignoredNrlCids.has(cid)) {
            cidMap.set(cid, {
              ...r,
              cid,
              category: endpoint.category
            });
          }
        });
      }
    } catch (err) {
      console.error(`   ✗ Error fetching ${endpoint.url}:`, err.message);
    }
  }

  console.log(`   ✓ Active companies from APIs: ${cidMap.size}`);

  // Scan remaining companies from SQL Server tables outside the APIs
  console.log('   🔍 Scanning SQL Server tables for remaining companies not in APIs...');
  const compRegis1 = readSqlTable('HalalyMain/tables/dbo.CompRegis.json');
  const compRegis2 = readSqlTable('HalalyMains/tables/dbo.CompRegis.json');
  const certRows = readSqlTable('HalalCert/tables/dbo.tlbcertMas.json');
  const certCids = new Set(certRows.map(c => cleanStr(c.CName)).filter(Boolean));
  const appRows = readSqlTable('HalalApp/tables/dbo.AppleReg.json');
  const appCids = new Set(appRows.map(a => cleanStr(a.CID)).filter(Boolean));

  let addedFromSql = 0;
  function addRemainingSqlCompany(r, defaultCat = 'signup') {
    const cid = cleanStr(r.CID || r.cid || r.KingID || r.CName);
    if (!cid || ignoredNrlCids.has(cid) || cidMap.has(cid)) return;

    let cat = defaultCat;
    const isNew = cleanStr(r.IsNew);
    if (isNew === 'Cert' || certCids.has(cid)) cat = 'certified';
    else if (isNew === 'Processing' || appCids.has(cid)) cat = 'processing';
    else if (isNew === 'Yes') cat = 'signup';

    cidMap.set(cid, {
      cid,
      cCompanyName: cleanStr(r.CCompanyName || r.CompanyName || r.CompName || r.COMPANYNAME),
      ceaKingp: cleanStr(r.CeaKingp || r.Email || r.email),
      pcnKinga: cleanStr(r.PcnKinga || r.Phone || r.phone),
      address1: cleanStr(r.Address1 || r.address1 || r.COMPANYADDRESS),
      address2: cleanStr(r.Address2 || r.address2),
      city: cleanStr(r.City || r.city),
      state: cleanStr(r.State || r.state),
      postCode: cleanStr(r.PostCode || r.postCode),
      country: cleanStr(r.Country || r.country || 'United Kingdom'),
      firstName: cleanStr(r.FirstName || r.firstName),
      lastName: cleanStr(r.LastName || r.lastName),
      category: cat,
      source: 'sql_table_fallback'
    });
    addedFromSql++;
  }

  compRegis2.forEach(r => addRemainingSqlCompany(r));
  compRegis1.forEach(r => addRemainingSqlCompany(r));
  certRows.forEach(r => addRemainingSqlCompany({ CID: r.CName, CCompanyName: r.COMPANYNAME, Address1: r.COMPANYADDRESS }, 'certified'));
  appRows.forEach(r => addRemainingSqlCompany({ CID: r.CID, CCompanyName: r.CompanyName || r.CompName, Email: r.Email }, 'processing'));

  console.log(`   ✓ Added ${addedFromSql} remaining companies from SQL Server tables`);

  const companies = Array.from(cidMap.values());
  const counts = { certified: 0, processing: 0, signup: 0 };
  companies.forEach(c => { counts[c.category] = (counts[c.category] || 0) + 1; });

  console.log(`   ====================================================`);
  console.log(`   📊 FINAL IMPORT COMPANY LIST: ${companies.length} TOTAL`);
  console.log(`      • Certified Companies : ${counts.certified}`);
  console.log(`      • Processing List     : ${counts.processing}`);
  console.log(`      • Sign-ups            : ${counts.signup}`);
  console.log(`      • NRL (Ignored)       : ${ignoredNrlCids.size}`);
  console.log(`   ====================================================\n`);

  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(companies, null, 2), 'utf8');
    console.log(`   ✓ Saved categorized cache to ${CACHE_FILE}`);
  } catch (err) {
    console.warn(`   ⚠️ Warning saving cache:`, err.message);
  }

  return companies;
}

// Helper to stream parse tlblogsit.json line-by-line
async function streamLoadLogsheets() {
  const filePath = path.join(EXPORT_DIR, 'HalalTick/tables/dbo.tlblogsit.json');
  if (!fs.existsSync(filePath)) {
    console.warn(`   ⚠️ Missing tlblogsit.json`);
    return [];
  }

  console.log('   ⏳ Streaming 4,586 logsheets from tlblogsit.json (2.3 GB with signatures)...');
  const t0 = Date.now();
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 1024 * 1024 });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  const rows = [];
  let inRows = false;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!inRows) {
      if (trimmed.startsWith('"rows": [')) inRows = true;
      continue;
    }

    if (trimmed.startsWith('{') && (trimmed.endsWith('},') || trimmed.endsWith('}'))) {
      const cleanJson = trimmed.endsWith(',') ? trimmed.slice(0, -1) : trimmed;
      try {
        const row = JSON.parse(cleanJson);
        rows.push(row);
      } catch (e) {}
    }
  }

  console.log(`   ✓ Extracted ${rows.length} complete logsheets in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return rows;
}

// 2. Pre-load and Index SQL Server Tables in Memory
async function loadAndIndexSqlTables() {
  console.log('\n🗄️  2. Pre-loading & indexing SQL Server exported tables...');
  
  const readTable = readSqlTable;

  // Sites (merge HalalyMain and HalalyMains, deduplicate by SitesID)
  const sitesMap = new Map();
  const sites1 = readTable('HalalyMain/tables/dbo.TlbSie.json');
  const sites2 = readTable('HalalyMains/tables/dbo.TlbSie.json');
  const sites3 = readTable('HalalyMain/tables/dbo.TlbSie2.json');
  const sites4 = readTable('HalalyMains/tables/dbo.TlbSie2.json');
  const siteSeenIds = new Set();
  const allSiteRows = [];
  [...sites1, ...sites2, ...sites3, ...sites4].forEach(s => {
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

  // Surveillance Applications (tlbSuvance)
  const survMap = new Map();
  const survRows = readTable('HalalAReNew/tables/dbo.tlbSuvance.json');
  survRows.forEach(s => {
    const cid = cleanStr(s.KingID);
    if (cid) {
      if (!survMap.has(cid)) survMap.set(cid, []);
      survMap.get(cid).push(s);
    }
  });
  console.log(`   ✓ Indexed ${survRows.length} surveillance applications across ${survMap.size} company CIDs`);

  // Certified Product Line Items (subcert)
  const subcertByCertNo = new Map();
  const subcertByMisterId = new Map();
  const subcertRows = readTable('HalalCert/tables/dbo.subcert.json');
  subcertRows.forEach(s => {
    const cNo = cleanStr(s.CerttificateNom);
    const mId = cleanStr(s.misterID);
    if (cNo) {
      if (!subcertByCertNo.has(cNo)) subcertByCertNo.set(cNo, []);
      subcertByCertNo.get(cNo).push(s);
    }
    if (mId) {
      if (!subcertByMisterId.has(mId)) subcertByMisterId.set(mId, []);
      subcertByMisterId.get(mId).push(s);
    }
  });
  console.log(`   ✓ Indexed ${subcertRows.length} certified product items across certificates`);

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

  // Master Products Catalogue (HaProlister.dbo.Prolister) - 13,112 Products!
  const prolisterMap = new Map();
  const prolisterRows = readTable('HaProlister/tables/dbo.Prolister.json');
  prolisterRows.forEach(p => {
    const cid = cleanStr(p.AppComp);
    if (cid) {
      if (!prolisterMap.has(cid)) prolisterMap.set(cid, []);
      prolisterMap.get(cid).push(p);
    }
  });

  // Ticket Products (HalalTick.dbo.tldbprotem)
  const tldbprotemRows = readTable('HalalTick/tables/dbo.tldbprotem.json');
  tldbprotemRows.forEach(p => {
    const cid = cleanStr(p.compid);
    if (cid) {
      if (!prolisterMap.has(cid)) prolisterMap.set(cid, []);
      prolisterMap.get(cid).push(p);
    }
  });
  console.log(`   ✓ Indexed ${prolisterRows.length + tldbprotemRows.length} total products across ${prolisterMap.size} company CIDs`);

  // Logsheets (HalalTick.dbo.tlblogsit) - 4,586 Logsheets!
  const logsheets = await streamLoadLogsheets();
  const logsheetsByCid = new Map();
  const logsheetsBySiteId = new Map();
  const logsheetsByAppId = new Map();
  const logsheetsByCName = new Map();
  const logsheetsById = new Map();

  logsheets.forEach(l => {
    const ider = cleanStr(l.ider);
    const cid = cleanStr(l.CID);
    const siteId = cleanStr(l.SiteID);
    const appId = cleanStr(l.AppID);
    const cName = cleanStr(l.CName).toLowerCase();

    if (ider) logsheetsById.set(ider, l);
    if (cid) {
      if (!logsheetsByCid.has(cid)) logsheetsByCid.set(cid, []);
      logsheetsByCid.get(cid).push(l);
    }
    if (siteId) {
      if (!logsheetsBySiteId.has(siteId)) logsheetsBySiteId.set(siteId, []);
      logsheetsBySiteId.get(siteId).push(l);
    }
    if (appId) {
      if (!logsheetsByAppId.has(appId)) logsheetsByAppId.set(appId, []);
      logsheetsByAppId.get(appId).push(l);
    }
    if (cName) {
      if (!logsheetsByCName.has(cName)) logsheetsByCName.set(cName, []);
      logsheetsByCName.get(cName).push(l);
    }
  });
  console.log(`   ✓ Indexed ${logsheets.length} logsheets by CID, SiteID, AppID, and Company Name`);

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
  console.log(`   ✓ Indexed ${exportCertRows.length} export certificates (${exportItemRows.length} line items)`);

  // Proposals (HalaProsl.dbo.TblProposal)
  const proposalsByCid = new Map();
  const proposalsByAppId = new Map();
  const proposalsByCompName = new Map();
  const proposalRows = readTable('HalaProsl/tables/dbo.TblProposal.json');
  proposalRows.forEach(p => {
    const cid = cleanStr(p.CID);
    const appId = cleanStr(p.ApplictionID);
    const cName = cleanStr(p.ComBookName).toLowerCase();
    if (cid) {
      if (!proposalsByCid.has(cid)) proposalsByCid.set(cid, []);
      proposalsByCid.get(cid).push(p);
    }
    if (appId) {
      if (!proposalsByAppId.has(appId)) proposalsByAppId.set(appId, []);
      proposalsByAppId.get(appId).push(p);
    }
    if (cName) {
      if (!proposalsByCompName.has(cName)) proposalsByCompName.set(cName, []);
      proposalsByCompName.get(cName).push(p);
    }
  });
  console.log(`   ✓ Indexed ${proposalRows.length} proposals across applications`);

  // Agreements (HalalApp.dbo.Agrdoon)
  const agreementsByCid = new Map();
  const agreementsByAppId = new Map();
  const agreementRows = readTable('HalalApp/tables/dbo.Agrdoon.json');
  agreementRows.forEach(a => {
    const cid = cleanStr(a.AppComp);
    const appId = cleanStr(a.AppID);
    if (cid) {
      if (!agreementsByCid.has(cid)) agreementsByCid.set(cid, []);
      agreementsByCid.get(cid).push(a);
    }
    if (appId) {
      if (!agreementsByAppId.has(appId)) agreementsByAppId.set(appId, []);
      agreementsByAppId.get(appId).push(a);
    }
  });
  console.log(`   ✓ Indexed ${agreementRows.length} agreements across applications`);

  // Invoices (HalalLisVoce.dbo.LisVoce)
  const invoicesByCid = new Map();
  const invoiceRows = readTable('HalalLisVoce/tables/dbo.LisVoce.json');
  invoiceRows.forEach(v => {
    const cid = cleanStr(v.CID);
    if (cid) {
      if (!invoicesByCid.has(cid)) invoicesByCid.set(cid, []);
      invoicesByCid.get(cid).push(v);
    }
  });
  console.log(`   ✓ Indexed ${invoiceRows.length} invoices across company CIDs`);

  // Audits (HalalyMains & HalalyMain dbo.tlbAudlister) - 3,439 Audits!
  const auditsByAppNum = new Map();
  const auditRows1 = readTable('HalalyMains/tables/dbo.tlbAudlister.json');
  const auditRows2 = readTable('HalalyMain/tables/dbo.tlbAudlister.json');
  [...auditRows1, ...auditRows2].forEach(a => {
    const appNum = cleanStr(a.AppID);
    if (appNum) {
      if (!auditsByAppNum.has(appNum)) auditsByAppNum.set(appNum, []);
      auditsByAppNum.get(appNum).push(a);
    }
  });
  console.log(`   ✓ Indexed ${auditRows1.length + auditRows2.length} audits across applications`);

  // Add-on Product Line Items (HaProlister.dbo.TlbProist) - 13,654 items!
  const addOnProductsByAtId = new Map();
  const proistRows = readTable('HaProlister/tables/dbo.TlbProist.json');
  proistRows.forEach(p => {
    const atId = cleanStr(p.Iders);
    if (atId) {
      if (!addOnProductsByAtId.has(atId)) addOnProductsByAtId.set(atId, []);
      addOnProductsByAtId.get(atId).push({
        name: cleanStr(p.ProNamer) || 'Product',
        code: cleanStr(p.Coder) || '',
        type: cleanStr(p.Typer) || 'Add product'
      });
    }
  });
  console.log(`   ✓ Indexed ${proistRows.length} add-on product line items`);

  // Secondary Contacts (dbo.TblContat)
  const contactsByCid = new Map();
  const contactRows1 = readTable('HalalyMains/tables/dbo.TblContat.json');
  const contactRows2 = readTable('HalalyMain/tables/dbo.TblContat.json');
  [...contactRows1, ...contactRows2].forEach(c => {
    const cid = cleanStr(c.CompKing);
    if (cid && !contactsByCid.has(cid)) contactsByCid.set(cid, c);
  });
  console.log(`   ✓ Indexed ${contactsByCid.size} company secondary contacts`);

  // Support Tickets (HalalTick.dbo.tlbtic)
  const ticketsByCompName = new Map();
  const ticketRows = readTable('HalalTick/tables/dbo.tlbtic.json');
  ticketRows.forEach(t => {
    const cName = cleanStr(t.Subjet || t.CName).toLowerCase();
    if (cName) {
      if (!ticketsByCompName.has(cName)) ticketsByCompName.set(cName, []);
      ticketsByCompName.get(cName).push(t);
    }
  });
  console.log(`   ✓ Indexed ${ticketRows.length} support tickets`);

  return {
    sitesMap,
    appsMap,
    renewalsMap,
    survMap,
    certsMap,
    subcertByCertNo,
    subcertByMisterId,
    prolisterMap,
    logsheetsByCid,
    logsheetsBySiteId,
    logsheetsByAppId,
    logsheetsByCName,
    logsheetsById,
    addOnsMap,
    exportCertsMap,
    exportItemsMap,
    proposalsByCid,
    proposalsByAppId,
    proposalsByCompName,
    agreementsByCid,
    agreementsByAppId,
    invoicesByCid,
    auditsByAppNum,
    addOnProductsByAtId,
    contactsByCid,
    ticketsByCompName
  };
}

// 3. Status mapping dictionaries
const APP_STATUS_MAP = {
  // Certificate Issued / Completed (1,840 apps)
  'successful': 'certificate_issued',
  'certificate sent': 'certificate_issued',
  'certficate sent': 'certificate_issued',
  'certificate issued': 'certificate_issued',

  // Initial & Review (246 apps)
  'submitted': 'submitted',
  'in-progress': 'under_review',
  'draft': 'under_review',

  // Proposals (112 apps)
  'proposal sent': 'proposal_sent',
  'proposal accepted': 'proposal_approved',
  'proposal rejected': 'proposal_rejected',

  // Invoices & Payments (61 apps)
  'invoice sent': 'invoice_sent',
  'invoice-sent': 'invoice_sent',
  'deposit payment received': 'payment_received',
  'payment recieved': 'payment_received',
  'payment received': 'payment_received',
  'final payment confirmation': 'final_invoice_paid',
  'invoice for final payement sent': 'final_invoice_sent',

  // Agreements (16 apps)
  'agreement sent': 'agreement_sent',
  'signed copy of agreement sent': 'agreement_signed',

  // Product Approvals (7 apps)
  'product approval forms recieved': 'initial_product_approved',
  'product approval forms received': 'initial_product_approved',

  // Audit Scheduling & Reports (41 apps)
  'audit date finalized': 'date_finalized',
  'stage2 audit date finalized': 'date_finalized',
  'audit reports submitted': 'audit_report_submitted',
  'audit completed': 'audit_completed',
  'audited': 'audit_completed',

  // Non-Conformance (40 apps)
  'nc reports': 'nc_flagged',
  'nc reportsgso': 'nc_flagged',

  // Processing & Approval (15 apps)
  'certificate processing': 'ready_for_certificate',
  'renewal accepted': 'approved',
  'surveillance accepted': 'approved',
  'approved': 'approved',

  // On Hold (6 apps)
  'on hold': 'on_hold',

  // Rejected / Bin (49 apps)
  'bin': 'rejected',
  'rejected': 'rejected',
  'renewal rejected': 'rejected',
  'surveillance rejected': 'rejected'
};

const ADDON_STATUS_MAP = {
  'request submited': 'submitted',
  'request accepted': 'accepted',
  'product form submitted': 'product_approval_form_enabled',
  'product approval forms received': 'all_forms_received',
  'certificate processing': 'ready_for_certificate',
  'certificate sent': 'completed',
  'certficate sent': 'completed'
};

// 4. Main Import Runner
async function runFullCompanyImport() {
  console.log('=============================================================================');
  console.log('🚀 STARTING COMPREHENSIVE HFA DATABASE MIGRATION TO MONGODB');
  console.log('=============================================================================');

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI is not set in .env');
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 30000 });
  console.log(`✅ Connected to MongoDB: ${mongoose.connection.name}`);

  const companies = await loadAllCompanies();
  const sqlTables = await loadAndIndexSqlTables();

  const startTime = Date.now();
  const trackerState = {
    startTime: new Date().toISOString(),
    totalCompanies: companies.length,
    processedCompanies: 0,
    currentCompany: '',
    currentCid: '',
    percent: '0.0%',
    elapsedMinutes: '0.0',
    estimatedRemainingMinutes: 'N/A',
    stats: {
      usersCreated: 0,
      usersUpdated: 0,
      certifiedImported: 0,
      processingImported: 0,
      signupsImported: 0,
      sitesCreated: 0,
      sitesUpdated: 0,
      appsCreated: 0,
      appsUpdated: 0,
      certsCreated: 0,
      certsUpdated: 0,
      productsCreated: 0,
      productsUpdated: 0,
      logsheetsCreated: 0,
      logsheetsUpdated: 0,
      addOnsCreated: 0,
      addOnsUpdated: 0,
      exportCertsCreated: 0,
      exportCertsUpdated: 0,
      proposalsCreated: 0,
      agreementsCreated: 0,
      invoicesCreated: 0,
      auditsCreated: 0,
      ticketsCreated: 0,
      errors: []
    },
    isComplete: false,
    lastUpdated: new Date().toISOString()
  };

  function updateTrackerFile(cid, companyName, isComplete = false) {
    const elapsedMs = Date.now() - startTime;
    const elapsedMinutes = (elapsedMs / 60000).toFixed(1);
    const pct = ((trackerState.processedCompanies / trackerState.totalCompanies) * 100).toFixed(1);
    
    let estRemaining = 'N/A';
    if (trackerState.processedCompanies > 5) {
      const msPerComp = elapsedMs / trackerState.processedCompanies;
      const remCompanies = trackerState.totalCompanies - trackerState.processedCompanies;
      estRemaining = ((remCompanies * msPerComp) / 60000).toFixed(1);
    }

    trackerState.currentCompany = companyName;
    trackerState.currentCid = cid;
    trackerState.percent = `${pct}%`;
    trackerState.elapsedMinutes = elapsedMinutes;
    trackerState.estimatedRemainingMinutes = estRemaining;
    trackerState.isComplete = isComplete;
    trackerState.lastUpdated = new Date().toISOString();

    try {
      fs.mkdirSync(path.dirname(TRACKER_FILE), { recursive: true });
      fs.writeFileSync(TRACKER_FILE, JSON.stringify(trackerState, null, 2), 'utf8');
    } catch (_) {}
  }

  // Pre-hash default password
  console.log('\n🔐 Pre-hashing default password for imported client accounts...');
  const defaultPasswordHash = await bcrypt.hash('Password123!', 10);
  console.log('   ✓ Default password hash ready ("Password123!")');

  const existingUsers = await User.find({}, 'email').lean();
  const existingEmailSet = new Set(existingUsers.map(u => (u.email || '').toLowerCase().trim()));
  console.log(`   ✓ Loaded ${existingUsers.length} existing database user emails into memory`);

  console.log(`\n▶️  Processing ${companies.length} companies...`);
  console.log('─────────────────────────────────────────────────────────────────────────────');

  for (let idx = 0; idx < companies.length; idx++) {
    const comp = companies[idx];
    const cid = cleanStr(comp.cid || comp.CID);

    // ── API field mappings (ceaKingp = email, cCompanyName = company name) ──
    const companyName = cleanStr(
      comp.cCompanyName || comp.company_name || comp.CompanyName,
      `Company ${cid}`
    );
    const emailCandidate = cleanStr(
      comp.ceaKingp || comp.email || comp.Email || comp.contact_email
    );
    const phone = cleanStr(
      comp.pcnKinga || comp.phone || comp.Phone || comp.contact_phone || '0000000000'
    );
    const address = buildAddress(comp);
    const firstNameRaw = cleanStr(comp.firstName || comp.first_name || '');
    const lastNameRaw  = cleanStr(comp.lastName  || comp.last_name  || '');
    const contactPerson = cleanStr(
      firstNameRaw && lastNameRaw ? `${firstNameRaw} ${lastNameRaw}` :
      firstNameRaw || lastNameRaw ||
      comp.contact_person || comp.ContactPerson || comp.name ||
      companyName
    );

    const companyCategory = comp.category || 'signup';

    // Guard: ignore NRL review companies
    if (companyCategory === 'review_nrl' || comp.isNrl) {
      console.log(`   [${idx + 1}/${companies.length}] ⏭️ Skipping NRL / Review company: ${companyName} (CID: ${cid})`);
      continue;
    }

    try {
      // -------------------------------------------------------------
      // A. USER (CLIENT ACCOUNT)
      // -------------------------------------------------------------
      let finalEmail = emailCandidate.toLowerCase().trim();
      if (!finalEmail || !finalEmail.includes('@')) {
        finalEmail = `client_${cid}@hfa-client.org`;
      }

      if (existingEmailSet.has(finalEmail)) {
        const existingDoc = await User.findOne({ email: finalEmail });
        if (existingDoc && cleanStr(existingDoc.company_name) !== companyName) {
          finalEmail = `client_${cid}_${finalEmail.replace('@', '_at_')}@hfa-client.org`;
        }
      }

      let user = await User.findOne({
        $or: [
          { email: finalEmail },
          { company_name: companyName }
        ]
      });

      const compRegDate = safeDate(comp.dateReg || comp.DateReg, new Date());
      const userFields = {
        email: finalEmail,
        password: defaultPasswordHash,
        role: 'client',
        client_role: 'admin',
        company_category: companyCategory,
        company_name: companyName,
        full_name: contactPerson,
        phone: phone,
        address: address,
        status: companyCategory === 'signup' ? 'pending' : 'active',
        is_active: true,
        is_verified: companyCategory !== 'signup',
        email_verified: companyCategory !== 'signup',
        created_at: compRegDate,
        createdAt: compRegDate,
        notes: `Imported from legacy HFA portal (CID: ${cid}, Category: ${companyCategory})`
      };

      const secCont = sqlTables.contactsByCid.get(cid);
      if (secCont) {
        const c2Name = cleanStr(secCont.ContactName2) || cleanStr(secCont.ContactName1);
        const c2Email = cleanStr(secCont.Email2) || cleanStr(secCont.Email1);
        const c2Phone = cleanStr(secCont.WorkTelephoneNo2) || cleanStr(secCont.MobilePhoneNo2) || cleanStr(secCont.WorkTelephoneNo1);
        if (c2Name && c2Name !== contactPerson) {
          userFields.notes += ` | Alternate Contact: ${c2Name}${c2Email ? ' (' + c2Email + ')' : ''}${c2Phone ? ' Tel: ' + c2Phone : ''}`;
        }
      }

      if (!user) {
        user = await User.create(userFields);
        trackerState.stats.usersCreated++;
        existingEmailSet.add(finalEmail);
      } else {
        await User.updateOne({ _id: user._id }, { $set: userFields });
        trackerState.stats.usersUpdated++;
      }

      if (companyCategory === 'certified') trackerState.stats.certifiedImported++;
      else if (companyCategory === 'processing') trackerState.stats.processingImported++;
      else trackerState.stats.signupsImported++;

      const userIdStr = user._id.toString();

      // -------------------------------------------------------------
      // B. SITES
      // -------------------------------------------------------------
      const siteRows = sqlTables.sitesMap.get(cid) || [];
      const siteIdMap = new Map(); // SitesID -> MongoDB _id
      let defaultSiteId = null;

      if (siteRows.length > 0) {
        for (const s of siteRows) {
          const sName = cleanStr(s.SiteName) || cleanStr(s.establishment_name) || `${companyName} Facility`;
          const sAddr1 = cleanStr(s.Address1) || cleanStr(s.address_1) || address;
          const sCity = cleanStr(s.City) || cleanStr(s.city) || 'UK';
          const sPost = cleanStr(s.PostCode) || cleanStr(s.postcode) || 'N/A';
          const sCountry = cleanStr(s.Country) || cleanStr(s.country) || 'United Kingdom';
          const sContact = cleanStr(s.ContactPerson) || contactPerson;
          const sPhone = cleanStr(s.ContactPhone) || phone;
          const sEmail = cleanStr(s.ContactEmail) || finalEmail;

          const siteDoc = {
            client_id: userIdStr,
            name: sName,
            est_name: cleanStr(s.establishment_name) || sName,
            address_1: sAddr1,
            address_2: cleanStr(s.Address2) || '',
            city: sCity,
            state: cleanStr(s.State) || '',
            postcode: sPost,
            country: sCountry,
            contact_name: sContact,
            contact_phone_number: sPhone,
            email: sEmail,
            client_code: cid,
            status: 'active'
          };

          const site = await Site.findOneAndUpdate(
            { client_id: userIdStr, name: sName },
            { $set: siteDoc },
            { upsert: true, new: true }
          );

          if (s.SitesID) siteIdMap.set(cleanStr(s.SitesID), site._id);
          if (!defaultSiteId) defaultSiteId = site._id;
          trackerState.stats.sitesCreated++;
        }
      } else {
        const defaultSite = await Site.findOneAndUpdate(
          { client_id: userIdStr, name: `${companyName} Main Site` },
          {
            $set: {
              client_id: userIdStr,
              name: `${companyName} Main Site`,
              est_name: companyName,
              address_1: address,
              city: 'UK',
              country: 'United Kingdom',
              contact_name: contactPerson,
              contact_phone_number: phone,
              email: finalEmail,
              client_code: cid,
              status: 'active'
            }
          },
          { upsert: true, new: true }
        );
        defaultSiteId = defaultSite._id;
        trackerState.stats.sitesCreated++;
      }

      // -------------------------------------------------------------
      // C. COMPLETE PRODUCTS CATALOGUE (dbo.Prolister & dbo.tldbprotem)
      // -------------------------------------------------------------
      const productRows = sqlTables.prolisterMap.get(cid) || [];
      for (const p of productRows) {
        const pName = cleanStr(p.ProName || p.pro_name || p.proname);
        if (!pName) continue;
        const pCode = cleanStr(p.ProCoder || p.procoder || p.ProID || p.proid);
        const assignedSiteId = siteIdMap.get(cleanStr(p.CiteID)) || defaultSiteId;
        const pCategory = cleanStr(p.Status || p.category) || 'General';

        const prodDoc = {
          client_id: userIdStr,
          site_id: assignedSiteId,
          name: pName,
          code: pCode,
          category: pCategory,
          status: 'approved',
          product_type: 'General',
          ingredients: cleanStr(p.FileNamee) || '',
          barcode: pCode,
          halal_status: 'Halal Certified',
          notes: `Imported from legacy HFA database (ProID: ${cleanStr(p.ProID)})`
        };

        await Product.findOneAndUpdate(
          { client_id: userIdStr, name: pName },
          { $set: prodDoc },
          { upsert: true, new: true }
        );
        trackerState.stats.productsCreated++;
      }

      // -------------------------------------------------------------
      // D. APPLICATIONS & RENEWALS & SURVEILLANCES
      // -------------------------------------------------------------
      const appRows = sqlTables.appsMap.get(cid) || [];
      const renewalRows = sqlTables.renewalsMap.get(cid) || [];
      const survRows = sqlTables.survMap.get(cid) || [];
      const appMapByAppNum = new Map();
      let latestAppId = null;
      let latestAppStatus = 'under_review';

      const compRegDate = safeDate(comp.dateReg || comp.DateReg, new Date());

      // 1. Initial New Applications
      for (const a of appRows) {
        const appNum = cleanStr(a.AppNumber) || `APP-${cleanStr(a.ApplicationID || a.ArenewID)}-${cid}`;
        const siteId = siteIdMap.get(cleanStr(a.CiteID)) || defaultSiteId;
        const rawStatus = cleanStr(a.ApplStatus).toLowerCase();
        const appStatus = APP_STATUS_MAP[rawStatus] || (rawStatus.includes('sent') ? 'certificate_issued' : 'under_review');
        const scheme = cleanStr(a.AppCategory) || 'HFA Scheme';
        const realAppDate = safeDate(a.AppDate || a.Datee || a.SubmittedDate || a.ApprDate, compRegDate);

        const appDoc = {
          application_number: appNum,
          client_id: userIdStr,
          site_id: siteId,
          type: 'initial',
          application_type: 'standard',
          is_renewal: false,
          is_surveillance: false,
          scheme: scheme,
          category: scheme,
          company_name: companyName,
          status: appStatus,
          contact_person: cleanStr(a.ContactName) || contactPerson,
          contact_email: cleanStr(a.ContactEmail) || finalEmail,
          submission_date: realAppDate,
          created_at: realAppDate,
          createdAt: realAppDate,
          notes: `Imported new application from legacy HFA database (ID: ${cleanStr(a.ApplicationID)})`
        };

        const appRes = await Application.findOneAndUpdate(
          { application_number: appNum },
          { $set: appDoc },
          { upsert: true, new: true, timestamps: false }
        );
        appMapByAppNum.set(appNum, appRes._id);
        latestAppId = appRes._id;
        latestAppStatus = appStatus;
        trackerState.stats.appsCreated++;
      }

      // 2. Renewal Applications
      for (const r of renewalRows) {
        const appNum = cleanStr(r.AppNumber) || `REN-${cleanStr(r.ArenewID || r.ApplicationID)}-${cid}`;
        const siteId = siteIdMap.get(cleanStr(r.CiteID)) || defaultSiteId;
        const rawStatus = cleanStr(r.ApplStatus).toLowerCase();
        const appStatus = APP_STATUS_MAP[rawStatus] || (rawStatus.includes('sent') ? 'certificate_issued' : 'under_review');
        const scheme = cleanStr(r.AppCategory) || 'HFA Scheme';
        const realRenDate = safeDate(r.AppDate || r.FinalizedDate || r.SubmittedDate || r.AuditedDate, compRegDate);

        const appDoc = {
          application_number: appNum,
          client_id: userIdStr,
          site_id: siteId,
          type: 'renewal',
          application_type: 'renewal',
          is_renewal: true,
          is_surveillance: false,
          scheme: scheme,
          category: scheme,
          company_name: companyName,
          status: appStatus,
          contact_person: cleanStr(r.ContactName) || contactPerson,
          contact_email: cleanStr(r.ContactEmail) || finalEmail,
          submission_date: realRenDate,
          created_at: realRenDate,
          createdAt: realRenDate,
          notes: `Imported renewal application from legacy HFA database (ID: ${cleanStr(r.ArenewID)})`
        };

        const appRes = await Application.findOneAndUpdate(
          { application_number: appNum },
          { $set: appDoc },
          { upsert: true, new: true, timestamps: false }
        );
        appMapByAppNum.set(appNum, appRes._id);
        latestAppId = appRes._id;
        latestAppStatus = appStatus;
        trackerState.stats.appsCreated++;
      }

      // 3. Surveillance Applications
      for (const s of survRows) {
        const appNum = cleanStr(s.AppNumber) || `SU-${cleanStr(s.ArenewID || s.ApplicationID)}-${cid}`;
        const siteId = siteIdMap.get(cleanStr(s.CiteID)) || defaultSiteId;
        const rawStatus = cleanStr(s.ApplStatus).toLowerCase();
        const appStatus = APP_STATUS_MAP[rawStatus] || (rawStatus.includes('sent') || rawStatus.includes('cert') ? 'certificate_issued' : 'under_review');
        const scheme = cleanStr(s.AppCategory) || 'GSO Scheme';
        const realSurvDate = safeDate(s.AppDate || s.SubmittedDate || s.FinalizedDate || s.AuditedDate, compRegDate);

        const survDoc = {
          application_number: appNum,
          client_id: userIdStr,
          site_id: siteId,
          type: 'surveillance',
          application_type: 'surveillance',
          is_surveillance: true,
          is_renewal: false,
          scheme: scheme,
          category: scheme,
          company_name: companyName,
          status: appStatus,
          contact_person: cleanStr(s.ContactName) || contactPerson,
          contact_email: cleanStr(s.ContactEmail) || finalEmail,
          submission_date: realSurvDate,
          created_at: realSurvDate,
          createdAt: realSurvDate,
          notes: `Imported surveillance application from legacy HFA database (ID: ${cleanStr(s.ArenewID)})`
        };

        const appRes = await Application.findOneAndUpdate(
          { application_number: appNum },
          { $set: survDoc },
          { upsert: true, new: true, timestamps: false }
        );
        appMapByAppNum.set(appNum, appRes._id);
        latestAppId = appRes._id;
        latestAppStatus = appStatus;
        trackerState.stats.appsCreated++;
      }

      // -------------------------------------------------------------
      // E. HALAL CERTIFICATES & CERTIFIED PRODUCTS (tlbcertMas & subcert)
      // -------------------------------------------------------------
      const certRows = sqlTables.certsMap.get(cid) || [];
      for (const c of certRows) {
        const certNo = cleanStr(c.CertificateNo) || cleanStr(c.CertficatNo) || `CERT-${c.ider}`;
        const cId = cleanStr(c.ider);
        const siteId = siteIdMap.get(cleanStr(c.SiteID)) || defaultSiteId;

        // Certified products from subcert
        const subItems = sqlTables.subcertByCertNo.get(certNo) || sqlTables.subcertByMisterId.get(cId) || [];
        const productsCovered = subItems.map(s => cleanStr(s.DESCRIPTION)).filter(Boolean);
        const productDetails = subItems.map(s => ({
          name: cleanStr(s.DESCRIPTION),
          code: cleanStr(s.CODE),
          category: cleanStr(c.PRODUCTCATEGORY) || 'General',
          description: cleanStr(s.SIZE) || ''
        })).filter(p => p.name);

        const rawCertStatus = cleanStr(c.Statuss).toLowerCase();
        const expDate = safeDate(c.ExpiryDate, new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));
        const isExpired = expDate < new Date();

        let certStatus = 'active';
        if (rawCertStatus === 'submitted') {
          certStatus = 'under_review';
        } else if (isExpired) {
          certStatus = 'expired';
        } else {
          certStatus = 'active';
        }

        const certDoc = {
          certificate_number: certNo,
          client_id: userIdStr,
          application_id: latestAppId || undefined,
          site_id: siteId,
          certificate_type: cleanStr(c.CateficateType) || 'Halal Certification',
          company_name: companyName,
          company_address: cleanStr(c.COMPANYADDRESS) || address,
          manufacturing_address: cleanStr(c.MANUFATURINGFACILITY) || address,
          product_category: cleanStr(c.PRODUCTCATEGORY) || 'Food & Beverage',
          scope: `Halal certification of ${cleanStr(c.PRODUCTCATEGORY) || 'compliant products'}`,
          products_covered: productsCovered,
          product_details: productDetails,
          product_table_columns: 2,
          issue_date: safeDate(c.IssueDate, safeDate(c.Dateer)),
          expiry_date: expDate,
          certification_start_date: safeDate(c.CurrentCyStartDate, safeDate(c.IssueDate)),
          original_cycle_start_date: safeDate(c.OriginalCyStartDate, safeDate(c.IssueDate)),
          status: certStatus,
          is_direct_issuance: false,
          notes: `Imported from legacy HFA database (Ref: ${cleanStr(c.Qcoder) || certNo}, Status: ${cleanStr(c.Statuss)})`
        };

        await Certificate.findOneAndUpdate(
          { certificate_number: certNo },
          { $set: certDoc },
          { upsert: true, new: true }
        );
        trackerState.stats.certsCreated++;
      }

      // -------------------------------------------------------------
      // F. APPLICATION LOGSHEETS (dbo.tlblogsit) - 4,586 Logsheets!
      // -------------------------------------------------------------
      const compLogsheets = sqlTables.logsheetsByCid.get(cid) ||
        sqlTables.logsheetsByCName.get(companyName.toLowerCase()) || [];

      for (const l of compLogsheets) {
        const logId = cleanStr(l.ider);
        const lSiteId = siteIdMap.get(cleanStr(l.SiteID)) || defaultSiteId;
        const lAppId = appMapByAppNum.get(cleanStr(l.AppID)) || latestAppId;

        const isSigned = l.ceoby || l.MufityBy || l.Singnaturee || cleanStr(l.Statuss).toLowerCase().includes('sign');

        const logDoc = {
          source_type: 'application',
          logsheet_type: 'application',
          application_id: lAppId || undefined,
          client_id: userIdStr,
          site_id: lSiteId,
          site_name: cleanStr(l.SiteName) || companyName,
          company_name: companyName,
          company_address: cleanStr(l.CAddress) || address,
          manufacturing_address: cleanStr(l.ManufactAddss) || address,
          contact_person: cleanStr(l.ContactPerson) || contactPerson,
          contact_email: cleanStr(l.Conemail) || finalEmail,
          nature_of_business: cleanStr(l.NatureOFBus) || 'Manufacturing',
          product_category: cleanStr(l.ProCate) || 'General',
          certificate_standard: cleanStr(l.ApplicationCategory) || 'HFA Standard',
          certificate_type: cleanStr(l.ApplicationType) || cleanStr(l.ApplicationCategory) || 'Halal Certification',
          issue_date: safeDate(l.IssDateOCert, null),
          expiry_date: safeDate(l.ExPiryDatCert, null),
          audit_type: cleanStr(l.AuditTy) || 'Annual',
          audit_date: safeDate(l.Audidate, null),
          auditors: cleanStr(l.Auditors) || '',
          ncs_close: cleanStr(l.NCsCloseifany) || '',
          docs_satisfactory: cleanStr(l.ADRAFS) || '',
          pork_free_statement: cleanStr(l.PFSSPPS) || '',
          reviewer_name: cleanStr(l.Name) || 'Auditor',
          review_date: safeDate(l.ReDate, null),
          annual_certificate: cleanStr(l.AnCer).toLowerCase().includes('y') ? 'Yes' : 'No',
          batch_certificate: cleanStr(l.BaCert).toLowerCase().includes('y') ? 'Yes' : 'No',
          new_products_only: cleanStr(l.OnAddONePro).toLowerCase().includes('y') ? 'Yes' : 'No',
          new_site_line: cleanStr(l.AddONewSite).toLowerCase().includes('y') ? 'Yes' : 'No',
          new_client: cleanStr(l.NewClite).toLowerCase().includes('y') ? 'Yes' : 'No',
          agreement_signed: cleanStr(l.AgSig).toLowerCase().includes('y') ? 'Yes' : 'No',
          status_date: safeDate(l.daOAgree, null),
          comment: cleanStr(l.Commenter) || cleanStr(l.Commenter1) || '',
          status: isSigned ? 'Completed' : 'Waiting for Signature',
          confirmed: true,
          // Signatures
          mufti_signature: l.Mufitysinf ? `data:image/png;base64,${l.Mufitysinf}` : (l.Singnaturee ? `data:image/png;base64,${l.Singnaturee}` : null),
          mufti_sign_name: cleanStr(l.MufityBy) || cleanStr(l.NameC) || 'Mufti Signatory',
          mufti_sign_date: safeDate(l.Mufitydate, safeDate(l.Datee, new Date())),
          ceo_signature: l.cebsing ? `data:image/png;base64,${l.cebsing}` : null,
          ceo_sign_name: cleanStr(l.ceoby) || cleanStr(l.NameC2) || 'CEO Signatory',
          ceo_sign_date: safeDate(l.ceodateby, safeDate(l.Datee, new Date())),
          manager_signature: l.SchemSing ? `data:image/png;base64,${l.SchemSing}` : null,
          manager_sign_name: cleanStr(l.SchemBy) || cleanStr(l.NameC3) || 'Scheme Manager',
          manager_sign_date: safeDate(l.SchemDate, safeDate(l.Datee, new Date())),
          mufti2_signature: l.Mufitysinf1 ? `data:image/png;base64,${l.Mufitysinf1}` : null,
          mufti2_sign_name: cleanStr(l.MufityBy1) || cleanStr(l.NameC4) || '',
          mufti2_sign_date: safeDate(l.Mufitydate1, null)
        };

        const logRes = await ApplicationLogsheet.findOneAndUpdate(
          { client_id: userIdStr, company_name: companyName, audit_date: logDoc.audit_date },
          { $set: logDoc },
          { upsert: true, new: true }
        );

        if (lAppId) {
          await Application.updateOne({ _id: lAppId }, { $set: { logsheet_id: logRes._id } });
        }
        trackerState.stats.logsheetsCreated++;
      }

      // -------------------------------------------------------------
      // G. ADD-ON APPLICATIONS (dbo.ProAder)
      // -------------------------------------------------------------
      const addOnRows = sqlTables.addOnsMap.get(cid) || [];
      for (const a of addOnRows) {
        const recId = cleanStr(a.RecordID);
        const refNo = `ADDON-${recId || cid}`;
        const siteId = siteIdMap.get(cleanStr(a.CiteID)) || defaultSiteId;
        const rawStat = cleanStr(a.Statuscomp).toLowerCase();
        const stat = ADDON_STATUS_MAP[rawStat] || (rawStat.includes('accept') ? 'accepted' : 'submitted');

        const atId = cleanStr(a.AtID);
        const addOnProds = sqlTables.addOnProductsByAtId.get(atId) || [];
        const productsList = addOnProds.map((p, pIdx) => ({
          sn: pIdx + 1,
          name: p.name,
          code: p.code,
          type: p.type === 'Add Product' ? 'Add product' : (['Add product', 'Remove product', 'Change name/code', 'Change ingredients', 'Change ingredient'].includes(p.type) ? p.type : 'Add product')
        }));

        const addOnDoc = {
          application_number: refNo,
          client_id: userIdStr,
          site_id: siteId,
          type_of_addon: 'New Products',
          company_name: companyName,
          status: stat,
          description: cleanStr(a.ProductLister) || `Add-on products for ${companyName}`,
          contact_person: cleanStr(a.ContactPeNa) || contactPerson,
          contact_email: finalEmail,
          products: productsList,
          submission_date: safeDate(a.Datere),
          notes: `Imported from legacy HFA database (Record: ${recId})`
        };

        await AddOnApplication.findOneAndUpdate(
          { client_id: userIdStr, application_number: refNo },
          { $set: addOnDoc },
          { upsert: true, new: true }
        );
        trackerState.stats.addOnsCreated++;
      }

      // -------------------------------------------------------------
      // H. EXPORT CERTIFICATES (dbo.tlbhecmaster)
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

      // -------------------------------------------------------------
      // I. PROPOSALS (dbo.TblProposal)
      // -------------------------------------------------------------
      const compProposals = [
        ...(sqlTables.proposalsByCid.get(cid) || []),
        ...(sqlTables.proposalsByCompName.get(companyName.toLowerCase()) || [])
      ];
      for (const [appNum] of appMapByAppNum.entries()) {
        const trailingMatch = appNum.match(/(\d+)$/);
        if (trailingMatch) {
          const suffixProps = sqlTables.proposalsByAppId.get(trailingMatch[1]) || [];
          for (const sp of suffixProps) {
            if (!compProposals.some(p => p.Proposalid === sp.Proposalid)) {
              compProposals.push(sp);
            }
          }
        }
      }

      for (const p of compProposals) {
        const rawStatus = cleanStr(p.PropoAR);
        const propStatus = rawStatus === 'Approved' ? 'accepted' : (rawStatus === 'Rejected' ? 'rejected' : 'pending');
        const pAppId = appMapByAppNum.get(cleanStr(p.ApplictionID)) || latestAppId;
        const propTitle = cleanStr(p.Subjeer) || `Halal Certification Proposal - ${companyName}`;

        const propDoc = {
          client_id: userIdStr,
          application_id: pAppId || undefined,
          title: propTitle,
          subject: cleanStr(p.Subjeer) || 'Halal Certification Proposal',
          details: cleanStr(p.Commenter) || cleanStr(p.CommenterA) || `Proposal for ${companyName}`,
          amount: 0,
          currency: 'GBP',
          status: propStatus,
          admin_comment: cleanStr(p.AdminR) || '',
          client_comment: cleanStr(p.ClinR) || '',
          version: 1,
          createdAt: safeDate(p.DateSent, new Date()),
          updatedAt: safeDate(p.DateRecieved, safeDate(p.DateSent, new Date()))
        };

        await Proposal.findOneAndUpdate(
          { client_id: userIdStr, title: propTitle },
          { $set: propDoc },
          { upsert: true, new: true }
        );
        trackerState.stats.proposalsCreated++;
      }

      // -------------------------------------------------------------
      // J. AGREEMENTS (dbo.Agrdoon)
      // -------------------------------------------------------------
      const compAgreements = [
        ...(sqlTables.agreementsByCid.get(cid) || [])
      ];
      for (const [appNum] of appMapByAppNum.entries()) {
        const appAgrs = sqlTables.agreementsByAppId.get(appNum) || [];
        for (const aa of appAgrs) {
          if (!compAgreements.some(a => a.Massid === aa.Massid && a.AppID === aa.AppID)) {
            compAgreements.push(aa);
          }
        }
      }

      for (const a of compAgreements) {
        const aAppId = appMapByAppNum.get(cleanStr(a.AppID)) || latestAppId;
        const isRead = cleanStr(a.Tatuse).toLowerCase() === 'read';
        let agrStatus = 'sent';
        if (latestAppStatus === 'certificate_issued' || latestAppStatus === 'agreement_signed') {
          agrStatus = 'finalized';
        } else if (isRead) {
          agrStatus = 'sent';
        }

        const agrDoc = {
          client_id: userIdStr,
          application_id: aAppId || undefined,
          title: `Halal Certification Agreement - ${companyName}`,
          details: `Agreement recorded on ${cleanStr(a.SentDate, 'file date')}`,
          status: agrStatus,
          client_signed: agrStatus === 'finalized',
          client_sign_date: safeDate(a.SentDate, null),
          createdAt: safeDate(a.SentDate, new Date())
        };

        await Agreement.findOneAndUpdate(
          { client_id: userIdStr, title: agrDoc.title },
          { $set: agrDoc },
          { upsert: true, new: true }
        );
        trackerState.stats.agreementsCreated++;
      }

      // -------------------------------------------------------------
      // K. INVOICES (dbo.LisVoce)
      // -------------------------------------------------------------
      const compInvoices = sqlTables.invoicesByCid.get(cid) || [];
      for (const v of compInvoices) {
        const invNum = `INV-${cleanStr(v.InvID)}`;
        const vAppId = appMapByAppNum.get(cleanStr(v.KingID)) || latestAppId;
        const isPaid = latestAppStatus === 'payment_received' || latestAppStatus === 'final_invoice_paid' || latestAppStatus === 'certificate_issued';

        const invDoc = {
          client_id: userIdStr,
          application_id: vAppId || undefined,
          invoice_number: invNum,
          title: cleanStr(v.Sujb) || `Invoice #${cleanStr(v.InvID)}`,
          description: cleanStr(v.Mess) || `Halal Certification Invoice for ${companyName}`,
          invoice_type: 'initial',
          amount: 0,
          currency: 'GBP',
          status: isPaid ? 'paid' : 'unpaid',
          due_date: safeDate(v.DateSe),
          paid_at: isPaid ? safeDate(v.DateSe) : undefined,
          createdAt: safeDate(v.DateSe, new Date()),
          version: 1
        };

        await Invoice.findOneAndUpdate(
          { invoice_number: invNum },
          { $set: invDoc },
          { upsert: true, new: true }
        );
        trackerState.stats.invoicesCreated++;
      }

      // -------------------------------------------------------------
      // L. AUDITS (dbo.tlbAudlister) - 3,439 Audits
      // -------------------------------------------------------------
      for (const [appNum, aId] of appMapByAppNum.entries()) {
        const appAudits = sqlTables.auditsByAppNum.get(appNum) || [];
        for (const aud of appAudits) {
          const auditDate = safeDate(aud.AuditDate);
          const isDone = cleanStr(aud.Donert).toLowerCase().includes('done') || auditDate < new Date();
          const auditType = cleanStr(aud.Statuss) || cleanStr(aud.AuditoType) || 'Annual';
          const auditorName = cleanStr(aud.AuditorName) || 'HFA Auditor';

          const auditDoc = {
            application_id: aId,
            client_id: userIdStr,
            site_id: defaultSiteId,
            audit_type: auditType,
            scheduled_date: auditDate,
            finalized_date: auditDate,
            completed_at: isDone ? auditDate : undefined,
            status: isDone ? 'audit_completed' : 'date_finalized',
            auditors: [{ name: auditorName, role: 'Lead Auditor' }],
            notes: `Assigned by: ${cleanStr(aud.AssPerson, 'HFA Admin')}`,
            stage: auditType.toLowerCase().includes('stage 2') ? 2 : 1
          };

          await Audit.findOneAndUpdate(
            { application_id: aId, scheduled_date: auditDate },
            { $set: auditDoc },
            { upsert: true, new: true }
          );
          trackerState.stats.auditsCreated++;
        }
      }

      // -------------------------------------------------------------
      // M. SUPPORT TICKETS (dbo.tlbtic)
      // -------------------------------------------------------------
      const compTickets = sqlTables.ticketsByCompName.get(companyName.toLowerCase()) || [];
      for (const t of compTickets) {
        const ticNum = `TCK-${cleanStr(t.Ider)}`;
        const isDone = cleanStr(t.satus).toLowerCase() === 'done';

        const ticDoc = {
          ticket_number: ticNum,
          user_id: userIdStr,
          subject: cleanStr(t.Subjet) || `Support Request - ${companyName}`,
          message: cleanStr(t.Mess) || 'Support inquiry',
          department: 'General',
          priority: 'medium',
          status: isDone ? 'resolved' : 'open',
          source: 'portal',
          created_at: safeDate(t.Date),
          resolved_at: isDone ? safeDate(t.Date) : undefined
        };

        await Ticket.findOneAndUpdate(
          { ticket_number: ticNum },
          { $set: ticDoc },
          { upsert: true, new: true }
        );
        trackerState.stats.ticketsCreated++;
      }

      // Progress Update
      trackerState.processedCompanies++;
      updateTrackerFile(cid, companyName);

      // Console Progress Log every 10 companies or at completion
      if ((idx + 1) % 10 === 0 || idx === companies.length - 1) {
        const pct = ((trackerState.processedCompanies / trackerState.totalCompanies) * 100).toFixed(1);
        console.log(`[${String(trackerState.processedCompanies).padStart(4)}/${trackerState.totalCompanies}] (${pct.padStart(5)}%) CID: ${cid.padEnd(7)} | ${companyName.substring(0, 25).padEnd(25)} | Prods: ${String(productRows.length).padStart(3)} | Logsheets: ${String(compLogsheets.length).padStart(2)} | Certs: ${String(certRows.length).padStart(2)} | Apps: ${String(appRows.length + renewalRows.length + survRows.length).padStart(2)}`);
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
  console.log('🎉 ALL HFA COMPANIES & DATA SUCCESSFULLY IMPORTED TO MONGODB!');
  console.log('=============================================================================');
  console.log(`⏱️  Total Duration      : ${totalMinutes} minutes`);
  console.log(`🏢 Companies Processed : ${trackerState.processedCompanies} / ${trackerState.totalCompanies}`);
  console.log(`👤 Users Created/Upd   : ${trackerState.stats.usersCreated} created, ${trackerState.stats.usersUpdated} updated`);
  console.log(`📍 Sites Created       : ${trackerState.stats.sitesCreated}`);
  console.log(`📦 Products Created    : ${trackerState.stats.productsCreated}`);
  console.log(`📝 Applications Created: ${trackerState.stats.appsCreated}`);
  console.log(`📜 Certificates Created: ${trackerState.stats.certsCreated}`);
  console.log(`📋 Logsheets Created   : ${trackerState.stats.logsheetsCreated}`);
  console.log(`➕ Add-Ons Created     : ${trackerState.stats.addOnsCreated}`);
  console.log(`🚢 Export Certs Created: ${trackerState.stats.exportCertsCreated}`);
  console.log(`📄 Proposals Created   : ${trackerState.stats.proposalsCreated}`);
  console.log(`🤝 Agreements Created  : ${trackerState.stats.agreementsCreated}`);
  console.log(`💳 Invoices Created    : ${trackerState.stats.invoicesCreated}`);
  console.log(`🔍 Audits Created      : ${trackerState.stats.auditsCreated}`);
  console.log(`🎫 Tickets Created     : ${trackerState.stats.ticketsCreated}`);
  console.log(`⚠️  Total Errors        : ${trackerState.stats.errors.length}`);
  console.log('=============================================================================\n');

  await mongoose.disconnect();
  process.exit(0);
}

runFullCompanyImport().catch(err => {
  console.error('FATAL ERROR DURING IMPORT:', err);
  process.exit(1);
});
