import mongoose from 'mongoose';
import User from './models/User.js';
import dotenv from 'dotenv';

dotenv.config();

const seedAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    // Check by username first — prevents duplicate key errors on re-runs
    const existsByUsername = await User.findOne({ username: 'admin' });
    if (existsByUsername) {
      console.log('Admin user already exists (username: admin). No changes made.');
      process.exit(0);
    }

    // Also check by email in case an old seed (email-only) was run before
    const existsByEmail = await User.findOne({ email: 'admin@hfa.com' });
    if (existsByEmail) {
      // Patch the existing record to add username if it's missing
      if (!existsByEmail.username) {
        existsByEmail.username = 'admin';
        await existsByEmail.save();
        console.log('Existing admin account patched: username "admin" added.');
      } else {
        console.log('Admin already exists with username. No changes made.');
      }
      process.exit(0);
    }

    // Create fresh admin account
    const admin = new User({
      email: 'admin@hfa.com',
      username: 'admin',
      password: 'password123',
      full_name: 'HFA Admin',
      role: 'admin',
      is_verified: true,
      is_active: true,
    });

    await admin.save();
    console.log('✅ Admin user created successfully.');
    console.log('   Username : admin');
    console.log('   Password : password123');
    console.log('   Email    : admin@hfa.com');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding admin:', error);
    process.exit(1);
  }
};

seedAdmin();
