import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function backfillSiteNames() {
  console.log('🔄 Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const totalApps = await db.collection('applications').countDocuments({});
  console.log(`📦 Total applications in DB: ${totalApps}`);

  // Fetch all sites into memory
  const sites = await db.collection('sites').find({}).toArray();
  const siteById = new Map();
  const sitesByClientId = new Map();

  for (const s of sites) {
    siteById.set(String(s._id), s.name || s.est_name);
    const cId = String(s.client_id);
    if (!sitesByClientId.has(cId)) sitesByClientId.set(cId, []);
    sitesByClientId.get(cId).push(s.name || s.est_name);
  }

  // Fetch all users into memory for fallback
  const users = await db.collection('users').find({}, { projection: { company_name: 1, full_name: 1 } }).toArray();
  const userById = new Map();
  for (const u of users) {
    userById.set(String(u._id), u.company_name || u.full_name);
  }

  const appsToUpdate = await db.collection('applications').find({
    $or: [
      { site_name: { $exists: false } },
      { site_name: null },
      { site_name: '' },
      { site_name: '—' },
      { site_name: '-' }
    ]
  }).toArray();

  console.log(`🔎 Found ${appsToUpdate.length} applications missing valid site_name. Updating...`);

  let updatedCount = 0;
  const bulkOps = [];

  for (const app of appsToUpdate) {
    let resolvedSiteName = '';

    if (app.site_id && siteById.has(String(app.site_id))) {
      resolvedSiteName = siteById.get(String(app.site_id));
    } else if (app.client_id && sitesByClientId.has(String(app.client_id))) {
      const clientSites = sitesByClientId.get(String(app.client_id));
      resolvedSiteName = clientSites[0];
    } else if (app.company_name) {
      resolvedSiteName = `${app.company_name} Main Site`;
    } else if (app.client_id && userById.has(String(app.client_id))) {
      const cName = userById.get(String(app.client_id));
      resolvedSiteName = `${cName} Main Site`;
    } else {
      resolvedSiteName = 'Main Facility';
    }

    bulkOps.push({
      updateOne: {
        filter: { _id: app._id },
        update: { $set: { site_name: resolvedSiteName } }
      }
    });

    if (bulkOps.length >= 200) {
      await db.collection('applications').bulkWrite(bulkOps);
      updatedCount += bulkOps.length;
      bulkOps.length = 0;
    }
  }

  if (bulkOps.length > 0) {
    await db.collection('applications').bulkWrite(bulkOps);
    updatedCount += bulkOps.length;
  }

  console.log(`✅ Successfully backfilled site_name for ${updatedCount} applications!`);

  // Verify
  const remainingMissing = await db.collection('applications').countDocuments({
    $or: [
      { site_name: { $exists: false } },
      { site_name: null },
      { site_name: '' }
    ]
  });
  console.log(`🎯 Applications remaining without site_name: ${remainingMissing}`);

  await mongoose.disconnect();
  console.log('🎉 Done!');
}

backfillSiteNames().catch(err => {
  console.error('❌ Error during backfill:', err);
  process.exit(1);
});
