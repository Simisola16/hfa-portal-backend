import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function inspectStream(fileName) {
  const p = path.join(__dirname, '../assets/certificates', fileName);
  console.log(`\n======================================================`);
  console.log(`INSPECTING STREAM: ${fileName}`);
  console.log(`======================================================`);
  const buf = fs.readFileSync(p);
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  const page = doc.getPage(0);

  const contents = page.node.Contents();
  const streams = Array.isArray(contents) ? contents : [contents];
  
  for (let i = 0; i < streams.length; i++) {
    const stream = streams[i];
    const bytes = stream.getContents();
    const str = Buffer.from(bytes).toString('latin1');
    console.log(`Stream ${i}: length ${bytes.length} bytes`);
    
    // Look for asterisks in stream
    if (str.includes('****') || str.includes('250.58') || str.includes('217.34')) {
      console.log(`Stream ${i} contains asterisks or table coords!`);
    }
  }
}

async function main() {
  await inspectStream('Template GSO Scheme (meat) Cert-unlocked (1) 1.pdf');
  await inspectStream('Template GSO Scheme (Non-meat) Cert-unlocked 1.pdf');
  await inspectStream('Template HFA Scheme (meat) Cert 11 Oct 22-unlocked.pdf');
  await inspectStream('Template HFA Scheme (Non-meat) Cert 11 Oct 22-unlocked.pdf');
  await inspectStream('Template HFA Scheme (Cosmetic) Cert 11 Oct 22-unlocked 1.pdf');
}

main().catch(console.error);
