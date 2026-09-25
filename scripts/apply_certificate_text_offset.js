import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument } from 'pdf-lib';
import zlib from 'zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const certAssetsDir = path.resolve(__dirname, '../assets/certificates');
const rootDir = path.resolve(__dirname, '../..');

/**
 * Shifts the baked-in declaration text block in the certificate PDF template downwards
 * so that it provides generous, professional breathing room below "Original Cycle Start Date"
 * (and "Current Cycle Start Date"), rather than sitting awkwardly cramped directly beneath it.
 */
async function shiftPdfText(fileName, replacements) {
  const primaryPath = path.join(certAssetsDir, fileName);
  const rootPath = path.join(rootDir, fileName);

  console.log(`\nProcessing ${fileName}...`);
  const buf = fs.readFileSync(primaryPath);
  const doc = await PDFDocument.load(buf);
  const page = doc.getPage(0);
  const contents = page.node.Contents();
  const arr = contents.asArray ? contents.asArray() : [contents];
  const obj = doc.context.lookup(arr[0]);

  let str = zlib.inflateSync(obj.asUint8Array()).toString('utf-8');

  let allReplaced = true;
  for (const { target, replacement } of replacements) {
    if (!str.includes(target)) {
      console.warn(`  Warning: Target '${target}' not found in ${fileName}`);
      allReplaced = false;
    } else {
      str = str.replace(target, replacement);
      console.log(`  ✓ Successfully shifted: '${target}' -> '${replacement}'`);
    }
  }

  if (allReplaced) {
    obj.contents = zlib.deflateSync(Buffer.from(str, 'utf-8'));
    const newBuf = await doc.save();
    
    // Save to backend/assets/certificates/
    fs.writeFileSync(primaryPath, newBuf);
    console.log(`  ✓ Updated primary asset: ${primaryPath} (${newBuf.length} bytes)`);

    // Sync to workspace root if present
    if (fs.existsSync(rootPath)) {
      fs.writeFileSync(rootPath, newBuf);
      console.log(`  ✓ Updated root asset copy: ${rootPath}`);
    }
  } else {
    console.error(`  ❌ Failed to complete all replacements for ${fileName}`);
  }
}

async function main() {
  // 1. GSO MEAT.pdf
  // Move down by 22.0pt:
  // Line 1: 578.0353 -> 556.0353
  // Line 3: 563.6353 -> 541.6353
  // Gap below Original Cycle Start Date (590.0) becomes 34.0pt
  // Gap above COMPANY NAME (480.0) becomes 32.8pt
  await shiftPdfText('GSO MEAT.pdf', [
    { target: '12 56.9698 578.0353 Tm', replacement: '12 56.9698 556.0353 Tm' },
    { target: '12 69.4943 563.6353 Tm', replacement: '12 69.4943 541.6353 Tm' }
  ]);

  // 2. GSO NON MEAT.pdf
  // Move down by 13.7pt:
  // Line 1: 569.7372 -> 556.0353
  // Gap below Original Cycle Start Date (590.0) becomes 34.0pt
  await shiftPdfText('GSO NON MEAT.pdf', [
    { target: '12 55.3896 569.7372 Tm', replacement: '12 55.3896 556.0353 Tm' }
  ]);

  // 3. HFA SCHEME.pdf
  // Move down by 19.0pt:
  // Line 1: 599.0225 -> 580.0225
  // Line 2: 584.6224 -> 565.6224
  // Gap below date row (610.0) becomes 30.0pt
  await shiftPdfText('HFA SCHEME.pdf', [
    { target: '12 58.2067 599.0225 Tm', replacement: '12 58.2067 580.0225 Tm' },
    { target: '12 70.7311 584.6224 Tm', replacement: '12 70.7311 565.6224 Tm' }
  ]);

  console.log('\n🎉 All certificate templates successfully updated and calibrated!');
}

main().catch(console.error);
