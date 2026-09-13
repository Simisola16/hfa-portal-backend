import connectDB from '../lib/db.js';
import ExtensionApplication from '../models/ExtensionApplication.js';
import ExtensionLogsheet from '../models/ExtensionLogsheet.js';
import Certificate from '../models/Certificate.js';

async function resetExtension() {
  try {
    await connectDB();
    console.log('🍃 Connected to DB');

    const appNumber = 'EXT-2026-0001';
    const app = await ExtensionApplication.findOne({ application_number: appNumber });

    if (!app) {
      console.error(`Application ${appNumber} not found!`);
      process.exit(1);
    }

    console.log(`Found application: ${app.application_number} (${app._id})`);

    // 1. Delete linked Certificate if it was issued
    if (app.certificate_id || app.certificate_number) {
      const certRes = await Certificate.deleteMany({
        $or: [
          { _id: app.certificate_id },
          { certificate_number: app.certificate_number }
        ]
      });
      console.log(`Deleted certificate: count=${certRes.deletedCount}`);
    }

    // 2. Reset Logsheet back to Draft with cleared signatures
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

    // 3. Reset ExtensionApplication back to 'submitted' (Extension Form Received)
    app.status = 'submitted';
    app.certificate_id = undefined;
    app.certificate_number = undefined;
    app.certificate_url = undefined;
    app.expiry_date = undefined;
    app.extended_until = undefined;
    app.rejection_reason = undefined;
    app.statusHistory = [{
      status: 'submitted',
      changedAt: app.created_at || new Date(),
      changedBy: app.client_id,
      note: 'Extension application submitted by client'
    }];

    await app.save();
    console.log(`✅ Successfully reset ${appNumber} back to 'submitted' (Extension Form Received)`);

    process.exit(0);
  } catch (err) {
    console.error('Error resetting extension application:', err);
    process.exit(1);
  }
}

resetExtension();
