import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Application from './models/Application.js';
import User from './models/User.js';

dotenv.config();

const API_URL = `http://localhost:${process.env.PORT || 5000}`;

async function runIntegrationTest() {
  console.log('Starting integration test...');
  console.log(`Connecting to MongoDB...`);
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB.');

  // 1. Get an existing application to test with
  const application = await Application.findOne();
  if (!application) {
    console.error('No applications found in the database. Please submit an application first before running this test.');
    process.exit(1);
  }
  console.log(`Using Application: ${application.application_number} (_id: ${application._id})`);

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
    const errorText = await loginRes.text();
    console.error('Admin login failed:', errorText);
    process.exit(1);
  }

  const { token } = await loginRes.json();
  console.log('Successfully logged in. Token acquired.');

  // 3. Delete any pre-existing certificates for this application to avoid conflict
  const { default: Certificate } = await import('./models/Certificate.js');
  await Certificate.deleteMany({ application_id: application._id });
  console.log('Cleared existing certificates for this application.');

  // 4. Hit POST /api/certificates/generate
  console.log('Hitting certificate generation endpoint /api/certificates/generate...');
  const genRes = await fetch(`${API_URL}/api/certificates/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      applicationId: application._id.toString()
    })
  });

  const genData = await genRes.json();
  if (!genRes.ok) {
    console.error('Certificate generation endpoint failed:', genData);
    process.exit(1);
  }

  console.log('--- Certificate Generation Success! ---');
  console.log('Response:', genData);
  
  // Verify application status got updated
  const updatedApp = await Application.findById(application._id);
  console.log('Updated Application Status:', updatedApp.status);
  
  // Clean up DB connection
  await mongoose.disconnect();
  console.log('MongoDB disconnected.');
}

runIntegrationTest().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
