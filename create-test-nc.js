import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Application from './models/Application.js';
import User from './models/User.js';
import Audit from './models/Audit.js';

dotenv.config();

async function run() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected.');

  const client = await User.findOne({ email: 'client@test.com' });
  if (!client) {
    console.error('Client client@test.com not found');
    process.exit(1);
  }

  const app = await Application.findOne({ application_number: 'HFA-PRO-2026' });
  if (!app) {
    console.error('Application HFA-PRO-2026 not found');
    process.exit(1);
  }

  // Update application status to audit_assigned
  app.status = 'audit_assigned';
  await app.save();

  // Remove old audits
  await Audit.deleteMany({ application_id: app._id });

  // Create a mock audit record
  const audit = new Audit({
    application_id: app._id,
    client_id: client._id.toString(),
    status: 'auditors_assigned',
    proposed_dates: [
      new Date('2026-08-10'),
      new Date('2026-08-12'),
      new Date('2026-08-15')
    ],
    selected_dates: [
      new Date('2026-08-10'),
      new Date('2026-08-12')
    ],
    finalized_date: new Date('2026-08-10'),
    auditors: [
      {
        name: 'Dr. Ahmad Halal',
        email: 'ahmad@hfaportal.com',
        contact_number: '+44 7700 900077',
        purpose: 'Lead Auditor',
        role: 'lead_auditor'
      },
      {
        name: 'Sh. Yusuf Sharia',
        email: 'yusuf@hfaportal.com',
        contact_number: '+44 7700 900088',
        purpose: 'Sharia Board Member',
        role: 'sharia_board'
      }
    ],
    nc_reports: [
      {
        text: 'Sanitisation records in Room B are incomplete for July 2026.',
        document_url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
        status: 'flagged',
        flagged_at: new Date('2026-07-15')
      },
      {
        text: 'Storage area lacks clear physical separation for non-halal raw materials (temporary transit).',
        document_url: '',
        status: 'flagged',
        flagged_at: new Date('2026-07-16')
      }
    ]
  });

  await audit.save();
  console.log('Created mock audit with NC reports for HFA-PRO-2026!');
  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
