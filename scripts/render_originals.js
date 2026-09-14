import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const scratchDir = path.join(rootDir, 'scratch');

const files = [
  'Template GSO Scheme (meat) Cert.pdf',
  'Template HFA Scheme (Cosmetic) Cert 11 Oct 22.pdf'
];

async function run() {
  const browser = await chromium.launch();
  for (const f of files) {
    const fullPath = path.join(rootDir, f);
    if (!fs.existsSync(fullPath)) continue;
    const buf = fs.readFileSync(fullPath);
    const b64 = buf.toString('base64');
    const page = await browser.newPage({ viewport: { width: 1200, height: 1700 } });
    const html = `
      <!DOCTYPE html><html><head>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
      <script>pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';</script>
      </head><body style="margin:0;padding:0;"><canvas id="c"></canvas><script>
      const pdfData = atob("${b64}");
      const u = new Uint8Array(pdfData.length);
      for (let i=0; i<pdfData.length; i++) u[i] = pdfData.charCodeAt(i);
      pdfjsLib.getDocument({data: u}).promise.then(doc => doc.getPage(1)).then(p => {
        const v = p.getViewport({scale: 2.0});
        const c = document.getElementById('c');
        c.width = v.width; c.height = v.height;
        return p.render({canvasContext: c.getContext('2d'), viewport: v}).promise;
      }).then(() => { window._done = true; }).catch(err => { window._err = err.message; });
      </script></body></html>
    `;
    await page.setContent(html);
    await page.waitForFunction('window._done === true || window._err', { timeout: 30000 });
    const c = await page.$('#c');
    const outName = f.replace(/[^a-zA-Z0-9]/g, '_') + '.png';
    const outPng = path.join(scratchDir, outName);
    await c.screenshot({ path: outPng });
    console.log('Saved:', outName);
    await page.close();
  }
  await browser.close();
}

run().catch(console.error);
