import mongoose from 'mongoose';
import { GridFSBucket } from 'mongodb';
import connectDB from './db.js';

let cachedBucket = null;
let lastDb = null;

// Clear cached bucket on disconnect/error
mongoose.connection.on('disconnected', () => {
  cachedBucket = null;
  lastDb = null;
});

mongoose.connection.on('error', () => {
  cachedBucket = null;
  lastDb = null;
});

export const getGridFSBucket = async () => {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    await connectDB();
  }

  const currentDb = mongoose.connection.db;
  if (!currentDb) {
    throw new Error('GridFS not ready: Database is not connected');
  }

  if (!cachedBucket || lastDb !== currentDb) {
    cachedBucket = new GridFSBucket(currentDb, {
      bucketName: 'uploads'
    });
    lastDb = currentDb;
  }

  return cachedBucket;
};

export const getGridFSBucketSync = () => {
  if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
    const currentDb = mongoose.connection.db;
    if (!cachedBucket || lastDb !== currentDb) {
      cachedBucket = new GridFSBucket(currentDb, {
        bucketName: 'uploads'
      });
      lastDb = currentDb;
    }
    return cachedBucket;
  }
  return null;
};

export const uploadToGridFS = async (buffer, filename, contentType) => {
  const bucket = await getGridFSBucket();

  return new Promise((resolve, reject) => {
    const writeStream = bucket.openUploadStream(filename, {
      contentType: contentType || 'application/octet-stream'
    });

    writeStream.on('error', (err) => {
      console.error('GridFS write stream error:', err);
      reject(err);
    });

    writeStream.on('finish', () => {
      resolve(`/api/files/${writeStream.id}`);
    });

    writeStream.end(buffer);
  });
};

