import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument } from 'pdf-lib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function inspect(f) {
  const buf = fs.readFileSync(path.join(__dirname, '../assets/certificates', f));
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  const page = doc.getPage(0);
  const { PDFContentStream, PDFOperator } = await import('pdf-lib');
  console.log('=== ' + f + ' ===');
}

inspect('Template HFA Scheme (meat) Cert 11 Oct 22-unlocked.pdf');
