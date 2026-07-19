/**
 * migrate-statuses.js
 * One-time migration: maps old free-text status strings to the new 14-value enum.
 * Run with: node migrate-statuses.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const VALID_STATUSES = [
  'submitted', 'under_review', 'rejected', 'approved',
  'proposal_sent', 'proposal_rejected', 'proposal_approved',
  'invoice_sent', 'audit_assigned', 'audit_report_submitted',
  'logsheet_created', 'logsheet_signed', 'agreement_sent',
  'agreement_signed', 'certificate_issued',
];

// Map old strings → closest new value
const STATUS_MAP = {
  'APPLICATION RECEIVED': 'submitted',
  'APPLICATION APPROVED/REJECT': 'under_review',
  'PROPOSAL SENT': 'proposal_sent',
  'PROPOSAL ACCEPTED/REJECTED': 'proposal_approved',
  'PROPOSAL REJECTED': 'proposal_rejected',
  'INVOICE SENT': 'invoice_sent',
  'PAYMENT RECEIVED': 'invoice_sent',
  'PROPOSE AUDIT DATE': 'audit_assigned',
  'AUDIT DATE FINALIZED': 'audit_assigned',
  'ASSIGN AUDITOR': 'audit_assigned',
  'AUDITED': 'audit_report_submitted',
  'NC REPORTS': 'audit_report_submitted',
  'NC REPORTS CLOSED': 'audit_report_submitted',
  'AUDIT REPORT SUBMITTED': 'audit_report_submitted',
  'APPLICATION SUCCESSFUL/UNSUCCESSFUL': 'approved',
  'Create Logsheet': 'logsheet_created',
  'AGREEMENT SENT': 'agreement_sent',
  'SIGNED COPY OF AGREEMENT SENT': 'agreement_sent',
  'AGREEMENT SIGNED COPY RECEIVED': 'agreement_signed',
  'INVOICE FOR FINAL PAYMENT SENT': 'invoice_sent',
  'FINAL PAYMENT RECEIVED': 'invoice_sent',
  'CERTIFICATE PROCESSING': 'certificate_issued',
  'SEND CERTIFICATE': 'certificate_issued',
  'on_hold': 'under_review',
  'audit_scheduled': 'audit_assigned',
  'audit_completed': 'audit_report_submitted',
};

async function migrate() {
  await mongoose.connect(process.env.MONGODB_URI, { bufferCommands: false });
  console.log('✅ Connected to MongoDB');

  const db = mongoose.connection.db;
  const col = db.collection('applications');

  const all = await col.find({}).toArray();
  console.log(`\n📊 Total application documents: ${all.length}`);

  const needsMigration = all.filter(doc => !VALID_STATUSES.includes(doc.status));
  console.log(`🔍 Documents with non-enum status: ${needsMigration.length}`);

  if (needsMigration.length === 0) {
    console.log('✅ No migration needed — all documents have valid status values.');
    await mongoose.disconnect();
    return;
  }

  console.log('\nDocuments to migrate:');
  needsMigration.forEach(doc => {
    const mapped = STATUS_MAP[doc.status] || 'submitted';
    console.log(`  ${doc.application_number || doc._id}: "${doc.status}" → "${mapped}"`);
  });

  console.log('\nApplying migration...');
  let updated = 0;
  for (const doc of needsMigration) {
    const newStatus = STATUS_MAP[doc.status] || 'submitted';
    const historyEntry = {
      status: newStatus,
      changedAt: doc.created_at || new Date(),
      changedBy: null,
      note: `Migrated from legacy status: "${doc.status}"`,
    };
    await col.updateOne(
      { _id: doc._id },
      {
        $set: { status: newStatus, updated_at: new Date() },
        $push: { statusHistory: historyEntry },
      }
    );
    updated++;
  }

  console.log(`\n✅ Migration complete — ${updated} documents updated.`);
  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
});
