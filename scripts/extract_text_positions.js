import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function extractText() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const targetName = process.argv[2] || '../../survellance-unlocked.pdf';
  const pdfPath = path.resolve(__dirname, targetName);
  const pdfBase64 = fs.readFileSync(pdfPath).toString('base64');
  const html = `
    <!DOCTYPE html><html><head>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
    <script>pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';</script>
    </head><body><script>
    const pdfData = atob("${pdfBase64}");
    const u = new Uint8Array(pdfData.length);
    for (let i=0; i<pdfData.length; i++) u[i] = pdfData.charCodeAt(i);
    pdfjsLib.getDocument({data: u}).promise.then(doc => doc.getPage(1)).then(p => {
      return p.getTextContent();
    }).then(tc => {
      window._items = tc.items.map(it => ({
        str: it.str,
        x: Math.round(it.transform[4]),
        y: Math.round(it.transform[5]),
        fontSize: Math.round(Math.sqrt(it.transform[0]*it.transform[0] + it.transform[1]*it.transform[1])),
        fontName: it.fontName,
        width: Math.round(it.width),
        height: Math.round(it.height)
      }));
      window._done = true;
    });
    </script></body></html>
  `;
  await page.setContent(html);
  await page.waitForFunction('window._done === true', { timeout: 30000 });
  const items = await page.evaluate(() => window._items);
  await browser.close();

  console.log('Extracted', items.length, 'items:');
  const valid = items.filter(it => it.str.trim());
  for (const it of valid) {
    const right = it.x + it.width;
    console.log(`[x=${it.x}, y=${it.y}, w=${it.width}, right=${right}, size=${it.fontSize}, font=${it.fontName}] "${it.str}"`);
  }
  const maxRight = Math.max(...valid.map(v => v.x + v.width));
  console.log('Max text right coordinate:', maxRight);
}

extractText().catch(console.error);
