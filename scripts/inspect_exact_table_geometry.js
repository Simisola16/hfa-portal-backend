import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument } from 'pdf-lib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const templates = [
  'Template GSO Scheme (meat) Cert-unlocked (1) 1.pdf',
  'Template GSO Scheme (Non-meat) Cert-unlocked 1.pdf',
  'Template HFA Scheme (meat) Cert 11 Oct 22-unlocked.pdf',
  'Template HFA Scheme (Non-meat) Cert 11 Oct 22-unlocked.pdf',
  'Template HFA Scheme (Cosmetic) Cert 11 Oct 22-unlocked 1.pdf'
];

async function inspect(fileName) {
  const p = path.join(__dirname, '../assets/certificates', fileName);
  console.log(`\n======================================================`);
  console.log(`INSPECTING: ${fileName}`);
  console.log(`======================================================`);
  const buf = fs.readFileSync(p);
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  const page = doc.getPage(0);
  console.log('Page size:', page.getWidth(), 'x', page.getHeight());

  // Let's decode the content stream of the page to find coordinates of rectangles and text
  const contents = page.node.Contents();
  const stream = Array.isArray(contents) ? contents.map(c => c.asString()).join('\n') : (contents ? contents.asString() : '');
  
  // Find lines with re (rectangles) or Tm / Td (text matrix)
  const lines = stream.split('\n');
  console.log(`Found ${lines.length} content stream lines.`);

  // Search for table-related keywords or asterisks in content stream
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.includes('NO.') || l.includes('CODE') || l.includes('DESCRIPTION') || l.includes('PRODUCTS') || l.includes('****') || l.includes('COMPANY')) {
      console.log(`Line ${i}:`, l);
      // Print 5 preceding and 5 following lines
      for (let j = Math.max(0, i - 5); j <= Math.min(lines.length - 1, i + 5); j++) {
        console.log(`  [${j}] ${lines[j]}`);
      }
      console.log('---');
    }
  }
}

async function main() {
  for (const t of templates) {
    await inspect(t);
  }
}

main().catch(console.error);
