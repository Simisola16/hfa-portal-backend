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

async function inspect(fileName) {
  const p = path.join(__dirname, '../assets/certificates', fileName);
  console.log(`\n======================================================`);
  console.log(`FILE: ${fileName}`);
  console.log(`======================================================`);
  const buf = fs.readFileSync(p);
  
  // Custom page render using pdf-parse internal PDFJS
  const render = async function(pageData) {
    const textContent = await pageData.getTextContent();
    const items = textContent.items.map(it => ({
      str: it.str,
      x: it.transform[4],
      y: it.transform[5],
      w: it.width,
      h: it.height
    })).filter(it => it.str.trim().length > 0);
    
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    for (const it of items) {
      console.log(`x: ${it.x.toFixed(2).padStart(6)}, y: ${it.y.toFixed(2).padStart(6)}, w: ${it.w.toFixed(2).padStart(6)} | "${it.str}"`);
    }
    return "";
  };

  const parser = new PDFParse({ data: buf, pagerender: render });
  await parser.getText();
}

async function main() {
  for (const t of templates) {
    await inspect(t);
  }
}

main().catch(console.error);
