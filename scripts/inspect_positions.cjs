const fs = require('fs');
const path = require('path');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

async function inspect(filePath) {
  console.log('========================================');
  console.log('FILE:', path.basename(filePath));
  console.log('========================================');
  const fullPath = path.resolve(__dirname, '../../', filePath);
  if (!fs.existsSync(fullPath)) {
    console.log('NOT FOUND:', fullPath);
    return;
  }
  const data = new Uint8Array(fs.readFileSync(fullPath));
  const doc = await pdfjs.getDocument({data}).promise;
  console.log('Page count:', doc.numPages);
  const page = await doc.getPage(1);
  const viewport = page.getViewport({scale: 1.0});
  console.log('Viewport:', viewport.width, 'x', viewport.height);
  const content = await page.getTextContent();
  content.items.sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);
  for (const item of content.items) {
    if (item.str && item.str.trim()) {
      console.log(`x: ${item.transform[4].toFixed(2)}, y: ${item.transform[5].toFixed(2)}, w: ${item.width.toFixed(2)}, h: ${item.height.toFixed(2)}, font: ${item.fontName} | "${item.str}"`);
    }
  }
}

async function main() {
  await inspect('Template GSO Scheme (meat) Cert-unlocked (1) 1.pdf');
  await inspect('Template GSO Scheme (Non-meat) Cert-unlocked 1.pdf');
  await inspect('Template HFA Scheme (meat) Cert 11 Oct 22-unlocked.pdf');
  await inspect('Template HFA Scheme (Non-meat) Cert 11 Oct 22-unlocked.pdf');
  await inspect('Template HFA Scheme (Cosmetic) Cert 11 Oct 22-unlocked 1.pdf');
}

main().catch(console.error);
