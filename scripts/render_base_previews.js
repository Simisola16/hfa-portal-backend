import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const scratchDir = path.join(rootDir, 'scratch');

const files = [
  { name: 'gso_meat_unlocked_2', file: 'Template GSO Scheme (meat) Cert-unlocked (1) 2.pdf' },
  { name: 'gso_non_meat_unlocked_2', file: 'Template GSO Scheme (Non-meat) Cert-unlocked 2.pdf' },
  { name: 'hfa_meat_unlocked_1', file: 'Template HFA Scheme (meat) Cert 11 Oct 22-unlocked 1.pdf' },
  { name: 'hfa_non_meat_unlocked_2', file: 'Template HFA Scheme (Non-meat) Cert 11 Oct 22-unlocked 2.pdf' },
  { name: 'hfa_cosmetic_unlocked_1', file: 'backend/assets/certificates/Template HFA Scheme (Cosmetic) Cert 11 Oct 22-unlocked 1.pdf' },
  { name: 'original_gso_meat', file: 'Template GSO Scheme (meat) Cert.pdf' },
  { name: 'original_hfa_cosmetic', file: 'Template HFA Scheme (Cosmetic) Cert 11 Oct 22.pdf' }
];

async function renderBases() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1240, height: 1754 } });

  for (const item of files) {
    const fullPath = path.join(rootDir, item.file);
    if (!fs.existsSync(fullPath)) {
      console.log('Not found:', item.file);
      continue;
    }
    const buf = fs.readFileSync(fullPath);
    const b64 = buf.toString('base64');
    
    const html = `
      <!DOCTYPE html><html><head>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
      <script>pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';</script>
      <style>body { margin: 0; padding: 0; background: #fff; }</style>
      </head><body><canvas id="c"></canvas><script>
      window._done = false; window._err = null;
      try {
        const pdfData = atob("${b64}");
        const u = new Uint8Array(pdfData.length);
        for (let i=0; i<pdfData.length; i++) u[i] = pdfData.charCodeAt(i);
        pdfjsLib.getDocument({data: u}).promise.then(doc => doc.getPage(1)).then(p => {
          const v = p.getViewport({scale: 2.0});
          const c = document.getElementById('c');
          c.width = v.width; c.height = v.height;
          return p.render({canvasContext: c.getContext('2d'), viewport: v}).promise;
        }).then(() => { window._done = true; }).catch(err => { window._err = err.message; });
      } catch (e) {
        window._err = e.message;
      }
      </script></body></html>
    `;
    
    await page.setContent(html);
    await page.waitForFunction('window._done === true || window._err !== null', { timeout: 30000 });
    const err = await page.evaluate(() => window._err);
    if (err) {
      console.error(`Error rendering ${item.name}: ${err}`);
      continue;
    }
    const c = await page.$('#c');
    const outPng = path.join(scratchDir, `base_${item.name}.png`);
    await c.screenshot({ path: outPng });
    console.log(`Saved: base_${item.name}.png`);
  }

  await browser.close();
}

renderBases().catch(console.error);
