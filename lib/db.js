import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

// Reset cached connection when Mongoose disconnects or encounters an error
mongoose.connection.on('disconnected', () => {
  console.warn('⚠️ Mongoose disconnected from MongoDB');
  if (cached) {
    cached.conn = null;
    cached.promise = null;
  }
});

mongoose.connection.on('error', (err) => {
  console.error('❌ Mongoose connection error:', err?.message || err);
  if (cached) {
    cached.conn = null;
    cached.promise = null;
  }
});

const connectDB = async () => {
  // If connection is already open, use it
  if (cached.conn && mongoose.connection.readyState === 1) {
    return cached.conn;
  }

  // If connection is in disconnected or disconnecting state, reset cache
  if (mongoose.connection.readyState === 0 || mongoose.connection.readyState === 3) {
    cached.conn = null;
    cached.promise = null;
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
        serverSelectionTimeoutMS: 8000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 10000,
      };

      console.log('🍃 Establishing MongoDB connection...');
      if (mongoose.connection.readyState !== 0 && mongoose.connection.readyState !== 1) {
        try { await mongoose.disconnect(); } catch (_) {}
      }
      return await mongoose.connect(uri, opts);
    })().catch(err => {
      cached.promise = null;
      cached.conn = null;
      console.error(`❌ MongoDB Error: ${err.message}`);
      throw err;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    cached.conn = null;
    throw e;
  }

  return cached.conn;
};

export default connectDB;

