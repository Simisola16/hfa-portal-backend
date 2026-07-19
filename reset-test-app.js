import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Application from './models/Application.js';
import User from './models/User.js';
import Proposal from './models/Proposal.js';
import Invoice from './models/Invoice.js';
import Audit from './models/Audit.js';
import Agreement from './models/Agreement.js';
import LogSheet from './models/LogSheet.js';
import Certificate from './models/Certificate.js';

dotenv.config();

async function reset() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected.');

  // Find or create test user
  let client = await User.findOne({ email: 'client@test.com' });
  if (!client) {
    client = new User({
      full_name: 'Test Client',
      email: 'client@test.com',
      password: 'password123',
      role: 'client',
      is_verified: true
    });
    await client.save();
  }

  // Delete all old applications/assets for client@test.com
  const apps = await Application.find({ client_id: client._id });
  for (const app of apps) {
    await Proposal.deleteMany({ application_id: app._id });
    await Invoice.deleteMany({ application_id: app._id });
    await Audit.deleteMany({ application_id: app._id });
    await Agreement.deleteMany({ application_id: app._id });
    await LogSheet.deleteMany({ application_id: app._id });
    await Certificate.deleteMany({ application_id: app._id });
    await app.deleteOne();
  }

  // Create a brand new fresh application
  const app = new Application({
    application_number: 'HFA-PRO-2026',
    client_id: client._id,
    application_type: 'Halal Certification',
    establishment_name: 'Test Client Food Factory',
    establishment_address: '123 Halal Lane, London, UK',
    contact_name: 'Test Client',
    contact_email: 'client@test.com',
    status: 'submitted',
    status_history: [{ status: 'submitted', changedAt: new Date(), note: 'Application submitted.' }]
  });

  await app.save();
  console.log('Test application created: HFA-PRO-2026');
  await mongoose.disconnect();
}

reset().catch(err => {
  console.error(err);
  process.exit(1);
});
