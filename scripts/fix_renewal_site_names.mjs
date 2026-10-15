import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { ensureMongoTunnel } = await import('../lib/tunnel.js');

async function fixRenewalsOnConnection(conn, label) {
  console.log(`\n======================================================`);
  console.log(`🔍 Checking and fixing renewals on ${label}...`);
  console.log(`======================================================`);

  const [apps, allSites, allCerts] = await Promise.all([
    conn.db.collection('applications').find({
      $or: [
        { application_type: 'renewal' },
        { type: 'renewal' },
        { is_renewal: true },
        { renewed_certificate_id: { $ne: null } }
      ]
    }).toArray(),
    conn.db.collection('sites').find({}).toArray(),
    conn.db.collection('certificates').find({}).toArray()
  ]);

  console.log(`Loaded ${apps.length} renewal apps, ${allSites.length} sites, and ${allCerts.length} certificates.`);

  const siteMap = new Map(allSites.map(s => [String(s._id), s]));
  const certMap = new Map(allCerts.map(c => [String(c._id), c]));

  const bulkOps = [];
  let fixedCount = 0;

  for (const app of apps) {
    const cert = app.renewed_certificate_id ? certMap.get(String(app.renewed_certificate_id)) : null;
    const effectiveSiteId = (app.site_id && siteMap.has(String(app.site_id)))
      ? String(app.site_id)
      : (cert?.site_id ? String(cert.site_id) : null);

    if (!effectiveSiteId || !siteMap.has(effectiveSiteId)) continue;

    const site = siteMap.get(effectiveSiteId);
    const correctSiteName = site.name || site.site_name || site.est_name;
    const correctAddress = site.address_1 || site.address || '';

    const needsFix = !app.site_name || 
      (app.site_name.trim().toLowerCase() !== correctSiteName.trim().toLowerCase()) ||
      (!app.site_id && cert?.site_id);

    if (needsFix) {
      console.log(`Fixing App: ${app.application_number} (${app._id})`);
      console.log(`  Old site_id: ${app.site_id} -> New site_id: ${site._id}`);
      console.log(`  Old site_name: "${app.site_name}" -> New site_name: "${correctSiteName}"`);

      const updateDoc = {
        site_name: correctSiteName,
        site_id: String(site._id)
      };
      if (correctAddress && !app.establishment_address) {
        updateDoc.establishment_address = correctAddress;
      }
      if (correctAddress && !app.site_address) {
        updateDoc.site_address = correctAddress;
      }

      bulkOps.push({
        updateOne: {
          filter: { _id: app._id },
          update: { $set: updateDoc }
        }
      });
      fixedCount++;
    }
  }

  if (bulkOps.length > 0) {
    await conn.db.collection('applications').bulkWrite(bulkOps);
    console.log(`  ✓ Applied ${bulkOps.length} updates in bulk.`);
  }

  console.log(`✅ Completed ${label}: fixed ${fixedCount} renewal applications.`);
}

async function main() {
  console.log('🚀 Connecting to Ubuntu Remote Server...');
  await ensureMongoTunnel();
  const remoteUri = 'mongodb://127.0.0.1:27018/hfa_portal_dev?directConnection=true';
  const remoteConn = await mongoose.createConnection(remoteUri, {
    serverSelectionTimeoutMS: 20000,
    socketTimeoutMS: 60000
  }).asPromise();

  console.log('🚀 Connecting to Local MongoDB...');
  const localConn = await mongoose.createConnection(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 20000
  }).asPromise();

  await fixRenewalsOnConnection(remoteConn, 'REMOTE SERVER (hfa_portal_dev)');
  await fixRenewalsOnConnection(localConn, 'LOCAL SERVER');

  process.exit(0);
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
