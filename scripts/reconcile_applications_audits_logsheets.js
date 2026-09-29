import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import readline from 'readline';
import { fileURLToPath } from 'url';
import dns from 'dns';

// Fix Node.js SRV DNS resolution on Windows
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const EXPORT_DIR = path.resolve(__dirname, '../sql-server-export/export');

function cleanStr(val, defaultVal = '') {
  if (val === null || val === undefined) return defaultVal;
  const s = String(val).trim();
  return s === '' || s === '-' || s === 'None' || s === 'null' ? defaultVal : s;
}

function safeDate(val, defaultDate = null) {
  if (!val) return defaultDate;
  const d = new Date(typeof val === 'string' ? val.trim() : val);
  return isNaN(d.getTime()) ? defaultDate : d;
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

async function streamLoadLogsheets() {
  const filePath = path.join(EXPORT_DIR, 'HalalTick/tables/dbo.tlblogsit.json');
  if (!fs.existsSync(filePath)) {
    console.warn(`   ⚠️ Missing tlblogsit.json`);
    return [];
  }

  console.log('   ⏳ Streaming logsheets from tlblogsit.json...');
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

  console.log(`   ✓ Loaded ${rows.length} logsheet rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return rows;
}

async function runReconciliation() {
  console.log('=============================================================================');
  console.log('🚀 RECONCILING APPLICATIONS, AUDITS & LOGSHEETS IN MONGODB');
  console.log('=============================================================================');

  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) throw new Error('MONGODB_URI is missing in .env');

  await mongoose.connect(mongoUri);
  console.log('✓ Connected to MongoDB');

  const Application = mongoose.model('Application', new mongoose.Schema({}, { strict: false }));
  const Audit = mongoose.model('Audit', new mongoose.Schema({}, { strict: false }));
  const ApplicationLogsheet = mongoose.model('ApplicationLogsheet', new mongoose.Schema({}, { strict: false }));
  const AddOnApplication = mongoose.model('AddOnApplication', new mongoose.Schema({}, { strict: false }));

  // 1. Pre-load Applications from MongoDB
  console.log('\n📥 1. Indexing existing MongoDB Applications & Add-Ons...');
  const allApps = await Application.find({}).lean();
  console.log(`   ✓ Found ${allApps.length} applications in MongoDB`);
  const appMapByNum = new Map();
  allApps.forEach(a => {
    if (a.application_number) appMapByNum.set(a.application_number.trim(), a);
  });

  const allAddOns = await AddOnApplication.find({}).lean();
  console.log(`   ✓ Found ${allAddOns.length} Add-On applications in MongoDB`);
  const addOnMapByRecId = new Map();
  const addOnMapByNum = new Map();
  allAddOns.forEach(ao => {
    if (ao.application_number) {
      addOnMapByNum.set(ao.application_number.trim(), ao);
      const match = ao.application_number.match(/ADDON-(\d+)/);
      if (match) addOnMapByRecId.set(match[1], ao);
    }
    if (ao.notes) {
      const matchNotes = ao.notes.match(/Record:\s*(\d+)/i);
      if (matchNotes) addOnMapByRecId.set(matchNotes[1], ao);
    }
  });

  // 2. Pre-load SQL tables
  console.log('\n🗄️  2. Loading SQL Server application tables...');
  const appRows = readSqlTable('HalalApp/tables/dbo.AppleReg.json');
  const renRows = readSqlTable('HalalAReNew/tables/dbo.REneApp.json');
  const survRows = readSqlTable('HalalAReNew/tables/dbo.tlbSuvance.json');
  const audits1 = readSqlTable('HalalyMains/tables/dbo.tlbAudlister.json');
  const audits2 = readSqlTable('HalalyMain/tables/dbo.tlbAudlister.json');
  const allAuditRows = [...audits1, ...audits2];

  console.log(`   ✓ AppleReg: ${appRows.length} rows`);
  console.log(`   ✓ REneApp: ${renRows.length} rows`);
  console.log(`   ✓ tlbSuvance: ${survRows.length} rows`);
  console.log(`   ✓ tlbAudlister: ${allAuditRows.length} audits`);

  const sqlAppByNum = new Map();
  appRows.forEach(a => {
    const num = cleanStr(a.AppNumber);
    if (num) sqlAppByNum.set(num, { ...a, _sourceType: 'new' });
  });
  renRows.forEach(r => {
    const num = cleanStr(r.AppNumber);
    if (num) sqlAppByNum.set(num, { ...r, _sourceType: 'renewal' });
  });
  survRows.forEach(s => {
    const num = cleanStr(s.AppNumber);
    if (num) sqlAppByNum.set(num, { ...s, _sourceType: 'surveillance' });
  });

  // 3. Enrich Application Details from SQL
  console.log('\n📝 3. Enriching Application Details in MongoDB...');
  const appEnrichOps = [];
  for (const app of allApps) {
    const sql = sqlAppByNum.get(app.application_number);
    if (!sql) continue;

    const updates = {};
    if (sql._sourceType === 'new') {
      const estName = cleanStr(sql.NameEstablishmen) || cleanStr(sql.NameEstablishmen1) || app.establishment_name || app.company_name;
      const headOffice = cleanStr(sql.CoHOfficeAddress) || app.establishment_address;
      const siteAddr = cleanStr(sql.SiteFactoryAddress) || cleanStr(sql.SiteFactoryAddress1) || cleanStr(sql.CoHOfficeAddress) || app.site_address;
      const regNo = cleanStr(sql.CRNumber) || cleanStr(sql.CRNumber1) || cleanStr(sql.RegistrationNo) || app.reg_number;
      const vatNo = cleanStr(sql.VATNumber) || cleanStr(sql.VATNumber1) || app.vat_number;
      const tradeName = cleanStr(sql.TradingNam) || cleanStr(sql.TradingNam1) || app.trading_name;
      const brand = cleanStr(sql.BrandName) || app.brand_name;
      const web = cleanStr(sql.WebsiteAddres) || cleanStr(sql.WebsiteAddres1) || app.website;
      const email = cleanStr(sql.EAddres) || cleanStr(sql.EAddres1) || cleanStr(sql.EmailAddress) || app.company_email;
      const empCount = parseInt(sql.NumberEmployees || sql.NumberEmployees1, 10) || app.employee_count || 0;
      const yrsBiz = cleanStr(sql.NumberOFBusinest) || cleanStr(sql.NumberOFBusinest1) || app.years_in_business;
      const md = cleanStr(sql.Nameer) || cleanStr(sql.PCPrimaryContactN) || app.managing_director;
      const pos = cleanStr(sql.Positionn) || app.signatory_position || 'Managing Director';
      const sigDate = safeDate(sql.Datee || sql.AppDate, app.signatory_date);
      const contactName = cleanStr(sql.PCPrimaryContactN) || cleanStr(sql.ContactName) || app.contact_person;
      const contactMail = cleanStr(sql.PCEmailAddress) || cleanStr(sql.EAddres) || cleanStr(sql.ContactEmail) || app.contact_email;
      const pWorkTel = cleanStr(sql.PCWorkPho) || app.primary_work_tel;
      const pMobile = cleanStr(sql.PCMobilePho) || app.primary_mobile;
      const halalCoord = cleanStr(sql.TechnicalName) || app.halal_coordinator;
      const tWorkTel = cleanStr(sql.TPWorktelephone) || app.tech_work_tel;
      const tMobile = cleanStr(sql.TPMobilePhone) || app.tech_mobile;
      const qaMail = cleanStr(sql.TPEmailAdd) || app.qa_contact;
      const scopeDesc = cleanStr(sql.ProDescription) || app.scope;
      const prodOnSite = parseInt(sql.NumberProduct, 10) || app.products_on_site_count || 0;
      const prodHalal = parseInt(sql.NumberProducHalal, 10) || app.products_halal_count || 0;
      const foodNat = cleanStr(sql.NatureBusiness) || app.food_nature;
      const nonFoodNat = cleanStr(sql.NatureBusiness1) || app.nonfood_nature;
      const bizType = cleanStr(sql.TypeOfBusiness1) || app.business_type || 'Manufacturer';
      const exportOnly = cleanStr(sql.CertificationRequiredtPurposes).toLowerCase() === 'yes' ? 'yes' : (app.export_only || 'no');
      const prevGso = cleanStr(sql.HaveGso).toLowerCase() === 'yes' ? 'yes' : (app.prev_gso_app || 'no');
      const sched = cleanStr(sql.ScheduleHalalProduction) || app.halal_schedule || 'Regular/Routine halal product';
      const isPorcine = cleanStr(sql.IsPock).toLowerCase() === 'yes';
      const isIntoxicant = cleanStr(sql.AreIntoxicants).toLowerCase() === 'yes';
      const useLogo = cleanStr(sql.Areyoudepict).toLowerCase() === 'yes' ? 'yes' : (app.use_hfa_logo || 'no');
      const refSrc = cleanStr(sql.HowHear) || app.referral_source;

      Object.assign(updates, {
        establishment_name: estName,
        establishment_address: headOffice,
        site_address: siteAddr,
        reg_number: regNo,
        company_reg_number: regNo,
        vat_number: vatNo,
        trading_name: tradeName,
        brand_name: brand,
        website: web,
        company_email: email,
        employee_count: empCount,
        years_in_business: yrsBiz,
        managing_director: md,
        signatory_position: pos,
        signatory_date: sigDate,
        contact_person: contactName,
        contact_email: contactMail,
        primary_contact_name: contactName,
        primary_work_tel: pWorkTel,
        primary_mobile: pMobile,
        primary_email: contactMail,
        halal_coordinator: halalCoord,
        tech_work_tel: tWorkTel,
        tech_mobile: tMobile,
        qa_contact: qaMail,
        scope: scopeDesc,
        products_on_site_count: prodOnSite,
        products_halal_count: prodHalal,
        food_nature: foodNat,
        nonfood_nature: nonFoodNat,
        business_type: bizType,
        export_only: exportOnly,
        prev_gso_app: prevGso,
        halal_schedule: sched,
        production_schedule: sched,
        has_porcine: isPorcine,
        has_intoxicants: isIntoxicant,
        use_hfa_logo: useLogo,
        referral_source: refSrc,
        declared_true: true,
        application_type: 'new',
        type: 'initial'
      });
    } else if (sql._sourceType === 'renewal') {
      Object.assign(updates, {
        establishment_name: app.establishment_name || app.company_name,
        contact_person: cleanStr(sql.ContactName) || app.contact_person,
        contact_email: cleanStr(sql.ContactEmail) || app.contact_email,
        primary_contact_name: cleanStr(sql.ContactName) || app.primary_contact_name || app.contact_person,
        primary_email: cleanStr(sql.ContactEmail) || app.primary_email || app.contact_email,
        managing_director: cleanStr(sql.Designation) || app.managing_director,
        scope: cleanStr(sql.AppCategory) || app.scope,
        declared_true: true,
        application_type: 'renewal',
        type: 'renewal',
        is_renewal: true,
        is_surveillance: false
      });
    } else if (sql._sourceType === 'surveillance') {
      Object.assign(updates, {
        establishment_name: app.establishment_name || app.company_name,
        contact_person: cleanStr(sql.ContactName) || app.contact_person,
        contact_email: cleanStr(sql.ContactEmail) || app.contact_email,
        primary_contact_name: cleanStr(sql.ContactName) || app.primary_contact_name || app.contact_person,
        primary_email: cleanStr(sql.ContactEmail) || app.primary_email || app.contact_email,
        managing_director: cleanStr(sql.Designation) || app.managing_director,
        scope: cleanStr(sql.AppCategory) || app.scope,
        declared_true: true,
        application_type: 'surveillance',
        type: 'surveillance',
        is_surveillance: true,
        is_renewal: false
      });
    }

    if (Object.keys(updates).length > 0) {
      appEnrichOps.push({
        updateOne: {
          filter: { _id: app._id },
          update: { $set: updates }
        }
      });
    }
  }

  if (appEnrichOps.length > 0) {
    const res = await Application.bulkWrite(appEnrichOps, { ordered: false });
    console.log(`   ✓ Successfully enriched details for ${res.modifiedCount || appEnrichOps.length} applications`);
  }

  // 4. Map and Reconcile Audits
  console.log('\n🔍 4. Reconciling Audits with exact applications & setting nc_closed: true...');
  const auditsByAppNum = new Map();
  allAuditRows.forEach(a => {
    const num = cleanStr(a.AppID);
    if (num) {
      if (!auditsByAppNum.has(num)) auditsByAppNum.set(num, []);
      auditsByAppNum.get(num).push(a);
    }
  });

  const auditBulkOps = [];
  const appStatusOps = [];

  for (const app of allApps) {
    const appNum = app.application_number;
    const appAudits = auditsByAppNum.get(appNum) || [];
    let hasCompletedAudit = false;
    let latestAuditDate = null;

    for (const aud of appAudits) {
      const auditDate = safeDate(aud.AuditDate);
      const isDone = cleanStr(aud.Donert).toLowerCase().includes('done') || (auditDate && auditDate < new Date());
      const auditType = cleanStr(aud.Statuss) || cleanStr(aud.AuditoType) || 'Annual';
      const auditorName = cleanStr(aud.AuditorName) || 'HFA Auditor';

      if (isDone) {
        hasCompletedAudit = true;
        if (!latestAuditDate || (auditDate && auditDate > latestAuditDate)) latestAuditDate = auditDate;
      }

      const auditDoc = {
        application_id: app._id,
        client_id: app.client_id,
        site_id: app.site_id,
        audit_type: auditType,
        scheduled_date: auditDate,
        finalized_date: auditDate,
        completed_at: isDone ? auditDate : undefined,
        status: isDone ? 'audit_completed' : 'date_finalized',
        nc_closed: isDone ? true : false,
        nc_closed_at: isDone ? auditDate : undefined,
        auditors: [{ name: auditorName, role: 'Lead Auditor' }],
        notes: `Assigned by: ${cleanStr(aud.AssPerson, 'HFA Admin')}`,
        stage: auditType.toLowerCase().includes('stage 2') ? 2 : 1
      };

      auditBulkOps.push({
        updateOne: {
          filter: { application_id: app._id, scheduled_date: auditDate },
          update: { $set: auditDoc },
          upsert: true
        }
      });
    }

    // If application audit is completed, advance to nc_closed if on earlier/audit stage
    if (hasCompletedAudit) {
      const preAuditStatuses = [
        'submitted', 'under_review', 'approved', 'dates_proposed',
        'dates_accepted', 'date_finalized', 'audit_assigned',
        'audit_completed', 'audited', 'audit_report_submitted'
      ];

      const currentStatus = app.status;
      if (preAuditStatuses.includes(currentStatus)) {
        appStatusOps.push({
          updateOne: {
            filter: { _id: app._id },
            update: {
              $set: {
                status: 'nc_closed',
                nc_closed: true,
                nc_closed_at: latestAuditDate || new Date()
              }
            }
          }
        });
      } else {
        // App is already in downstream stage (logsheet, cert, agreement)
        appStatusOps.push({
          updateOne: {
            filter: { _id: app._id },
            update: {
              $set: {
                nc_closed: true,
                nc_closed_at: latestAuditDate || app.submission_date || new Date()
              }
            }
          }
        });
      }
    }
  }

  // Execute audit updates in chunks
  if (auditBulkOps.length > 0) {
    const CHUNK_SIZE = 500;
    for (let i = 0; i < auditBulkOps.length; i += CHUNK_SIZE) {
      const chunk = auditBulkOps.slice(i, i + CHUNK_SIZE);
      await Audit.bulkWrite(chunk, { ordered: false });
    }
    console.log(`   ✓ Audits processed/created in bulk: ${auditBulkOps.length}`);
  }

  // Ensure all existing completed audits are marked nc_closed: true
  const auditCloseRes = await Audit.updateMany(
    { status: 'audit_completed' },
    { $set: { nc_closed: true } }
  );
  console.log(`   ✓ Marked ${auditCloseRes.modifiedCount} existing completed audits with nc_closed: true`);

  if (appStatusOps.length > 0) {
    await Application.bulkWrite(appStatusOps, { ordered: false });
    console.log(`   ✓ Applications updated with nc_closed: true: ${appStatusOps.length}`);
  }

  // 5. Reconcile Logsheets with exact applications (NO FALLBACK!)
  console.log('\n📋 5. Reconciling Logsheets with exact applications without fallback...');
  const sqlLogsheets = await streamLoadLogsheets();

  const exactAppLogsheetMap = new Map(); // appNum -> logsheet row
  const exactAddOnLogsheetMap = new Map(); // recordId -> logsheet row
  let unlinkedLogsheets = 0;

  sqlLogsheets.forEach(l => {
    const rawAppId = cleanStr(l.AppID);
    if (!rawAppId || rawAppId.toLowerCase().includes('select')) {
      unlinkedLogsheets++;
      return;
    }

    if (rawAppId.startsWith('M2-') || appMapByNum.has(rawAppId)) {
      exactAppLogsheetMap.set(rawAppId, l);
    } else if (rawAppId.startsWith('AO')) {
      const recId = rawAppId.replace(/^AO0*/, '');
      exactAddOnLogsheetMap.set(recId, l);
      exactAddOnLogsheetMap.set(rawAppId, l);
    } else {
      unlinkedLogsheets++;
    }
  });

  console.log(`   ✓ Exact Application Logsheets identified: ${exactAppLogsheetMap.size}`);
  console.log(`   ✓ Exact Add-On Logsheets identified     : ${exactAddOnLogsheetMap.size}`);
  console.log(`   ✓ Unlinked Logsheets (No fallback)     : ${unlinkedLogsheets}`);

  // Clear dangling logsheet_ids
  console.log('\n🧹 Clearing dangling logsheet_id links on applications...');
  const existingLogsheetIds = new Set((await ApplicationLogsheet.find({}, { _id: 1 }).lean()).map(l => String(l._id)));
  const appsWithDangling = allApps.filter(a => a.logsheet_id && !existingLogsheetIds.has(String(a.logsheet_id)));
  if (appsWithDangling.length > 0) {
    await Application.updateMany(
      { _id: { $in: appsWithDangling.map(a => a._id) } },
      { $unset: { logsheet_id: 1 } }
    );
  }
  console.log(`   ✓ Cleared ${appsWithDangling.length} dangling logsheet_id pointers`);

  // Map exact application logsheets
  console.log('\n⚡ Upserting exact application logsheets and linking to applications...');
  let logsheetsLinkedToApps = 0;
  for (const [appNum, l] of exactAppLogsheetMap.entries()) {
    const app = appMapByNum.get(appNum);
    if (!app) continue;

    const rawStatus = cleanStr(l.Statuss);
    const lowerRaw = rawStatus.toLowerCase();
    if (lowerRaw === 'bin') continue;

    let mappedStatus;
    if (lowerRaw === 'waiting for signature') {
      mappedStatus = 'Waiting for Signature';
    } else if (rawStatus === 'Ready for Certificate.') {
      mappedStatus = 'Completed';
    } else if (lowerRaw === 'done') {
      mappedStatus = 'Signed';
    } else if (lowerRaw.includes('certificate sent') || lowerRaw === 'certficate sent') {
      mappedStatus = 'Completed';
    } else if (
      lowerRaw.includes('ready for certificate') ||
      lowerRaw.includes('account approval') ||
      lowerRaw.includes('product')
    ) {
      mappedStatus = 'Waiting For Certificate';
    } else {
      const isSigned = l.ceoby || l.MufityBy || l.SchemBy || l.Singnaturee;
      mappedStatus = isSigned ? 'Signed' : 'Completed';
    }

    const isSignedAtAll = Boolean(l.ceoby || l.MufityBy || l.SchemBy || l.Singnaturee || l.cebsing || l.Mufitysinf || l.SchemSing);

    const logDoc = {
      source_type: 'application',
      logsheet_type: 'application',
      is_seed: true,
      application_id: app._id,
      client_id: app.client_id,
      site_id: app.site_id,
      site_name: cleanStr(l.SiteName) || app.site_name || app.company_name,
      company_name: app.company_name,
      company_address: cleanStr(l.CAddress) || app.establishment_address,
      manufacturing_address: cleanStr(l.ManufactAddss) || app.site_address,
      contact_person: cleanStr(l.ContactPerson) || app.contact_person,
      contact_email: cleanStr(l.Conemail) || app.contact_email,
      nature_of_business: cleanStr(l.NatureOFBus) || app.business_type || 'Manufacturing',
      product_category: cleanStr(l.ProCate) || 'General',
      certificate_standard: cleanStr(l.ApplicationCategory) || app.scheme || 'HFA Standard',
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
      status: mappedStatus,
      confirmed: true,
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

    const logQuery = logDoc.audit_date
      ? { client_id: app.client_id, company_name: app.company_name, audit_date: logDoc.audit_date }
      : (logDoc.issue_date
        ? { client_id: app.client_id, company_name: app.company_name, issue_date: logDoc.issue_date }
        : { client_id: app.client_id, company_name: app.company_name, reviewer_name: logDoc.reviewer_name });

    const logRes = await ApplicationLogsheet.findOneAndUpdate(
      logQuery,
      { $set: logDoc },
      { upsert: true, new: true }
    );

    const isLogsheetFinalized = mappedStatus === 'Waiting For Certificate' || mappedStatus === 'Completed';
    const appTargetStatus = isLogsheetFinalized
      ? 'application_successful'
      : (isSignedAtAll ? 'logsheet_signed' : 'logsheet_created');

    const canAdvanceStatus = ['submitted', 'under_review', 'approved', 'dates_proposed', 'dates_accepted', 'date_finalized', 'audit_assigned', 'audit_completed', 'audited', 'audit_report_submitted', 'nc_closed', 'logsheet_created'].includes(app.status);

    await Application.updateOne(
      { _id: app._id },
      {
        $set: {
          logsheet_id: logRes._id,
          nc_closed: true,
          ...(canAdvanceStatus ? { status: appTargetStatus } : {})
        }
      }
    );
    logsheetsLinkedToApps++;
  }
  console.log(`   ✓ Exactly linked ${logsheetsLinkedToApps} logsheets to their rightful applications!`);

  // Unlink orphaned logsheets from ApplicationLogsheet
  console.log('\n🧹 Cleaning up any cross-linked logsheets in ApplicationLogsheet...');
  const appIds = new Set(allApps.map(a => String(a._id)));
  const appLogsheetsInDb = await ApplicationLogsheet.find({ application_id: { $ne: null } }, { _id: 1, application_id: 1 }).lean();
  const orphanedLogsheetIds = appLogsheetsInDb
    .filter(ls => ls.application_id && !appIds.has(String(ls.application_id)))
    .map(ls => ls._id);

  if (orphanedLogsheetIds.length > 0) {
    await ApplicationLogsheet.updateMany(
      { _id: { $in: orphanedLogsheetIds } },
      { $unset: { application_id: 1 } }
    );
  }
  console.log(`   ✓ Unlinked ${orphanedLogsheetIds.length} orphaned logsheet application_id references`);

  console.log('\n=============================================================================');
  console.log('🎉 RECONCILIATION COMPLETED SUCCESSFULLY!');
  console.log('=============================================================================\n');

  await mongoose.disconnect();
}

runReconciliation().catch(err => {
  console.error('FATAL RECONCILIATION ERROR:', err);
  process.exit(1);
});
