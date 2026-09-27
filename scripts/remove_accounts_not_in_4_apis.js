import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns';
import fs from 'fs';

dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import User from '../models/User.js';
import Site from '../models/Site.js';
import Application from '../models/Application.js';
import Certificate from '../models/Certificate.js';
import Product from '../models/Product.js';
import AddOnApplication from '../models/AddOnApplication.js';
import ApplicationLogsheet from '../models/ApplicationLogsheet.js';
import ExportCertificate from '../models/ExportCertificate.js';
import ExtensionApplication from '../models/ExtensionApplication.js';
import ExtensionLogsheet from '../models/ExtensionLogsheet.js';
import InitialProductApplication from '../models/InitialProductApplication.js';
import Proposal from '../models/Proposal.js';
import Agreement from '../models/Agreement.js';
import Invoice from '../models/Invoice.js';
import Audit from '../models/Audit.js';
import Ticket from '../models/Ticket.js';
import Notification from '../models/Notification.js';
import Message from '../models/Message.js';
import SurveillanceRequest from '../models/SurveillanceRequest.js';
import SurveillanceSchedule from '../models/SurveillanceSchedule.js';

const urls = [
  'https://app.hfa-portal.com/api/Crpirs/loadcomp/False/Cert/None',
  'https://app.hfa-portal.com/api/Crpirs/loadcomp/False/NRL/None',
  'https://app.hfa-portal.com/api/Crpirs/loadcomp/Yes/None/None',
  'https://app.hfa-portal.com/api/Crpirs/loadcomp/True/Processing/None'
];

async function run() {
  console.log('Connecting to MongoDB Atlas...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB successfully.\n');

  // Step 1: Build the definitive email whitelist from the 4 APIs
  console.log('📡 Fetching company data from the 4 official APIs...');
  const apiEmails = new Set();
  const apiData = [];

  for (const url of urls) {
    let fetched = false;
    for (let retry = 0; retry < 5; retry++) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        console.log(`  ✓ Fetched ${data.length} records from ${url}`);
        data.forEach(r => {
          apiData.push(r);
          const email = String(r.ceaKingp || r.email || r.Email || '').trim().toLowerCase();
          if (email && email.includes('@')) {
            apiEmails.add(email);
          }
        });
        fetched = true;
        break;
      } catch (e) {
        console.warn(`    Retry ${retry + 1}/5 for ${url}: ${e.message}`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    if (!fetched) {
      console.warn(`Could not reach ${url} live, falling back to cache.`);
      const cachePath = path.resolve(__dirname, '../scratch/loadcomp_companies_cache.json');
      if (fs.existsSync(cachePath)) {
        const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        cached.forEach(r => {
          const email = String(r.ceaKingp || r.email || r.Email || '').trim().toLowerCase();
          if (email && email.includes('@')) {
            apiEmails.add(email);
          }
        });
      }
    }
  }

  // Also include protected emails from legacy setup (McCain / Anike)
  apiEmails.add('mccain@halalfoodauthority.com');
  apiEmails.add('shane.green@mccain.co.uk');
  apiEmails.add('anike@halalfoodauthority.com');

  console.log(`\n📊 4 APIs Whitelist:`);
  console.log(`  • Total Valid Unique Emails: ${apiEmails.size}\n`);

  // Step 2: Fetch all users in DB
  const allUsers = await User.find({}).lean();
  const staffOrAdminUsers = allUsers.filter(u => ['admin', 'superadmin', 'auditor', 'staff', 'food_tech', 'food_tech_manager', 'inspector'].includes(u.role));
  const clientAccounts = allUsers.filter(u => !['admin', 'superadmin', 'auditor', 'staff', 'food_tech', 'food_tech_manager', 'inspector'].includes(u.role));

  console.log(`Current DB State:`);
  console.log(`  • Staff/Admin Accounts (PRESERVED): ${staffOrAdminUsers.length}`);
  console.log(`  • Total Client Accounts (Companies & Users): ${clientAccounts.length}\n`);

  const accountsToKeep = [];
  const accountsToRemove = [];

  for (const u of clientAccounts) {
    const email = (u.email || '').trim().toLowerCase();
    if (apiEmails.has(email)) {
      accountsToKeep.push(u);
    } else {
      accountsToRemove.push(u);
    }
  }

  console.log(`Audit Breakdown:`);
  console.log(`  • Accounts matching 4 APIs emails (KEEP): ${accountsToKeep.length}`);
  console.log(`  • Accounts whose email is NOT in 4 APIs (REMOVE): ${accountsToRemove.length}\n`);

  if (accountsToRemove.length === 0) {
    console.log('No accounts to remove! Database is already strictly aligned with the 4 APIs.');
    await mongoose.disconnect();
    return;
  }

  // Split into parent companies and sub-users
  const parentsToRemove = accountsToRemove.filter(u => !u.parent_client_id);
  const subUsersToRemove = accountsToRemove.filter(u => u.parent_client_id);

  console.log(`Details of Accounts to Remove:`);
  console.log(`  • Parent Companies to remove: ${parentsToRemove.length}`);
  console.log(`  • Sub-users / Members to remove: ${subUsersToRemove.length}\n`);

  // Build ID list (both ObjectId and String representations to handle Mixed types)
  const removeObjectIds = accountsToRemove.map(u => u._id);
  const removeStringIds = accountsToRemove.map(u => u._id.toString());
  const allRemoveIdVariants = [...removeObjectIds, ...removeStringIds];

  console.log('🗑️  Executing Cascading Deletion of Data...');

  // Collections with client_id
  const dSites = await Site.deleteMany({ client_id: { $in: allRemoveIdVariants } });
  console.log(`  • Deleted Sites: ${dSites.deletedCount}`);

  const dApps = await Application.deleteMany({ client_id: { $in: allRemoveIdVariants } });
  console.log(`  • Deleted Applications: ${dApps.deletedCount}`);

  const dCerts = await Certificate.deleteMany({ client_id: { $in: allRemoveIdVariants } });
  console.log(`  • Deleted Certificates: ${dCerts.deletedCount}`);

  const dProds = await Product.deleteMany({ client_id: { $in: allRemoveIdVariants } });
  console.log(`  • Deleted Products: ${dProds.deletedCount}`);

  const dAddOns = await AddOnApplication.deleteMany({ client_id: { $in: allRemoveIdVariants } });
  console.log(`  • Deleted AddOn Applications: ${dAddOns.deletedCount}`);

  const dLogsheets = await ApplicationLogsheet.deleteMany({ client_id: { $in: allRemoveIdVariants } });
  console.log(`  • Deleted Application Logsheets: ${dLogsheets.deletedCount}`);

  const dExpCerts = await ExportCertificate.deleteMany({ client_id: { $in: allRemoveIdVariants } });
  console.log(`  • Deleted Export Certificates: ${dExpCerts.deletedCount}`);

  const dExtApps = await ExtensionApplication.deleteMany({ client_id: { $in: allRemoveIdVariants } });
  console.log(`  • Deleted Extension Applications: ${dExtApps.deletedCount}`);

  const dExtLogs = await ExtensionLogsheet.deleteMany({ client_id: { $in: allRemoveIdVariants } });
  console.log(`  • Deleted Extension Logsheets: ${dExtLogs.deletedCount}`);

  const dInitProds = await InitialProductApplication.deleteMany({ client_id: { $in: allRemoveIdVariants } });
  console.log(`  • Deleted Initial Product Applications: ${dInitProds.deletedCount}`);

  const dProposals = await Proposal.deleteMany({ client_id: { $in: allRemoveIdVariants } });
  console.log(`  • Deleted Proposals: ${dProposals.deletedCount}`);

  const dAgreements = await Agreement.deleteMany({ client_id: { $in: allRemoveIdVariants } });
  console.log(`  • Deleted Agreements: ${dAgreements.deletedCount}`);

  const dInvoices = await Invoice.deleteMany({ client_id: { $in: allRemoveIdVariants } });
  console.log(`  • Deleted Invoices: ${dInvoices.deletedCount}`);

  const dAudits = await Audit.deleteMany({ client_id: { $in: allRemoveIdVariants } });
  console.log(`  • Deleted Audits: ${dAudits.deletedCount}`);

  const dTickets = await Ticket.deleteMany({ client_id: { $in: allRemoveIdVariants } });
  console.log(`  • Deleted Tickets: ${dTickets.deletedCount}`);

  const dNotifications = await Notification.deleteMany({ user_id: { $in: allRemoveIdVariants } });
  console.log(`  • Deleted Notifications: ${dNotifications.deletedCount}`);

  const dMessages = await Message.deleteMany({
    $or: [
      { sender_id: { $in: allRemoveIdVariants } },
      { recipient_id: { $in: allRemoveIdVariants } }
    ]
  });
  console.log(`  • Deleted Messages: ${dMessages.deletedCount}`);

  const dSurvReqs = await SurveillanceRequest.deleteMany({ client_id: { $in: allRemoveIdVariants } });
  console.log(`  • Deleted Surveillance Requests: ${dSurvReqs.deletedCount}`);

  const dSurvScheds = await SurveillanceSchedule.deleteMany({ client_id: { $in: allRemoveIdVariants } });
  console.log(`  • Deleted Surveillance Schedules: ${dSurvScheds.deletedCount}`);

  // Delete the User accounts themselves
  const dUsers = await User.deleteMany({ _id: { $in: removeObjectIds } });
  console.log(`  • Deleted User Accounts: ${dUsers.deletedCount}\n`);

  // Final Verification
  const remainingTotal = await User.countDocuments({});
  const remainingClients = await User.countDocuments({ role: 'client' });
  const remainingStaff = await User.countDocuments({ role: { $ne: 'client' } });

  console.log('====================================================');
  console.log('✅ CLEANUP VERIFICATION COMPLETE');
  console.log(`   • Total Users in DB: ${remainingTotal}`);
  console.log(`   • Total Client Accounts in DB: ${remainingClients}`);
  console.log(`   • Total Staff/Admin in DB: ${remainingStaff}`);
  console.log('====================================================\n');

  // Verify sample companies
  const huel = await User.findOne({ email: 'kirsty@huel.com' });
  console.log('Huel Ltd check:', huel ? `✓ Preserved (${huel.company_name})` : '✗ Missing!');

  const basildon = await User.findOne({ email: 'adedoyin.tinubu@momentive.com' });
  console.log('Basildon Chemical check:', basildon ? `✓ Preserved (${basildon.company_name})` : '✗ Missing!');

  const mccain = await User.findOne({ email: 'mccain@halalfoodauthority.com' });
  console.log('McCain Foods check:', mccain ? `✓ Preserved (${mccain.company_name})` : '✗ Missing!');

  const anike = await User.findOne({ email: 'anike@halalfoodauthority.com' });
  console.log('Anike International check:', anike ? `✓ Preserved (${anike.company_name})` : '✗ Missing!');

  await mongoose.disconnect();
}

run().catch(err => {
  console.error('Fatal error during execution:', err);
  process.exit(1);
});
