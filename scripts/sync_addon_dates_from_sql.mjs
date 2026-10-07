/**
 * Sync Add-On Application Dates from Scripted SQL Database to MongoDB
 * 
 * Maps SQL dbo.ProAder fields to MongoDB addonapplications collection:
 * - Datere      -> created_at, createdAt, submission_date
 * - DateAccpt   -> acceptance_date
 * 
 * Prevents timezone offset day shift by constructing UTC noon Date (12:00:00 UTC).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const SQL_EXPORT_PATH = path.resolve(__dirname, '../sql-server-export/export/HalalAReNew/tables/dbo.ProAder.json');

const MONTH_MAP = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11
};

export function parseExactSqlDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (
    !s ||
    s === '_' ||
    s === '-' ||
    s === 'None' ||
    s === 'null' ||
    s === 'undefined' ||
    s.toLowerCase() === 'not set'
  ) {
    return null;
  }

  // Format 1: DD-Mon-YYYY or DD-Month-YYYY or DD Mon YYYY (e.g. 18-Nov-2019, 29-Dec-2022)
  const mAlpha = s.match(/^(\d{1,2})[\s\-]+([A-Za-z]+)[\s\-]+(\d{4})/);
  if (mAlpha) {
    const day = parseInt(mAlpha[1], 10);
    const monKey = mAlpha[2].toLowerCase();
    const year = parseInt(mAlpha[3], 10);
    const month = MONTH_MAP[monKey] !== undefined ? MONTH_MAP[monKey] : MONTH_MAP[monKey.slice(0, 3)];
    if (month !== undefined) {
      // 12:00:00 UTC guarantees zero day-shift in all timezones (-11 to +11)
      return new Date(Date.UTC(year, month, day, 12, 0, 0));
    }
  }

  // Format 2: DD/MM/YYYY or DD-MM-YYYY
  const mNum = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
  if (mNum) {
    const day = parseInt(mNum[1], 10);
    const month = parseInt(mNum[2], 10) - 1;
    const year = parseInt(mNum[3], 10);
    return new Date(Date.UTC(year, month, day, 12, 0, 0));
  }

  // Format 3: YYYY-MM-DD
  const mIso = s.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
  if (mIso) {
    const year = parseInt(mIso[1], 10);
    const month = parseInt(mIso[2], 10) - 1;
    const day = parseInt(mIso[3], 10);
    return new Date(Date.UTC(year, month, day, 12, 0, 0));
  }

  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0));
  }

  return null;
}

async function run() {
  console.log('====================================================');
  console.log('  SYNC ADD-ON DATES FROM SCRIPTED SQL TO MONGODB');
  console.log('====================================================\n');

  if (!fs.existsSync(SQL_EXPORT_PATH)) {
    console.error(`❌ SQL export file not found: ${SQL_EXPORT_PATH}`);
    process.exit(1);
  }

  console.log(`📖 Loading SQL ProAder data from: ${SQL_EXPORT_PATH}`);
  const sqlContent = JSON.parse(fs.readFileSync(SQL_EXPORT_PATH, 'utf8'));
  const sqlRows = sqlContent.rows || [];
  console.log(`   ✓ Loaded ${sqlRows.length} SQL records from dbo.ProAder`);

  // Build indexing maps
  const byRecordId = new Map();
  const byAtId = new Map();
  const byAppNum = new Map();

  for (const r of sqlRows) {
    if (r.RecordID) {
      byRecordId.set(String(r.RecordID).trim(), r);
    }
    if (r.AtID) {
      byAtId.set(String(r.AtID).trim(), r);
    }
    if (r.AppNum && r.AppNum !== 'None') {
      byAppNum.set(String(r.AppNum).trim(), r);
    }
  }
  console.log(`   ✓ Indexed ${byRecordId.size} by RecordID, ${byAtId.size} by AtID`);

  // Connect to MongoDB
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('❌ MONGODB_URI is not set in environment or .env');
    process.exit(1);
  }

  console.log('\n🔌 Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  console.log('   ✓ Connected to MongoDB');

  const col = mongoose.connection.db.collection('addonapplications');
  const allDocs = await col.find({}).toArray();
  console.log(`   ✓ Found ${allDocs.length} Add-On Applications in MongoDB`);

  let matchedCount = 0;
  let unmatchedCount = 0;
  let updatedCount = 0;
  const bulkOps = [];

  for (const doc of allDocs) {
    const appNum = (doc.application_number || '').trim();
    let sqlRow = null;

    // 1. Try products[0].code e.g. ADD-242113 -> 242113
    const prodCode = doc.products?.[0]?.code || '';
    const codeMatch = prodCode.match(/\b(?:ADD-|ADDON-)?(\d+)\b/);
    if (codeMatch && byRecordId.has(codeMatch[1])) {
      sqlRow = byRecordId.get(codeMatch[1]);
    }

    // 2. Try application_number as RecordID or AtID
    if (!sqlRow) {
      const recMatch = appNum.match(/^(?:ADDON-|ADD-)(\d+)(?:-\d+)?$/);
      if (recMatch) {
        if (byRecordId.has(recMatch[1])) {
          sqlRow = byRecordId.get(recMatch[1]);
        } else if (byAtId.has(recMatch[1])) {
          sqlRow = byAtId.get(recMatch[1]);
        }
      }
    }

    // 3. Try notes e.g. "Record: 20014" or "Ref: ADDON-20014"
    if (!sqlRow && doc.notes) {
      const noteMatch = doc.notes.match(/Record:\s*(\d+)/i);
      if (noteMatch && byRecordId.has(noteMatch[1])) {
        sqlRow = byRecordId.get(noteMatch[1]);
      }
    }

    // 4. Try any products code matching RecordID
    if (!sqlRow && Array.isArray(doc.products)) {
      for (const p of doc.products) {
        const pMatch = (p.code || '').match(/\b(?:ADD-|ADDON-)?(\d+)\b/);
        if (pMatch && byRecordId.has(pMatch[1])) {
          sqlRow = byRecordId.get(pMatch[1]);
          break;
        }
      }
    }

    if (!sqlRow) {
      unmatchedCount++;
      continue;
    }

    matchedCount++;
    const exactDate = parseExactSqlDate(sqlRow.Datere);
    if (!exactDate) {
      console.warn(`⚠️ Could not parse Datere "${sqlRow.Datere}" for doc ${doc._id} (${appNum})`);
      continue;
    }

    const updateFields = {
      created_at: exactDate,
      createdAt: exactDate,
      submission_date: exactDate
    };

    if (sqlRow.DateAccpt) {
      const accDate = parseExactSqlDate(sqlRow.DateAccpt);
      if (accDate) {
        updateFields.acceptance_date = accDate;
      }
    }

    bulkOps.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: updateFields }
      }
    });
  }

  console.log(`\n📊 Match Summary:`);
  console.log(`   - Total MongoDB Add-Ons: ${allDocs.length}`);
  console.log(`   - Matched to SQL ProAder: ${matchedCount} (${((matchedCount / allDocs.length) * 100).toFixed(1)}%)`);
  console.log(`   - Unmatched: ${unmatchedCount}`);
  console.log(`   - Bulk Update Operations Prepared: ${bulkOps.length}`);

  if (bulkOps.length > 0) {
    console.log('\n🚀 Executing bulk updates in batches of 500...');
    const BATCH_SIZE = 500;
    for (let i = 0; i < bulkOps.length; i += BATCH_SIZE) {
      const batch = bulkOps.slice(i, i + BATCH_SIZE);
      const res = await col.bulkWrite(batch, { ordered: false });
      updatedCount += (res.modifiedCount || res.matchedCount || 0);
      process.stdout.write(`   ✓ Processed ${Math.min(i + BATCH_SIZE, bulkOps.length)} / ${bulkOps.length}\r`);
    }
    console.log(`\n✅ Successfully synced dates for ${bulkOps.length} Add-On Applications!`);
  }

  // Verification sampling
  console.log('\n🔍 Verification Sample (First 5 records):');
  const sample = await col.find({}).sort({ created_at: -1 }).limit(5).toArray();
  sample.forEach((s, idx) => {
    console.log(`   ${idx + 1}. [${s.application_number}] Date: ${s.created_at ? s.created_at.toISOString().split('T')[0] : 'N/A'} (UK: ${s.created_at ? s.created_at.toLocaleDateString('en-GB', { timeZone: 'UTC' }) : 'N/A'}) - Status: ${s.status}`);
  });

  console.log('\n🔍 Verification Sample (Oldest 5 records):');
  const oldest = await col.find({}).sort({ created_at: 1 }).limit(5).toArray();
  oldest.forEach((s, idx) => {
    console.log(`   ${idx + 1}. [${s.application_number}] Date: ${s.created_at ? s.created_at.toISOString().split('T')[0] : 'N/A'} (UK: ${s.created_at ? s.created_at.toLocaleDateString('en-GB', { timeZone: 'UTC' }) : 'N/A'}) - Status: ${s.status}`);
  });

  await mongoose.disconnect();
  console.log('\n🎉 Finished sync successfully!');
  process.exit(0);
}

run().catch(err => {
  console.error('Fatal error during sync:', err);
  process.exit(1);
});
