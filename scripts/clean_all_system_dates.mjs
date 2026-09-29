/**
 * Clean & Normalize All System Dates (Zero Day-Back Shift)
 * 
 * Scans all collections in MongoDB and repairs dates that were shifted by
 * 1 day due to local-to-UTC timezone conversions (23:00 / 22:00 UTC).
 * Normalizes all calendar dates to 12:00:00 UTC (Noon UTC).
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

function normalizeDateField(val) {
  if (!val) return null;
  const d = val instanceof Date ? val : new Date(val);
  if (isNaN(d.getTime())) return null;

  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const s = d.getUTCSeconds();
  const ms = d.getUTCMilliseconds();

  // Midnight / local-parse fingerprint: minutes, seconds, ms are exactly 0
  const isMidnightFingerprint = (m === 0 && s === 0 && ms === 0);

  if (isMidnightFingerprint) {
    if (h === 23 || h === 22) {
      // Shifted back 1 or 2 hours by local timezone (e.g. BST/WAT UTC+1 or CEST UTC+2)
      // True calendar date is the next day:
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 12, 0, 0));
    }
    if (h === 0 || h === 1) {
      // UTC midnight or GMT-1
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0));
    }
  }

  return null; // Untouched
}

function scanAndNormalizeObject(obj, prefix = '') {
  const updates = {};
  let modifiedCount = 0;

  for (const [key, value] of Object.entries(obj)) {
    if (key === '_id') continue;
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value instanceof Date) {
      const normalized = normalizeDateField(value);
      if (normalized && normalized.toISOString() !== value.toISOString()) {
        updates[fullKey] = normalized;
        modifiedCount++;
      }
    } else if (Array.isArray(value)) {
      // Handle array of sub-documents if applicable
      let arrayModified = false;
      const updatedArray = value.map(item => {
        if (item && typeof item === 'object' && !(item instanceof Date) && !(item instanceof mongoose.Types.ObjectId)) {
          const itemUpdates = {};
          let itemMod = false;
          for (const [subK, subV] of Object.entries(item)) {
            if (subV instanceof Date) {
              const norm = normalizeDateField(subV);
              if (norm && norm.toISOString() !== subV.toISOString()) {
                itemUpdates[subK] = norm;
                itemMod = true;
                modifiedCount++;
              }
            }
          }
          if (itemMod) {
            arrayModified = true;
            return { ...item, ...itemUpdates };
          }
        }
        return item;
      });

      if (arrayModified) {
        updates[fullKey] = updatedArray;
      }
    } else if (value && typeof value === 'object' && !(value instanceof mongoose.Types.ObjectId)) {
      const nested = scanAndNormalizeObject(value, fullKey);
      if (nested.modifiedCount > 0) {
        Object.assign(updates, nested.updates);
        modifiedCount += nested.modifiedCount;
      }
    }
  }

  return { updates, modifiedCount };
}

async function cleanCollection(db, colName) {
  const col = db.collection(colName);
  const totalDocs = await col.countDocuments();
  if (totalDocs === 0) {
    console.log(`\n📁 [${colName}] — Empty collection, skipping.`);
    return { docsUpdated: 0, datesFixed: 0 };
  }

  console.log(`\n📁 [${colName}] — Scanning ${totalDocs} documents...`);

  const cursor = col.find({}, { batchSize: 500 });
  let bulkOps = [];
  let docsUpdated = 0;
  let datesFixed = 0;

  for await (const doc of cursor) {
    const { updates, modifiedCount } = scanAndNormalizeObject(doc);
    if (modifiedCount > 0) {
      docsUpdated++;
      datesFixed += modifiedCount;
      bulkOps.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: updates }
        }
      });

      if (bulkOps.length >= 500) {
        await col.bulkWrite(bulkOps);
        bulkOps = [];
      }
    }
  }

  if (bulkOps.length > 0) {
    await col.bulkWrite(bulkOps);
  }

  console.log(`   ✓ Documents updated: ${docsUpdated} / ${totalDocs}`);
  console.log(`   ✓ Dates repaired to 12:00 UTC: ${datesFixed}`);

  return { docsUpdated, datesFixed };
}

async function main() {
  console.log('========================================================================');
  console.log('   SYSTEM-WIDE DATE CLEANUP: REPAIR TIMEZONE DAY-BACK DRIFT             ');
  console.log('   Target: All Collections -> 12:00:00 UTC (Noon UTC)                   ');
  console.log('========================================================================\n');

  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const targetCollections = [
    'applications',
    'audits',
    'invoices',
    'applicationlogsheets',
    'addonapplications',
    'extensionapplications',
    'extensionlogsheets',
    'surveillanceschedules',
    'surveillancerequests',
    'certificates'
  ];

  let totalDocsUpdated = 0;
  let totalDatesRepaired = 0;

  for (const colName of targetCollections) {
    const res = await cleanCollection(db, colName);
    totalDocsUpdated += res.docsUpdated;
    totalDatesRepaired += res.datesFixed;
  }

  console.log('\n========================================================================');
  console.log('🎉 SYSTEM-WIDE DATE NORMALIZATION COMPLETE!');
  console.log(`   Total Documents Repaired Across System: ${totalDocsUpdated}`);
  console.log(`   Total Date Fields Corrected to 12:00:00 UTC: ${totalDatesRepaired}`);
  console.log('========================================================================\n');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error during date cleanup:', err);
  process.exit(1);
});
