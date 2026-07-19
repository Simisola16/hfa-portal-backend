import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Application from './models/Application.js';

dotenv.config();

const API_URL = `http://localhost:${process.env.PORT || 5000}`;

async function runApprovalTest() {
  console.log('Starting approval trigger test...');
  console.log(`Connecting to MongoDB...`);
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB.');

  // 1. Get an existing application to test with
  const application = await Application.findOne();
  if (!application) {
    console.error('No applications found in the database.');
    process.exit(1);
  }
  console.log(`Using Application: ${application.application_number} (_id: ${application._id})`);

  // Reset status to under_review so we can test the transition to approved
  application.status = 'under_review';
  await application.save();
  console.log('Reset application status to under_review.');

  // 2. Login as admin to get token
  console.log('Logging in as admin...');
  const loginRes = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@hfa.com',
      password: 'password123'
    })
  });

  if (!loginRes.ok) {
    console.error('Admin login failed');
    process.exit(1);
  }

  const { token } = await loginRes.json();
  console.log('Successfully logged in. Token acquired.');

  // 3. Clear existing certificates for this application
  const { default: Certificate } = await import('./models/Certificate.js');
  await Certificate.deleteMany({ application_id: application._id });
  console.log('Cleared existing certificates for this application.');

  // 4. Hit PUT /api/applications/:id/status with status: 'approved'
  console.log('Hitting PUT /api/applications/:id/status with status: "approved"...');
  const putRes = await fetch(`${API_URL}/api/applications/${application._id}/status`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      status: 'approved',
      notes: 'Approved via trigger test'
    })
  });

  const putData = await putRes.json();
  if (!putRes.ok) {
    console.error('PUT status update failed:', putData);
    process.exit(1);
  }

  console.log('PUT Response:', putData);

  // 5. Verify certificate got created
  console.log('Verifying certificate creation in MongoDB...');
  const newCert = await Certificate.findOne({ application_id: application._id });
  if (newCert) {
    console.log('--- Approval Trigger Success! ---');
    console.log('Generated Certificate:', {
      id: newCert._id,
      certificateNumber: newCert.certificate_number,
      certificateUrl: newCert.certificate_url,
      status: newCert.status
    });
  } else {
    console.error('FAIL: Certificate was not auto-generated.');
  }
  
  // Verify application status got updated to certificate_issued internally
  const updatedApp = await Application.findById(application._id);
  console.log('Updated Application Status:', updatedApp.status);

  // Clean up DB connection
  await mongoose.disconnect();
  console.log('MongoDB disconnected.');
}

runApprovalTest().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
