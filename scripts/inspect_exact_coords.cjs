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
    console.log(`INSPECTING COORDS: ${t.name}`);
    console.log(`======================================================`);
    const dataBuffer = fs.readFileSync(p);
    
    // Custom page renderer to get text item positions
    let items = [];
    const customRender = async function(pageData) {
      const textContent = await pageData.getTextContent();
      for (const item of textContent.items) {
        if (item.str && item.str.trim()) {
          items.push({
            str: item.str,
            x: item.transform[4],
            y: item.transform[5],
            w: item.width,
            h: item.height,
            font: item.fontName
          });
        }
      }
      return "";
    };

    const parser = new PDFParse({ data: dataBuffer, pagerender: customRender });
    await parser.getText();

    items.sort((a, b) => b.y - a.y || a.x - b.x);
    for (const item of items) {
      console.log(`x: ${item.x.toFixed(2).padStart(6)}, y: ${item.y.toFixed(2).padStart(6)}, w: ${item.w.toFixed(2).padStart(6)}, h: ${item.h.toFixed(2).padStart(5)} | "${item.str}"`);
    }
  }
}

inspect().catch(console.error);
