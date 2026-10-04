import mongoose from 'mongoose';
import dotenv from 'dotenv';
import './models/User.js';
import './models/Site.js';
import './models/Certificate.js';
import './models/ExtensionLogsheet.js';
import './models/ExtensionApplication.js';
import './models/Application.js';
import './models/ApplicationLogsheet.js';
import Certificate from './models/Certificate.js';
import ExtensionApplication from './models/ExtensionApplication.js';

dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB');

  // Find the latest extension application
  const ext = await ExtensionApplication.findById('6ac24e1bf0417491491511b0').lean();
  console.log('Found extension:', ext._id, ext.company_name, ext.site_id, ext.client_id);

  // Check existing certificates with this extension application
  const existing = await Certificate.find({ extension_application_id: ext._id }).lean();
  console.log('Existing certs for this extension:', existing.map(c => ({ _id: c._id, num: c.certificate_number, status: c.status })));

  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
