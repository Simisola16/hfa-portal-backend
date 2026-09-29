import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dns from 'dns';
import { Client } from 'ssh2';
import { ensureMongoTunnel } from '../lib/tunnel.js';

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

function loadSqlProducts() {
  const prolisterPath = path.join(EXPORT_DIR, 'HaProlister/tables/dbo.Prolister.json');
  const tldbprotemPath = path.join(EXPORT_DIR, 'HalalTick/tables/dbo.tldbprotem.json');

  const sqlProducts = new Map(); // proId -> { status, category }

  if (fs.existsSync(prolisterPath)) {
    const d = JSON.parse(fs.readFileSync(prolisterPath, 'utf8'));
    const rows = d.rows || d;
    rows.forEach(r => {
      const pid = cleanStr(r.ProID);
      const cat = cleanStr(r.Status || r.category || r.Category || r.PRODUCTCATEGORY, '');
      if (pid) sqlProducts.set(pid, cat);
    });
  }

  if (fs.existsSync(tldbprotemPath)) {
    const d = JSON.parse(fs.readFileSync(tldbprotemPath, 'utf8'));
    const rows = d.rows || d;
    rows.forEach(r => {
      const pid = cleanStr(r.proid || r.ProID || r.ider);
      const cat = cleanStr(r.Status || r.category || r.Category, '');
      if (pid) sqlProducts.set(pid, cat);
    });
  }

  console.log(`Loaded ${sqlProducts.size} SQL products for category lookup`);
  return sqlProducts;
}

async function cleanTargetDatabase(conn, dbName) {
  console.log(`\n=======================================================`);
  console.log(`🧹 CLEANING & UPDATING TARGET DB: ${dbName}`);
  console.log(`=======================================================`);

  const Product = conn.model('Product', new mongoose.Schema({}, { strict: false }));
  const Application = conn.model('Application', new mongoose.Schema({}, { strict: false }));
  const Certificate = conn.model('Certificate', new mongoose.Schema({}, { strict: false }));

  // 1. Clean Products Category & Product Type Fallbacks
  console.log('\n1. Cleaning Product Fallbacks (removing fake "General" category & product_type)...');
  const sqlProducts = loadSqlProducts();

  // Find all products with category: 'General'
  const generalProducts = await Product.find({ category: 'General' }).lean();
  console.log(`   Found ${generalProducts.length} products with category: 'General'`);

  const prodBulkOps = [];
  for (const p of generalProducts) {
    let realCat = '';
    const proIdMatch = (p.notes || '').match(/ProID:\s*([^\)]+)/i);
    if (proIdMatch) {
      const proId = proIdMatch[1].trim();
      realCat = sqlProducts.get(proId) || '';
    }

    prodBulkOps.push({
      updateOne: {
        filter: { _id: p._id },
        update: {
          $set: {
            category: realCat // sets to actual category or empty string if none
          }
        }
      }
    });
  }

  if (prodBulkOps.length > 0) {
    const CHUNK_SIZE = 500;
    for (let i = 0; i < prodBulkOps.length; i += CHUNK_SIZE) {
      await Product.bulkWrite(prodBulkOps.slice(i, i + CHUNK_SIZE), { ordered: false });
    }
    console.log(`   ✓ Cleaned ${prodBulkOps.length} products with category fallback removed`);
  }

  // Also remove fake product_type: 'General' where it was artificially populated
  const typeRes = await Product.updateMany(
    { product_type: 'General', notes: /Imported from legacy HFA database/i },
    { $set: { product_type: '' } }
  );
  console.log(`   ✓ Reset ${typeRes.modifiedCount} product_type: 'General' fallbacks to empty`);

  // 2. Update Application Details for Seeded Applications
  console.log('\n2. Updating Seeded Applications with hide_proposal_card & hide_initial_invoice_card...');
  const appRes = await Application.updateMany(
    {
      $or: [
        { is_seed: true },
        { notes: /Imported (new|renewal|surveillance) application from legacy/i },
        { notes: /legacy HFA database/i }
      ]
    },
    {
      $set: {
        is_seed: true,
        is_seeded: true,
        hide_proposal_card: true,
        hide_initial_invoice_card: true,
        skip_proposal_card: true,
        skip_invoice_card: true
      }
    }
  );
  console.log(`   ✓ Updated ${appRes.modifiedCount} applications with seeded card suppression flags`);

  // 3. Unlink former certificates from in-progress applications
  console.log('\n3. Unlinking former certificates from in-progress applications...');
  const allApps = await Application.find({}, { _id: 1, status: 1 }).lean();
  const nonCertIssuedAppIds = allApps
    .filter(a => a.status !== 'certificate_issued')
    .map(a => a._id);

  console.log(`   Found ${nonCertIssuedAppIds.length} applications NOT in certificate_issued stage`);
  const certUnlinkRes = await Certificate.updateMany(
    { application_id: { $in: nonCertIssuedAppIds }, status: 'active' },
    { $unset: { application_id: 1 } }
  );
  console.log(`   ✓ Unlinked ${certUnlinkRes.modifiedCount} former active certificates from in-progress applications`);

  // Verification counts
  const remainingGeneral = await Product.countDocuments({ category: 'General' });
  const seededApps = await Application.countDocuments({ is_seed: true });
  const attachedToInProgress = await Certificate.countDocuments({
    application_id: { $in: nonCertIssuedAppIds },
    status: 'active'
  });

  console.log('\n📊 POST-CLEANUP VERIFICATION:');
  console.log(`   • Products with category 'General' remaining: ${remainingGeneral}`);
  console.log(`   • Applications with is_seed & suppression flags: ${seededApps}`);
  console.log(`   • Active certs attached to in-progress apps: ${attachedToInProgress} (must be 0)`);
}

async function uploadFileOverSsh(ssh, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    ssh.sftp((err, sftp) => {
      if (err) return reject(err);
      sftp.fastPut(localPath, remotePath, (uploadErr) => {
        if (uploadErr) return reject(uploadErr);
        resolve();
      });
    });
  });
}

async function main() {
  console.log('🚀 CLEANING UP PRODUCTS, PROPOSAL/INVOICE CARDS & FORMER CERTS');

  // A. Clean Local MongoDB
  const localUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (localUri) {
    const localConn = await mongoose.createConnection(localUri).asPromise();
    await cleanTargetDatabase(localConn, 'LOCAL MONGODB');
    await localConn.close();
  }

  // B. Clean Ubuntu MongoDB
  console.log('\n🔌 Connecting to Ubuntu Server MongoDB via SSH tunnel...');
  await ensureMongoTunnel();
  const remoteUri = 'mongodb://127.0.0.1:27018/hfa_portal_dev?directConnection=true';
  const remoteConn = await mongoose.createConnection(remoteUri, {
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 60000
  }).asPromise();
  await cleanTargetDatabase(remoteConn, 'UBUNTU PRODUCTION MONGODB (hfa_portal_dev)');
  await remoteConn.close();

  // C. Deploy updated backend files to Ubuntu and restart PM2
  console.log('\n📤 Deploying updated backend files to Ubuntu Server (/var/www/hfa-backend)...');
  const ssh = new Client();
  await new Promise((resolve, reject) => {
    ssh.on('ready', async () => {
      try {
        console.log('   Uploading routes/certificates.js...');
        await uploadFileOverSsh(ssh, path.resolve('routes/certificates.js'), '/var/www/hfa-backend/routes/certificates.js');

        console.log('   Uploading routes/applications.js...');
        await uploadFileOverSsh(ssh, path.resolve('routes/applications.js'), '/var/www/hfa-backend/routes/applications.js');

        console.log('   Uploading scripts/import_all_companies_to_mongodb.js...');
        await uploadFileOverSsh(ssh, path.resolve('scripts/import_all_companies_to_mongodb.js'), '/var/www/hfa-backend/scripts/import_all_companies_to_mongodb.js');

        console.log('   Uploading scripts/restore_all_products_no_dedup.js...');
        await uploadFileOverSsh(ssh, path.resolve('scripts/restore_all_products_no_dedup.js'), '/var/www/hfa-backend/scripts/restore_all_products_no_dedup.js');

        console.log('\n🔄 Restarting PM2 hfa-backend on Ubuntu...');
        ssh.exec('pm2 restart hfa-backend && pm2 status', (execErr, stream) => {
          if (execErr) return reject(execErr);
          let out = '';
          stream.on('close', () => {
            ssh.end();
            console.log(out);
            resolve();
          }).on('data', d => { out += d; })
          .stderr.on('data', d => console.error('STDERR:', String(d)));
        });
      } catch (e) {
        ssh.end();
        reject(e);
      }
    }).connect({
      host: process.env.SSH_TUNNEL_HOST || process.env.UBUNTU_SERVER_IP,
      port: parseInt(process.env.SSH_TUNNEL_PORT, 10) || 22,
      username: process.env.SSH_TUNNEL_USER || 'administrator',
      password: process.env.SSH_TUNNEL_PASSWORD || process.env.UBUNTU_SERVER_PASSWORD
    });
  });

  console.log('\n🎉 ALL UPDATES AND CLEANUPS COMPLETE ON BOTH LOCAL AND UBUNTU PRODUCTION SERVER!');
  process.exit(0);
}

main().catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
