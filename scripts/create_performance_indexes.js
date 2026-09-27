import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns';

dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function createEssentialIndexes() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB Atlas.\n');
  const db = mongoose.connection.db;

  const indexDefinitions = [
    { collection: 'products', index: { client_id: 1 } },
    { collection: 'products', index: { site_id: 1 } },
    { collection: 'products', index: { status: 1 } },
    { collection: 'products', index: { client_id: 1, site_id: 1 } },
    { collection: 'applications', index: { client_id: 1 } },
    { collection: 'applications', index: { status: 1 } },
    { collection: 'applications', index: { site_id: 1 } },
    { collection: 'certificates', index: { client_id: 1 } },
    { collection: 'certificates', index: { status: 1 } },
    { collection: 'certificates', index: { site_id: 1 } },
    { collection: 'sites', index: { client_id: 1 } },
    { collection: 'sites', index: { client_code: 1 } },
    { collection: 'users', index: { role: 1 } },
    { collection: 'users', index: { is_verified: 1 } },
    { collection: 'users', index: { company_category: 1 } }
  ];

  console.log('Creating essential indexes on MongoDB Atlas...');
  for (const def of indexDefinitions) {
    try {
      const result = await db.collection(def.collection).createIndex(def.index, { background: true });
      console.log(`  ✓ Index on ${def.collection}: ${JSON.stringify(def.index)} -> created (${result})`);
    } catch (err) {
      console.warn(`  ⚠️ Warning on ${def.collection}:`, err.message);
    }
  }

  console.log('\n✅ All database performance indexes created successfully!');
  await mongoose.disconnect();
}

createEssentialIndexes().catch(console.error);
