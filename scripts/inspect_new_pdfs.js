import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument } from 'pdf-lib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const files = [
  'Template GSO Scheme (meat) Cert-unlocked (1) 2.pdf',
  'Template GSO Scheme (Non-meat) Cert-unlocked 2.pdf',
  'Template HFA Scheme (meat) Cert 11 Oct 22-unlocked 1.pdf',
  'Template HFA Scheme (Non-meat) Cert 11 Oct 22-unlocked 2.pdf',
  'Template HFA Scheme (Cosmetic) Cert 11 Oct 22-unlocked 2.pdf',
  'Template GSO Scheme (meat) Cert.pdf',
  'Template HFA Scheme (Cosmetic) Cert 11 Oct 22.pdf'
];

async function inspect() {
  for (const file of files) {
    const fullPath = path.join(rootDir, file);
    if (!fs.existsSync(fullPath)) {
      console.log(`File not found: ${file}`);
      continue;
    }
    const buf = fs.readFileSync(fullPath);
    try {
      const pdfDoc = await PDFDocument.load(buf, { ignoreEncryption: true });
      const page = pdfDoc.getPage(0);
      const { width, height } = page.getSize();
      console.log(`OK: ${file} | size: ${width.toFixed(2)} x ${height.toFixed(2)} | pages: ${pdfDoc.getPageCount()}`);
    } catch (e) {
      console.log(`ERROR on ${file}: ${e.message}`);
    }
  }
}

inspect().catch(console.error);
