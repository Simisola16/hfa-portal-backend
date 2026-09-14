import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument } from 'pdf-lib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

async function inspect() {
  const filePath = path.resolve(rootDir, 'Template GSO Scheme (meat) Cert-unlocked (1).pdf');
  console.log('Inspecting file:', filePath);
  const pdfBytes = fs.readFileSync(filePath);
  console.log('Size:', pdfBytes.length);
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  console.log('Pages:', doc.getPageCount());
  const page = doc.getPage(0);
  console.log('Dimensions:', page.getWidth(), 'x', page.getHeight());
}

inspect().catch(console.error);
