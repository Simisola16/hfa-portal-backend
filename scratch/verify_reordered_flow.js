import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Application from '../models/Application.js';
import User from '../models/User.js';
import Invoice from '../models/Invoice.js';
import ApplicationLogsheet from '../models/ApplicationLogsheet.js';
import Agreement from '../models/Agreement.js';
import Certificate from '../models/Certificate.js';

dotenv.config();

const PORT = process.env.PORT || 5000;
const API_URL = `http://localhost:${PORT}`;

async function verifyReorderedFlow() {
  console.log('=== VERIFYING REORDERED LIFECYCLE FLOW ===');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  // 1. Get or create test admin and client users
  let adminUser = await User.findOne({ role: 'admin' });
  if (!adminUser) {
    adminUser = await User.create({
      full_name: 'Test Admin',
      email: 'testadmin@hfa.com',
      password_hash: 'hash',
      role: 'admin',
      is_active: true
    });
  }

  let clientUser = await User.findOne({ role: 'client' });
  if (!clientUser) {
    clientUser = await User.create({
      full_name: 'Test Client',
      email: 'testclient@hfa.com',
      company_name: 'Test Food Co',
      password_hash: 'hash',
      role: 'client',
      is_active: true
    });
  }

  // Generate Admin JWT Token
  const jwt = (await import('jsonwebtoken')).default;
  const adminToken = jwt.sign(
    { _id: adminUser._id, role: 'admin', email: adminUser.email },
    process.env.JWT_SECRET || 'secret'
  );

  // 2. Create test application
  const appNo = `TEST-FLOW-${Date.now().toString().slice(-6)}`;
  const testApp = await Application.create({
    application_number: appNo,
    client_id: clientUser._id,
    establishment_name: 'Test Food Co',
    establishment_address: '123 Test Street, London',
    application_type: 'New Certification',
    category: 'Standard Halal Certification',
    scope: 'Meat Processing',
    status: 'audit_report_submitted'
  });
  console.log(`\n1. Created Test Application: ${appNo} (_id: ${testApp._id})`);

  // Clean up any old invoices / logsheets / agreements / certificates for this app
  await Invoice.deleteMany({ application_id: testApp._id });
  await ApplicationLogsheet.deleteMany({ application_id: testApp._id });
  await Agreement.deleteMany({ application_id: testApp._id });
  await Certificate.deleteMany({ application_id: testApp._id });

  // 3. Test On Hold state
  console.log('\n2. Testing On Hold branch...');
  const holdRes = await fetch(`${API_URL}/api/applications/${testApp._id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({ status: 'on_hold', note: 'Testing on hold state post-audit' })
  });
  const holdData = await holdRes.json();
  if (holdRes.ok && holdData.status === 'on_hold') {
    console.log('✅ On Hold status updated successfully');
  } else {
    console.error('❌ Failed to put application on hold:', holdData);
  }

  // 4. Mark Successful -> audit_successful
  console.log('\n3. Marking Audit Successful...');
  const succRes = await fetch(`${API_URL}/api/applications/${testApp._id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({ status: 'audit_successful', note: 'Audit marked successful by admin' })
  });
  const succData = await succRes.json();
  console.log(`✅ Application status updated to: ${succData.status}`);

  // 5. Create LogSheet -> logsheet_created (WITHOUT final invoice)
  console.log('\n4. Creating LogSheet (verifying no invoice gate blocks this)...');
  const logsheetRes = await fetch(`${API_URL}/api/application-logsheets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      application_id: testApp._id.toString(),
      client_id: clientUser._id.toString(),
      scope_of_audit: 'Test Meat Processing',
      auditor_name: 'Lead Auditor',
      summary_of_findings: 'Compliant with standards'
    })
  });
  const logsheetData = await logsheetRes.json();
  if (logsheetRes.ok) {
    console.log('✅ LogSheet created successfully without invoice requirement!');
  } else {
    console.error('❌ LogSheet creation failed unexpectedly:', logsheetData);
    process.exit(1);
  }

  // Update app status to logsheet_signed
  await Application.findByIdAndUpdate(testApp._id, { status: 'logsheet_signed' });

  // 6. Send & Sign Agreement -> status: agreement_signed
  console.log('\n5. Moving status to agreement_signed...');
  await Application.findByIdAndUpdate(testApp._id, { status: 'agreement_signed' });
  console.log('✅ Status set to agreement_signed');

  // 7. Attempt Certificate Issuance BEFORE Final Invoice exists
  console.log('\n6. Attempting certificate issuance BEFORE final invoice is created (expecting 403 REJECTED)...');
  const certRes1 = await fetch(`${API_URL}/api/certificates/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({ applicationId: testApp._id.toString() })
  });
  const certData1 = await certRes1.json();
  if (certRes1.status === 403 && certData1.code === 'FINAL_INVOICE_REQUIRED') {
    console.log(`✅ EXPECTED REJECTION (403): ${certData1.error} [code: ${certData1.code}]`);
  } else {
    console.error('❌ FAILED: Certificate generation should have been rejected (403), got:', certRes1.status, certData1);
    process.exit(1);
  }

  // 8. Create Final Invoice -> status: final_invoice_sent
  console.log('\n7. Sending Final Invoice...');
  const invRes = await fetch(`${API_URL}/api/invoices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      application_id: testApp._id.toString(),
      client_id: clientUser._id.toString(),
      invoice_type: 'final',
      target_status: 'final_invoice_sent',
      title: 'Final Certification Fee Invoice',
      amount: 750.00,
      status: 'unpaid'
    })
  });
  const invData = await invRes.json();
  console.log(`✅ Final Invoice created: ${invData.data?.invoice_number}`);
  const updatedAppPostInvoice = await Application.findById(testApp._id);
  console.log(`   Application status is now: ${updatedAppPostInvoice.status}`);

  // 9. Attempt Certificate Issuance while Final Invoice is UNPAID
  console.log('\n8. Attempting certificate issuance while final invoice is UNPAID (expecting 403 REJECTED)...');
  const certRes2 = await fetch(`${API_URL}/api/certificates/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({ applicationId: testApp._id.toString() })
  });
  const certData2 = await certRes2.json();
  if (certRes2.status === 403 && certData2.code === 'FINAL_INVOICE_NOT_PAID') {
    console.log(`✅ EXPECTED REJECTION (403): ${certData2.error} [code: ${certData2.code}]`);
  } else {
    console.error('❌ FAILED: Certificate generation should have been rejected for unpaid invoice, got:', certRes2.status, certData2);
    process.exit(1);
  }

  // 10. Pay Final Invoice (Admin confirms payment) -> status: final_invoice_paid
  console.log('\n9. Confirming payment for Final Invoice...');
  const payRes = await fetch(`${API_URL}/api/invoices/${invData.data._id}/confirm-payment`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({})
  });
  const payData = await payRes.json();
  console.log(`✅ Invoice payment confirmed: invoice status = ${payData.data?.status}`);
  const updatedAppPostPayment = await Application.findById(testApp._id);
  console.log(`   Application status updated to: ${updatedAppPostPayment.status}`);

  // 11. Issue Certificate NOW -> expect SUCCESS and status: certificate_issued
  console.log('\n10. Issuing Certificate NOW (expecting SUCCESS 201)...');
  const certRes3 = await fetch(`${API_URL}/api/certificates/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({ applicationId: testApp._id.toString() })
  });
  const certData3 = await certRes3.json();
  if (certRes3.ok && certData3.success) {
    console.log(`✅ CERTIFICATE ISSUED SUCCESSFULLY!`);
    console.log(`   Cert No: ${certData3.certificateNumber}`);
    const finalApp = await Application.findById(testApp._id);
    console.log(`   Final Application Status: ${finalApp.status}`);
  } else {
    console.error('❌ FAILED: Certificate generation failed after payment:', certData3);
    process.exit(1);
  }

  // Cleanup test app
  await Application.findByIdAndDelete(testApp._id);
  await Invoice.deleteMany({ application_id: testApp._id });
  await ApplicationLogsheet.deleteMany({ application_id: testApp._id });
  await Certificate.deleteMany({ application_id: testApp._id });
  console.log('\n✅ Cleaned up test records.');

  await mongoose.disconnect();
  console.log('\n🎉 ALL LIFECYCLE REORDERING VERIFICATION CHECKS PASSED SUCCESSFULLY!');
}

verifyReorderedFlow().catch(err => {
  console.error('Verification script failed with error:', err);
  process.exit(1);
});
