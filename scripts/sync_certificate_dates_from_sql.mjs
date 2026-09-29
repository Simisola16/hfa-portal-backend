/**
 * Sync Certificate Dates from Scripted SQL Database to MongoDB
 * 
 * Maps SQL dbo.tlbcertMas fields to MongoDB certificates collection:
 * - IssueDate           -> issue_date
 * - ExpiryDate          -> expiry_date
 * - CurrentCyStartDate  -> current_cycle_start_date (& certification_start_date)
 * - OriginalCyStartDate -> original_cycle_start_date
 * - AuditDatee          -> audit_date
 * - Dateer              -> created_at & createdAt
 * - Clears certificate_url to ensure fresh PDF regeneration with exact dates
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const SQL_EXPORT_PATH = path.resolve(__dirname, '../sql-server-export/export/HalalCert/tables/dbo.tlbcertMas.json');

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

export function parseSqlDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (
    !s ||
    s === '_' ||
    s === '-' ||
    s === 'null' ||
    s === 'undefined' ||
    s.toLowerCase() === 'not set' ||
    s.toLowerCase().includes('used to be')
  ) {
    return null;
  }

  // Format 1: DD-Mon-YYYY or DD-Month-YYYY or DD Mon YYYY (e.g. 04-May-2023, 26-July-2025, 16 April 2025)
  const mAlpha = s.match(/^(\d{1,2})[\s\-]+([A-Za-z]+)[\s\-]+(\d{4})/);
  if (mAlpha) {
    const day = parseInt(mAlpha[1], 10);
    const monKey = mAlpha[2].toLowerCase();
    const year = parseInt(mAlpha[3], 10);
    const month = MONTH_MAP[monKey] !== undefined ? MONTH_MAP[monKey] : MONTH_MAP[monKey.slice(0, 3)];
    if (month !== undefined) {
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

  // Format 3: M/D/YYYY (e.g. 2/3/2026 4:14:27 PM)
  const mUs = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mUs) {
    const m = parseInt(mUs[1], 10) - 1;
    const d = parseInt(mUs[2], 10);
    const y = parseInt(mUs[3], 10);
    return new Date(Date.UTC(y, m, d, 12, 0, 0));
  }

  // Fallback
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 12, 0, 0));
  }

  return null;
}

async function run() {
  const isApply = process.argv.includes('--apply');
  console.log(`\n========================================================================`);
  console.log(`     SYNC CERTIFICATE DATES: SQL DATABASE -> MONGODB LOCALHOST         `);
  console.log(`     Mode: ${isApply ? '>>> LIVE APPLY <<<' : 'DRY RUN (preview only)'} `);
  console.log(`========================================================================\n`);

  if (!fs.existsSync(SQL_EXPORT_PATH)) {
    throw new Error(`SQL export file not found at: ${SQL_EXPORT_PATH}`);
  }

  console.log(`Loading SQL records from ${SQL_EXPORT_PATH}...`);
  const sqlData = JSON.parse(fs.readFileSync(SQL_EXPORT_PATH, 'utf8'));
  console.log(`Loaded ${sqlData.rows.length} rows from dbo.tlbcertMas.`);

  // Build lookup index
  const sqlIndex = new Map();
  for (const r of sqlData.rows) {
    if (r.CertificateNo && r.CertificateNo.trim()) {
      const key = r.CertificateNo.trim().toUpperCase();
      if (!sqlIndex.has(key)) sqlIndex.set(key, r);
    }
    if (r.CertficatNo && r.CertficatNo.trim()) {
      const key2 = r.CertficatNo.trim().toUpperCase();
      if (!sqlIndex.has(key2)) sqlIndex.set(key2, r);
    }
  }

  console.log(`Connecting to MongoDB (${process.env.MONGODB_URI})...`);
  await mongoose.connect(process.env.MONGODB_URI);
  const col = mongoose.connection.collection('certificates');

  const mongoCerts = await col.find({}).toArray();
  console.log(`Found ${mongoCerts.length} certificates in MongoDB collection.\n`);

  let matchedCount = 0;
  let unmatchedCount = 0;
  let auditDatePopulated = 0;
  let origCyclePopulated = 0;
  let dateerPopulated = 0;
  let issueDatePopulated = 0;
  let expiryDatePopulated = 0;
  let currentCyclePopulated = 0;

  const bulkOps = [];
  const sampleChanges = [];

  for (const doc of mongoCerts) {
    const certNum = (doc.certificate_number || '').trim().toUpperCase();
    const sqlRow = sqlIndex.get(certNum);

    if (!sqlRow) {
      unmatchedCount++;
      continue;
    }
    matchedCount++;

    const issueDate = parseSqlDate(sqlRow.IssueDate);
    const expiryDate = parseSqlDate(sqlRow.ExpiryDate);
    const currentCycleDate = parseSqlDate(sqlRow.CurrentCyStartDate);
    const originalCycleDate = parseSqlDate(sqlRow.OriginalCyStartDate);
    const auditDate = parseSqlDate(sqlRow.AuditDatee);
    const creationDate = parseSqlDate(sqlRow.Dateer) || issueDate || doc.createdAt || new Date();

    if (issueDate) issueDatePopulated++;
    if (expiryDate) expiryDatePopulated++;
    if (currentCycleDate) currentCyclePopulated++;
    if (originalCycleDate) origCyclePopulated++;
    if (auditDate) auditDatePopulated++;
    if (creationDate) dateerPopulated++;

    const updateFields = {
      issue_date: issueDate || doc.issue_date,
      expiry_date: expiryDate || doc.expiry_date,
      current_cycle_start_date: currentCycleDate || doc.current_cycle_start_date || issueDate,
      certification_start_date: currentCycleDate || doc.certification_start_date || issueDate,
      original_cycle_start_date: originalCycleDate,
      audit_date: auditDate,
      created_at: creationDate,
      createdAt: creationDate,
      certificate_url: null, // Clear URL to force re-render with accurate dates
      updated_at: new Date()
    };

    if (sampleChanges.length < 8) {
      sampleChanges.push({
        cert_num: doc.certificate_number,
        company: doc.company_name,
        sql: {
          IssueDate: sqlRow.IssueDate,
          ExpiryDate: sqlRow.ExpiryDate,
          CurrentCyStartDate: sqlRow.CurrentCyStartDate,
          OriginalCyStartDate: sqlRow.OriginalCyStartDate,
          AuditDatee: sqlRow.AuditDatee,
          Dateer: sqlRow.Dateer
        },
        mongoBefore: {
          issue_date: doc.issue_date?.toISOString?.()?.split('T')[0] ?? doc.issue_date,
          expiry_date: doc.expiry_date?.toISOString?.()?.split('T')[0] ?? doc.expiry_date,
          current_cycle: doc.current_cycle_start_date?.toISOString?.()?.split('T')[0] ?? doc.current_cycle_start_date,
          original_cycle: doc.original_cycle_start_date?.toISOString?.()?.split('T')[0] ?? doc.original_cycle_start_date,
          audit_date: doc.audit_date?.toISOString?.()?.split('T')[0] ?? doc.audit_date,
          createdAt: doc.createdAt?.toISOString?.()?.split('T')[0] ?? doc.createdAt
        },
        mongoAfter: {
          issue_date: updateFields.issue_date?.toISOString?.()?.split('T')[0],
          expiry_date: updateFields.expiry_date?.toISOString?.()?.split('T')[0],
          current_cycle: updateFields.current_cycle_start_date?.toISOString?.()?.split('T')[0],
          original_cycle: updateFields.original_cycle_start_date?.toISOString?.()?.split('T')[0] ?? 'null',
          audit_date: updateFields.audit_date?.toISOString?.()?.split('T')[0] ?? 'null',
          createdAt: updateFields.createdAt?.toISOString?.()?.split('T')[0]
        }
      });
    }

    bulkOps.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: updateFields }
      }
    });
  }

  console.log(`------------------------------------------------------------------------`);
  console.log(`MATCHING & MAPPING SUMMARY`);
  console.log(`------------------------------------------------------------------------`);
  console.log(`Total Mongo Certificates       : ${mongoCerts.length}`);
  console.log(`Matched to SQL tlbcertMas      : ${matchedCount} (${((matchedCount / mongoCerts.length) * 100).toFixed(1)}%)`);
  console.log(`Unmatched Certificates         : ${unmatchedCount}`);
  console.log(`issue_date mapped              : ${issueDatePopulated}`);
  console.log(`expiry_date mapped             : ${expiryDatePopulated}`);
  console.log(`current_cycle_start_date mapped: ${currentCyclePopulated}`);
  console.log(`original_cycle_start_date populated: ${origCyclePopulated}`);
  console.log(`audit_date populated           : ${auditDatePopulated}`);
  console.log(`created_at / createdAt mapped  : ${dateerPopulated}`);

  console.log(`\n------------------------------------------------------------------------`);
  console.log(`SAMPLE CERTIFICATES: BEFORE VS AFTER`);
  console.log(`------------------------------------------------------------------------`);
  sampleChanges.forEach((s, idx) => {
    console.log(`\n[${idx + 1}] Cert: ${s.cert_num} (${s.company})`);
    console.log(`    SQL Raw      : Issue="${s.sql.IssueDate}" | Exp="${s.sql.ExpiryDate}" | CurrCy="${s.sql.CurrentCyStartDate}" | OrigCy="${s.sql.OriginalCyStartDate}" | Audit="${s.sql.AuditDatee?.trim()}" | Dateer="${s.sql.Dateer}"`);
    console.log(`    Mongo BEFORE : Issue=${s.mongoBefore.issue_date} | Exp=${s.mongoBefore.expiry_date} | CurrCy=${s.mongoBefore.current_cycle} | OrigCy=${s.mongoBefore.original_cycle} | Audit=${s.mongoBefore.audit_date} | Created=${s.mongoBefore.createdAt}`);
    console.log(`    Mongo AFTER  : Issue=${s.mongoAfter.issue_date} | Exp=${s.mongoAfter.expiry_date} | CurrCy=${s.mongoAfter.current_cycle} | OrigCy=${s.mongoAfter.original_cycle} | Audit=${s.mongoAfter.audit_date} | Created=${s.mongoAfter.createdAt}`);
  });

  if (isApply) {
    console.log(`\nExecuting bulk update of ${bulkOps.length} certificates in MongoDB...`);
    const bulkResult = await col.bulkWrite(bulkOps, { ordered: false });
    console.log(`\nSUCCESS! MongoDB Bulk Update Result:`);
    console.log(`  Matched  : ${bulkResult.matchedCount}`);
    console.log(`  Modified : ${bulkResult.modifiedCount}`);
  } else {
    console.log(`\n>>> DRY RUN COMPLETED. No writes made. Run with --apply to execute. <<<`);
  }

  await mongoose.disconnect();
  console.log(`\nFinished.`);
}

run().catch(err => {
  console.error('Error during execution:', err);
  process.exit(1);
});
