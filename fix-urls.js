import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Application from './models/Application.js';
import Proposal from './models/Proposal.js';
import User from './models/User.js';

dotenv.config();

async function fixUrls() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB. Fixing URLs...');

    let fixedCount = 0;

    const fixUrl = (url) => {
      if (url && typeof url === 'string' && url.startsWith('http://localhost:5000/api/files/')) {
        fixedCount++;
        return url.replace('http://localhost:5000', '');
      }
      return url;
    };

    // 1. Proposals
    const proposals = await Proposal.find({});
    for (let p of proposals) {
      if (p.proposal_url && p.proposal_url.startsWith('http://localhost:5000')) {
        p.proposal_url = fixUrl(p.proposal_url);
        await p.save();
      }
    }

    // 2. Applications
    const applications = await Application.find({});
    for (let app of applications) {
      let changed = false;
      if (app.documents) {
        const keys = ['halal_policy', 'ingredient_list', 'floor_plan', 'company_registration', 'haccp_plan'];
        for (let key of keys) {
          if (app.documents[key] && app.documents[key].startsWith('http://localhost:5000')) {
            app.documents[key] = fixUrl(app.documents[key]);
            changed = true;
          }
        }
        if (app.documents.supporting_docs && Array.isArray(app.documents.supporting_docs)) {
          for (let i = 0; i < app.documents.supporting_docs.length; i++) {
            if (app.documents.supporting_docs[i] && app.documents.supporting_docs[i].startsWith('http://localhost:5000')) {
              app.documents.supporting_docs[i] = fixUrl(app.documents.supporting_docs[i]);
              changed = true;
            }
          }
        }
      }
      if (changed) {
        app.markModified('documents');
        await app.save();
      }
    }

    // 3. Users
    const users = await User.find({});
    for (let u of users) {
      if (u.avatar_url && u.avatar_url.startsWith('http://localhost:5000')) {
        u.avatar_url = fixUrl(u.avatar_url);
        await u.save();
      }
    }

    console.log(`Fixed ${fixedCount} URLs successfully.`);
    process.exit(0);
  } catch (err) {
    console.error('Failed to fix URLs:', err);
    process.exit(1);
  }
}

fixUrls();
