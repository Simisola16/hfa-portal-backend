import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument } from 'pdf-lib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function inspectPdfLib(fileName) {
  const filePath = path.join(__dirname, '../assets/certificates', fileName);
  const buf = fs.readFileSync(filePath);
  const doc = await PDFDocument.load(buf);
  const page = doc.getPage(0);
  console.log(`\n=== ${fileName} === size: ${page.getWidth()} x ${page.getHeight()}`);
}

async function run() {
  await inspectPdfLib('Template GSO Scheme (meat) Cert-unlocked (1) 2.pdf');
  await inspectPdfLib('Template GSO Scheme (Non-meat) Cert-unlocked 2.pdf');
  await inspectPdfLib('Template HFA Scheme (meat) Cert 11 Oct 22-unlocked 1.pdf');
  await inspectPdfLib('Template HFA Scheme (Non-meat) Cert 11 Oct 22-unlocked 2.pdf');
  await inspectPdfLib('Template HFA Scheme (Cosmetic) Cert 11 Oct 22-unlocked 1.pdf');
}
run().catch(console.error);
