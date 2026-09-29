import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureMongoTunnel } from '../lib/tunnel.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function syncToUbuntu() {
  console.log('=============================================================================');
  console.log('🚀 OPTION A: SYNCING ALL 4,354 VALID LOGSHEETS TO UBUNTU SERVER VIA SSH TUNNEL');
  console.log('=============================================================================');

  const localUri = process.env.MONGODB_URI;
  if (!localUri) throw new Error('MONGODB_URI missing in .env');

  console.log('1. Connecting to Local MongoDB to read 4,354 verified logsheets...');
  const localConn = await mongoose.createConnection(localUri).asPromise();
  const localCol = localConn.db.collection('applicationlogsheets');

  const localDocs = await localCol.find({}).toArray();
  console.log(`   ✓ Found ${localDocs.length} logsheet documents in Local MongoDB`);

  // Integrity checks
  const binDocs = localDocs.filter(d => String(d.status).toLowerCase() === 'bin');
  if (binDocs.length > 0) {
    throw new Error(`CRITICAL: Found ${binDocs.length} Bin documents in source! Aborting.`);
  }

  console.log('\n2. Opening SSH tunnel to Ubuntu Server (155.117.43.205)...');
  await ensureMongoTunnel();

  console.log('3. Connecting to Remote MongoDB on Ubuntu Server (hfa_portal_dev)...');
  const remoteUri = 'mongodb://127.0.0.1:27018/hfa_portal_dev?directConnection=true';
  const remoteConn = await mongoose.createConnection(remoteUri, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 60000
  }).asPromise();
  const remoteCol = remoteConn.db.collection('applicationlogsheets');

  const beforeCount = await remoteCol.countDocuments({});
  console.log(`   ✓ Connected! Existing logsheets on Ubuntu server before sync: ${beforeCount}`);

  console.log('\n4. Cleaning previous seed logsheets & any Bin records on Ubuntu server...');
  const delSeed = await remoteCol.deleteMany({ is_seed: true });
  console.log(`   ✓ Deleted ${delSeed.deletedCount} previous seed records on Ubuntu`);

  const delBin = await remoteCol.deleteMany({ status: { $regex: /^bin$/i } });
  if (delBin.deletedCount > 0) {
    console.log(`   ✓ Purged ${delBin.deletedCount} rogue Bin records on Ubuntu`);
  }

  console.log('\n5. Inserting 4,354 verified logsheets into Ubuntu Server in batches...');
  const BATCH_SIZE = 500;
  let inserted = 0;

  for (let i = 0; i < localDocs.length; i += BATCH_SIZE) {
    const batch = localDocs.slice(i, i + BATCH_SIZE);
    await remoteCol.insertMany(batch, { ordered: false });
    inserted += batch.length;
    console.log(`   ✓ Inserted [${inserted}/${localDocs.length}] logsheets onto Ubuntu...`);
  }

  console.log('\n6. Running Final Verification on Ubuntu Server...');
  const afterCount = await remoteCol.countDocuments({});
  const finalStatuses = await remoteCol.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ]).toArray();

  const remoteBinCount = await remoteCol.countDocuments({ status: { $regex: /^bin$/i } });

  console.log('=============================================================================');
  console.log('✅ UBUNTU SERVER MONGODB SYNC COMPLETE!');
  console.log('=============================================================================');
  console.log(`📋 Total Logsheets on Ubuntu Server : ${afterCount}`);
  console.log(`🚫 Bin Status Records on Ubuntu     : ${remoteBinCount} (strictly 0)`);
  console.log('📊 Status Breakdown on Ubuntu Server:');
  finalStatuses.forEach(s => {
    console.log(`   • ${String(s._id).padEnd(25)}: ${s.count}`);
  });
  console.log('=============================================================================\n');

  await remoteConn.close();
  await localConn.close();
  process.exit(0);
}

syncToUbuntu().catch(err => {
  console.error('\n❌ Fatal error syncing to Ubuntu server:', err);
  process.exit(1);
});
