import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function inspect(filePath) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const buf = fs.readFileSync(filePath);
  const b64 = buf.toString('base64');
  const html = `
    <!DOCTYPE html><html><head>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
    <script>pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';</script>
    </head><body><script>
    const pdfData = atob("${b64}");
    const u = new Uint8Array(pdfData.length);
    for (let i=0; i<pdfData.length; i++) u[i] = pdfData.charCodeAt(i);
    pdfjsLib.getDocument({data: u}).promise.then(d => d.getPage(1)).then(p => p.getTextContent()).then(c => {
      window._items = c.items.map(i => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: i.height }));
    });
    </script></body></html>
  `;
  await page.setContent(html);
  await page.waitForFunction('window._items !== undefined', { timeout: 15000 });
  const items = await page.evaluate(() => window._items);
  console.log(`\n========================================\n${path.basename(filePath)}\n========================================`);
  items.filter(i => i.str.trim()).forEach(it => {
    console.log(`  y=${it.y.toFixed(2).padStart(6)} | x=${it.x.toFixed(2).padStart(6)} | "${it.str}"`);
  });
  await browser.close();
}

async function run() {
  const certsDir = path.join(__dirname, '../assets/certificates');
  const files = [
    'Template GSO Scheme (meat) Cert-unlocked (1) 2.pdf',
    'Template GSO Scheme (Non-meat) Cert-unlocked 2.pdf',
    'Template HFA Scheme (meat) Cert 11 Oct 22-unlocked 1.pdf',
    'Template HFA Scheme (Non-meat) Cert 11 Oct 22-unlocked 2.pdf',
    'Template HFA Scheme (Cosmetic) Cert 11 Oct 22-unlocked 1.pdf'
  ];
  for (const f of files) {
    await inspect(path.join(certsDir, f));
  }
}

run().catch(console.error);
