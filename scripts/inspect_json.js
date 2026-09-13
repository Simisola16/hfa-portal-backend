import fs from 'fs';
import path from 'path';

function inspectJson(file) {
  const p = path.resolve('..', 'scratch', 'pdf_renders', file);
  if (!fs.existsSync(p)) {
    console.log('Not found:', p);
    return;
  }
  const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
  console.log('\n==============================');
  console.log('=== ' + file + ' ===');
  console.log('==============================');
  data[0].forEach(item => {
    if (item.str && item.str.trim()) {
      console.log(`${item.str.padEnd(45)} | x: ${Math.round(item.x).toString().padStart(3)}, y: ${Math.round(item.y).toString().padStart(3)}, w: ${Math.round(item.width).toString().padStart(3)}, h: ${Math.round(item.height).toString().padStart(2)}, font: ${item.fontName}`);
    }
  });
}

const files = [
  'Template_GSO_Scheme__meat__Cert_pdf_text.json',
  'Template_HFA_Scheme__Cosmetic__Cert_11_Oct_22_pdf_text.json',
  'COSMETICS_pdf_text.json',
  'GSO_MEAT_pdf_text.json',
  'GSO_NON_MEAT_pdf_text.json',
  'HFA_SCHEME_pdf_text.json',
  'SMIIC_pdf_text.json'
];

files.forEach(inspectJson);
