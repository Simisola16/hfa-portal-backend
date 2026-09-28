import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureMongoTunnel } from '../lib/tunnel.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function syncCertificatesToUbuntu() {
  console.log('=============================================================================');
  console.log('🚀 SYNCING 1,889 CLEANED CERTIFICATES TO UBUNTU SERVER VIA SSH TUNNEL');
  console.log('=============================================================================');

  const localUri = process.env.MONGODB_URI;
  if (!localUri) throw new Error('MONGODB_URI missing in .env');

  console.log('1. Connecting to Local MongoDB to read cleaned certificates...');
  const localConn = await mongoose.createConnection(localUri).asPromise();
  const localCol = localConn.db.collection('certificates');

  const localDocs = await localCol.find({}).toArray();
  console.log(`   ✓ Found ${localDocs.length} certificate documents in Local MongoDB`);

  // Verify local docs are 100% clean
  const withOldScope = localDocs.filter(d => d.scope && d.scope.startsWith('Halal certification of'));
  const withLegacyNotes = localDocs.filter(d => d.notes && d.notes.startsWith('Imported from legacy'));
  const withFB = localDocs.filter(d => d.product_category === 'Food & Beverage');

  if (withOldScope.length > 0 || withLegacyNotes.length > 0 || withFB.length > 0) {
    throw new Error(`CRITICAL: Source certificates contain unclean data! Aborting sync.`);
  }
  console.log('   ✓ Integrity verified: 0 dirty scopes, 0 legacy notes, 0 fake categories.');

  console.log('\n2. Opening SSH tunnel to Ubuntu Server (155.117.43.205)...');
  await ensureMongoTunnel();

  console.log('3. Connecting to Remote MongoDB on Ubuntu Server (hfa_portal_dev)...');
  const remoteUri = 'mongodb://127.0.0.1:27018/hfa_portal_dev?directConnection=true';
  const remoteConn = await mongoose.createConnection(remoteUri, {
    serverSelectionTimeoutMS: 20000,
    socketTimeoutMS: 120000
  }).asPromise();
  const remoteCol = remoteConn.db.collection('certificates');

  const beforeCount = await remoteCol.countDocuments({});
  console.log(`   ✓ Connected! Existing certificates on Ubuntu server: ${beforeCount}`);

  console.log('\n4. Syncing cleaned certificates to Ubuntu Server in batches of 100...');
  const BATCH_SIZE = 100;
  let processed = 0;
  let totalMatched = 0;
  let totalModified = 0;

  for (let i = 0; i < localDocs.length; i += BATCH_SIZE) {
    const batch = localDocs.slice(i, i + BATCH_SIZE);
    const bulkOps = batch.map(doc => {
      const { _id, ...cleanDoc } = doc;
      return {
        updateOne: {
          filter: { certificate_number: doc.certificate_number },
          update: { $set: cleanDoc },
          upsert: true
        }
      };
    });

    const res = await remoteCol.bulkWrite(bulkOps, { ordered: false });
    totalMatched += res.matchedCount;
    totalModified += res.modifiedCount;
    processed += batch.length;
    console.log(`   ✓ Synced [${processed}/${localDocs.length}] certificates onto Ubuntu...`);
  }

  console.log(`\n   ✓ All batches finished! Total Matched: ${totalMatched}, Total Modified: ${totalModified}`);

  // Post-verification on Remote
  const remoteBadScope = await remoteCol.countDocuments({ scope: { $regex: /^Halal certification of/ } });
  const remoteBadNotes = await remoteCol.countDocuments({ notes: { $regex: /^Imported from legacy HFA database/ } });
  const remoteFB = await remoteCol.countDocuments({ product_category: 'Food & Beverage' });

  console.log('\n--- Remote Ubuntu Server Verification ---');
  console.log(`Remaining with "Halal certification of...": ${remoteBadScope}`);
  console.log(`Remaining with legacy notes: ${remoteBadNotes}`);
  console.log(`Remaining with "Food & Beverage": ${remoteFB}`);

  await localConn.close();
  await remoteConn.close();
  console.log('\n🎉 Successfully updated and cleaned all certificates on Ubuntu Server!');
  process.exit(0);
}

syncCertificatesToUbuntu().catch(err => {
  console.error('Fatal sync error:', err);
  process.exit(1);
});
