const fs = require('fs');
const path = require('path');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

async function inspect(filePath) {
  const fullPath = path.join(__dirname, '..', filePath);
  if (!fs.existsSync(fullPath)) return;
  const data = new Uint8Array(fs.readFileSync(fullPath));
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const page = await doc.getPage(1);
  const textContent = await page.getTextContent();
  console.log('=== ' + path.basename(filePath) + ' ===');
  for (const item of textContent.items) {
    if (item.str && item.str.trim()) {
      console.log(`[${item.transform[4].toFixed(2)}, ${item.transform[5].toFixed(2)}] w=${item.width ? item.width.toFixed(2) : 0} size=${item.transform[0].toFixed(2)}: "${item.str}"`);
    }
  }
}

async function run() {
  await inspect('assets/certificates/Template GSO Scheme (meat) Cert-unlocked (1) 1.pdf');
  await inspect('assets/certificates/Template HFA Scheme (meat) Cert 11 Oct 22-unlocked.pdf');
}
run();
