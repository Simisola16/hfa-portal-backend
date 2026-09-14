import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { PDFDocument } from 'pdf-lib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function inspectStreamDecompressed(fileName) {
  const p = path.join(__dirname, '../assets/certificates', fileName);
  console.log(`\n======================================================`);
  console.log(`FILE: ${fileName}`);
  console.log(`======================================================`);
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

  console.log('Decompressed text length:', text.length);
  
  // Search for table text or asterisks
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.includes('NO.') || l.includes('CODE') || l.includes('DESCRIPTION') || l.includes('PRODUCTS') || l.includes('****') || l.includes('300.') || l.includes('250.')) {
      console.log(`Line ${i}: ${l}`);
      for (let j = Math.max(0, i - 3); j <= Math.min(lines.length - 1, i + 3); j++) {
        console.log(`  [${j}] ${lines[j]}`);
      }
      console.log('---');
    }
  }
}

async function main() {
  await inspectStreamDecompressed('Template GSO Scheme (meat) Cert-unlocked (1) 1.pdf');
}

main().catch(console.error);
