const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

const outputs = [
  { name: 'GSO Meat', file: 'output_gso_meat.pdf' },
  { name: 'GSO Non-Meat', file: 'output_gso_non_meat.pdf' },
  { name: 'HFA Scheme Meat', file: 'output_hfa_scheme_meat.pdf' },
  { name: 'HFA Scheme Non-Meat', file: 'output_hfa_scheme_non_meat.pdf' },
  { name: 'Cosmetics', file: 'output_cosmetics.pdf' },
  { name: 'SMIIC', file: 'output_smiic.pdf' }
];

async function verify() {
  for (const o of outputs) {
    const p = path.join(__dirname, '../../scratch', o.file);
    console.log(`\n======================================================`);
    console.log(`VERIFYING GENERATED: ${o.name} (${o.file})`);
    console.log(`======================================================`);
    if (fs.existsSync(p)) {
      const dataBuffer = fs.readFileSync(p);
      const parser = new PDFParse({ data: dataBuffer });
      const res = await parser.getText();
      console.log(`--- EXTRACTED TEXT ---`);
      console.log(res.text || res);
      console.log(`----------------------`);
    } else {
      console.log('File does not exist:', p);
    }
  }
}

verify().catch(console.error);
