import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function render() {
  const browser = await chromium.launch();
  const files = [
    { pdf: path.resolve(__dirname, '../../survellance-unlocked template.pdf'), out: path.resolve(__dirname, '../surveillance_template_preview.png') },
    { pdf: path.resolve(__dirname, '../../survellance-unlocked.pdf'), out: path.resolve(__dirname, '../surveillance_sample_preview.png') },
    { pdf: path.resolve(__dirname, '../scratch/test-surv-letter.pdf'), out: path.resolve(__dirname, '../scratch/test-surv-letter-preview.png') }
  ];

  for (const item of files) {
    if (!fs.existsSync(item.pdf)) {
      console.log('File does not exist:', item.pdf);
      continue;
    }
    const page = await browser.newPage();
    const pdfBase64 = fs.readFileSync(item.pdf).toString('base64');
    const html = `
      <!DOCTYPE html><html><head>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
      <script>pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';</script>
      </head><body style="margin:0;padding:0;"><canvas id="c"></canvas><script>
      const pdfData = atob("${pdfBase64}");
      const u = new Uint8Array(pdfData.length);
      for (let i=0; i<pdfData.length; i++) u[i] = pdfData.charCodeAt(i);
      pdfjsLib.getDocument({data: u}).promise.then(doc => doc.getPage(1)).then(p => {
        const v = p.getViewport({scale: 2.0});
        const c = document.getElementById('c');
        c.width = v.width; c.height = v.height;
        return p.render({canvasContext: c.getContext('2d'), viewport: v}).promise;
      }).then(() => { window._done = true; });
      </script></body></html>
    `;
    await page.setContent(html);
    await page.waitForFunction('window._done === true', { timeout: 30000 });
    const c = await page.$('#c');
    await c.screenshot({ path: item.out });
    await page.close();
    console.log('Rendered ' + item.out);
  }
  await browser.close();
}

render().catch(console.error);
