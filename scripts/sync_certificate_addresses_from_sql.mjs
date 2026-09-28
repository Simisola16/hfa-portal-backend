/**
 * Sync Certificate Addresses from Scripted SQL Database to MongoDB
 * 
 * Updates both company_address and manufacturing_address using exact SQL values:
 * - company_address       : cleanStr(c.COMPANYADDRESS) || ''
 * - manufacturing_address : cleanStr(c.MANUFATURINGFACILITY) || ''
 * 
 * Removes erroneous fallback to company head office address.
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

// Protected certificates whose URLs should never be cleared
const PROTECTED_CERT_NUMS = new Set([
  'GR-KH/QR260921102332',
  'AB-KH/QR260925112548'
]);

export function cleanStr(val, defaultVal = '') {
  if (val === null || val === undefined) return defaultVal;
  const s = String(val).trim();
  return s === '' || s === '-' || s === 'None' || s === 'null' ? defaultVal : s;
}

async function run() {
  const isApply = process.argv.includes('--apply');
  console.log(`\n========================================================================`);
  console.log(`    SYNC CERTIFICATE ADDRESSES: SQL DATABASE -> MONGODB                `);
  console.log(`    Mode: ${isApply ? '>>> LIVE APPLY <<<' : 'DRY RUN (preview only)'} `);
  console.log(`========================================================================\n`);

  if (!fs.existsSync(SQL_EXPORT_PATH)) {
    throw new Error(`SQL export file not found at: ${SQL_EXPORT_PATH}`);
  }

  console.log(`Loading SQL records from ${SQL_EXPORT_PATH}...`);
  const sqlData = JSON.parse(fs.readFileSync(SQL_EXPORT_PATH, 'utf8'));
  console.log(`Loaded ${sqlData.rows.length} rows from dbo.tlbcertMas.`);

  // Build index by CertificateNo and CertficatNo
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

  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hfa_portal_dev';
  console.log(`Connecting to MongoDB (${mongoUri})...`);
  await mongoose.connect(mongoUri);
  const col = mongoose.connection.collection('certificates');

  const mongoCerts = await col.find({}).toArray();
  console.log(`Found ${mongoCerts.length} certificates in MongoDB collection.\n`);

  let matchedCount = 0;
  let unmatchedCount = 0;
  let mfgChangedCount = 0;
  let mfgNowBlankCount = 0;
  let compChangedCount = 0;

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

    const newCompanyAddr = cleanStr(sqlRow.COMPANYADDRESS) || '';
    const newMfgAddr = cleanStr(sqlRow.MANUFATURINGFACILITY) || '';

    const oldCompanyAddr = doc.company_address || '';
    const oldMfgAddr = doc.manufacturing_address || '';

    const mfgChanged = oldMfgAddr !== newMfgAddr;
    const compChanged = oldCompanyAddr !== newCompanyAddr;

    if (mfgChanged) mfgChangedCount++;
    if (!newMfgAddr) mfgNowBlankCount++;
    if (compChanged) compChangedCount++;

    if (mfgChanged || compChanged) {
      const updateFields = {
        company_address: newCompanyAddr,
        manufacturing_address: newMfgAddr,
        updated_at: new Date()
      };

      // If the certificate is NOT one of the protected ones, clear certificate_url so it regenerates cleanly
      if (!PROTECTED_CERT_NUMS.has(doc.certificate_number)) {
        updateFields.certificate_url = null;
      }

      if (sampleChanges.length < 10) {
        sampleChanges.push({
          cert: doc.certificate_number,
          company: doc.company_name,
          oldCompanyAddr,
          newCompanyAddr,
          oldMfgAddr,
          newMfgAddr,
          mfgChanged,
          compChanged
        });
      }

      bulkOps.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: updateFields }
        }
      });
    }
  }

  console.log(`------------------------------------------------------------------------`);
  console.log(`ADDRESS MAPPING AUDIT SUMMARY`);
  console.log(`------------------------------------------------------------------------`);
  console.log(`Total MongoDB Certificates           : ${mongoCerts.length}`);
  console.log(`Matched to SQL tlbcertMas            : ${matchedCount} (${((matchedCount / mongoCerts.length) * 100).toFixed(1)}%)`);
  console.log(`Unmatched Certificates               : ${unmatchedCount}`);
  console.log(`Certificates with changed mfg address: ${mfgChangedCount}`);
  console.log(`Certificates where mfg address is "" : ${mfgNowBlankCount} (was falsely populated with company address)`);
  console.log(`Certificates with changed comp addr  : ${compChangedCount}`);
  console.log(`Total Bulk Update Operations Pending : ${bulkOps.length}`);

  console.log(`\n------------------------------------------------------------------------`);
  console.log(`SAMPLE CERTIFICATES: BEFORE VS AFTER`);
  console.log(`------------------------------------------------------------------------`);
  sampleChanges.forEach((s, idx) => {
    console.log(`\n[${idx + 1}] Cert: ${s.cert} (${s.company})`);
    if (s.mfgChanged) {
      console.log(`    manufacturing_address BEFORE: "${s.oldMfgAddr}"`);
      console.log(`    manufacturing_address AFTER : "${s.newMfgAddr}"`);
    } else {
      console.log(`    manufacturing_address UNCHANGED: "${s.newMfgAddr}"`);
    }
    if (s.compChanged) {
      console.log(`    company_address BEFORE      : "${s.oldCompanyAddr}"`);
      console.log(`    company_address AFTER       : "${s.newCompanyAddr}"`);
    }
  });

  if (isApply) {
    if (bulkOps.length > 0) {
      console.log(`\nExecuting bulk write of ${bulkOps.length} updates in MongoDB...`);
      const bulkResult = await col.bulkWrite(bulkOps, { ordered: false });
      console.log(`\nSUCCESS! MongoDB Bulk Update Result:`);
      console.log(`  Matched  : ${bulkResult.matchedCount}`);
      console.log(`  Modified : ${bulkResult.modifiedCount}`);
    } else {
      console.log(`\nAll certificates are already up to date. No writes needed.`);
    }
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
