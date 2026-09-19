import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function extractCoords() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  const files = [
    path.join(__dirname, '../assets/certificates/Template GSO Scheme (meat) Cert-unlocked (1) 2.pdf'),
    path.join(__dirname, '../assets/certificates/Template GSO Scheme (Non-meat) Cert-unlocked 2.pdf'),
    path.join(__dirname, '../assets/certificates/Template HFA Scheme (meat) Cert 11 Oct 22-unlocked 1.pdf'),
    path.join(__dirname, '../assets/certificates/Template HFA Scheme (Non-meat) Cert 11 Oct 22-unlocked 2.pdf'),
    path.join(__dirname, '../assets/certificates/Template HFA Scheme (Cosmetic) Cert 11 Oct 22-unlocked 1.pdf')
  ];
  
  for (const file of files) {
    if (!fs.existsSync(file)) {
      console.log('Not found:', file);
      continue;
    }
    const buf = fs.readFileSync(file);
    const b64 = buf.toString('base64');
    const html = `
      <!DOCTYPE html><html><head>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
      <script>pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';</script>
      </head><body><script>
      const pdfData = atob("${b64}");
      const u = new Uint8Array(pdfData.length);
      for (let i=0; i<pdfData.length; i++) u[i] = pdfData.charCodeAt(i);
      pdfjsLib.getDocument({data: u}).promise.then(doc => doc.getPage(1)).then(p => p.getTextContent()).then(c => {
        window._items = c.items.map(i => ({ str: i.str, x: i.transform[4], y: i.transform[5], h: i.height, w: i.width }));
      });
      </script></body></html>
    `;
    await page.setContent(html);
    await page.waitForFunction('window._items !== undefined', { timeout: 15000 });
    const items = await page.evaluate(() => window._items);
    console.log('=== ' + file + ' ===');
    items.forEach(it => {
      if (it.str.trim()) {
        console.log(`  [${it.x.toFixed(2)}, ${it.y.toFixed(2)}] w=${it.w.toFixed(2)} h=${it.h.toFixed(2)}: "${it.str}"`);
      }
    });
  }
  await browser.close();
}
extractCoords().catch(console.error);
