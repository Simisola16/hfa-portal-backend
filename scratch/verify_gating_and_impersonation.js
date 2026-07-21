import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Application from '../models/Application.js';
import Certificate from '../models/Certificate.js';
import User from '../models/User.js';
import ImpersonationLog from '../models/ImpersonationLog.js';

dotenv.config();

async function runTests() {
  console.log('🔄 Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB.');

  const clientEmail = 'client_verify@test.com';
  const adminEmail = 'admin_verify@hfa.com';
  const siteId = new mongoose.Types.ObjectId().toString();

  // 1. Clean up old test data
  await User.deleteMany({ email: { $in: [clientEmail, adminEmail] } });
  await Application.deleteMany({ establishment_name: 'Test Verify Factory' });
  await Certificate.deleteMany({ site_id: siteId });
  await ImpersonationLog.deleteMany({ comment: 'verification_testing' });

  // Create test client
  const clientUser = new User({
    email: clientEmail,
    password: 'password123',
    full_name: 'Verification Client',
    role: 'client',
    is_verified: true,
    is_active: true
  });
  await clientUser.save();

  // Create test admin
  const adminUser = new User({
    email: adminEmail,
    password: 'password123',
    full_name: 'Verification Admin',
    role: 'admin',
    is_verified: true,
    is_active: true
  });
  await adminUser.save();

  console.log('✅ Test users seeded.');

  // TEST 1: Gating Rule A — Active (non-expired) certificate blocks new application
  console.log('\n--- TEST 1: Gating Rule A (Active certificate blocks new application) ---');
  // Create an active certificate for siteId
  const activeCert = new Certificate({
    site_id: siteId,
    client_id: clientUser._id.toString(),
    certificate_number: 'HFA-UK-TEST-1',
    issue_date: new Date(),
    expiry_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Active for 30 days
    status: 'active'
  });
  await activeCert.save();
  console.log('Created active certificate expiring in 30 days.');

  // Emulate check for new application
  const activeCertCheck = await Certificate.findOne({
    site_id: siteId,
    status: 'active',
    expiry_date: { $gt: new Date() }
  });

  if (activeCertCheck) {
    console.log('PASS: Query successfully detected active certificate. New application for this site would be BLOCKED.');
  } else {
    console.log('FAIL: Query failed to detect active certificate.');
  }

  // TEST 2: Gating Rule B — Ongoing application blocks a new one (per-site)
  console.log('\n--- TEST 2: Gating Rule B (Ongoing application blocks a new one) ---');
  // Create an ongoing application for siteId
  const ongoingApp = new Application({
    application_number: 'HFA-V-001',
    client_id: clientUser._id,
    site_id: siteId,
    application_type: 'new',
    establishment_name: 'Test Verify Factory',
    status: 'under_review',
    statusHistory: [{ status: 'under_review', changedAt: new Date(), changedBy: adminUser._id }]
  });
  await ongoingApp.save();
  console.log('Created ongoing application in status "under_review".');

  // Emulate check
  const ongoingAppCheck = await Application.findOne({
    site_id: siteId,
    client_id: clientUser._id,
    status: { $nin: ['approved', 'rejected', 'certificate_issued'] }
  });

  if (ongoingAppCheck) {
    console.log('PASS: Query successfully detected ongoing application. Second application for this site would be BLOCKED.');
  } else {
    console.log('FAIL: Query failed to detect ongoing application.');
  }

  // TEST 3: Impersonation audit trails
  console.log('\n--- TEST 3: Impersonation Audit Trail ---');
  // Create an impersonation log
  const logEntry = new ImpersonationLog({
    admin_id: adminUser._id,
    client_id: clientUser._id,
    started_at: new Date(),
    comment: 'verification_testing'
  });
  await logEntry.save();
  console.log('Logged start of impersonation session.');

  // Emulate ending impersonation
  const foundLog = await ImpersonationLog.findOneAndUpdate(
    { admin_id: adminUser._id, client_id: clientUser._id, ended_at: { $exists: false } },
    { ended_at: new Date() },
    { new: true }
  );

  if (foundLog && foundLog.ended_at) {
    console.log('PASS: Impersonation log successfully updated with ended_at timestamp.');
  } else {
    console.log('FAIL: Impersonation log ending failed.');
  }

  // 6. Clean up verification data
  await User.deleteMany({ email: { $in: [clientEmail, adminEmail] } });
  await Application.deleteMany({ establishment_name: 'Test Verify Factory' });
  await Certificate.deleteMany({ site_id: siteId });
  await ImpersonationLog.deleteMany({ comment: 'verification_testing' });
  console.log('\n🧹 Verification data cleaned up.');

  await mongoose.disconnect();
  console.log('🔌 Disconnected from MongoDB. Tests completed.');
}

runTests().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
