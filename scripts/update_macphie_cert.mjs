import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureMongoTunnel } from '../lib/tunnel.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function updateMacphieCert() {
  const certNo = 'MA-KH/QR260731110228';
  const targetExpiry = new Date(Date.UTC(2027, 11, 18)); // 18-Dec-2027

  console.log(`Updating ${certNo} expiry_date to 18-Dec-2027...`);

  // 1. Update Locally
  const localConn = await mongoose.createConnection(process.env.MONGODB_URI).asPromise();
  const localRes = await localConn.db.collection('certificates').updateOne(
    { certificate_number: certNo },
    { $set: { expiry_date: targetExpiry } }
  );
  console.log(`Local update result: matched=${localRes.matchedCount}, modified=${localRes.modifiedCount}`);
  
  const localDoc = await localConn.db.collection('certificates').findOne({ certificate_number: certNo });
  console.log('Local verified expiry_date:', localDoc?.expiry_date);
  await localConn.close();

  // 2. Update on Ubuntu via SSH Tunnel
  console.log('Opening SSH tunnel to Ubuntu Server...');
  await ensureMongoTunnel();

  const remoteUri = 'mongodb://127.0.0.1:27018/hfa_portal_dev?directConnection=true';
  const remoteConn = await mongoose.createConnection(remoteUri, {
    serverSelectionTimeoutMS: 20000,
    socketTimeoutMS: 60000
  }).asPromise();

  const remoteRes = await remoteConn.db.collection('certificates').updateOne(
    { certificate_number: certNo },
    { $set: { expiry_date: targetExpiry } }
  );
  console.log(`Ubuntu update result: matched=${remoteRes.matchedCount}, modified=${remoteRes.modifiedCount}`);

  const remoteDoc = await remoteConn.db.collection('certificates').findOne({ certificate_number: certNo });
  console.log('Ubuntu verified expiry_date:', remoteDoc?.expiry_date);
  await remoteConn.close();

  console.log('✅ Successfully updated MA-KH/QR260731110228 to 18-Dec-2027 locally and on Ubuntu Server!');
  process.exit(0);
}

updateMacphieCert().catch(err => {
  console.error('Update error:', err);
  process.exit(1);
});
