import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const scratchDir = path.join(rootDir, 'scratch');

async function inspectUnlocked() {
  const filePath = path.resolve(rootDir, 'Template GSO Scheme (meat) Cert-unlocked (1).pdf');
  console.log('Inspecting:', filePath);
  if (!fs.existsSync(filePath)) {
    console.error('File not found!');
    return;
  }
  const stat = fs.statSync(filePath);
  console.log('Size:', stat.size);

  const pdfBuf = fs.readFileSync(filePath);
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
      window._textItems = tc.items.map(it => it.str).filter(Boolean);
      window._done = true;
    }).catch(err => { window._err = err.message; });
    </script></body></html>
  `;
  await page.setContent(html);
  await page.waitForFunction('window._done === true || window._err', { timeout: 30000 });
  const textItems = await page.evaluate('window._textItems');
  console.log('Extracted text items count:', textItems?.length);
  console.log('Text items sample:', textItems?.slice(0, 20));

  const c = await page.$('#c');
  const outPng = path.join(scratchDir, 'unlocked_gso_meat.png');
  await c.screenshot({ path: outPng });
  console.log('Saved rendered PNG:', outPng);
  await browser.close();
}

inspectUnlocked().catch(console.error);
