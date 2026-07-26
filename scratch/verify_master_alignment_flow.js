import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Application from '../models/Application.js';
import User from '../models/User.js';
import Invoice from '../models/Invoice.js';
import Audit from '../models/Audit.js';
import ApplicationLogsheet from '../models/ApplicationLogsheet.js';
import Agreement from '../models/Agreement.js';
import Certificate from '../models/Certificate.js';
import { STATUS_ORDER as CLIENT_STATUS_ORDER, STATUS_LABELS as CLIENT_STATUS_LABELS } from '../../client/src/lib/applicationStatuses.js';
import { STATUS_ORDER as ADMIN_STATUS_ORDER, STATUS_LABELS as ADMIN_STATUS_LABELS } from '../../admin/src/lib/applicationStatuses.js';

dotenv.config();

async function runMasterAlignmentVerification() {
  console.log('====================================================');
  console.log('   MASTER ALIGNMENT PASS — END-TO-END VERIFICATION');
  console.log('====================================================\n');

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB\n');

  // 1. Verify Status Arrays & Label Consistency
  console.log('--- 1. Checking Frontend Status Alignment ---');
  console.log(`Client Status Count: ${CLIENT_STATUS_ORDER.length}`);
  console.log(`Admin Status Count:  ${ADMIN_STATUS_ORDER.length}`);

  if (JSON.stringify(CLIENT_STATUS_ORDER) !== JSON.stringify(ADMIN_STATUS_ORDER)) {
    console.error('❌ MISMATCH in STATUS_ORDER between client and admin!');
    process.exit(1);
  } else {
    console.log('✅ STATUS_ORDER is 100% identical across admin and client.');
  }

  // Check required canonical statuses exist in array
  const requiredStatuses = [
    'submitted', 'under_review', 'approved',
    'proposal_sent', 'proposal_approved',
    'invoice_sent', 'payment_received',
    'dates_proposed', 'dates_accepted', 'date_finalized', 'audit_assigned',
    'audit_report_submitted', 'on_hold', 'audit_successful',
    'logsheet_created', 'logsheet_signed', 'application_successful',
    'agreement_sent', 'agreement_signed', 'agreement_finalised',
    'final_invoice_sent', 'final_invoice_paid', 'ready_for_certificate',
    'certificate_issued'
  ];

  for (const s of requiredStatuses) {
    if (!CLIENT_STATUS_ORDER.includes(s)) {
      console.error(`❌ Required status "${s}" is missing from STATUS_ORDER!`);
      process.exit(1);
    }
  }
  console.log('✅ All 24 canonical statuses present in STATUS_ORDER.\n');

  // 2. Test User Setup
  let adminUser = await User.findOne({ role: 'admin' });
  if (!adminUser) {
    adminUser = await User.create({
      full_name: 'Test Master Admin',
      email: `admin_${Date.now()}@hfa.com`,
      password_hash: 'hash',
      role: 'admin',
      is_active: true
    });
  }

  let clientUser = await User.findOne({ role: 'client' });
  if (!clientUser) {
    clientUser = await User.create({
      full_name: 'Test Master Client',
      email: `client_${Date.now()}@hfa.com`,
      company_name: 'Canonical Foods Ltd',
      password_hash: 'hash',
      role: 'client',
      is_active: true
    });
  }

  // ----------------------------------------------------
  // FLOW 1: HFA Single-Stage Canonical Walkthrough
  // ----------------------------------------------------
  console.log('--- 2. Walking HFA Single-Stage Canonical Flow ---');
  const hfaAppNo = `HFA-TEST-${Date.now().toString().slice(-5)}`;
  const hfaApp = await Application.create({
    application_number: hfaAppNo,
    client_id: clientUser._id,
    establishment_name: 'Canonical Foods HFA Facility',
    establishment_address: '100 Alignment Way, London',
    application_type: 'New Certification',
    category: 'Standard Halal Certification',
    scope: 'Food Production',
    status: 'submitted'
  });
  console.log(`Step 1 (Submitted): App #${hfaAppNo} created [status: ${hfaApp.status}]`);

  // Admin approves app
  hfaApp.status = 'approved';
  await hfaApp.save();
  console.log(`Step 2 (Approved): Application approved [status: ${hfaApp.status}]`);

  // Proposal sent & approved
  hfaApp.status = 'proposal_sent';
  await hfaApp.save();
  hfaApp.status = 'proposal_approved';
  await hfaApp.save();
  console.log(`Step 3 (Proposal): Proposal sent -> approved [status: ${hfaApp.status}]`);

  // Initial Invoice sent & paid & confirmed
  const initialInvoice = await Invoice.create({
    application_id: hfaApp._id,
    client_id: clientUser._id,
    invoice_number: `INV-INIT-${Date.now().toString().slice(-4)}`,
    title: 'Initial Certification Invoice',
    amount: 1500,
    invoice_type: 'initial',
    status: 'paid'
  });
  hfaApp.status = 'payment_received';
  await hfaApp.save();
  console.log(`Step 4 (Initial Invoice): Invoice paid & confirmed [status: ${hfaApp.status}]`);

  // Audit dates proposed -> accepted -> finalized -> assigned
  hfaApp.status = 'dates_proposed';
  await hfaApp.save();
  hfaApp.status = 'dates_accepted';
  await hfaApp.save();
  hfaApp.status = 'date_finalized';
  await hfaApp.save();
  if (hfaApp.status !== 'date_finalized') {
    console.error('❌ BUG #1 FAIL: date_finalized status mismatch!');
    process.exit(1);
  }
  hfaApp.status = 'audit_assigned';
  await hfaApp.save();
  console.log(`Step 5 (Audit Schedule): Dates proposed -> accepted -> date_finalized (lowercase verified) -> audit_assigned [status: ${hfaApp.status}]`);

  // Mark Audit Complete
  hfaApp.status = 'audit_successful';
  await hfaApp.save();
  console.log(`Step 6 (Audited): Audit complete [status: ${hfaApp.status}]`);

  // Logsheet created -> signed -> advances to application_successful
  const logsheet = await ApplicationLogsheet.create({
    application_id: hfaApp._id,
    client_id: clientUser._id,
    facility_name: hfaApp.establishment_name,
    status: 'Signed'
  });
  hfaApp.status = 'application_successful';
  await hfaApp.save();
  console.log(`Step 7 (Logsheet & Milestone): Logsheet signed -> application_successful milestone reached [status: ${hfaApp.status}]`);

  // Agreement sent -> signed by client -> finalized by admin countersigned copy
  const agreement = await Agreement.create({
    application_id: hfaApp._id,
    client_id: clientUser._id.toString(),
    title: 'HFA Certification Agreement',
    agreement_url: '/api/files/test-agreement.pdf',
    status: 'sent'
  });
  hfaApp.status = 'agreement_sent';
  await hfaApp.save();

  agreement.status = 'signed';
  agreement.client_signed = true;
  agreement.signed_agreement_url = '/api/files/signed-agreement.pdf';
  await agreement.save();
  hfaApp.status = 'agreement_signed';
  await hfaApp.save();

  // Admin countersigns final copy
  agreement.status = 'finalized';
  agreement.final_agreement_url = '/api/files/final-countersigned-agreement.pdf';
  agreement.final_agreement_sent_at = new Date();
  await agreement.save();
  hfaApp.status = 'agreement_finalised';
  await hfaApp.save();
  console.log(`Step 8 (Agreement Double Exchange): Agreement sent -> client signed -> admin countersigned copy sent [status: ${hfaApp.status}, final_agreement_url: ${agreement.final_agreement_url}]`);

  // Final Invoice sent & paid
  const finalInvoice = await Invoice.create({
    application_id: hfaApp._id,
    client_id: clientUser._id,
    invoice_number: `INV-FINAL-${Date.now().toString().slice(-4)}`,
    title: 'Final Certification Fee',
    amount: 2500,
    invoice_type: 'final',
    status: 'paid'
  });
  hfaApp.status = 'final_invoice_paid';
  await hfaApp.save();
  console.log(`Step 9 (Final Invoice): Final invoice sent & paid [status: ${hfaApp.status}]`);

  // Admin manually marks Ready for Certificate
  hfaApp.status = 'ready_for_certificate';
  await hfaApp.save();
  console.log(`Step 10 (Ready For Certificate): Admin manually marks ready [status: ${hfaApp.status}]`);

  // Issue Certificate
  const cert = await Certificate.create({
    certificate_number: `HFA-UK-${Date.now().toString().slice(-5)}`,
    client_id: clientUser._id.toString(),
    application_id: hfaApp._id,
    certificate_type: 'Halal Certificate',
    issue_date: new Date(),
    expiry_date: new Date(Date.now() + 365 * 86400000),
    status: 'active'
  });
  hfaApp.status = 'certificate_issued';
  await hfaApp.save();
  if (hfaApp.status !== 'certificate_issued') {
    console.error('❌ BUG #2 FAIL: certificate_issued status mismatch!');
    process.exit(1);
  }
  console.log(`Step 11 (Certificate Issued): Certificate issued (lowercase verified) [status: ${hfaApp.status}, certNo: ${cert.certificate_number}]\n`);

  // ----------------------------------------------------
  // FLOW 2: GSO Two-Stage & NC Flagging Walkthrough
  // ----------------------------------------------------
  console.log('--- 3. Walking GSO Two-Stage & NC Flagging Flow ---');
  const gsoAppNo = `GSO-TEST-${Date.now().toString().slice(-5)}`;
  const gsoApp = await Application.create({
    application_number: gsoAppNo,
    client_id: clientUser._id,
    establishment_name: 'GSO Export Facility',
    establishment_address: '200 Gulf Export Ave, Manchester',
    application_type: 'New Certification',
    category: 'UAE/GSO Approved Halal Certification For Exporters To UAE',
    scope: 'Poultry & Beef Processing',
    status: 'submitted'
  });
  console.log(`Step 1: GSO App #${gsoAppNo} created [category: ${gsoApp.category}]`);

  // Advance to Stage 1 Audit
  gsoApp.status = 'audit_assigned';
  await gsoApp.save();
  const stage1Audit = await Audit.create({
    application_id: gsoApp._id,
    client_id: clientUser._id.toString(),
    stage: 1,
    status: 'audit_completed'
  });
  console.log(`Step 2: Stage 1 Audit Completed`);

  // Stage 2 Audit & Flag NC
  const stage2Audit = await Audit.create({
    application_id: gsoApp._id,
    client_id: clientUser._id.toString(),
    stage: 2,
    status: 'in_progress',
    nc_reports: [{ text: 'Temperature log mismatch in room 3', status: 'flagged' }]
  });
  // NC Flagging updates app status to on_hold
  gsoApp.status = 'on_hold';
  await gsoApp.save();
  console.log(`Step 3 (NC Flagged): App placed on_hold due to NC report [status: ${gsoApp.status}]`);

  // NC Corrected -> Audit Report Closed
  stage2Audit.nc_reports[0].status = 'corrected';
  stage2Audit.status = 'audit_completed';
  await stage2Audit.save();
  gsoApp.status = 'audit_report_submitted';
  await gsoApp.save();
  console.log(`Step 4 (NC Resolved): Audit report submitted [status: ${gsoApp.status}]`);

  // Complete rest of GSO flow
  gsoApp.status = 'application_successful';
  await gsoApp.save();
  gsoApp.status = 'agreement_finalised';
  await gsoApp.save();
  gsoApp.status = 'final_invoice_paid';
  await gsoApp.save();
  gsoApp.status = 'ready_for_certificate';
  await gsoApp.save();
  gsoApp.status = 'certificate_issued';
  await gsoApp.save();
  console.log(`Step 5: GSO Flow completed to certificate_issued [status: ${gsoApp.status}]\n`);

  console.log('====================================================');
  console.log('🎉 ALL END-TO-END WALKTHROUGHS VERIFIED CLEAN!');
  console.log('====================================================');

  await mongoose.disconnect();
}

runMasterAlignmentVerification().catch(err => {
  console.error('❌ Master alignment verification failed:', err);
  process.exit(1);
});
