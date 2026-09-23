import connectDB from '../lib/db.js';
import '../models/User.js';
import ExtensionApplication from '../models/ExtensionApplication.js';
import ExtensionLogsheet from '../models/ExtensionLogsheet.js';
import Certificate from '../models/Certificate.js';

async function reverseToLogsheet() {
  try {
    await connectDB();
    console.log('🍃 Connected to MongoDB');

    const appNumber = 'HFA-AL-EX-64704';
    const app = await ExtensionApplication.findOne({ application_number: appNumber });

    if (!app) {
      console.error(`Application ${appNumber} not found!`);
      process.exit(1);
    }

    console.log(`Found application: ${app.application_number} (${app._id}), current status: ${app.status}`);

    // 1. Remove any linked certificate
    if (app.certificate_id || app.certificate_number) {
      const certRes = await Certificate.deleteMany({
        $or: [
          { _id: app.certificate_id },
          { certificate_number: app.certificate_number }
        ]
      });
      console.log(`Deleted certificate: count=${certRes.deletedCount}`);
    }

    // 2. Reset Logsheet to Draft and clear signatures
    const logsheet = await ExtensionLogsheet.findOne({ extension_application_id: app._id });
    if (logsheet) {
      logsheet.status = 'Draft';
      logsheet.single_signature = null;
      logsheet.single_sign_name = '';
      logsheet.single_sign_date = null;
      logsheet.mufti_signature = null;
      logsheet.mufti_sign_name = '';
      logsheet.mufti_sign_date = null;
      logsheet.ceo_signature = null;
      logsheet.ceo_sign_name = '';
      logsheet.ceo_sign_date = null;
      logsheet.manager_signature = null;
      logsheet.manager_sign_name = '';
      logsheet.manager_sign_date = null;
      logsheet.mufti2_signature = null;
      logsheet.mufti2_sign_name = '';
      logsheet.mufti2_sign_date = null;
      await logsheet.save();
      console.log(`Reset logsheet ${logsheet._id} to Draft with cleared signatures.`);
    }

    // 3. Set ExtensionApplication back to 'under_review' (Stage 2: Create Logsheet)
    app.status = 'under_review';
    app.certificate_id = undefined;
    app.certificate_number = undefined;
    app.certificate_url = undefined;
    app.expiry_date = undefined;
    app.extended_until = undefined;
    app.rejection_reason = undefined;

    // Filter out waiting_signature or subsequent events from statusHistory
    const initialHist = app.statusHistory?.filter(h => h.status === 'submitted' || h.status === 'under_review') || [];
    if (!initialHist.some(h => h.status === 'under_review')) {
      initialHist.push({
        status: 'under_review',
        changedAt: new Date(),
        note: 'Extension request approved by admin. Ready for logsheet creation.'
      });
    }
    app.statusHistory = initialHist;

    await app.save();
    console.log(`✅ Successfully reversed ${appNumber} back to 'under_review' (Stage 2: Create Logsheet).`);

    process.exit(0);
  } catch (err) {
    console.error('Error reversing extension application:', err);
    process.exit(1);
  }
}

reverseToLogsheet();
