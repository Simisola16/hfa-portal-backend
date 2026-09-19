import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument } from 'pdf-lib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function inspect(fileName) {
  const filePath = path.join(__dirname, '../assets/certificates', fileName);
  if (!fs.existsSync(filePath)) {
    console.log('Not found:', filePath);
    return;
  }
  const buf = fs.readFileSync(filePath);
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  const page = doc.getPage(0);
  console.log(`\n=== ${fileName} ===`);
  console.log(`Page size: ${page.getWidth()} x ${page.getHeight()}`);
}

async function main() {
  await inspect('Template GSO Scheme (meat) Cert-unlocked (1) 1.pdf');
  await inspect('Template GSO Scheme (Non-meat) Cert-unlocked 1.pdf');
  await inspect('Template HFA Scheme (meat) Cert 11 Oct 22-unlocked.pdf');
  await inspect('Template HFA Scheme (Non-meat) Cert 11 Oct 22-unlocked.pdf');
  await inspect('Template HFA Scheme (Cosmetic) Cert 11 Oct 22-unlocked 1.pdf');
}

main().catch(console.error);
