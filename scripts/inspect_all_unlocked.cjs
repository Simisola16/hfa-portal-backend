const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

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
    if (fs.existsSync(p)) {
      const dataBuffer = fs.readFileSync(p);
      try {
        const parser = new PDFParse({ data: dataBuffer });
        const res = await parser.getText();
        console.log(`--- EXTRACTED TEXT (${t.name}) ---`);
        console.log(res.text || res);
        console.log(`-----------------------------------`);
      } catch (err) {
        console.log(`Error parsing ${t.name}:`, err.message);
      }
    } else {
      console.log('File does not exist:', p);
    }
  }
}

inspect().catch(console.error);
