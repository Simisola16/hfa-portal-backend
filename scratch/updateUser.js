import mongoose from 'mongoose';
import User from '../models/User.js';
import dotenv from 'dotenv';

dotenv.config();

const run = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to DB');

    let user = await User.findOne({ email: 'test@example.com' });
    if (!user) {
      console.log('Creating new user test@example.com');
      user = new User({
        email: 'test@example.com',
        full_name: 'Test User',
        company_name: 'Test Foods Ltd',
        role: 'client',
        is_active: true,
        is_verified: true,
        password: 'password123'
      });
    } else {
      console.log('Updating existing user test@example.com');
      user.is_active = true;
      user.is_verified = true;
      user.password = 'password123';
    }

    await user.save();
    console.log('User setup completed!');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
};

run();
