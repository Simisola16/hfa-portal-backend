import mongoose from 'mongoose';
import { GridFSBucket } from 'mongodb';

let gfs;

const initGridFS = () => {
  if (mongoose.connection.db && !gfs) {
    gfs = new GridFSBucket(mongoose.connection.db, {
      bucketName: 'uploads'
    });
    console.log('GridFS initialized');
  }
};

if (mongoose.connection.readyState === 1) {
  initGridFS();
} else {
  mongoose.connection.once('open', initGridFS);
}

export const uploadToGridFS = (buffer, filename, contentType) => {
  return new Promise((resolve, reject) => {
    if (!gfs) return reject(new Error('GridFS not initialized yet. Database connection may be pending.'));
    
    const writeStream = gfs.openUploadStream(filename, {
      contentType: contentType || 'application/octet-stream'
    });
    
    writeStream.on('error', reject);
    writeStream.on('finish', () => {
      // Generate the internal API URL for the file
      resolve(`/api/files/${writeStream.id}`);
    });
    
    writeStream.end(buffer);
  });
};

export const getGridFSBucket = () => gfs;
