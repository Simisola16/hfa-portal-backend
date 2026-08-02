import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Application from '../models/Application.js';
import User from '../models/User.js';
import Proposal from '../models/Proposal.js';
import Invoice from '../models/Invoice.js';

dotenv.config();

async function setupUiTest() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB');

  // Client user
  let clientUser = await User.findOne({ email: 'client@hfa.com' });
  if (!clientUser) {
    clientUser = await User.create({
      full_name: 'Browser Test Client',
      email: 'client@hfa.com',
      company_name: 'Browser Test Foods Ltd',
      password: 'password123',
      role: 'client',
      is_active: true,
      is_verified: true
    });
  }

  // Admin user
  let adminUser = await User.findOne({ email: 'admin@hfa.com' });
  if (!adminUser) {
    adminUser = await User.create({
      full_name: 'Browser Test Admin',
      email: 'admin@hfa.com',
      username: 'admin',
      password: 'password123',
      role: 'admin',
      is_active: true,
      is_verified: true
    });
  }

  // 1. Create App requiring proposal response
  const propApp = await Application.create({
    application_number: `UI-PROP-${Date.now().toString().slice(-4)}`,
    client_id: clientUser._id,
    establishment_name: 'Browser Proposal Test Facility',
    establishment_address: '10 Test Lane, London',
    application_type: 'New Certification',
    category: 'Standard Halal Certification',
    scope: 'Meat Processing',
    status: 'proposal_sent'
  });

  await Proposal.create({
    application_id: propApp._id,
    client_id: clientUser._id.toString(),
    title: 'Halal Certification Proposal 2026',
    amount: 1500,
    estimated_cost: 1500,
    scope: 'Meat Processing',
    status: 'pending'
  });

  // 2. Create App requiring admin payment confirmation
  const payApp = await Application.create({
    application_number: `UI-PAY-${Date.now().toString().slice(-4)}`,
    client_id: clientUser._id,
    establishment_name: 'Browser Payment Test Facility',
    establishment_address: '20 Test Lane, Manchester',
    application_type: 'New Certification',
    category: 'Standard Halal Certification',
    scope: 'Bakery Processing',
    status: 'invoice_sent'
  });

  await Invoice.create({
    application_id: payApp._id,
    client_id: clientUser._id.toString(),
    invoice_number: `INV-UI-${Date.now().toString().slice(-4)}`,
    title: 'Initial Certification Invoice',
    amount: 1200,
    invoice_type: 'initial',
    status: 'client_paid',
    payment_proof_url: '/api/files/sample-receipt.pdf'
  });

  console.log('SETUP_COMPLETE');
  console.log(`PropApp ID: ${propApp._id}`);
  console.log(`PayApp ID: ${payApp._id}`);

  await mongoose.disconnect();
}

setupUiTest().catch(console.error);
