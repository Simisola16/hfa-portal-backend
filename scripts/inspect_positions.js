import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

async function inspect(browser, filePath) {
  console.log('========================================');
  console.log('FILE:', path.basename(filePath));
  console.log('========================================');
  const fullPath = path.resolve(rootDir, filePath);
  if (!fs.existsSync(fullPath)) {
    console.log('NOT FOUND:', fullPath);
    return;
  }
  const pdfBuf = fs.readFileSync(fullPath);
  const b64 = pdfBuf.toString('base64');
  const page = await browser.newPage();
  const html = `
    <!DOCTYPE html><html><head>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
    <script>pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';</script>
    </head><body><script>
    const pdfData = atob("${b64}");
    const u = new Uint8Array(pdfData.length);
    for (let i=0; i<pdfData.length; i++) u[i] = pdfData.charCodeAt(i);
    pdfjsLib.getDocument({data: u}).promise.then(doc => doc.getPage(1)).then(p => {
      const v = p.getViewport({scale: 1.0});
      return p.getTextContent().then(tc => {
        window._res = {
          width: v.width,
          height: v.height,
          items: tc.items.map(it => ({
            str: it.str,
            x: it.transform[4],
            y: it.transform[5],
            w: it.width,
            h: it.height,
            fontName: it.fontName
          }))
        };
      });
    }).catch(err => { window._err = err.message; });
    </script></body></html>
  `;
  await page.setContent(html);
  await page.waitForFunction('window._res || window._err', { timeout: 30000 });
  const res = await page.evaluate('window._res');
  const err = await page.evaluate('window._err');
  if (err) {
    console.log('Error inspecting:', err);
  } else if (res) {
    console.log(`Page dimensions: ${res.width} x ${res.height}`);
    res.items.sort((a, b) => b.y - a.y || a.x - b.x);
    for (const item of res.items) {
      if (item.str && item.str.trim()) {
        console.log(`x: ${item.x.toFixed(2)}, y: ${item.y.toFixed(2)}, w: ${item.w.toFixed(2)}, h: ${item.h.toFixed(2)}, font: ${item.fontName} | "${item.str}"`);
      }
    }
  }
  await page.close();
}

async function main() {
  const browser = await chromium.launch();
  await inspect(browser, 'Template GSO Scheme (meat) Cert-unlocked (1) 1.pdf');
  await inspect(browser, 'Template GSO Scheme (Non-meat) Cert-unlocked 1.pdf');
  await inspect(browser, 'Template HFA Scheme (meat) Cert 11 Oct 22-unlocked.pdf');
  await inspect(browser, 'Template HFA Scheme (Non-meat) Cert 11 Oct 22-unlocked.pdf');
  await inspect(browser, 'Template HFA Scheme (Cosmetic) Cert 11 Oct 22-unlocked 1.pdf');
  await browser.close();
}

main().catch(console.error);
