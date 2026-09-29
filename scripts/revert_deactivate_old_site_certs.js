import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hfa-portal-database';
  await mongoose.connect(uri);
  const Certificate = mongoose.model('Certificate', new mongoose.Schema({}, { strict: false }));

  const supersededCount = await Certificate.countDocuments({ status: 'superseded' });
  const activeCountBefore = await Certificate.countDocuments({ status: 'active' });
  console.log(`Before revert: ${supersededCount} superseded certificates, ${activeCountBefore} active certificates.`);

  if (supersededCount > 0) {
    const updateResult = await Certificate.updateMany(
      { status: 'superseded' },
      {
        $set: {
          status: 'active',
          updated_at: new Date()
        },
        $unset: {
          superseded_by: '',
          is_renewed: ''
        }
      }
    );
    console.log(`Successfully reverted ${updateResult.modifiedCount} certificates back to "active".`);
  } else {
    console.log('No superseded certificates found to revert.');
  }

  const activeCountAfter = await Certificate.countDocuments({ status: 'active' });
  const supersededCountAfter = await Certificate.countDocuments({ status: 'superseded' });
  console.log(`After revert: ${activeCountAfter} active certificates, ${supersededCountAfter} superseded certificates.`);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error('Error during revert:', err);
  process.exit(1);
});
