import mongoose from 'mongoose';
import User from './models/User.js';
import dotenv from 'dotenv';

dotenv.config();

const cleanUsers = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    
    // Delete all users where role is not admin AND email is not admin@hfa.com
    // Just to be safe, we keep anything with role 'admin'
    const result = await User.deleteMany({ 
      $and: [
        { role: { $ne: 'admin' } },
        { email: { $ne: 'admin@hfa.com' } }
      ]
    });
    
    console.log(`Successfully deleted ${result.deletedCount} users.`);
    console.log('Remaining users:');
    const remaining = await User.find({}, 'email role');
    remaining.forEach(u => console.log(`- ${u.email} (${u.role})`));
    
    process.exit(0);
  } catch (error) {
    console.error('Error cleaning users:', error);
    process.exit(1);
  }
};

cleanUsers();
