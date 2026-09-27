import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns';

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

async function removeNonApiCompanies() {
  console.log('Connecting to MongoDB Atlas...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB successfully.\n');

  // Step 1: Fetch the 4 APIs to build the official whitelist
  console.log('📡 Fetching company data from the 4 official APIs...');
  const apiCids = new Set();
  const apiEmails = new Set();
  const apiCompanyNames = new Set();

  for (const url of urls) {
    let success = false;
    for (let retry = 0; retry < 5; retry++) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        console.log(`  ✓ Fetched ${data.length} records from ${url}`);
        data.forEach(r => {
          const cid = String(r.cid || r.CID || '').trim();
          if (cid) apiCids.add(cid);

          const email = String(r.ceaKingp || r.email || r.Email || '').trim().toLowerCase();
          if (email && email.includes('@')) apiEmails.add(email);

          const cName = String(r.cCompanyName || r.company_name || r.CompanyName || '').trim().toLowerCase();
          if (cName) apiCompanyNames.add(cName);
        });
        success = true;
        break;
      } catch (e) {
        console.warn(`    Retry ${retry + 1}/5 for ${url}: ${e.message}`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    if (!success) {
      throw new Error(`Failed to fetch from ${url} after 5 retries`);
    }
  }

  console.log('\n📊 4 APIs Whitelist Totals:');
  console.log(`  • Unique CIDs: ${apiCids.size}`);
  console.log(`  • Unique Emails: ${apiEmails.size}`);
  console.log(`  • Unique Company Names: ${apiCompanyNames.size}\n`);

  // Step 2: Identify client users in MongoDB to keep vs remove
  const allUsers = await User.find({}).lean();
  const clientUsers = allUsers.filter(u => u.role === 'client');
  const adminUsers = allUsers.filter(u => u.role !== 'client');

  console.log(`Current DB state:`);
  console.log(`  • Admin/Staff accounts (ALWAYS PRESERVED): ${adminUsers.length}`);
  console.log(`  • Client accounts in DB: ${clientUsers.length}\n`);

  const toKeep = [];
  const toRemove = [];

  for (const u of clientUsers) {
    const userEmail = (u.email || '').trim().toLowerCase();
    const userCompany = (u.company_name || '').trim().toLowerCase();
    const notes = u.notes || '';

    // Safety checks for McCain and Anike
    if (userEmail.includes('mccain') || userCompany.includes('mccain') ||
        userEmail.includes('anike') || userCompany.includes('anike')) {
      toKeep.push({ u, reason: 'Protected company (McCain / Anike)' });
      continue;
    }

    const cidMatch = notes.match(/CID:\s*(\w+)/i) || userEmail.match(/client_(\w+)@/i);
    const userCid = cidMatch ? cidMatch[1].trim() : null;

    let matched = false;
    let matchReason = '';

    if (userCid && apiCids.has(userCid)) {
      matched = true;
      matchReason = `CID match: ${userCid}`;
    } else if (userEmail && apiEmails.has(userEmail)) {
      matched = true;
      matchReason = `Email match: ${userEmail}`;
    } else if (userCompany && apiCompanyNames.has(userCompany)) {
      matched = true;
      matchReason = `Company Name match: ${userCompany}`;
    } else {
      const normUserComp = userCompany.replace(/[^a-z0-9]/g, '');
      if (normUserComp.length > 3) {
        for (const ac of apiCompanyNames) {
          const normAc = ac.replace(/[^a-z0-9]/g, '');
          if (normAc && (normAc === normUserComp || normAc.startsWith(normUserComp) || normUserComp.startsWith(normAc))) {
            matched = true;
            matchReason = `Fuzzy Name match: "${userCompany}" ~ "${ac}"`;
            break;
          }
        }
      }
    }

    if (matched) {
      toKeep.push({ u, reason: matchReason });
    } else {
      toRemove.push(u);
    }
  }

  console.log(`Results:`);
  console.log(`  • Companies to KEEP: ${toKeep.length}`);
  console.log(`  • Companies to REMOVE (not in 4 APIs): ${toRemove.length}\n`);

  if (toRemove.length === 0) {
    console.log('No companies found that need removal. All client companies match the 4 APIs!');
    await mongoose.disconnect();
    return;
  }

  console.log('Companies to be removed:');
  toRemove.forEach((u, idx) => {
    console.log(`  ${idx + 1}. [${u._id}] "${u.company_name}" | Email: ${u.email}`);
  });

  const removeIds = toRemove.map(u => u._id);

  console.log('\n🗑️  Executing Cascading Deletion...');

  // Collections with client_id
  const dSites = await Site.deleteMany({ client_id: { $in: removeIds } });
  console.log(`  • Deleted Sites: ${dSites.deletedCount}`);

  const dApps = await Application.deleteMany({ client_id: { $in: removeIds } });
  console.log(`  • Deleted Applications: ${dApps.deletedCount}`);

  const dCerts = await Certificate.deleteMany({ client_id: { $in: removeIds } });
  console.log(`  • Deleted Certificates: ${dCerts.deletedCount}`);

  const dProds = await Product.deleteMany({ client_id: { $in: removeIds } });
  console.log(`  • Deleted Products: ${dProds.deletedCount}`);

  const dAddOns = await AddOnApplication.deleteMany({ client_id: { $in: removeIds } });
  console.log(`  • Deleted AddOn Applications: ${dAddOns.deletedCount}`);

  const dLogsheets = await ApplicationLogsheet.deleteMany({ client_id: { $in: removeIds } });
  console.log(`  • Deleted Application Logsheets: ${dLogsheets.deletedCount}`);

  const dExpCerts = await ExportCertificate.deleteMany({ client_id: { $in: removeIds } });
  console.log(`  • Deleted Export Certificates: ${dExpCerts.deletedCount}`);

  const dExtApps = await ExtensionApplication.deleteMany({ client_id: { $in: removeIds } });
  console.log(`  • Deleted Extension Applications: ${dExtApps.deletedCount}`);

  const dExtLogs = await ExtensionLogsheet.deleteMany({ client_id: { $in: removeIds } });
  console.log(`  • Deleted Extension Logsheets: ${dExtLogs.deletedCount}`);

  const dInitProds = await InitialProductApplication.deleteMany({ client_id: { $in: removeIds } });
  console.log(`  • Deleted Initial Product Applications: ${dInitProds.deletedCount}`);

  const dProposals = await Proposal.deleteMany({ client_id: { $in: removeIds } });
  console.log(`  • Deleted Proposals: ${dProposals.deletedCount}`);

  const dAgreements = await Agreement.deleteMany({ client_id: { $in: removeIds } });
  console.log(`  • Deleted Agreements: ${dAgreements.deletedCount}`);

  const dInvoices = await Invoice.deleteMany({ client_id: { $in: removeIds } });
  console.log(`  • Deleted Invoices: ${dInvoices.deletedCount}`);

  const dAudits = await Audit.deleteMany({ client_id: { $in: removeIds } });
  console.log(`  • Deleted Audits: ${dAudits.deletedCount}`);

  const dTickets = await Ticket.deleteMany({ client_id: { $in: removeIds } });
  console.log(`  • Deleted Tickets: ${dTickets.deletedCount}`);

  const dNotifications = await Notification.deleteMany({ user_id: { $in: removeIds } });
  console.log(`  • Deleted Notifications: ${dNotifications.deletedCount}`);

  const dMessages = await Message.deleteMany({ $or: [{ sender_id: { $in: removeIds } }, { recipient_id: { $in: removeIds } }] });
  console.log(`  • Deleted Messages: ${dMessages.deletedCount}`);

  const dSurvReqs = await SurveillanceRequest.deleteMany({ client_id: { $in: removeIds } });
  console.log(`  • Deleted Surveillance Requests: ${dSurvReqs.deletedCount}`);

  const dSurvScheds = await SurveillanceSchedule.deleteMany({ client_id: { $in: removeIds } });
  console.log(`  • Deleted Surveillance Schedules: ${dSurvScheds.deletedCount}`);

  // Delete the client users themselves
  const dUsers = await User.deleteMany({ _id: { $in: removeIds } });
  console.log(`  • Deleted Client User accounts: ${dUsers.deletedCount}\n`);

  // Final Verification
  const remainingTotal = await User.countDocuments({});
  const remainingClients = await User.countDocuments({ role: 'client' });
  const remainingStaff = await User.countDocuments({ role: { $ne: 'client' } });

  console.log('====================================================');
  console.log('✅ CLEANUP VERIFICATION COMPLETE');
  console.log(`   • Total Users in DB: ${remainingTotal}`);
  console.log(`   • Total Clients in DB: ${remainingClients}`);
  console.log(`   • Total Staff/Admin in DB: ${remainingStaff}`);
  console.log('====================================================\n');

  // Verify McCain and Anike
  const mccain = await User.findOne({ email: 'shane.green@mccain.co.uk' });
  console.log('McCain Foods check:', mccain ? `✓ Preserved (${mccain.company_name})` : '✗ Missing!');

  const anike = await User.findOne({ email: 'anike@halalfoodauthority.com' });
  console.log('Anike International check:', anike ? `✓ Preserved (${anike.company_name})` : '✗ Missing!');

  await mongoose.disconnect();
}

removeNonApiCompanies().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
