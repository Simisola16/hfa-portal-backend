import connectDB from '../lib/db.js';
import Application from '../models/Application.js';
import ApplicationLogsheet from '../models/ApplicationLogsheet.js';
import Agreement from '../models/Agreement.js';
import '../models/User.js'; // Register User schema for populate

async function reverseToLogsheetCreated() {
  try {
    await connectDB();
    console.log('✅ Connected to DB');

    // Find the Yeren Inc application by application number or establishment name
    const apps = await Application.find({
      $or: [
        { application_number: /HFA-AL-NE-25729/i },
        { establishment_name: /Yeren/i },
        { site_name: /Yeren/i }
      ]
    });

    if (apps.length === 0) {
      console.log('❌ No matching applications found for Yeren Inc.');
      process.exit(1);
    }

    console.log(`Found ${apps.length} matching application(s):`);

    for (const app of apps) {
      console.log(`\n📄 App: ${app.application_number} (${app._id})`);
      console.log(`   Establishment: ${app.establishment_name || app.site_name}`);
      console.log(`   Current Status: ${app.status}`);

      if (!['application_successful', 'logsheet_signed'].includes(app.status)) {
        console.log(`   ⚠️  Status is '${app.status}' — not in expected range. Proceeding anyway...`);
      }

      // Find associated logsheet
      const logsheet = await ApplicationLogsheet.findOne({
        $or: [
          { application_id: app._id },
          ...(app.logsheet_id ? [{ _id: app.logsheet_id }] : [])
        ]
      });
      console.log(`   Logsheet: ${logsheet ? `${logsheet._id} (status: ${logsheet.status})` : 'None found'}`);

      // Find associated agreement
      const agreement = await Agreement.findOne({ application_id: app._id });
      console.log(`   Agreement: ${agreement ? `${agreement._id} (status: ${agreement.status})` : 'None found'}`);

      // Step 1: Delete the agreement if it exists
      if (agreement) {
        await Agreement.findByIdAndDelete(agreement._id);
        console.log(`   🗑️  Deleted Agreement ${agreement._id}`);
      }

      // Step 2: Reset the logsheet status back to 'Waiting for Signature' and clear all signatures
      if (logsheet) {
        logsheet.status = 'Waiting for Signature';
        // Clear all committee signatures
        logsheet.mufti_signature = undefined;
        logsheet.mufti_sign_name = undefined;
        logsheet.mufti_sign_date = undefined;
        logsheet.ceo_signature = undefined;
        logsheet.ceo_sign_name = undefined;
        logsheet.ceo_sign_date = undefined;
        logsheet.manager_signature = undefined;
        logsheet.manager_sign_name = undefined;
        logsheet.manager_sign_date = undefined;
        logsheet.mufti2_signature = undefined;
        logsheet.mufti2_sign_name = undefined;
        logsheet.mufti2_sign_date = undefined;
        await logsheet.save();
        console.log(`   📋 Logsheet status reset to 'Waiting for Signature', all signatures cleared`);
      }

      // Step 3: Reverse application status to 'logsheet_created'
      app.status = 'logsheet_created';

      if (Array.isArray(app.statusHistory)) {
        // Strip out downstream statuses from history
        const downstreamStatuses = [
          'logsheet_signed',
          'application_successful',
          'agreement_sent',
          'agreement_signed',
          'agreement_finalised',
          'final_invoice_sent',
          'final_invoice_paid',
          'ready_for_certificate',
          'certificate_issued'
        ];
        const before = app.statusHistory.length;
        app.statusHistory = app.statusHistory.filter(
          h => !downstreamStatuses.includes(h.status)
        );
        const removed = before - app.statusHistory.length;
        console.log(`   🧹 Removed ${removed} downstream status history entries`);

        // Add a new status history entry for the reversal
        app.statusHistory.push({
          status: 'logsheet_created',
          changedAt: new Date(),
          note: 'Status reversed to Logsheet Created. Awaiting committee signatures.'
        });
      }

      await app.save();
      console.log(`   ✅ Application ${app.application_number} reversed to 'logsheet_created'`);
    }

    console.log('\n🎉 Reversal complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error during reversal:', err);
    process.exit(1);
  }
}

reverseToLogsheetCreated();
