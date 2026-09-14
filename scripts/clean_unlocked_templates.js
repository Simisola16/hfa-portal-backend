import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { PDFDocument, PDFName } from 'pdf-lib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const templates = [
  'Template GSO Scheme (meat) Cert-unlocked (1) 1.pdf',
  'Template GSO Scheme (Non-meat) Cert-unlocked 1.pdf',
  'Template HFA Scheme (meat) Cert 11 Oct 22-unlocked.pdf',
  'Template HFA Scheme (Non-meat) Cert 11 Oct 22-unlocked.pdf',
  'Template HFA Scheme (Cosmetic) Cert 11 Oct 22-unlocked 1.pdf'
];

async function cleanTemplate(fileName) {
  const p = path.join(__dirname, '../assets/certificates', fileName);
  console.log(`\nCleaning template: ${fileName}`);
  const buf = fs.readFileSync(p);
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  const page = doc.getPage(0);
  const contents = page.node.Contents();
  const rawBytes = contents.getContents();
  
  let text = '';
  try {
    text = zlib.inflateSync(Buffer.from(rawBytes)).toString('latin1');
  } catch (e) {
    text = Buffer.from(rawBytes).toString('latin1');
  }

  // Replace asterisks text blocks
  let modified = text;
  if (modified.includes('****************')) {
    console.log('Found asterisks! Removing from content stream...');
    modified = modified.replace(/\(\*{10,25}\)Tj/g, '()Tj');
    modified = modified.replace(/\[\s*\(\*{10,25}\)\s*\]TJ/g, '[]TJ');
    modified = modified.replace(/\(\*{10,25}\)/g, '()');
  }

  const newStream = doc.context.flateStream(Buffer.from(modified, 'latin1'));
  const newStreamRef = doc.context.register(newStream);
  page.node.set(PDFName.of('Contents'), newStreamRef);

  const outBytes = await doc.save();
  fs.writeFileSync(p, outBytes);
  const rootP = path.join(rootDir, fileName);
  if (fs.existsSync(rootP)) {
    fs.writeFileSync(rootP, outBytes);
  }
  console.log(`✅ Successfully cleaned and saved: ${fileName} (${outBytes.length} bytes)`);
}

async function main() {
  for (const t of templates) {
    await cleanTemplate(t);
  }
}

main().catch(console.error);
