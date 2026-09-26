/**
 * reset_and_reseed.js
 * ─────────────────────────────────────────────────────────────────────
 * 1. Connects to MongoDB (from .env)
 * 2. Drops ALL application data collections (preserving nothing)
 * 3. Re-creates the admin user (admin / Password123!)
 * 4. Runs the full company migration from the HFA API + SQL export
 * ─────────────────────────────────────────────────────────────────────
 * Usage: node scripts/reset_and_reseed.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import dns from 'dns';

dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

// ─── All collections to drop ──────────────────────────────────────────────────
const COLLECTIONS_TO_DROP = [
  'users',
  'sites',
  'applications',
  'applicationlogsheets',
  'certificates',
  'products',
  'addonapplications',
  'exportcertificates',
  'invoices',
  'audits',
  'agreements',
  'extensionapplications',
  'extensionlogsheets',
  'initialproductapplications',
  'inspectors',
  'logsheets',
  'messages',
  'notifications',
  'proposals',
  'signatures',
  'surveillancerequests',
  'surveillanceschedules',
  'tickets',
  'impersonationcodes',
  'impersonationlogs',
];

async function resetDatabase() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI is not set in .env');

  console.log('\n=============================================================================');
  console.log('⚠️  HFA DATABASE RESET + FULL RESEED');
  console.log('=============================================================================');
  console.log(`🔗 Connecting to: ${mongoUri.replace(/:([^@]+)@/, ':***@')}`);

  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 30000 });
  console.log(`✅ Connected to database: "${mongoose.connection.name}"\n`);

  // ── Step 1: Drop all collections ──────────────────────────────────────────
  console.log('🗑️  Step 1: Dropping all data collections...');
  const db = mongoose.connection.db;
  const existingCollections = (await db.listCollections().toArray()).map(c => c.name);

  let dropped = 0;
  for (const name of COLLECTIONS_TO_DROP) {
    if (existingCollections.includes(name)) {
      await db.collection(name).drop();
      console.log(`   ✓ Dropped: ${name}`);
      dropped++;
    } else {
      console.log(`   – Skipped (not found): ${name}`);
    }
  }
  console.log(`\n   ✅ Dropped ${dropped} collections.\n`);

  // ── Step 2: Re-create admin user ───────────────────────────────────────────
  console.log('🔐 Step 2: Creating admin user...');

  // Import the User model fresh after dropping
  const { default: User } = await import('../models/User.js');

  const adminEmail    = process.env.ADMIN_EMAIL    || 'admin@hfa.com';
  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Password123!';

  const hashedPassword = await bcrypt.hash(adminPassword, 10);

  const adminUser = await User.create({
    email:          adminEmail,
    username:       adminUsername,
    password:       hashedPassword,
    role:           'admin',
    full_name:      'HFA Administrator',
    is_verified:    true,
    email_verified: true,
    status:         'active',
  });

  console.log(`   ✅ Admin created:`);
  console.log(`      Username : ${adminUsername}`);
  console.log(`      Email    : ${adminEmail}`);
  console.log(`      Password : ${adminPassword}`);
  console.log(`      Role     : admin\n`);

  await mongoose.disconnect();

  // ── Step 3: Run full company migration ────────────────────────────────────
  console.log('🚀 Step 3: Starting full company migration...\n');

  // Dynamically import and run the import script
  // (It reconnects to MongoDB itself)
  await import('./import_all_companies_to_mongodb.js');
}

resetDatabase().catch(err => {
  console.error('\n❌ FATAL ERROR during reset:', err);
  process.exit(1);
});
