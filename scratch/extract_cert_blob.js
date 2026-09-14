/**
 * extract_cert_blob.js
 * ─────────────────────────────────────────────────────────────
 * READ-ONLY: Streams dbo.RegCert.json line by line (3.5GB),
 * finds the first row with a valid Cerfile PDF blob,
 * and saves it as a .pdf file. The source JSON is never modified.
 *
 * Usage:
 *   node scratch/extract_cert_blob.js
 *   node scratch/extract_cert_blob.js --index 5   (pick the 5th cert)
 *   node scratch/extract_cert_blob.js --ref "LE-MU/QR230608100050"
 * ─────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const SOURCE_FILE = path.join(
  __dirname,
  '../sql-server-export/export/HalalCert/tables/dbo.RegCert.json'
);

// Parse CLI args
const args = process.argv.slice(2);
const indexArg = args.indexOf('--index');
const refArg   = args.indexOf('--ref');
const targetIndex = indexArg !== -1 ? parseInt(args[indexArg + 1], 10) : 42; // default: first cert
const targetRef   = refArg !== -1 ? args[refArg + 1] : null;

console.log('=== HFA Certificate Blob Extractor (READ-ONLY) ===');
console.log(`Source : ${SOURCE_FILE}`);
if (targetRef)   console.log(`Looking for CertificateRefNo: "${targetRef}"`);
else             console.log(`Extracting cert at index     : ${targetIndex}`);
console.log('');

async function extract() {
  if (!fs.existsSync(SOURCE_FILE)) {
    console.error(`ERROR: Source file not found:\n  ${SOURCE_FILE}`);
    process.exit(1);
  }

  const fileStream = fs.createReadStream(SOURCE_FILE, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let inRowsSection = false;
  let rowBuffer = '';
  let rowCount = 0;
  let certCount = 0; // certs with actual Cerfile data
  let found = false;

  for await (const line of rl) {
    const trimmed = line.trim();

    // Detect start of rows array
    if (!inRowsSection) {
      if (trimmed === '"rows": [') {
        inRowsSection = true;
      }
      continue;
    }

    // Accumulate lines into rowBuffer until we have a complete JSON object
    rowBuffer += line + '\n';

    // Each row is a single very long line in this export — try to parse when we see a closing }
    // The rows are written one-per-line as compact JSON objects
    const isCompleteLine = trimmed.startsWith('{') && (trimmed.endsWith('},') || trimmed.endsWith('}'));
    if (!isCompleteLine) {
      // multi-line row — keep buffering
      const openBraces  = (rowBuffer.match(/\{/g) || []).length;
      const closeBraces = (rowBuffer.match(/\}/g) || []).length;
      if (openBraces === 0 || openBraces !== closeBraces) continue;
    }

    // Clean and parse the buffered row
    let rowJson = rowBuffer.trim();
    rowBuffer = '';

    // Strip trailing comma if present
    if (rowJson.endsWith(',')) rowJson = rowJson.slice(0, -1);
    if (rowJson === ']' || rowJson === '}') break; // end of rows/file

    let row;
    try {
      row = JSON.parse(rowJson);
    } catch {
      continue; // skip unparseable
    }

    rowCount++;

    // Must have a Cerfile blob
    const cerfile = row.Cerfile;
    if (!cerfile || !cerfile.data) continue;

    const certRef = (row.CertificateRefNo || '').trim();
    const company = (row.CompanyName || 'Unknown').trim();

    certCount++;

    // Check if this is the one we want
    const isTarget = targetRef
      ? certRef === targetRef
      : certCount - 1 === targetIndex;

    if (!isTarget) continue;

    // ── Found it ──────────────────────────────────────────────
    found = true;
    rl.close();
    fileStream.destroy();

    console.log(`✅ Found certificate:`);
    console.log(`   CertificateRefNo : ${certRef || '(empty)'}`);
    console.log(`   CompanyName      : ${company}`);
    console.log(`   DateSent         : ${(row.DateSent || '').trim()}`);
    console.log(`   EpriyeDate       : ${(row.EpriyeDate || '').trim()}`);
    console.log(`   CertificatType   : ${row.CertificatType || ''}`);
    console.log(`   IDColl           : ${row.IDColl}`);
    console.log(`   Blob encoding    : ${cerfile.encoding || 'base64'}`);
    console.log(`   Blob size        : ${Math.round(cerfile.data.length * 0.75 / 1024)} KB (approx)`);
    console.log('');

    // Decode base64 blob → Buffer
    const pdfBuffer = Buffer.from(cerfile.data, cerfile.encoding || 'base64');

    // Check PDF magic bytes (%PDF)
    const magic = pdfBuffer.slice(0, 4).toString('ascii');
    if (magic !== '%PDF') {
      console.warn(`⚠️  Warning: File does not start with %PDF (got: ${magic}). May not be a PDF.`);
    } else {
      console.log('   Magic bytes      : %PDF ✓');
    }

    // Save to scratch folder — read-only extraction, source untouched
    const safeName = (certRef || `cert-${rowCount}`).replace(/[/\\:*?"<>|]/g, '_');
    const outPath  = path.join(__dirname, `extracted_${safeName}.pdf`);
    fs.writeFileSync(outPath, pdfBuffer);

    console.log(`\n📄 Certificate saved to:\n   ${outPath}`);
    console.log('\nOpen the file above in any PDF viewer to see the certificate.');
    break;
  }

  if (!found) {
    console.log(`\n❌ No matching certificate found.`);
    console.log(`   Total rows scanned     : ${rowCount}`);
    console.log(`   Rows with Cerfile data : ${certCount}`);
    if (targetRef) {
      console.log(`   Searched for ref       : "${targetRef}"`);
    } else {
      console.log(`   Requested index        : ${targetIndex} (0-based)`);
    }
  }
}

extract().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
