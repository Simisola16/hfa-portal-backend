import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument } from 'pdf-lib';
import zlib from 'zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function inspect(fileName) {
  const fullPath = path.join(__dirname, '../assets/certificates', fileName);
  if (!fs.existsSync(fullPath)) return;
  const buf = fs.readFileSync(fullPath);
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  const page = doc.getPage(0);
  
  console.log(`\n======================================================`);
  console.log(`FILE: ${fileName}`);
  console.log(`======================================================`);

  const contents = page.node.Contents();
  const streams = contents.array ? contents.array : [contents];
  
  for (let i = 0; i < streams.length; i++) {
    const s = streams[i];
    let raw;
    try {
      raw = s.asUint8Array();
    } catch {
      continue;
    }
    
    // Try inflating if compressed
    let str = '';
    try {
      str = zlib.inflateSync(Buffer.from(raw)).toString('latin1');
    } catch {
      str = Buffer.from(raw).toString('latin1');
    }
    
    // Search for all rectangles 'x y w h re'
    const reRegex = /([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+re/g;
    let match;
    while ((match = reRegex.exec(str)) !== null) {
      const x = parseFloat(match[1]);
      const y = parseFloat(match[2]);
      const w = parseFloat(match[3]);
      const h = parseFloat(match[4]);
      console.log(`Rectangle: x=${x.toFixed(2)}, y=${y.toFixed(2)}, w=${w.toFixed(2)}, h=${h.toFixed(2)}`);
    }

    // Search for any line command 'm ... l' or 'm ... c' or 'm ... S'
    const anyOpRegex = /([-\d.]+)\s+([-\d.]+)\s+m\s+([-\d.]+)\s+([-\d.]+)\s+[l]/g;
    while ((match = anyOpRegex.exec(str)) !== null) {
      console.log(`Line: (${match[1]}, ${match[2]}) -> (${match[3]}, ${match[4]})`);
    }
  }
}

async function main() {
  await inspect('Template GSO Scheme (meat) Cert-unlocked (1) 1.pdf');
  await inspect('Template HFA Scheme (meat) Cert 11 Oct 22-unlocked.pdf');
}

main().catch(console.error);
