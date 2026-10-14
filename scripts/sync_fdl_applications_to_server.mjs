import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { ensureMongoTunnel } = await import('../lib/tunnel.js');

const CLIENT_ID = new mongoose.Types.ObjectId('6ab842f6e6ca3f615de08a49');
const SITE_STAFFORD_ID = '6abe4ecc181b61afeba4911c';
const SITE_WALDEN_ID = '6abe4ff4181b61afeba4a0f1';

// 1. Latest Stafford Application (from dbo.AppleReg, AppNumber: M2-0429/1900000150948)
const staffordAppDoc = {
  application_number: 'M2-0429/1900000150948',
  client_id: CLIENT_ID,
  site_id: SITE_STAFFORD_ID,
  site_name: 'FDL Stafford',
  site_address: 'Unit 2, Exploration Works, Shackleton Way, Stafford, ST16 1GY, UK',
  type: 'initial',
  application_type: 'initial',
  is_renewal: false,
  is_surveillance: false,
  category: 'Annual Certification – UAE/GSO approved halal certification for exporters to the UAE',
  scheme: 'Annual Certification – UAE/GSO approved halal certification for exporters to the UAE',
  scope: 'Annual Certification – UAE/GSO approved halal certification for exporters to the UAE',
  status: 'certificate_issued',
  nc_closed: true,
  establishment_name: 'Fuerst Day Lawson Ltd',
  establishment_address: 'Metropolitan Wharf, 70 Wapping Wall, London, E1W 3SS, UK',
  trading_name: 'FDL Stafford',
  reg_number: '0000000',
  contact_person: 'Audrey Castleton',
  contact_email: 'Audrey.Castleton@adm.com',
  primary_contact_name: 'Audrey Castleton',
  primary_email: 'Audrey.Castleton@adm.com',
  primary_mobile: '+44 7483395207',
  managing_director: 'Audrey Castleton',
  signatory_position: 'Site QA Manager',
  production_schedule: 'Regular/Routine halal product',
  food_nature: 'Cosmetics / Food and General processing',
  business_type: 'Manufacturer',
  declared_true: true,
  has_porcine: false,
  has_intoxicants: false,
  products_on_site_count: 41,
  products_halal_count: 41,
  products: [],
  documents: { supporting_docs: [] },
  statusHistory: [
    {
      status: 'submitted',
      changedAt: new Date('2024-06-19T00:00:00.000Z'),
      note: 'Application submitted via legacy system'
    },
    {
      status: 'date_finalized',
      changedAt: new Date('2024-05-23T00:00:00.000Z'),
      note: 'Audit date finalized: 23-May-2024'
    },
    {
      status: 'audit_completed',
      changedAt: new Date('2024-05-23T00:00:00.000Z'),
      note: 'Audited by Kenan / Ali, Sharia Auditor: Abu Yusha'
    },
    {
      status: 'certificate_issued',
      changedAt: new Date('2024-07-29T00:00:00.000Z'),
      note: 'Certificate issued / approved by Muhammad'
    }
  ],
  signatory_date: new Date('2024-07-29T00:00:00.000Z'),
  submission_date: new Date('2024-06-19T00:00:00.000Z'),
  created_at: new Date('2024-06-19T00:00:00.000Z'),
  createdAt: new Date('2024-06-19T00:00:00.000Z'),
  updated_at: new Date('2024-07-29T00:00:00.000Z'),
  updatedAt: new Date('2024-07-29T00:00:00.000Z'),
  notes: 'Imported application from SQL Server database (KingID: 150949, CID: 162, CiteID: 10030)',
  skip_invoice_card: true,
  skip_proposal_card: true,
  hide_initial_invoice_card: true,
  hide_proposal_card: true
};

// 2. Latest Walden Application (from dbo.REneApp, ArenewID: 40069, AppNumber: M2-0429/19000010049)
const waldenAppDoc = {
  application_number: 'M2-0429/19000010049',
  client_id: CLIENT_ID,
  site_id: SITE_WALDEN_ID,
  site_name: 'FDL Walden',
  site_address: 'Little Walden, Essex CB10 1XQ. UK',
  type: 'renewal',
  application_type: 'renewal',
  is_renewal: true,
  is_surveillance: false,
  category: 'Annual Certification – Food and General processing',
  scheme: 'Annual Certification – Food and General processing',
  scope: 'Annual Certification – Food and General processing',
  status: 'certificate_issued',
  nc_closed: true,
  establishment_name: 'Fuerst Day Lawson Ltd',
  establishment_address: 'Metropolitan Wharf, 70 Wapping Wall, London, E1W 3SS, UK',
  trading_name: 'FDL Walden',
  contact_person: 'Monika Baross',
  contact_email: 'Monika.Barros@adm.com',
  primary_contact_name: 'Monika Baross',
  primary_email: 'Monika.Barros@adm.com',
  primary_mobile: '+44 7801848659',
  managing_director: 'Monika Baross',
  signatory_position: 'Site QA Manager',
  declared_true: true,
  has_porcine: false,
  has_intoxicants: false,
  products: [],
  documents: { supporting_docs: [] },
  statusHistory: [
    {
      status: 'submitted',
      changedAt: new Date('2020-03-24T00:00:00.000Z'),
      note: 'Renewal application submitted via legacy system'
    },
    {
      status: 'date_finalized',
      changedAt: new Date('2020-03-19T00:00:00.000Z'),
      note: 'Audit date finalized: 19-Mar-2020'
    },
    {
      status: 'audit_completed',
      changedAt: new Date('2020-03-26T00:00:00.000Z'),
      note: 'Audited by HI + AW'
    },
    {
      status: 'certificate_issued',
      changedAt: new Date('2020-03-20T00:00:00.000Z'),
      note: 'Renewal Certificate issued / approved by Hifza'
    }
  ],
  signatory_date: new Date('2020-03-20T00:00:00.000Z'),
  submission_date: new Date('2020-03-24T00:00:00.000Z'),
  created_at: new Date('2020-03-20T00:00:00.000Z'),
  createdAt: new Date('2020-03-20T00:00:00.000Z'),
  updated_at: new Date('2020-03-26T00:00:00.000Z'),
  updatedAt: new Date('2020-03-26T00:00:00.000Z'),
  notes: 'Imported renewal application from SQL Server database (ArenewID: 40069, KingID: 162, CiteID: 10049)',
  skip_invoice_card: true,
  skip_proposal_card: true,
  hide_initial_invoice_card: true,
  hide_proposal_card: true
};

async function main() {
  console.log('=============================================================================');
  console.log('🚀 PUTTING LATEST APPLICATIONS FOR FDL WALDEN & STAFFORD ONTO THE SERVER');
  console.log('=============================================================================\n');

  // 1. SSH Tunnel & Connect to Remote MongoDB
  console.log('1️⃣ Establishing SSH Tunnel to Ubuntu Server...');
  await ensureMongoTunnel();
  const remoteUri = 'mongodb://127.0.0.1:27018/hfa_portal_dev?directConnection=true';
  const remoteConn = await mongoose.createConnection(remoteUri, {
    serverSelectionTimeoutMS: 20000,
    socketTimeoutMS: 60000
  }).asPromise();
  console.log(`   ✓ Connected to Remote MongoDB: ${remoteConn.db.databaseName}\n`);

  // Also connect to Local MongoDB to keep local in sync
  console.log('2️⃣ Connecting to Local MongoDB...');
  const localConn = await mongoose.createConnection(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 20000
  }).asPromise();
  console.log('   ✓ Connected to Local MongoDB\n');

  // Verify sites exist on remote
  console.log('3️⃣ Verifying Sites on Remote Server...');
  const remoteStaffordSite = await remoteConn.db.collection('sites').findOne({ _id: new mongoose.Types.ObjectId(SITE_STAFFORD_ID) });
  const remoteWaldenSite = await remoteConn.db.collection('sites').findOne({ _id: new mongoose.Types.ObjectId(SITE_WALDEN_ID) });

  if (!remoteStaffordSite) throw new Error(`Stafford site ${SITE_STAFFORD_ID} not found on remote server!`);
  if (!remoteWaldenSite) throw new Error(`Walden site ${SITE_WALDEN_ID} not found on remote server!`);

  console.log(`   ✓ Remote Stafford Site found: ${remoteStaffordSite.name} (_id: ${remoteStaffordSite._id})`);
  console.log(`   ✓ Remote Walden Site found: ${remoteWaldenSite.name} (_id: ${remoteWaldenSite._id})\n`);

  // Ensure sites also exist on local MongoDB
  console.log('4️⃣ Ensuring Sites exist on Local MongoDB...');
  await localConn.db.collection('sites').updateOne(
    { _id: new mongoose.Types.ObjectId(SITE_STAFFORD_ID) },
    { $set: remoteStaffordSite },
    { upsert: true }
  );
  await localConn.db.collection('sites').updateOne(
    { _id: new mongoose.Types.ObjectId(SITE_WALDEN_ID) },
    { $set: remoteWaldenSite },
    { upsert: true }
  );
  console.log('   ✓ Local Sites synced\n');

  // Upsert Applications on Remote Server
  console.log('5️⃣ Upserting Applications to Remote Server MongoDB...');
  const remoteStaffordRes = await remoteConn.db.collection('applications').updateOne(
    { application_number: staffordAppDoc.application_number },
    { $set: staffordAppDoc },
    { upsert: true }
  );
  console.log(`   ✓ Remote Stafford App upserted: ${staffordAppDoc.application_number} (matched: ${remoteStaffordRes.matchedCount}, upserted: ${remoteStaffordRes.upsertedCount || 0})`);

  const remoteWaldenRes = await remoteConn.db.collection('applications').updateOne(
    { application_number: waldenAppDoc.application_number },
    { $set: waldenAppDoc },
    { upsert: true }
  );
  console.log(`   ✓ Remote Walden App upserted: ${waldenAppDoc.application_number} (matched: ${remoteWaldenRes.matchedCount}, upserted: ${remoteWaldenRes.upsertedCount || 0})\n`);

  // Upsert Applications on Local MongoDB
  console.log('6️⃣ Upserting Applications to Local MongoDB...');
  await localConn.db.collection('applications').updateOne(
    { application_number: staffordAppDoc.application_number },
    { $set: staffordAppDoc },
    { upsert: true }
  );
  await localConn.db.collection('applications').updateOne(
    { application_number: waldenAppDoc.application_number },
    { $set: waldenAppDoc },
    { upsert: true }
  );
  console.log('   ✓ Local Applications synced\n');

  // Verify applications on remote server
  console.log('7️⃣ Verifying Applications on Remote Server MongoDB...');
  const remoteApps = await remoteConn.db.collection('applications').find({
    client_id: CLIENT_ID
  }).toArray();

  console.log(`   Total applications for FDL on remote server: ${remoteApps.length}`);
  remoteApps.forEach((a, i) => {
    console.log(`   [${i + 1}] Number: ${a.application_number}`);
    console.log(`       Site ID: ${a.site_id} (${a.site_name})`);
    console.log(`       Type: ${a.type} / ${a.application_type}`);
    console.log(`       Category: ${a.category}`);
    console.log(`       Status: ${a.status}`);
    console.log(`       Submission Date: ${a.submission_date}`);
  });

  console.log('\n✅ Successfully synced 1 latest application each for FDL Walden and FDL Stafford!');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Error syncing applications:', err);
  process.exit(1);
});
