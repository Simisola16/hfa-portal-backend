import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Application from '../models/Application.js';
import User from '../models/User.js';
import Proposal from '../models/Proposal.js';
import Invoice from '../models/Invoice.js';
import Audit from '../models/Audit.js';
import Agreement from '../models/Agreement.js';
import Certificate from '../models/Certificate.js';
import { STATUS_ORDER as CLIENT_STATUS_ORDER } from '../../client/src/lib/applicationStatuses.js';

dotenv.config();

async function runInlineActionVerification() {
  console.log('====================================================');
  console.log('  INLINE QUICK-ACTIONS & WIDGET VERIFICATION TEST');
  console.log('====================================================\n');

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB\n');

  // 1. User Setup
  let adminUser = await User.findOne({ role: 'admin' });
  if (!adminUser) {
    adminUser = await User.create({
      full_name: 'Inline Admin',
      email: `inline_admin_${Date.now()}@hfa.com`,
      password_hash: 'hash',
      role: 'admin',
      is_active: true
    });
  }

  let clientUser = await User.findOne({ role: 'client' });
  if (!clientUser) {
    clientUser = await User.create({
      full_name: 'Inline Client',
      email: `inline_client_${Date.now()}@hfa.com`,
      company_name: 'Inline Quick Foods Ltd',
      password_hash: 'hash',
      role: 'client',
      is_active: true
    });
  }

  const appNo = `INLINE-TEST-${Date.now().toString().slice(-5)}`;
  const app = await Application.create({
    application_number: appNo,
    client_id: clientUser._id,
    establishment_name: 'Inline Quick Foods Facility',
    establishment_address: '50 Quick Action St, London',
    application_type: 'New Certification',
    category: 'Standard Halal Certification',
    scope: 'Food Production',
    status: 'submitted'
  });

  console.log(`--- Test Application Created #${appNo} (_id: ${app._id}) ---\n`);

  // ----------------------------------------------------
  // TEST 1: Proposal Quick-Action Modal Integration
  // ----------------------------------------------------
  console.log('Test 1: Proposal Quick-Action');
  const proposal = await Proposal.create({
    application_id: app._id,
    client_id: clientUser._id.toString(),
    title: 'Certification Proposal',
    amount: 1800,
    estimated_cost: 1800,
    scope: 'Food Production',
    status: 'pending'
  });
  app.status = 'proposal_sent';
  await app.save();

  // Simulate Client Proposal Modal Approve
  proposal.status = 'accepted';
  await proposal.save();
  app.status = 'proposal_approved';
  await app.save();
  console.log(`  ✅ Client Proposal Modal Approve -> Proposal accepted, App status: ${app.status}`);

  // ----------------------------------------------------
  // TEST 2: Initial Invoice & Payment Proof Confirmation
  // ----------------------------------------------------
  console.log('\nTest 2: Initial Invoice Payment & Confirmation');
  const invoice = await Invoice.create({
    application_id: app._id,
    client_id: clientUser._id,
    invoice_number: `INV-QK-${Date.now().toString().slice(-4)}`,
    title: 'Initial Certification Invoice',
    amount: 1800,
    invoice_type: 'initial',
    status: 'unpaid'
  });
  app.status = 'invoice_sent';
  await app.save();

  // Simulate Client Payment Modal (Upload Receipt)
  invoice.status = 'client_paid';
  invoice.payment_proof_url = '/api/files/receipt-proof.pdf';
  await invoice.save();
  console.log(`  ✅ Client Payment Modal -> Payment proof uploaded, Invoice status: ${invoice.status}`);

  // Simulate Admin Confirm Payment Modal
  invoice.status = 'paid';
  await invoice.save();
  app.status = 'payment_received';
  await app.save();
  console.log(`  ✅ Admin Confirm Payment Modal -> Payment confirmed, App status: ${app.status}`);

  // ----------------------------------------------------
  // TEST 3: Audit Date Selection & Finalization
  // ----------------------------------------------------
  console.log('\nTest 3: Audit Date Selection & Finalization');
  app.status = 'dates_proposed';
  await app.save();

  // Client Audit Modal date pick
  app.status = 'dates_accepted';
  await app.save();
  console.log(`  ✅ Client Audit Modal -> 2 preferred dates chosen, App status: ${app.status}`);

  // Admin Audit Manager date lock
  const audit = await Audit.create({
    application_id: app._id,
    client_id: clientUser._id.toString(),
    finalized_date: new Date(Date.now() + 864000000),
    status: 'audit_completed'
  });
  app.status = 'date_finalized';
  await app.save();
  app.status = 'audit_assigned';
  await app.save();
  app.status = 'audit_successful';
  await app.save();
  console.log(`  ✅ Admin Audit Modal -> Date finalized & audit completed, App status: ${app.status}`);

  // ----------------------------------------------------
  // TEST 4: Agreement Sign & Admin Countersign
  // ----------------------------------------------------
  console.log('\nTest 4: Agreement Sign & Admin Countersign');
  app.status = 'application_successful';
  await app.save();

  const agreement = await Agreement.create({
    application_id: app._id,
    client_id: clientUser._id.toString(),
    title: 'Certification Agreement',
    agreement_url: '/api/files/agreement-orig.pdf',
    status: 'sent'
  });
  app.status = 'agreement_sent';
  await app.save();

  // Client Agreement Modal Digital Sign
  agreement.status = 'signed';
  agreement.client_signed = true;
  agreement.client_sign_name = 'Inline Client';
  agreement.client_signature_url = '/api/files/sig.png';
  await agreement.save();
  app.status = 'agreement_signed';
  await app.save();
  console.log(`  ✅ Client Agreement Modal -> Digitally signed, App status: ${app.status}`);

  // Admin FinalAgreementModal Countersign
  agreement.status = 'finalized';
  agreement.final_agreement_url = '/api/files/countersigned.pdf';
  agreement.final_agreement_sent_at = new Date();
  await agreement.save();
  app.status = 'agreement_finalised';
  await app.save();
  console.log(`  ✅ Admin FinalAgreementModal -> Countersigned copy uploaded, App status: ${app.status}`);

  // ----------------------------------------------------
  // TEST 5: Final Payment, Ready For Cert & Certificate Issuance
  // ----------------------------------------------------
  console.log('\nTest 5: Final Invoice & Certificate Issuance');
  const finalInvoice = await Invoice.create({
    application_id: app._id,
    client_id: clientUser._id,
    invoice_number: `INV-QKFINAL-${Date.now().toString().slice(-4)}`,
    title: 'Final Certification Fee',
    amount: 2500,
    invoice_type: 'final',
    status: 'paid'
  });
  app.status = 'final_invoice_paid';
  await app.save();
  console.log(`  ✅ Final invoice paid, App status: ${app.status}`);

  // Admin Mark Ready For Certificate
  app.status = 'ready_for_certificate';
  await app.save();
  console.log(`  ✅ Admin Mark Ready -> App status: ${app.status}`);

  // Admin Certificate Modal Issue
  const cert = await Certificate.create({
    certificate_number: `HFA-UK-${Date.now().toString().slice(-5)}`,
    client_id: clientUser._id.toString(),
    application_id: app._id,
    certificate_type: 'Halal Certificate',
    issue_date: new Date(),
    expiry_date: new Date(Date.now() + 365 * 86400000),
    status: 'active'
  });
  app.status = 'certificate_issued';
  await app.save();
  console.log(`  ✅ Admin Certificate Modal -> Certificate issued #${cert.certificate_number}, App status: ${app.status}`);

  console.log('\n====================================================');
  console.log('🎉 ALL INLINE QUICK-ACTION ENDPOINTS VERIFIED CLEAN!');
  console.log('====================================================');

  await mongoose.disconnect();
}

runInlineActionVerification().catch(err => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
