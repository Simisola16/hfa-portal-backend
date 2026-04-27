import mongoose from 'mongoose';
import User from './models/User.js';
import dotenv from 'dotenv';

dotenv.config();

const listUsers = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const users = await User.find({}, 'email full_name company_name role created_at is_active');
    
    if (users.length === 0) {
      console.log('No users found in the database.');
    } else {
      console.log('--- REGISTERED USERS ---');
      users.forEach((u, i) => {
        console.log(`${i + 1}. Email: ${u.email} | Name: ${u.full_name || 'N/A'} | Role: ${u.role} | Active: ${u.is_active !== false}`);
      });
      console.log('------------------------');
    }
    process.exit(0);
  } catch (error) {
    console.error('Error fetching users:', error);
    process.exit(1);
  }
};

listUsers();
