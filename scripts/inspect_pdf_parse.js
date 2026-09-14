import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const templates = [
  { name: 'GSO Meat', file: 'Template GSO Scheme (meat) Cert-unlocked (1) 1.pdf' },
  { name: 'GSO Non-Meat', file: 'Template GSO Scheme (Non-meat) Cert-unlocked 1.pdf' },
  { name: 'HFA Scheme Meat', file: 'Template HFA Scheme (meat) Cert 11 Oct 22-unlocked.pdf' },
  { name: 'HFA Scheme Non-Meat', file: 'Template HFA Scheme (Non-meat) Cert 11 Oct 22-unlocked.pdf' },
  { name: 'Cosmetics', file: 'Template HFA Scheme (Cosmetic) Cert 11 Oct 22-unlocked 1.pdf' }
];

async function inspect() {
  for (const t of templates) {
    const p = path.join(__dirname, '../assets/certificates', t.file);
    console.log(`\n======================================================`);
    console.log(`FILE: ${t.name} -> ${t.file}`);
    console.log(`EXISTS: ${fs.existsSync(p)} | SIZE: ${fs.existsSync(p) ? fs.statSync(p).size : 0}`);
    if (fs.existsSync(p)) {
      const dataBuffer = fs.readFileSync(p);
      const data = await pdfParse(dataBuffer);
      console.log(`NUM PAGES: ${data.numpages}`);
      console.log(`--- EXTRACTED TEXT ---`);
      console.log(data.text);
      console.log(`----------------------`);
    }
  }
}

inspect().catch(console.error);
