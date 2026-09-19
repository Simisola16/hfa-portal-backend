import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, PDFRawStream } from 'pdf-lib';
import zlib from 'zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function cleanPdfStreams(filePath) {
  const buf = fs.readFileSync(filePath);
  let doc;
  try {
    doc = await PDFDocument.load(buf);
  } catch (e) {
    console.log(`Failed to load ${path.basename(filePath)}: ${e.message}`);
    return;
  }
  
  const pages = doc.getPages();
  let modified = false;

  for (const page of pages) {
    const { Contents } = page.node.normalizedEntries();
    if (!Contents) continue;

    // Contents can be a single stream or an array of streams
    const streams = Contents.asArray ? Contents.asArray() : [Contents];

    for (const ref of streams) {
      const stream = doc.context.lookup(ref);
      if (!stream) continue;

      let rawBytes;
      if (stream.contents) {
        rawBytes = stream.contents;
      } else if (stream.getBytes) {
        rawBytes = stream.getBytes();
      }

      if (!rawBytes) continue;

      // Try decompressing
      let decodedStr;
      let isCompressed = false;
      try {
        decodedStr = zlib.inflateSync(Buffer.from(rawBytes)).toString('latin1');
        isCompressed = true;
      } catch (e) {
        decodedStr = Buffer.from(rawBytes).toString('latin1');
      }

      if (decodedStr.includes('*') && decodedStr.includes('****')) {
        console.log(`Found asterisks in stream of ${path.basename(filePath)}`);
        // Remove text showing asterisks e.g. (****************) Tj or [(***)...]
        const cleanedStr = decodedStr.replace(/\([*]{4,}\)/g, '()').replace(/\[\s*\([*]{4,}\)\s*\]\s*TJ/g, '() Tj');
        if (cleanedStr !== decodedStr) {
          console.log(`Successfully removed asterisks from ${path.basename(filePath)}!`);
          const newBytes = isCompressed ? zlib.deflateSync(Buffer.from(cleanedStr, 'latin1')) : Buffer.from(cleanedStr, 'latin1');
          // Update stream
          const newStream = doc.context.flateStream(cleanedStr);
          doc.context.assign(ref, newStream);
          modified = true;
        }
      }
    }
  }

  if (modified) {
    const saved = await doc.save();
    fs.writeFileSync(filePath, saved);
    console.log(`Saved cleaned PDF: ${path.basename(filePath)}`);
  }
}

async function run() {
  const certsDir = path.join(__dirname, '../assets/certificates');
  const files = [
    'Template GSO Scheme (meat) Cert-unlocked (1) 2.pdf',
    'Template GSO Scheme (Non-meat) Cert-unlocked 2.pdf',
    'Template HFA Scheme (meat) Cert 11 Oct 22-unlocked 1.pdf',
    'Template HFA Scheme (Non-meat) Cert 11 Oct 22-unlocked 2.pdf',
    'Template HFA Scheme (Cosmetic) Cert 11 Oct 22-unlocked 1.pdf'
  ];
  for (const f of files) {
    await cleanPdfStreams(path.join(certsDir, f));
  }
}

run().catch(console.error);
