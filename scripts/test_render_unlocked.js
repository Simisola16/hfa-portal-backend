import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const scratchDir = path.join(rootDir, 'scratch');
if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });

async function renderPdf(pdfPath, outPngPath) {
  const pdfJsPath = path.resolve(__dirname, '../node_modules/playwright-core/lib/tools/backend/pdf.js');
  const pdfJsContent = fs.readFileSync(pdfJsPath, 'utf8');
  const pdfData = fs.readFileSync(pdfPath).toString('base64');

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 1700 } });
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head><style>body { margin:0; padding:0; background:#fff; }</style></head>
    <body>
      <canvas id="the-canvas"></canvas>
      <script>
        ${pdfJsContent}
      </script>
      <script>
        (async function() {
          try {
            const raw = atob("${pdfData}");
            const uint8Array = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) {
              uint8Array[i] = raw.charCodeAt(i);
            }
            const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
            const pdf = await loadingTask.promise;
            const page = await pdf.getPage(1);
            const scale = 2.0;
            const viewport = page.getViewport({ scale: scale });
            const canvas = document.getElementById('the-canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            await page.render({ canvasContext: context, viewport: viewport }).promise;
            window._renderDone = true;
          } catch (e) {
            window._renderError = e.toString();
          }
        })();
      </script>
    </body>
    </html>
  `;

  await page.setContent(html);
  await page.waitForFunction('window._renderDone || window._renderError', { timeout: 15000 });
  const err = await page.evaluate('window._renderError');
  if (err) {
    console.error('Render error:', err);
  } else {
    const canvas = await page.$('#the-canvas');
    await canvas.screenshot({ path: outPngPath });
    console.log('Saved screenshot:', outPngPath);
  }
  await browser.close();
}

const target = path.join(__dirname, '../assets/certificates/Template GSO Scheme (meat) Cert-unlocked (1) 1.pdf');
const out = path.join(scratchDir, 'gso_meat_unlocked_preview.png');
renderPdf(target, out).catch(console.error);
