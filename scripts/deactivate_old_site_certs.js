import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const Certificate = mongoose.model('Certificate', new mongoose.Schema({}, { strict: false }));
  
  // Find all active certificates
  const activeCerts = await Certificate.find({ status: 'active' }).lean();
  console.log('Total active certificates before cleanup:', activeCerts.length);

  // Group by site
  const siteMap = new Map();
  activeCerts.forEach(cert => {
    const siteKey = (
      (cert.site_id ? String(cert.site_id) : '') ||
      (cert.site_name || cert.establishment_name || cert.company_name || '').trim().toLowerCase()
    );

    if (!siteMap.has(siteKey)) {
      siteMap.set(siteKey, []);
    }
    siteMap.get(siteKey).push(cert);
  });

  const toSupersede = [];

  for (const [siteKey, certsList] of siteMap.entries()) {
    if (certsList.length <= 1) continue;

    // Sort by latest expiry date, then issue date, then createdAt
    certsList.sort((a, b) => {
      const expA = new Date(a.expiry_date || a.issue_date || a.createdAt || 0).getTime();
      const expB = new Date(b.expiry_date || b.issue_date || b.createdAt || 0).getTime();
      return expB - expA;
    });

    const latest = certsList[0];
    const older = certsList.slice(1);

    for (const oldCert of older) {
      toSupersede.push({
        id: oldCert._id,
        superseded_by: latest._id,
        certNo: oldCert.certificate_number,
        latestCertNo: latest.certificate_number,
        siteKey
      });
    }
  }

  console.log('Total older certificates to deactivate across all sites:', toSupersede.length);

  if (toSupersede.length > 0) {
    const ids = toSupersede.map(item => item.id);
    const updateResult = await Certificate.updateMany(
      { _id: { $in: ids } },
      {
        $set: {
          status: 'superseded',
          updated_at: new Date()
        }
      }
    );
    console.log('Successfully updated certificates to superseded:', updateResult.modifiedCount);

    // Also set superseded_by for each
    for (const item of toSupersede) {
      await Certificate.updateOne({ _id: item.id }, { $set: { superseded_by: item.superseded_by } });
    }
    console.log('Successfully linked superseded_by to latest certificate for all deactivated certs.');
  }

  const remainingActive = await Certificate.countDocuments({ status: 'active' });
  console.log('Remaining active certificates (each site has strictly 1 latest active certificate):', remainingActive);

  process.exit(0);
}

run().catch(err => {
  console.error('Error during site certs deactivation:', err);
  process.exit(1);
});
