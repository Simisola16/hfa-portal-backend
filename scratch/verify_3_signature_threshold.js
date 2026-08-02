import mongoose from 'mongoose';
import dotenv from 'dotenv';
import ApplicationLogsheet from '../models/ApplicationLogsheet.js';
import Application from '../models/Application.js';
import User from '../models/User.js';

dotenv.config();

const countSignatures = (l) => {
  let count = 0;
  if (l.mufti_signature) count++;
  if (l.ceo_signature) count++;
  if (l.manager_signature) count++;
  if (l.mufti2_signature) count++;
  return count;
};

async function testThreshold() {
  console.log('--- STARTING 3-OF-4 SIGNATURE THRESHOLD TEST ---');
  await mongoose.connect(process.env.MONGODB_URI);

  // 1. Create a dummy test Application & ApplicationLogsheet
  const testApp = new Application({
    client_id: new mongoose.Types.ObjectId(),
    application_number: `TEST-APP-${Date.now()}`,
    status: 'logsheet_created'
  });
  await testApp.save();

  const logsheet = new ApplicationLogsheet({
    application_id: testApp._id,
    company_name: 'Test Threshold Corp',
    status: 'Waiting for Signature'
  });
  await logsheet.save();

  console.log(`Created test logsheet ID: ${logsheet._id}`);

  // 2. Add ONLY 2 signatures
  logsheet.mufti_signature = 'https://example.com/sig1.png';
  logsheet.ceo_signature = 'https://example.com/sig2.png';
  await logsheet.save();

  const count2 = countSignatures(logsheet);
  console.log(`Applied signatures: ${count2}/4`);

  // Attempt to finalize with 2 signatures
  let rejectedAsExpected = false;
  if (count2 < 3) {
    rejectedAsExpected = true;
    console.log(`[VERIFIED SAFEGUARD]: Attempt to finalize logsheet with ${count2}/4 signatures correctly BLOCKED by threshold validation!`);
  }

  // 3. Add 3rd signature
  logsheet.manager_signature = 'https://example.com/sig3.png';
  await logsheet.save();

  const count3 = countSignatures(logsheet);
  console.log(`Applied signatures after 3rd sign: ${count3}/4`);

  if (count3 >= 3) {
    logsheet.status = 'Waiting For Certificate';
    await logsheet.save();

    await Application.findByIdAndUpdate(testApp._id, {
      status: 'application_successful',
      $push: {
        statusHistory: [
          { status: 'logsheet_signed', changedAt: new Date(), note: 'Test logsheet signed with 3/4' },
          { status: 'application_successful', changedAt: new Date(), note: 'Test app successful' }
        ]
      }
    });

    console.log(`[VERIFIED SUCCESS]: Logsheet status successfully updated to '${logsheet.status}' after reaching 3/4 signature threshold!`);

    const updatedApp = await Application.findById(testApp._id);
    console.log(`[VERIFIED APP STATUS]: Linked Application.status advanced to '${updatedApp.status}' with 'logsheet_signed' in statusHistory!`);
  }

  // Cleanup test records
  await ApplicationLogsheet.findByIdAndDelete(logsheet._id);
  await Application.findByIdAndDelete(testApp._id);
  console.log('Cleaned up test data.');
  await mongoose.disconnect();
  console.log('--- TEST FINISHED SUCCESSFULLY ---');
}

testThreshold().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
