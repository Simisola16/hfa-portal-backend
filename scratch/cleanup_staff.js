import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';

dotenv.config();

async function cleanupStaff() {
  console.log('=== CLEANING UP HFA STAFF ACCOUNTS ===\n');

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB Database');

  const staffRoles = ['admin', 'superadmin', 'food_tech_manager', 'food_tech', 'inspector'];

  // 1. Find or update the primary admin account (username: admin)
  let primaryAdmin = await User.findOne({ username: 'admin' });
  if (!primaryAdmin) {
    primaryAdmin = await User.findOne({ email: 'admin@hfa.com' });
  }

  if (primaryAdmin) {
    primaryAdmin.username = 'admin';
    primaryAdmin.email = 'admin@hfa.com';
    primaryAdmin.password = 'password123'; // Mongoose pre('save') hook hashes this automatically
    primaryAdmin.role = 'superadmin';
    primaryAdmin.is_active = true;
    primaryAdmin.is_verified = true;
    if (!primaryAdmin.full_name) primaryAdmin.full_name = 'HFA Admin';
    await primaryAdmin.save();
    console.log(`✅ Primary Admin updated: username "admin", email "admin@hfa.com", password "password123", role "superadmin"`);
  } else {
    primaryAdmin = await User.create({
      username: 'admin',
      email: 'admin@hfa.com',
      password: 'password123',
      full_name: 'HFA Admin',
      role: 'superadmin',
      is_active: true,
      is_verified: true
    });
    console.log(`✅ Created new Primary Admin: username "admin", email "admin@hfa.com", password "password123", role "superadmin"`);
  }

  // 2. Delete all other staff accounts except the primary admin
  const deleteResult = await User.deleteMany({
    role: { $in: staffRoles },
    _id: { $ne: primaryAdmin._id }
  });

  console.log(`🗑️ Deleted ${deleteResult.deletedCount} non-primary staff accounts.`);

  // 3. Print remaining staff accounts
  const remainingStaff = await User.find({ role: { $in: staffRoles } });
  console.log(`\nRemaining Staff Accounts (${remainingStaff.length}):`);
  remainingStaff.forEach(u => {
    console.log(`  - Username: "${u.username}" | Email: "${u.email}" | Name: "${u.full_name}" | Role: "${u.role}" | Active: ${u.is_active}`);
  });

  console.log('\n=== CLEANUP COMPLETE ===');
  await mongoose.disconnect();
}

cleanupStaff().catch(err => {
  console.error('Error during cleanup:', err);
  process.exit(1);
});
