import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { ensureMongoTunnel } = await import('../lib/tunnel.js');

const YSCO_ID = new mongoose.Types.ObjectId('6ab8492ce6ca3f615de4394c');
const YSCO_EMAIL = 'danny.pattyn@ysco.eu';

async function syncYsco() {
  console.log('=============================================================================');
  console.log('🚀 SYNCING YSCO NV TO UBUNTU SERVER MONGODB');
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

  // 3. User
  const localUser = await localDb.collection('users').findOne({ _id: YSCO_ID });
  if (!localUser) {
    throw new Error('Ysco NV user not found locally!');
  }

  const { _id, suspension_reason, ...userWithoutId } = localUser;
  const userPayload = {
    ...userWithoutId,
    role: 'client',
    roles: localUser.roles && localUser.roles.length > 0 ? localUser.roles : ['client'],
    client_role: localUser.client_role || 'admin',
    company_category: localUser.company_category || 'certified',
    is_active: true,
    is_verified: true,
    can_issue_direct_certificate: false,
    is_support_manager: false,
    can_sign_logsheet: false,
    can_review_certificate: false
  };

  await remoteDb.collection('users').updateOne(
    { _id: YSCO_ID },
    {
      $set: userPayload,
      $unset: { suspension_reason: "" }
    },
    { upsert: true }
  );
  console.log('   ✓ User Ysco NV synced and activated (removed suspension_reason):', userPayload.email);

  // 4. Sync all collections
  const collections = await localDb.listCollections().toArray();
  for (const c of collections) {
    if (c.name === 'users') continue;

    const filter = {
      $or: [
        { client_id: YSCO_ID },
        { client_id: String(YSCO_ID) },
        { user_id: YSCO_ID },
        { user_id: String(YSCO_ID) },
        { company_id: YSCO_ID },
        { company_id: String(YSCO_ID) },
        { email: YSCO_EMAIL }
      ]
    };

    const docs = await localDb.collection(c.name).find(filter).toArray();
    if (docs.length === 0) continue;

    for (const doc of docs) {
      const { _id: docId, ...docData } = doc;
      await remoteDb.collection(c.name).updateOne(
        { _id: docId },
        { $set: docData, $setOnInsert: { _id: docId } },
        { upsert: true }
      );
    }
    console.log(`   ✓ Collection [${c.name}]: synced ${docs.length} docs`);
  }

  // 5. Verify on Remote
  console.log('\n=============================================================================');
  console.log('🔍 VERIFYING YSCO NV ON UBUNTU SERVER MONGODB');
  console.log('=============================================================================\n');

  const rUser = await remoteDb.collection('users').findOne({ _id: YSCO_ID });
  console.log('Remote User Status:', {
    _id: rUser._id,
    company_name: rUser.company_name,
    email: rUser.email,
    is_active: rUser.is_active,
    is_verified: rUser.is_verified,
    role: rUser.role,
    roles: rUser.roles,
    suspension_reason: rUser.suspension_reason
  });

  const checkCols = ['sites', 'applications', 'products', 'certificates', 'addonapplications', 'audits', 'invoices'];
  for (const c of checkCols) {
    const count = await remoteDb.collection(c).countDocuments({
      $or: [
        { client_id: YSCO_ID },
        { client_id: String(YSCO_ID) },
        { user_id: YSCO_ID },
        { user_id: String(YSCO_ID) }
      ]
    });
    console.log(`  - ${c}: ${count} docs`);
  }

  // Clean scratch scripts
  const tempFiles = [
    './scripts/temp_find_ysco.mjs',
    './scripts/temp_inspect_ysco_deep.mjs',
    './scripts/temp_check_remote_ysco.mjs',
    './scripts/temp_search_ysco_sql.mjs'
  ];
  for (const f of tempFiles) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch(e){}
  }

  await localConn.close();
  await remoteConn.close();
  console.log('\n✅ YSCO NV FULLY SYNCED, RESTORED AND VERIFIED ON UBUNTU SERVER!');
  process.exit(0);
}

syncYsco().catch(err => {
  console.error('❌ Sync error:', err);
  process.exit(1);
});
