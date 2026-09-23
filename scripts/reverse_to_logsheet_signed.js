import connectDB from '../lib/db.js';
import Application from '../models/Application.js';
import ApplicationLogsheet from '../models/ApplicationLogsheet.js';
import Agreement from '../models/Agreement.js';
import User from '../models/User.js';

async function findAndReverse() {
  try {
    await connectDB();
    console.log('Connected to DB');

    // Find application by company name or application number
    const apps = await Application.find({
      $or: [
        { establishment_name: /Ade Food/i },
        { site_name: /Ade Food/i },
        { application_number: /91646/i },
        { application_number: /40783/i }
      ]
    }).populate('client_id');

    console.log(`Found ${apps.length} matching applications:`);
    for (const a of apps) {
      console.log(`- App: ${a.application_number} (${a._id}), establishment: ${a.establishment_name}, status: ${a.status}`);
      
      const logsheet = await ApplicationLogsheet.findOne({
        $or: [
          { application_id: a._id },
          { application_id: String(a._id) },
          ...(a.logsheet_id ? [{ _id: a.logsheet_id }] : [])
        ]
      });
      console.log(`  Logsheet: ${logsheet ? `${logsheet._id} (status: ${logsheet.status})` : 'None'}`);

      const agreement = await Agreement.findOne({ application_id: a._id });
      console.log(`  Agreement: ${agreement ? `${agreement._id} (status: ${agreement.status})` : 'None'}`);

      // Perform the reversal:
      // 1. If agreement exists, remove or reset it
      if (agreement) {
        await Agreement.findByIdAndDelete(agreement._id);
        console.log(`  Deleted Agreement ${agreement._id}`);
      }

      // 2. Ensure logsheet is marked as 'Signed' (or preserve 4 signatures)
      if (logsheet) {
        logsheet.status = 'Signed';
        await logsheet.save();
        console.log(`  Set logsheet status to 'Signed'`);
      }

      // 3. Set application status back to 'logsheet_signed'
      a.status = 'logsheet_signed';
      if (Array.isArray(a.statusHistory)) {
        // Remove any downstream history (agreement_sent, agreement_signed, etc.)
        a.statusHistory = a.statusHistory.filter(h => !['application_successful', 'agreement_sent', 'agreement_signed', 'agreement_finalised', 'final_invoice_sent', 'final_invoice_paid', 'ready_for_certificate', 'certificate_issued'].includes(h.status));
        a.statusHistory.push({
          status: 'logsheet_signed',
          changedAt: new Date(),
          note: 'Logsheet signed with all committee signatures. Ready for confirmation.'
        });
      }
      await a.save();
      console.log(`  Updated application ${a.application_number} status to 'logsheet_signed' ✅`);
    }

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

findAndReverse();
