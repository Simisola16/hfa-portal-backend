import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const APP_STATUS_MAP = {
  'successful': 'certificate_issued',
  'approved': 'approved',
  'certificate sent': 'certificate_issued',
  'certificate issued': 'certificate_issued',
  'nc reports': 'nc_flagged',
  'submitted': 'submitted',
  'in progress': 'under_review'
};

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  const User = (await import('../models/User.js')).default;
  const Site = (await import('../models/Site.js')).default;
  const Application = (await import('../models/Application.js')).default;
  const AddOnApplication = (await import('../models/AddOnApplication.js')).default;

  const user = await User.findOne({ email: 'carl.robinson@clawson.co.uk' });
  if (!user) throw new Error('User not found!');

  const meltonSite = await Site.findOne({ client_id: user._id, name: /Melton/i });
  const bottesfordSite = await Site.findOne({ client_id: user._id, name: /Bottesford/i });

  console.log('User:', user.company_name, user._id);
  console.log('Melton Site:', meltonSite?.name, meltonSite?._id);
  console.log('Bottesford Site:', bottesfordSite?.name, bottesfordSite?._id);

  // 1. Initial Applications from AppleReg
  const appleRegPath = path.resolve(__dirname, '../sql-server-export/export/HalalApp/tables/dbo.AppleReg.json');
  const appleData = JSON.parse(fs.readFileSync(appleRegPath, 'utf8'));
  const appleRows = (appleData.rows || []).filter(r => JSON.stringify(r).toLowerCase().includes('clawson') || r.CID == '401');

  console.log(`\nImporting ${appleRows.length} initial applications...`);
  for (const a of appleRows) {
    const isBottesford = String(a.SiteName || a.CiteID || '').toLowerCase().includes('bottesford') || a.CiteID == '20306';
    const site = isBottesford ? bottesfordSite : meltonSite;
    const appNum = a.AppNumber || `APP-${a.CiteID}-401`;
    const appDate = new Date(a.AppDate ? a.AppDate.trim() : '2020-06-05');

    const doc = {
      application_number: appNum,
      client_id: user._id,
      site_id: String(site._id),
      site_name: site.name,
      type: 'initial',
      application_type: 'initial',
      is_renewal: false,
      is_surveillance: false,
      category: 'HFA Scheme',
      establishment_name: 'Long Clawson Dairy Ltd',
      establishment_address: site.address,
      reg_number: '5419R',
      vat_number: '116999525',
      contact_person: a.PCPrimaryContactN || 'Carl Robinson',
      contact_email: 'carl.robinson@clawson.co.uk',
      primary_contact_name: 'Carl Robinson',
      primary_email: 'carl.robinson@clawson.co.uk',
      managing_director: 'Carl Robinson',
      nature_of_business: 'Dairy (Food Processor)',
      food_nature: 'Dairy Processing',
      scope: 'Annual Certification – Food and General processing',
      declared_true: true,
      status: 'certificate_issued',
      nc_closed: true,
      submission_date: appDate,
      created_at: appDate,
      createdAt: appDate,
      notes: `Imported initial application from legacy HFA database (CiteID: ${a.CiteID})`
    };

    await Application.findOneAndUpdate(
      { application_number: appNum },
      { $set: doc },
      { upsert: true, new: true, timestamps: false }
    );
    console.log(` ✓ Initial App: ${appNum} (${site.name})`);
  }

  // 2. Renewal Applications from REneApp
  const renePath = path.resolve(__dirname, '../sql-server-export/export/HalalAReNew/tables/dbo.REneApp.json');
  const reneData = JSON.parse(fs.readFileSync(renePath, 'utf8'));
  const reneRows = (reneData.rows || []).filter(r => JSON.stringify(r).toLowerCase().includes('clawson') || r.KingID == '401');

  console.log(`\nImporting ${reneRows.length} renewal applications...`);
  for (const r of reneRows) {
    const isBottesford = String(r.SiteName || r.CiteID || '').toLowerCase().includes('bottesford') || r.CiteID == '20306';
    const site = isBottesford ? bottesfordSite : meltonSite;
    const appNum = `REN-${r.ArenewID}-401`;
    const appDate = new Date(r.AppDate ? r.AppDate.trim() : (r.FinalizedDate || '2020-05-25'));
    const rawStatus = (r.ApplStatus || '').trim().toLowerCase();
    const status = APP_STATUS_MAP[rawStatus] || 'certificate_issued';

    const doc = {
      application_number: appNum,
      client_id: user._id,
      site_id: String(site._id),
      site_name: site.name,
      type: 'renewal',
      application_type: 'renewal',
      is_renewal: true,
      is_surveillance: false,
      category: 'HFA Scheme',
      establishment_name: 'Long Clawson Dairy Ltd',
      establishment_address: site.address,
      reg_number: '5419R',
      vat_number: '116999525',
      contact_person: r.ContactName || (isBottesford ? 'Paula Marshall' : 'Carl Robinson'),
      contact_email: isBottesford ? 'paula.marshall@clawson.co.uk' : 'carl.robinson@clawson.co.uk',
      primary_contact_name: r.ContactName || (isBottesford ? 'Paula Marshall' : 'Carl Robinson'),
      primary_email: isBottesford ? 'paula.marshall@clawson.co.uk' : 'carl.robinson@clawson.co.uk',
      managing_director: r.Designation || 'Technical Manager',
      scope: 'Annual Certification – Food and General processing',
      declared_true: true,
      status: status,
      nc_closed: status === 'certificate_issued',
      submission_date: appDate,
      created_at: appDate,
      createdAt: appDate,
      notes: `Imported renewal application (ArenewID: ${r.ArenewID}, Auditor: ${r.AuditePerson || 'N/A'}, Audited: ${r.AuditedDate || 'N/A'})`
    };

    await Application.findOneAndUpdate(
      { application_number: appNum },
      { $set: doc },
      { upsert: true, new: true, timestamps: false }
    );
    console.log(` ✓ Renewal App: ${appNum} (${site.name}) - Status: ${status}`);
  }

  // 3. Add-On Application from ProAder
  const proAderPath = path.resolve(__dirname, '../sql-server-export/export/HalalAReNew/tables/dbo.ProAder.json');
  const proData = JSON.parse(fs.readFileSync(proAderPath, 'utf8'));
  const proRows = (proData.rows || []).filter(r => JSON.stringify(r).toLowerCase().includes('clawson') || r.CompID == '401');

  console.log(`\nImporting ${proRows.length} add-on applications...`);
  for (const p of proRows) {
    const isBottesford = String(p.SiteName || p.CiteID || '').toLowerCase().includes('bottesford') || p.CiteID == '20306';
    const site = isBottesford ? bottesfordSite : meltonSite;
    const addOnNum = `ADDON-${p.RecordID}-401`;
    const addOnDate = new Date(p.Datere ? p.Datere.trim() : '2021-04-08');

    const appDoc = {
      application_number: addOnNum,
      client_id: user._id,
      site_id: String(site._id),
      site_name: site.name,
      type: 'addon',
      application_type: 'addon',
      is_renewal: false,
      is_surveillance: false,
      category: 'HFA Scheme',
      establishment_name: 'Long Clawson Dairy Ltd',
      establishment_address: site.address,
      contact_person: p.ContactPeNa || 'Carl Robinson',
      contact_email: 'carl.robinson@clawson.co.uk',
      scope: p.Sujetrer || 'Add-On Application',
      declared_true: true,
      status: 'certificate_issued',
      submission_date: addOnDate,
      created_at: addOnDate,
      createdAt: addOnDate,
      notes: `Imported add-on application from legacy HFA database: ${p.Sujetrer}`
    };

    await Application.findOneAndUpdate(
      { application_number: addOnNum },
      { $set: appDoc },
      { upsert: true, new: true, timestamps: false }
    );
    console.log(` ✓ Add-On App: ${addOnNum} (${p.Sujetrer})`);
  }

  console.log('\n=============================================================================');
  console.log('🎉 ALL LONG CLAWSON DAIRY APPLICATIONS SUCCESSFULLY IMPORTED!');
  const totalApps = await Application.countDocuments({ client_id: user._id });
  console.log(`Total Applications in MongoDB for Long Clawson Dairy: ${totalApps}`);
  console.log('=============================================================================\n');

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
