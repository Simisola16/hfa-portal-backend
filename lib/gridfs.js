import mongoose from 'mongoose';
import { GridFSBucket } from 'mongodb';

let gfs;

mongoose.connection.once('open', () => {
  gfs = new GridFSBucket(mongoose.connection.db, {
    bucketName: 'uploads'
  });
  console.log('GridFS initialized');
});

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
