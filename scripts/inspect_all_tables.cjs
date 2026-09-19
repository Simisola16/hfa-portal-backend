const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

const templates = [
  'Template GSO Scheme (meat) Cert-unlocked (1) 1.pdf',
  'Template GSO Scheme (Non-meat) Cert-unlocked 1.pdf',
  'Template HFA Scheme (meat) Cert 11 Oct 22-unlocked.pdf',
  'Template HFA Scheme (Non-meat) Cert 11 Oct 22-unlocked.pdf',
  'Template HFA Scheme (Cosmetic) Cert 11 Oct 22-unlocked 1.pdf'
];

async function main() {
  for (const t of templates) {
    const p = path.join(__dirname, '../assets/certificates', t);
    console.log(`\n======================================================`);
    console.log(`TEMPLATE: ${t}`);
    console.log(`======================================================`);
    const buf = fs.readFileSync(p);
    const parser = new PDFParse({ data: buf });
    const tableInfo = await parser.getTable();
    console.log('TABLES:', JSON.stringify(tableInfo, null, 2));
  }
}

main().catch(console.error);
