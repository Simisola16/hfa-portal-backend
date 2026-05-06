import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Application from './models/Application.js';
import Proposal from './models/Proposal.js';
import User from './models/User.js';
import { uploadToGridFS } from './lib/gridfs.js';

dotenv.config();

import cloudinary from './lib/cloudinary.js';

const getFileName = (url) => {
  try {
    const urlObj = new URL(url);
    const parts = urlObj.pathname.split('/');
    return parts[parts.length - 1] || 'document.pdf';
  } catch {
    return 'document.pdf';
  }
};

const processUrl = async (url, folder) => {
  if (!url || !url.includes('res.cloudinary.com')) return url;
  
  console.log(`Migrating: ${url}`);
  try {
    // Extract publicId
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/');
    const uploadIndex = pathParts.indexOf('upload');
    const publicIdWithExt = pathParts.slice(uploadIndex + 2).join('/');
    const publicId = publicIdWithExt.replace(/\.[^/.]+$/, ""); // strip extension

    // Rename to authenticated type to bypass CDN PDF delivery block on free tiers
    await cloudinary.uploader.rename(publicId, publicId, {
      resource_type: 'image',
      to_type: 'authenticated',
      overwrite: true
    }).catch(err => {
      // If it fails (e.g., already authenticated or not found), continue anyway
      console.log(`  Rename skipped or failed: ${err.message}`);
    });

    // Generate authenticated API download URL
    const downloadUrl = cloudinary.utils.private_download_url(publicId, 'pdf', {
      resource_type: 'image',
      type: 'authenticated'
    });

    // Fetch the original file via API
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      console.log(`  Failed to download from Cloudinary: ${response.statusText}`);
      return url; // Keep original if failed
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    const originalName = getFileName(url);
    const contentType = response.headers.get('content-type') || 'application/pdf';
    const gridfsUrl = await uploadToGridFS(buffer, originalName, contentType);
    
    console.log(`  Successfully migrated to: ${gridfsUrl}`);
    return gridfsUrl;
  } catch (error) {
    console.error(`  Error processing ${url}:`, error.message);
    return url;
  }
};

async function run() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB. Starting migration...');
    
    // Wait a brief moment to ensure GridFS initializes
    await new Promise(res => setTimeout(res, 1000));

    // 1. Migrate Proposals
    const proposals = await Proposal.find({});
    for (let p of proposals) {
      if (p.proposal_url && p.proposal_url.includes('res.cloudinary.com')) {
        p.proposal_url = await processUrl(p.proposal_url, 'proposals');
        await p.save();
      }
    }

    // 2. Migrate Applications
    const applications = await Application.find({});
    for (let app of applications) {
      let changed = false;
      if (app.documents) {
        const keys = ['halal_policy', 'ingredient_list', 'floor_plan', 'company_registration', 'haccp_plan'];
        for (let key of keys) {
          if (app.documents[key] && app.documents[key].includes('res.cloudinary.com')) {
            app.documents[key] = await processUrl(app.documents[key], 'applications');
            changed = true;
          }
        }
        
        if (app.documents.supporting_docs && Array.isArray(app.documents.supporting_docs)) {
          for (let i = 0; i < app.documents.supporting_docs.length; i++) {
            if (app.documents.supporting_docs[i] && app.documents.supporting_docs[i].includes('res.cloudinary.com')) {
              app.documents.supporting_docs[i] = await processUrl(app.documents.supporting_docs[i], 'applications');
              changed = true;
            }
          }
        }
      }
      if (changed) {
        // Mark modified since documents is a mixed type/nested object
        app.markModified('documents');
        await app.save();
      }
    }

    // 3. Migrate Users (Avatars)
    const users = await User.find({});
    for (let u of users) {
      if (u.avatar_url && u.avatar_url.includes('res.cloudinary.com')) {
        u.avatar_url = await processUrl(u.avatar_url, 'avatars');
        await u.save();
      }
    }

    console.log('Migration complete!');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

// We need node-fetch if Node < 18, but Node 18+ has fetch built-in.
// Let's use built in fetch, so we won't import node-fetch if we can avoid it.
// Actually we imported node-fetch, let's remove it and use global fetch.

run();
