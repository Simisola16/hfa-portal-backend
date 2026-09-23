import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config({ path: './.env' });

async function backfill() {
  await mongoose.connect(process.env.MONGODB_URI);
  const ApplicationLogsheet = mongoose.model('ApplicationLogsheet', new mongoose.Schema({}, { strict: false }));
  const Application = mongoose.model('Application', new mongoose.Schema({}, { strict: false }));
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));

  const users = await User.find({ role: { $ne: 'client' } });
  console.log(`Found ${users.length} admin/staff users.`);

  // Map user search helpers
  const findUserByFuzzyName = (nameStr) => {
    if (!nameStr) return null;
    const clean = String(nameStr).toLowerCase().trim();
    for (const u of users) {
      const uName = (u.username || '').toLowerCase();
      const fName = (u.full_name || '').toLowerCase();
      const emailPrefix = (u.email || '').split('@')[0].toLowerCase();
      if (clean === uName || clean === fName || clean === emailPrefix) return u;
      if (clean.includes(uName) && uName.length > 2) return u;
      if (clean.includes(fName) && fName.length > 2) return u;
      if (fName.includes(clean) && clean.length > 2) return u;
      if (uName.includes(clean) && clean.length > 2) return u;
    }
    return null;
  };

  const defaultAdmin = users.find(u => u.username === 'admin' || u.role === 'superadmin') || users[0];

  const logsheets = await ApplicationLogsheet.find({});
  console.log(`Found ${logsheets.length} total logsheets to check/backfill.`);

  let updatedCount = 0;
  for (const log of logsheets) {
    if (log.created_by) {
      // Check if user exists
      const userExists = users.some(u => u._id.toString() === log.created_by.toString());
      if (userExists) continue;
    }

    let resolvedUser = null;

    // 1. Try to find from Application statusHistory
    if (log.application_id) {
      const app = await Application.findById(log.application_id);
      if (app && Array.isArray(app.statusHistory)) {
        const logEntry = app.statusHistory.find(s => s.status === 'logsheet_created' && s.changedBy);
        if (logEntry?.changedBy) {
          resolvedUser = users.find(u => u._id.toString() === logEntry.changedBy.toString());
        }
      }
    }

    // 2. Try to find from auditors
    if (!resolvedUser && log.auditors) {
      resolvedUser = findUserByFuzzyName(log.auditors);
    }

    // 3. Try to find from reviewer_name or reviewed_by
    if (!resolvedUser && log.reviewer_name && !log.reviewer_name.includes('HFA Admin')) {
      resolvedUser = findUserByFuzzyName(log.reviewer_name);
    }
    if (!resolvedUser && log.reviewed_by && !log.reviewed_by.includes('HFA Admin')) {
      resolvedUser = findUserByFuzzyName(log.reviewed_by);
    }

    // 4. Default fallback
    if (!resolvedUser) {
      resolvedUser = defaultAdmin;
    }

    await ApplicationLogsheet.updateOne(
      { _id: log._id },
      { $set: { created_by: resolvedUser._id } }
    );
    updatedCount++;
    console.log(`Logsheet ${log._id} (${log.company_name}) -> created_by set to @${resolvedUser.username} (${resolvedUser.full_name})`);
  }

  console.log(`\nBackfill complete! Updated ${updatedCount} logsheets.`);
  process.exit(0);
}

backfill().catch(console.error);
