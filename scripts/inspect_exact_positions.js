import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const templates = [
  { name: 'GSO Meat', file: 'Template GSO Scheme (meat) Cert-unlocked (1) 1.pdf' },
  { name: 'GSO Non-Meat', file: 'Template GSO Scheme (Non-meat) Cert-unlocked 1.pdf' },
  { name: 'HFA Scheme Meat', file: 'Template HFA Scheme (meat) Cert 11 Oct 22-unlocked.pdf' },
  { name: 'HFA Scheme Non-Meat', file: 'Template HFA Scheme (Non-meat) Cert 11 Oct 22-unlocked.pdf' },
  { name: 'Cosmetics', file: 'Template HFA Scheme (Cosmetic) Cert 11 Oct 22-unlocked 1.pdf' }
];

async function run() {
  const browser = await chromium.launch();
  for (const t of templates) {
    const fullPath = path.join(__dirname, '../assets/certificates', t.file);
    if (!fs.existsSync(fullPath)) continue;
    const buf = fs.readFileSync(fullPath);
    const b64 = buf.toString('base64');
    const page = await browser.newPage();
    const html = `
      <!DOCTYPE html><html><head>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
      <script>pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';</script>
      </head><body><script>
      const pdfData = atob("${b64}");
      const u = new Uint8Array(pdfData.length);
      for (let i=0; i<pdfData.length; i++) u[i] = pdfData.charCodeAt(i);
      pdfjsLib.getDocument({data: u}).promise.then(doc => doc.getPage(1)).then(async p => {
        const textContent = await p.getTextContent();
        window._items = textContent.items.map(item => ({
          str: item.str,
          x: item.transform[4],
          y: item.transform[5],
          w: item.width,
          h: item.height,
          font: item.fontName
        }));
        window._done = true;
      }).catch(err => { window._err = err.message; });
      </script></body></html>
    `;
    await page.setContent(html);
    await page.waitForFunction('window._done === true || window._err', { timeout: 30000 });
    const items = await page.evaluate(() => window._items || []);
    console.log(`\n======================================================`);
    console.log(`FILE: ${t.name}`);
    console.log(`======================================================`);
    // Sort by y desc, x asc
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    for (const item of items) {
      if (item.str && item.str.trim()) {
        console.log(`x: ${item.x.toFixed(2)}, y: ${item.y.toFixed(2)}, w: ${item.w.toFixed(2)}, h: ${item.h.toFixed(2)} | "${item.str}"`);
      }
    }
    await page.close();
  }
  await browser.close();
}

run().catch(console.error);
