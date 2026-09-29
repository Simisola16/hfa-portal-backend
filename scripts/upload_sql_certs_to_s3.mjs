/**
 * upload_sql_certs_to_s3.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Streams dbo.RegCert.json line-by-line (3.5 GB)
 * 2. For each CertificateRefNo, keeps only the LATEST blob (highest IDColl)
 * 3. Uploads the PDF blob to AWS S3 (bucket: hfaportal, folder: certificates/)
 * 4. Updates the matching MongoDB certificate document with the new S3 URL
 * 5. Writes a full report to scratch/s3_upload_report.json
 *
 * Usage: node scratch/upload_sql_certs_to_s3.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(__dirname, '../sql-server-export/export/HalalCert/tables/dbo.RegCert.json');
const REPORT_PATH = path.join(__dirname, 's3_upload_report.json');
const RESUME_PATH = path.join(__dirname, 's3_upload_progress.json'); // for resumable runs

const BUCKET = process.env.AWS_S3_BUCKET_NAME;
const REGION = process.env.AWS_REGION;
const S3_FOLDER = 'certificates';

// ── S3 Client ────────────────────────────────────────────────────────────────
const s3 = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

console.log('='.repeat(80));
console.log('  UPLOAD SQL CERTIFICATE BLOBS TO S3 + UPDATE MONGODB');
console.log('  Bucket:', BUCKET, '| Region:', REGION, '| Folder:', S3_FOLDER + '/');
console.log('='.repeat(80));
console.log('');

// ── Phase 1: Scan RegCert.json — keep latest blob per CertificateRefNo ───────
async function buildBlobIndex() {
  console.log('📂 Phase 1: Scanning dbo.RegCert.json to index blobs...');
  console.log('   (This will take ~30-60s for the 3.5 GB file)\n');

  const rl = readline.createInterface({
    input: fs.createReadStream(SOURCE, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let inRows = false;
  let rowBuffer = '';
  let rowCount = 0;
  let blobCount = 0;

  // Map: certRef (lowercase) → { certRef, company, certName, IDColl, blobData, sizeKB }
  const index = new Map();

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!inRows) {
      if (trimmed === '"rows": [') inRows = true;
      continue;
    }
    if (trimmed === ']' || trimmed === '}') break;

    rowBuffer += line + '\n';
    const isCompact = trimmed.startsWith('{') && (trimmed.endsWith('},') || trimmed.endsWith('}'));
    if (!isCompact) {
      const opens = (rowBuffer.match(/\{/g) || []).length;
      const closes = (rowBuffer.match(/\}/g) || []).length;
      if (opens === 0 || opens !== closes) continue;
    }

    let rowJson = rowBuffer.trim();
    rowBuffer = '';
    if (rowJson.endsWith(',')) rowJson = rowJson.slice(0, -1);

    let row;
    try { row = JSON.parse(rowJson); } catch(e) { rowCount++; continue; }
    rowCount++;

    if (!row.Cerfile || !row.Cerfile.data) continue;
    blobCount++;

    const certRef = (row.CertificateRefNo || '').trim();
    const certKey = certRef.toLowerCase();
    const IDColl = Number(row.IDColl) || 0;

    const existing = index.get(certKey);
    // Keep latest version (highest IDColl)
    if (!existing || IDColl > existing.IDColl) {
      index.set(certKey, {
        certRef,
        company: (row.CompanyName || '').trim(),
        certName: (row.CertName || '').trim(),
        IDColl,
        blobData: row.Cerfile.data,
        blobEncoding: row.Cerfile.encoding || 'base64',
        sizeKB: Math.round(row.Cerfile.data.length * 0.75 / 1024),
      });
    }

    if (blobCount % 200 === 0) {
      process.stdout.write(`\r   Rows scanned: ${rowCount} | Blobs found: ${blobCount} | Unique refs: ${index.size}   `);
    }
  }

  console.log(`\n\n   ✅ Phase 1 complete:`);
  console.log(`      Total rows scanned     : ${rowCount}`);
  console.log(`      Total blobs found      : ${blobCount}`);
  console.log(`      Unique CertRefs        : ${index.size}`);
  console.log(`      Duplicates deduplicated: ${blobCount - index.size} (kept latest per cert)\n`);

  return index;
}

// ── Phase 2: Connect MongoDB, fetch all certificates ─────────────────────────
async function fetchMongoCerts() {
  console.log('🔌 Phase 2: Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  const col = mongoose.connection.db.collection('certificates');
  const certs = await col.find({}, { projection: { _id: 1, certificate_number: 1, company_name: 1, certificate_url: 1 } }).toArray();
  console.log(`   ✅ Fetched ${certs.length} certificates from MongoDB\n`);
  return col;
}

// ── Phase 3: Upload blobs to S3 + update MongoDB ─────────────────────────────
async function uploadAndUpdate(blobIndex, mongoCol) {
  console.log('🚀 Phase 3: Uploading to S3 and updating MongoDB...\n');

  // Load resume progress if available
  let completedRefs = new Set();
  if (fs.existsSync(RESUME_PATH)) {
    try {
      const prog = JSON.parse(fs.readFileSync(RESUME_PATH, 'utf8'));
      completedRefs = new Set(prog.completed || []);
      console.log(`   ↩  Resuming: ${completedRefs.size} already uploaded from previous run\n`);
    } catch(e) {}
  }

  const mongoCerts = await mongoCol.find({}, { projection: { _id: 1, certificate_number: 1, company_name: 1 } }).toArray();

  const report = {
    timestamp: new Date().toISOString(),
    uploaded: [],
    skipped_no_mongo_match: [],
    skipped_no_blob: [],
    already_done: [],
    errors: [],
  };

  let uploaded = 0;
  let noMatch = 0;
  let alreadyDone = 0;
  let errors = 0;

  for (const mongoCert of mongoCerts) {
    const certNo = (mongoCert.certificate_number || '').trim();
    const certKey = certNo.toLowerCase();

    const blobEntry = blobIndex.get(certKey);
    if (!blobEntry) {
      noMatch++;
      report.skipped_no_blob.push({ certificate_number: certNo, company: mongoCert.company_name });
      continue;
    }

    if (completedRefs.has(certKey)) {
      alreadyDone++;
      report.already_done.push(certNo);
      continue;
    }

    // Build S3 key
    const safeName = certNo.replace(/[\/\\:*?"<>|]/g, '_');
    const s3Key = `${S3_FOLDER}/${safeName}.pdf`;
    const s3Url = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${s3Key}`;

    try {
      // Check if already exists on S3
      let existsOnS3 = false;
      try {
        await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: s3Key }));
        existsOnS3 = true;
      } catch(e) {
        if (e.name !== 'NotFound' && e.$metadata?.httpStatusCode !== 404) throw e;
      }

      if (!existsOnS3) {
        // Decode base64 blob
        const pdfBuffer = Buffer.from(blobEntry.blobData, blobEntry.blobEncoding);

        // Validate PDF magic bytes
        const magic = pdfBuffer.slice(0, 4).toString('ascii');
        if (magic !== '%PDF') {
          throw new Error(`Invalid PDF magic bytes: "${magic}" for cert ${certNo}`);
        }

        // Sanitize metadata: AWS S3 metadata must be ASCII only
        const toAscii = s => String(s || '').replace(/[^\x20-\x7E]/g, '').slice(0, 200);
        await s3.send(new PutObjectCommand({
          Bucket: BUCKET,
          Key: s3Key,
          Body: pdfBuffer,
          ContentType: 'application/pdf',
          Metadata: {
            certificate_number: toAscii(certNo),
            company_name: toAscii(mongoCert.company_name),
            cert_name: toAscii(blobEntry.certName),
          },
        }));
      }

      // Update MongoDB
      await mongoCol.updateOne(
        { _id: mongoCert._id },
        { $set: { certificate_url: s3Url } }
      );

      uploaded++;
      completedRefs.add(certKey);
      report.uploaded.push({
        certificate_number: certNo,
        company: mongoCert.company_name,
        s3_url: s3Url,
        size_kb: blobEntry.sizeKB,
        was_already_on_s3: existsOnS3,
      });

      // Save progress every 25 uploads
      if (uploaded % 25 === 0) {
        fs.writeFileSync(RESUME_PATH, JSON.stringify({ completed: [...completedRefs] }));
        process.stdout.write(`\r   ✅ Uploaded: ${uploaded} | No match: ${noMatch} | Errors: ${errors}   `);
      }

    } catch(err) {
      errors++;
      console.error(`\n   ❌ Error for ${certNo}: ${err.message}`);
      report.errors.push({ certificate_number: certNo, error: err.message });
    }
  }

  // Final progress save
  fs.writeFileSync(RESUME_PATH, JSON.stringify({ completed: [...completedRefs] }));

  console.log(`\n\n${'='.repeat(80)}`);
  console.log('🎉 UPLOAD COMPLETE!');
  console.log(`   ✅ Uploaded to S3 + MongoDB updated : ${uploaded}`);
  console.log(`   ⏩ Already done (skipped)           : ${alreadyDone}`);
  console.log(`   ⚠️  No SQL blob match                : ${noMatch}`);
  console.log(`   ❌ Errors                            : ${errors}`);
  console.log(`${'='.repeat(80)}\n`);

  // Write full report
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log('📄 Full report written to:', REPORT_PATH);

  if (report.skipped_no_blob.length > 0 && report.skipped_no_blob.length <= 30) {
    console.log(`\n⚠️  MongoDB certs with no SQL blob (${report.skipped_no_blob.length}):`);
    report.skipped_no_blob.forEach(c => console.log(`   - ${c.certificate_number} | ${c.company}`));
  } else if (report.skipped_no_blob.length > 30) {
    console.log(`\n⚠️  ${report.skipped_no_blob.length} MongoDB certs had no SQL blob — see report for full list`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  try {
    // Verify AWS config
    if (!BUCKET || !REGION || !process.env.AWS_ACCESS_KEY_ID) {
      console.error('❌ Missing AWS credentials. Check .env for AWS_S3_BUCKET_NAME, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY');
      process.exit(1);
    }

    const blobIndex = await buildBlobIndex();
    const mongoCol = await fetchMongoCerts();
    await uploadAndUpdate(blobIndex, mongoCol);

    await mongoose.disconnect();
    console.log('\n✅ Done! MongoDB disconnected.');
    process.exit(0);
  } catch(err) {
    console.error('\n❌ Fatal error:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
