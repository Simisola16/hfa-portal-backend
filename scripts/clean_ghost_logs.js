import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Admin from '../models/Admin.js';
import ImpersonationLog from '../models/ImpersonationLog.js';
import UserActivityLog from '../models/UserActivityLog.js';

dotenv.config();

async function clean() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/hfa_portal';
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  const basic = await Admin.findOne({
    $or: [{ username: 'basic' }, { email: 'basic@hfa.internal' }, { is_ghost: true }]
  });

  const queryOr = [
    { admin_email: 'basic@hfa.internal' },
    { admin_username: 'basic' },
    { admin_name: 'Basic Super Admin' }
  ];

  if (basic) {
    queryOr.push({ admin_id: basic._id });
  }

  const impRes = await ImpersonationLog.deleteMany({ $or: queryOr });
  console.log('Deleted ImpersonationLog entries:', impRes.deletedCount);

  const actOr = [
    { email: 'basic@hfa.internal' },
    { username: 'basic' },
    { name: 'Basic Super Admin' }
  ];
  if (basic) {
    actOr.push({ user_id: basic._id });
  }

  const actRes = await UserActivityLog.deleteMany({ $or: actOr });
  console.log('Deleted UserActivityLog entries:', actRes.deletedCount);

  await mongoose.disconnect();
  console.log('Done!');
}

clean().catch(err => {
  console.error('Clean error:', err);
  process.exit(1);
});
