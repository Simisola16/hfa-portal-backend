import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function findGreenHeader() {
  const browser = await chromium.launch();
  const list = [
    'Template GSO Scheme (meat) Cert-unlocked (1) 1.pdf',
    'Template GSO Scheme (Non-meat) Cert-unlocked 1.pdf',
    'Template HFA Scheme (meat) Cert 11 Oct 22-unlocked.pdf',
    'Template HFA Scheme (Non-meat) Cert 11 Oct 22-unlocked.pdf',
    'Template HFA Scheme (Cosmetic) Cert 11 Oct 22-unlocked 1.pdf'
  ];

  for (const name of list) {
    const fullPath = path.resolve(__dirname, '../assets/certificates', name);
    const buf = fs.readFileSync(fullPath);
    const b64 = buf.toString('base64');
    const page = await browser.newPage({ viewport: { width: 1200, height: 1700 } });
    const html = `
      <!DOCTYPE html><html><head>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
      <script>pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';</script>
      </head><body><canvas id="c"></canvas><script>
      const pdfData = atob("${b64}");
      const u = new Uint8Array(pdfData.length);
      for (let i=0; i<pdfData.length; i++) u[i] = pdfData.charCodeAt(i);
      pdfjsLib.getDocument({data: u}).promise.then(doc => doc.getPage(1)).then(async p => {
        const v = p.getViewport({scale: 2.0});
        const c = document.getElementById('c');
        c.width = v.width; c.height = v.height;
        await p.render({canvasContext: c.getContext('2d'), viewport: v}).promise;
        const ctx = c.getContext('2d');
        const imgData = ctx.getImageData(0, 0, c.width, c.height);
        const data = imgData.data;
        
        // Find green pixels (#0b7c47 or RGB: R < 50, G > 100, B < 90)
        // in PDF y: 270-330 -> Canvas y: (841.89-330)*2 to (841.89-270)*2 = 1023 to 1143
        let minX = 9999, maxX = -1, minY = 9999, maxY = -1;
        for (let y = 1000; y < 1200; y++) {
          for (let x = 0; x < c.width; x++) {
            const idx = (y * c.width + x) * 4;
            const r = data[idx], g = data[idx+1], b = data[idx+2];
            if (g > 100 && r < 60 && b < 90) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
        
        // Convert canvas coords back to PDF points
        window._result = {
          leftX: (minX / 2.0).toFixed(2),
          rightX: (maxX / 2.0).toFixed(2),
          width: ((maxX - minX) / 2.0).toFixed(2),
          bottomY: (841.89 - maxY / 2.0).toFixed(2),
          topY: (841.89 - minY / 2.0).toFixed(2),
          height: ((maxY - minY) / 2.0).toFixed(2)
        };
        window._done = true;
      });
      </script></body></html>
    `;
    await page.setContent(html);
    await page.waitForFunction('window._done === true', { timeout: 30000 });
    const res = await page.evaluate(() => window._result);
    console.log(`\n=== ${name} ===`);
    console.log(JSON.stringify(res, null, 2));
    await page.close();
  }
  await browser.close();
}

findGreenHeader().catch(console.error);
