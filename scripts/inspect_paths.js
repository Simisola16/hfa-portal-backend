import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, PDFName, PDFArray, PDFDict } from 'pdf-lib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function inspect(f) {
  const fullPath = path.join(__dirname, '../assets/certificates', f);
  const buf = fs.readFileSync(fullPath);
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  const page = doc.getPage(0);
  console.log('=== PAGE DIMS ===', page.getWidth(), page.getHeight());
  
  const contents = page.node.Contents();
  const streams = contents.array ? contents.array : [contents];
  for (const s of streams) {
    const rawBytes = s.asUint8Array();
    const str = Buffer.from(rawBytes).toString('latin1');
    const lines = str.split(/[\r\n]+/);
    for (const line of lines) {
      if (line.includes(' re') || line.includes(' m') || line.includes(' l')) {
        const matches = line.match(/-?\d+\.?\d*/g);
        if (matches && matches.length >= 2) {
          const nums = matches.map(Number);
          if (nums.some(n => n >= 220 && n <= 320)) {
            console.log('Path:', line.trim());
          }
        }
      }
    }
  }
}

inspect('Template HFA Scheme (meat) Cert 11 Oct 22-unlocked.pdf');
