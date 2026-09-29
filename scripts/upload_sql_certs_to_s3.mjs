/**
 * upload_sql_certs_to_s3.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Streams dbo.RegCert.json line-by-line (3.5 GB)
 * 2. For each CertificateRefNo, keeps only the LATEST blob (highest IDColl)
 * 3. Uploads the PDF blob to AWS S3 (bucket: hfaportal, folder: certificates/)
 *    Key format: certificates/${Date.now()}_${rand}_${cleanFilename}
 * 4. Updates the matching MongoDB certificate document with the proxy URL:
 *    certificate_url: /api/files/s3/${key}
 *    e.g. "/api/files/s3/certificates/1790679958961_fbnkuk_IS-KH_QR260921111049.pdf"
 * 5. Uses a concurrent worker pool (6 parallel workers) for fast uploads
 * 6. Resumable via scratch/s3_upload_progress.json
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(__dirname, '../sql-server-export/export/HalalCert/tables/dbo.RegCert.json');
const REPORT_PATH = path.join(__dirname, 's3_upload_report.json');
const RESUME_PATH = path.join(__dirname, 's3_upload_progress.json');

const BUCKET = process.env.AWS_S3_BUCKET_NAME;
const REGION = process.env.AWS_REGION;
const S3_FOLDER = 'certificates';
const CONCURRENCY = 6;

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
console.log('  URL format: /api/files/s3/certificates/${timestamp}_${rand}_${certRef}.pdf');
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
    try { row = JSON.parse(rowJson); } catch (e) { rowCount++; continue; }
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
        company: row.CompanyName || '',
        certName: row.CertName || `${certRef}.pdf`,
        IDColl,
        blobData: row.Cerfile.data,
        blobEncoding: row.Cerfile.type === 'Buffer' ? 'base64' : 'utf8',
        sizeKB: Math.round(row.Cerfile.data.length * 0.75 / 1024),
      });
    }

    if (rowCount % 200 === 0) {
      process.stdout.write(`   Rows scanned: ${rowCount} | Blobs found: ${blobCount} | Unique refs: ${index.size}   \r`);
    }
  }

  console.log(`\n\n   ✅ Phase 1 complete:`);
  console.log(`      Total rows scanned     : ${rowCount}`);
  console.log(`      Total blobs found      : ${blobCount}`);
  console.log(`      Unique CertRefs        : ${index.size}`);
  console.log(`      Duplicates deduplicated: ${blobCount - index.size} (kept latest per cert)\n`);

  return index;
}

// ── Helper: generate S3 key and URL ──────────────────────────────────────────
function generateS3KeyAndUrl(certNo) {
  const cleanFilename = `${certNo.replace(/[\/\\:*?"<>|]/g, '_')}.pdf`;
  const rand = Math.random().toString(36).slice(2, 8);
  const key = `${S3_FOLDER}/${Date.now()}_${rand}_${cleanFilename}`;
  const url = `/api/files/s3/${key}`;
  return { key, url, cleanFilename };
}

// ── Phase 2 & 3: Match with MongoDB and Upload ────────────────────────────────
async function main() {
  const blobIndex = await buildBlobIndex();

  console.log('🔌 Phase 2: Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  const mongoCol = mongoose.connection.db.collection('certificates');

  const mongoCerts = await mongoCol.find(
    {},
    { projection: { _id: 1, certificate_number: 1, certificate_url: 1, company_name: 1 } }
  ).toArray();
  console.log(`   ✅ Fetched ${mongoCerts.length} certificates from MongoDB\n`);

  // Load resume progress
  const completedRefs = new Set();
  if (fs.existsSync(RESUME_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(RESUME_PATH, 'utf8'));
      if (Array.isArray(data.completed)) {
        data.completed.forEach(k => completedRefs.add(k.toLowerCase()));
        console.log(`   🔁 Found resume checkpoint with ${completedRefs.size} already completed certificates.\n`);
      }
    } catch (e) {
      // ignore
    }
  }

  console.log(`🚀 Phase 3: Uploading to S3 and updating MongoDB (${CONCURRENCY} parallel workers)...`);
  console.log(`   Target format: "/api/files/s3/certificates/<timestamp>_<rand>_<certNo>.pdf"\n`);

  const report = {
    timestamp: new Date().toISOString(),
    uploaded: [],
    skipped_already_has_api_url: [],
    skipped_no_blob: [],
    already_done: [],
    errors: [],
  };

  let uploaded = 0;
  let noMatch = 0;
  let alreadyDone = 0;
  let skippedExisting = 0;
  let errors = 0;

  // Build work items
  const queue = [];
  for (const mongoCert of mongoCerts) {
    const certNo = (mongoCert.certificate_number || '').trim();
    const certKey = certNo.toLowerCase();

    // If it already has a valid /api/files/s3/ URL, skip to protect newly issued certs
    if (mongoCert.certificate_url && mongoCert.certificate_url.startsWith('/api/files/s3/')) {
      skippedExisting++;
      report.skipped_already_has_api_url.push({ certificate_number: certNo, url: mongoCert.certificate_url });
      continue;
    }

    if (completedRefs.has(certKey)) {
      alreadyDone++;
      report.already_done.push(certNo);
      continue;
    }

    const blobEntry = blobIndex.get(certKey);
    if (!blobEntry) {
      noMatch++;
      report.skipped_no_blob.push({ certificate_number: certNo, company: mongoCert.company_name });
      continue;
    }

    queue.push({ mongoCert, blobEntry, certNo, certKey });
  }

  console.log(`   Queue: ${queue.length} certs to upload | Existing API URLs skipped: ${skippedExisting} | Already done: ${alreadyDone} | No SQL blob: ${noMatch}\n`);

  // Worker function
  let queueIndex = 0;
  async function worker() {
    while (queueIndex < queue.length) {
      const item = queue[queueIndex++];
      if (!item) break;

      const { mongoCert, blobEntry, certNo, certKey } = item;
      const { key: s3Key, url: s3Url, cleanFilename } = generateS3KeyAndUrl(certNo);

      try {
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
          ContentDisposition: `inline; filename="${encodeURIComponent(cleanFilename)}"`,
          Metadata: {
            certificate_number: toAscii(certNo),
            company_name: toAscii(mongoCert.company_name),
            cert_name: toAscii(blobEntry.certName),
          },
        }));

        // Update MongoDB with the /api/files/s3/ URL
        await mongoCol.updateOne(
          { _id: mongoCert._id },
          { $set: { certificate_url: s3Url } }
        );

        uploaded++;
        completedRefs.add(certKey);
        report.uploaded.push({
          certificate_number: certNo,
          company: mongoCert.company_name,
          s3_key: s3Key,
          certificate_url: s3Url,
          size_kb: blobEntry.sizeKB,
        });

        // Save progress every 25 uploads
        if (uploaded % 25 === 0) {
          fs.writeFileSync(RESUME_PATH, JSON.stringify({ completed: [...completedRefs] }));
          process.stdout.write(`\r   ✅ Uploaded: ${uploaded}/${queue.length} | No match: ${noMatch} | Errors: ${errors}   `);
        }
      } catch (err) {
        errors++;
        console.error(`\n   ❌ Error for ${certNo}: ${err.message}`);
        report.errors.push({ certificate_number: certNo, error: err.message });
      }
    }
  }

  // Run workers concurrently
  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  // Final progress save
  fs.writeFileSync(RESUME_PATH, JSON.stringify({ completed: [...completedRefs] }));
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log(`\n\n${'='.repeat(80)}`);
  console.log('  UPLOAD & UPDATE SUMMARY');
  console.log('='.repeat(80));
  console.log(`  ✅ Successfully uploaded to S3 & MongoDB updated : ${uploaded}`);
  console.log(`  ⏭️  Already had valid /api/files/s3/ URL         : ${skippedExisting}`);
  console.log(`  ⏭️  Skipped (no blob found in SQL)               : ${noMatch}`);
  console.log(`  🔁 Already done (resume checkpoint)              : ${alreadyDone}`);
  console.log(`  ❌ Errors                                        : ${errors}`);
  console.log(`  📄 Detailed report written to                    : scratch/s3_upload_report.json`);
  console.log('='.repeat(80));

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('\n💥 FATAL ERROR:', err);
  process.exit(1);
});
