import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const STATUS_MAP = {
  'AUDIT DATE FINALIZED': 'date_finalized',
  'SEND CERTIFICATE': 'certificate_issued',
  'APPLICATION RECEIVED': 'submitted',
  'APPLICATION APPROVED/REJECT': 'under_review',
  'PROPOSAL SENT': 'proposal_sent',
  'PROPOSAL ACCEPTED/REJECTED': 'proposal_approved',
  'PROPOSAL REJECTED': 'proposal_rejected',
  'INVOICE SENT': 'invoice_sent',
  'PAYMENT RECEIVED': 'payment_received',
  'PROPOSE AUDIT DATE': 'dates_proposed',
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
  'INVOICE FOR FINAL PAYMENT SENT': 'final_invoice_sent',
  'FINAL PAYMENT RECEIVED': 'final_invoice_paid',
  'CERTIFICATE PROCESSING': 'certificate_issued',
};

async function runMigration() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI not found in env');
    process.exit(1);
  }

  await mongoose.connect(uri, { bufferCommands: false });
  console.log('✅ Connected to MongoDB');

  const col = mongoose.connection.db.collection('applications');
  const docs = await col.find({}).toArray();
  console.log(`📊 Inspected ${docs.length} application documents.`);

  let updatedCount = 0;
  for (const doc of docs) {
    if (STATUS_MAP[doc.status]) {
      const newStatus = STATUS_MAP[doc.status];
      console.log(`🔄 Migrating App #${doc.application_number || doc._id}: "${doc.status}" → "${newStatus}"`);
      
      const historyEntry = {
        status: newStatus,
        changedAt: new Date(),
        changedBy: null,
        note: `Migrated legacy status "${doc.status}" to "${newStatus}"`
      };

      await col.updateOne(
        { _id: doc._id },
        {
          $set: { status: newStatus, updated_at: new Date() },
          $push: { statusHistory: historyEntry }
        }
      );
      updatedCount++;
    }
  }

  console.log(`\n🎉 Migration Complete: ${updatedCount} records updated.`);
  await mongoose.disconnect();
}

runMigration().catch(err => {
  console.error('❌ Migration error:', err);
  process.exit(1);
});
