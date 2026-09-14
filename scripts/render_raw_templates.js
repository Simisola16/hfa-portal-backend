import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scratchDir = path.join(__dirname, '../../scratch');

async function renderPdf(browser, name, relPath) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1700 } });
  const buf = fs.readFileSync(path.join(__dirname, relPath));
  const b64 = buf.toString('base64');
  const html = `
    <!DOCTYPE html><html><head>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
    <script>pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';</script>
    </head><body style="margin:0;"><canvas id="c"></canvas><script>
    const pdfData = atob("${b64}");
    const u = new Uint8Array(pdfData.length);
    for (let i=0; i<pdfData.length; i++) u[i] = pdfData.charCodeAt(i);
    pdfjsLib.getDocument({data: u}).promise.then(d => d.getPage(1)).then(p => {
      const v = p.getViewport({scale: 2.0});
      const c = document.getElementById('c');
      c.width = v.width; c.height = v.height;
      return p.render({canvasContext: c.getContext('2d'), viewport: v}).promise;
    }).then(() => { window._done = true; });
    </script></body></html>
  `;
  await page.setContent(html);
  await page.waitForFunction('window._done === true', { timeout: 15000 });
  const c = await page.$('#c');
  await c.screenshot({ path: path.join(scratchDir, `raw_${name}.png`) });
  console.log(`Saved raw_${name}.png`);
  await page.close();
}

async function run() {
  const browser = await chromium.launch();
  await renderPdf(browser, 'gso_meat', '../assets/certificates/Template GSO Scheme (meat) Cert-unlocked (1) 2.pdf');
  await renderPdf(browser, 'gso_non_meat', '../assets/certificates/Template GSO Scheme (Non-meat) Cert-unlocked 2.pdf');
  await renderPdf(browser, 'hfa_meat', '../assets/certificates/Template HFA Scheme (meat) Cert 11 Oct 22-unlocked 1.pdf');
  await renderPdf(browser, 'hfa_non_meat', '../assets/certificates/Template HFA Scheme (Non-meat) Cert 11 Oct 22-unlocked 2.pdf');
  await renderPdf(browser, 'cosmetics', '../assets/certificates/Template HFA Scheme (Cosmetic) Cert 11 Oct 22-unlocked 1.pdf');
  await browser.close();
}
run().catch(console.error);
