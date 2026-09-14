import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function extractCleanPngs() {
  const browser = await puppeteer.launch({ 
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const files = [
    { pdf: 'HFA SCHEME.pdf', out: 'hfa_scheme_bg.png' },
    { pdf: 'COSMETICS.pdf', out: 'cosmetics_bg.png' },
    { pdf: 'SMIIC.pdf', out: 'smiic_bg.png' },
    { pdf: 'GSO MEAT.pdf', out: 'gso_meat_bg.png' },
    { pdf: 'GSO NON MEAT.pdf', out: 'gso_non_meat_bg.png' }
  ];

  const assetsDir = path.resolve(__dirname, '../assets/certificates');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  for (const item of files) {
    const pdfPath = path.resolve(__dirname, '../../', item.pdf);
    if (!fs.existsSync(pdfPath)) {
      console.error('File not found:', pdfPath);
      continue;
    }
    const pdfBuf = fs.readFileSync(pdfPath);
    const pdfBase64 = pdfBuf.toString('base64');
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 2 });
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body, html { width: 100%; height: 100%; overflow: hidden; background: #fff; }
          canvas { width: 100%; height: 100%; display: block; }
        </style>
      </head>
      <body>
        <canvas id="the-canvas"></canvas>
        <script>
          const pdfData = atob("${pdfBase64}");
          const uint8Array = new Uint8Array(pdfData.length);
          for (let i = 0; i < pdfData.length; i++) {
            uint8Array[i] = pdfData.charCodeAt(i);
          }
          pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          pdfjsLib.getDocument({ data: uint8Array }).promise.then(function(pdf) {
            return pdf.getPage(1).then(function(page) {
              const canvas = document.getElementById('the-canvas');
              const context = canvas.getContext('2d');
              const viewport = page.getViewport({ scale: 2.5 });
              canvas.width = viewport.width;
              canvas.height = viewport.height;
              const renderContext = {
                canvasContext: context,
                viewport: viewport
              };
              return page.render(renderContext).promise.then(function() {
                window._pdfRendered = true;
              });
            });
          });
        </script>
      </body>
      </html>
    `;

    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window._pdfRendered === true', { timeout: 30000 });
    
    const canvasElement = await page.$('#the-canvas');
    const outPath = path.join(assetsDir, item.out);
    await canvasElement.screenshot({ path: outPath, type: 'png' });
    console.log('Clean rendered:', item.out, 'size:', fs.statSync(outPath).size);
    await page.close();
  }
  await browser.close();
  console.log('All clean PNGs generated!');
}

extractCleanPngs().catch(console.error);
