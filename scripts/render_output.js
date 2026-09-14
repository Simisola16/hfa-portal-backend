import { chromium } from 'playwright';
import fs from 'fs';

async function render() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pdfBase64 = fs.readFileSync('test_output_cert.pdf').toString('base64');
  const html = `
    <!DOCTYPE html><html><head>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
    <script>pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';</script>
    </head><body><canvas id="c"></canvas><script>
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
  await c.screenshot({ path: 'test_output_cert_preview.png' });
  await browser.close();
  console.log('Rendered test_output_cert_preview.png!');
}
render().catch(console.error);
