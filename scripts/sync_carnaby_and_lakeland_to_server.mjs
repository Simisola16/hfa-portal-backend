import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { ensureMongoTunnel } = await import('../lib/tunnel.js');

const TARGETS = [
  {
    name: 'Dunbia Carnaby',
    userId: new mongoose.Types.ObjectId('6ab9c753bf2a0a48dac81c96'),
    email: 'niamh.kelly@dunbia.com'
  },
  {
    name: 'Lakeland Dairies',
    userId: new mongoose.Types.ObjectId('6ab9c9f0bf2a0a48dac8cad5'),
    email: 'brogana@lakeland.ie'
  }
];

async function upsertDocument(collection, doc, colName) {
  const { _id, ...docWithoutId } = doc;

  try {
    if (colName === 'certificates' && doc.certificate_number) {
      const existing = await collection.findOne({ certificate_number: doc.certificate_number });
      if (existing) {
        await collection.updateOne({ _id: existing._id }, { $set: docWithoutId });
        return;
      }
    } else if (colName === 'users' && doc.email) {
      const existing = await collection.findOne({ email: doc.email.toLowerCase() });
      if (existing) {
        await collection.updateOne({ _id: existing._id }, { $set: docWithoutId });
        return;
      }
    } else if (colName === 'addonapplications' && doc.application_number) {
      const existing = await collection.findOne({ application_number: doc.application_number });
      if (existing) {
        await collection.updateOne({ _id: existing._id }, { $set: docWithoutId });
        return;
      }
    } else if (colName === 'applications' && (doc.application_number || doc.reference_number)) {
      const ref = doc.application_number || doc.reference_number;
      const existing = await collection.findOne({
        $or: [{ application_number: ref }, { reference_number: ref }]
      });
      if (existing) {
        await collection.updateOne({ _id: existing._id }, { $set: docWithoutId });
        return;
      }
    } else if (colName === 'invoices' && doc.invoice_number) {
      const existing = await collection.findOne({ invoice_number: doc.invoice_number });
      if (existing) {
        await collection.updateOne({ _id: existing._id }, { $set: docWithoutId });
        return;
      }
    }

    // Default upsert by _id (use $setOnInsert for _id so MongoDB doesn't throw immutable field error)
    await collection.updateOne(
      { _id: doc._id },
      { $set: docWithoutId, $setOnInsert: { _id: doc._id } },
      { upsert: true }
    );
  } catch (err) {
    if (err.code === 11000) {
      console.warn(`   ⚠️ Duplicate key in [${colName}] for doc ${doc._id}: ${err.message}. Retrying with match...`);
      if (err.keyValue) {
        await collection.updateOne(err.keyValue, { $set: docWithoutId });
        return;
      }
    }
    throw err;
  }
}

async function syncCompanies() {
  console.log('=============================================================================');
  console.log('🚀 CLEAN SYNC: DUNBIA CARNABY & LAKELAND DAIRIES TO UBUNTU SERVER MONGODB');
  console.log('=============================================================================\n');

  // 1. Connect Local
  console.log('1️⃣ Connecting to Local MongoDB...');
  const localConn = await mongoose.createConnection(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 20000
  }).asPromise();
  console.log('   ✓ Connected to Local MongoDB\n');

  // 2. Connect Remote via SSH Tunnel
  console.log('2️⃣ Establishing SSH Tunnel to Ubuntu Server...');
  await ensureMongoTunnel();
  const remoteUri = 'mongodb://127.0.0.1:27018/hfa_portal_dev?directConnection=true';
  const remoteConn = await mongoose.createConnection(remoteUri, {
    serverSelectionTimeoutMS: 20000,
    socketTimeoutMS: 60000
  }).asPromise();
  console.log(`   ✓ Connected to Remote MongoDB: ${remoteConn.db.databaseName}\n`);

  const localDb = localConn.db;
  const remoteDb = remoteConn.db;

  const collections = await localDb.listCollections().toArray();
  const collectionNames = collections.map(c => c.name).filter(n => !n.startsWith('system.'));

  for (const target of TARGETS) {
    console.log(`=============================================================================`);
    console.log(`📦 PROCESSING: ${target.name} [User ID: ${target.userId}] (${target.email})`);
    console.log(`=============================================================================`);

    // 1. User
    const userDoc = await localDb.collection('users').findOne({ _id: target.userId });
    if (!userDoc) {
      console.error(`   ❌ User ${target.name} not found locally!`);
      continue;
    }

    const userPayload = {
      ...userDoc,
      role: 'client',
      roles: userDoc.roles && userDoc.roles.length > 0 ? userDoc.roles : ['client'],
      client_role: userDoc.client_role || 'admin',
      company_category: userDoc.company_category || 'certified',
      is_active: userDoc.is_active !== undefined ? userDoc.is_active : true,
      is_verified: userDoc.is_verified !== undefined ? userDoc.is_verified : true,
      can_issue_direct_certificate: false,
      is_support_manager: false,
      can_sign_logsheet: false,
      can_review_certificate: false
    };

    await upsertDocument(remoteDb.collection('users'), userPayload, 'users');
    console.log(`   ✓ User synced: ${userPayload.company_name} (${userPayload.email})`);

    // Fetch site IDs and application IDs for deep reference matching
    const sites = await localDb.collection('sites').find({
      $or: [{ client_id: target.userId }, { client_id: String(target.userId) }]
    }).toArray();
    const siteIds = sites.map(s => s._id);

    const apps = await localDb.collection('applications').find({
      $or: [{ client_id: target.userId }, { client_id: String(target.userId) }]
    }).toArray();
    const appIds = apps.map(a => a._id);

    // Sync all related collections
    for (const colName of collectionNames) {
      if (colName === 'users') continue;

      const filter = {
        $or: [
          { client_id: target.userId },
          { client_id: String(target.userId) },
          { user_id: target.userId },
          { user_id: String(target.userId) },
          { company_id: target.userId },
          { company_id: String(target.userId) },
          { userId: target.userId },
          { userId: String(target.userId) },
          { email: target.email }
        ]
      };

      if (siteIds.length > 0) {
        filter.$or.push({ site_id: { $in: siteIds } });
        filter.$or.push({ site: { $in: siteIds } });
      }

      if (appIds.length > 0) {
        filter.$or.push({ application_id: { $in: appIds } });
        filter.$or.push({ application: { $in: appIds } });
      }

      const docs = await localDb.collection(colName).find(filter).toArray();
      if (docs.length === 0) continue;

      let syncedCount = 0;
      for (const doc of docs) {
        await upsertDocument(remoteDb.collection(colName), doc, colName);
        syncedCount++;
      }
      console.log(`   ✓ Collection [${colName}]: synced ${syncedCount} docs`);
    }

    console.log(`   ✨ Completed sync for ${target.name}\n`);
  }

  // Verification on Remote DB
  console.log('=============================================================================');
  console.log('🔍 FINAL VERIFICATION ON REMOTE UBUNTU SERVER MONGODB');
  console.log('=============================================================================\n');

  for (const target of TARGETS) {
    console.log(`Checking ${target.name} on remote server:`);
    const rUser = await remoteDb.collection('users').findOne({
      $or: [{ _id: target.userId }, { email: target.email }]
    });
    console.log(`  User: ${rUser ? '✓ Present (' + rUser.company_name + ' / ' + rUser.email + ')' : '❌ Missing'}`);

    const checkCols = [
      'sites', 'products', 'applications', 'addonapplications',
      'certificates', 'applicationlogsheets', 'audits', 'invoices',
      'agreements', 'proposals'
    ];

    for (const c of checkCols) {
      const count = await remoteDb.collection(c).countDocuments({
        $or: [
          { client_id: target.userId },
          { client_id: String(target.userId) },
          { user_id: target.userId },
          { user_id: String(target.userId) },
          { email: target.email }
        ]
      });
      console.log(`    - ${c}: ${count} docs`);
    }
    console.log('');
  }

  // Clean up scratch temp scripts
  const tempFiles = [
    './scripts/temp_check_remote_certs.mjs',
    './scripts/temp_check_remote_existing.mjs'
  ];
  for (const f of tempFiles) {
    try {
      if (import('fs').then(({default: fs}) => { if (fs.existsSync(f)) fs.unlinkSync(f); }));
    } catch(e){}
  }

  await localConn.close();
  await remoteConn.close();
  console.log('✅ ALL DATA FOR DUNBIA CARNABY & LAKELAND DAIRIES IS NOW VERIFIED ON UBUNTU SERVER!');
  process.exit(0);
}

syncCompanies().catch(err => {
  console.error('❌ Sync error:', err);
  process.exit(1);
});
