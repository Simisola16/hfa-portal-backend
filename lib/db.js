import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

const connectDB = async () => {
  if (cached.conn) {
    console.log('🍃 Using existing MongoDB connection');
    return cached.conn;
  }

  if (!cached.promise) {
    const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27018/hfa_portal_dev';
    
    cached.promise = (async () => {
      if (uri.includes('27018')) {
        try {
          const { ensureMongoTunnel } = await import('./tunnel.js');
          await ensureMongoTunnel();
        } catch (e) {
          console.warn('⚠️ Could not initialize SSH tunnel:', e.message);
        }
      }

      const opts = {
        bufferCommands: false,
      };

      console.log('🍃 Establishing MongoDB connection...');
      return await mongoose.connect(uri, opts);
    })().catch(err => {
      cached.promise = null;
      console.error(`❌ MongoDB Error: ${err.message}`);
      throw err;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  return cached.conn;
};

export default connectDB;

