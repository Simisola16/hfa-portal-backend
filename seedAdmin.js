import mongoose from 'mongoose';
import User from './models/User.js';
import dotenv from 'dotenv';

dotenv.config();

const seedAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    
    const adminExists = await User.findOne({ email: 'admin@hfa.com' });
    if (adminExists) {
      console.log('Admin already exists');
      process.exit(0);
    }

    const admin = new User({
      email: 'admin@hfa.com',
      password: 'password123',
      full_name: 'HFA Admin',
      role: 'admin'
    });

    await admin.save();
    console.log('Admin user created: admin@hfa.com / password123');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding admin:', error);
    process.exit(1);
  }
};

seedAdmin();
