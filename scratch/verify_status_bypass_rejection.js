import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import ApplicationLogsheet from '../models/ApplicationLogsheet.js';
import User from '../models/User.js';
import applicationLogsheetsRouter from '../routes/applicationLogsheets.js';
import jwt from 'jsonwebtoken';

dotenv.config();

async function testSignatureBypassRejection() {
  console.log('=== TEST: DIRECT API CALL TO PUT /api/application-logsheets/:id/status ===');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  // Setup Express test server
  const app = express();
  app.use(express.json());
  app.use('/api/application-logsheets', applicationLogsheetsRouter);

  const server = app.listen(5099);
  const API_URL = 'http://localhost:5099';

  try {
    // 1. Get existing active admin user
    let adminUser = await User.findOne({ role: 'admin' });
    if (!adminUser) {
      adminUser = await User.create({
        full_name: 'Test Admin',
        email: `testadmin_${Date.now()}@hfa.org`,
        password_hash: 'hash',
        role: 'admin',
        is_active: true
      });
    }

    const token = jwt.sign(
      { id: adminUser._id.toString(), userId: adminUser._id.toString(), role: 'admin', email: adminUser.email },
      process.env.JWT_SECRET || 'secret'
    );

    // 2. Create a test logsheet with ZERO signatures applied
    const fakeAppId = new mongoose.Types.ObjectId();
    const testLogsheet = await ApplicationLogsheet.create({
      application_id: fakeAppId,
      company_name: 'Test Unsigned Company Ltd',
      status: 'Waiting for Signature',
      mufti_signature: null,
      ceo_signature: null,
      manager_signature: null,
      mufti2_signature: null
    });

    console.log(`📋 Created test logsheet ID: ${testLogsheet._id} with 0 signatures (Current Status: "${testLogsheet.status}")`);

    // 3. Make direct HTTP PUT request to /api/application-logsheets/:id/status attempting to set status: 'Signed'
    console.log(`\n🚀 Sending direct HTTP PUT request to ${API_URL}/api/application-logsheets/${testLogsheet._id}/status...`);
    console.log(`Payload: { "status": "Signed" }\n`);

    const res = await fetch(`${API_URL}/api/application-logsheets/${testLogsheet._id}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ status: 'Signed' })
    });

    const statusCode = res.status;
    const responseBody = await res.json();

    console.log('================ OFFICIAL API RESPONSE ================');
    console.log(`HTTP Status Code: ${statusCode} ${res.statusText}`);
    console.log('Response Body:', JSON.stringify(responseBody, null, 2));
    console.log('=======================================================\n');

    if (statusCode === 400 && responseBody.error) {
      console.log('✅ VERIFIED: Backend route successfully blocked the bypass with 400 Bad Request!');
    } else {
      console.error('❌ UNEXPECTED RESPONSE:', statusCode, responseBody);
    }

    // Clean up test logsheet
    await ApplicationLogsheet.findByIdAndDelete(testLogsheet._id);
    console.log('🧹 Cleaned up test logsheet record.');
  } catch (err) {
    console.error('❌ Error executing test:', err.message);
  } finally {
    server.close();
    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB.');
  }
}

testSignatureBypassRejection();
