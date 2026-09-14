import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const scratchDir = path.join(rootDir, 'scratch');

async function renderAndInspect(filePath, outPngName) {
  const fullPath = path.resolve(rootDir, filePath);
  console.log('Inspecting:', fullPath);
  const pdfBuf = fs.readFileSync(fullPath);
  const b64 = pdfBuf.toString('base64');
  const browser = await chromium.launch();
  const page = await browser.newPage();
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
      return p.render({canvasContext: c.getContext('2d'), viewport: v}).promise.then(() => p.getTextContent());
    }).then(tc => {
      window._items = tc.items.map(it => ({
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
        h: it.height,
        font: it.fontName
      }));
      window._done = true;
    }).catch(err => { window._err = err.message; });
    </script></body></html>
  `;
  await page.setContent(html);
  await page.waitForFunction('window._done === true || window._err', { timeout: 30000 });
  const items = await page.evaluate('window._items');
  console.log('Text items count:', items?.length);
  if (items) {
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    for (const item of items) {
      if (item.str && item.str.trim()) {
        console.log(`x: ${item.x.toFixed(2)}, y: ${item.y.toFixed(2)}, h: ${item.h.toFixed(2)}, font: ${item.font} | "${item.str}"`);
      }
    }
  }
  const c = await page.$('#c');
  const outPng = path.join(scratchDir, outPngName);
  await c.screenshot({ path: outPng });
  console.log('Saved rendered PNG:', outPng);
  await browser.close();
}

renderAndInspect('Template GSO Scheme (meat) Cert-unlocked (1).pdf', 'gso_unlocked_preview.png').catch(console.error);
