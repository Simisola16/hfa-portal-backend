import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateCertificate } from '../services/certificateGenerator.js';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testMultiPage() {
  const prodNames = [
    'Semovita', 'Rice', 'Light chocolate', 'Dark Charcoal', 'Milk Chocolate',
    'Beans', 'Yam Flour', 'Plantain Flour', 'Pounded Yam', 'Wheat Flour',
    'Cassava Flour', 'Oat Meal', 'Brown Rice',
    'Corn Beef', 'Ewa Agoyin', 'Locust Beans', 'Basmati Rice', 'Shawarma',
    'Beef Sausage', 'Chinese Rice', 'Beef', 'Sharwarma', 'Garri', 'Rice', 'Gizzard'
  ];
  const prods = prodNames.map((name, i) => ({
    code: 'PRD-' + String(i + 1).padStart(2, '0'),
    name: name,
    description: name,
    category: 'Halal Certified'
  }));
  const pdfBuf = await generateCertificate({
    certificateType: 'HFA SCHEME NON MEAT',
    certificateNumber: 'HFA-MULTI-001',
    companyName: 'GLOBAL HALAL FOODS LTD',
    companyAddress: '10 INDUSTRIAL PARK, LONDON, UK',
    scope: 'MANUFACTURING OF MEAT PRODUCTS',
    products: prods
  });
  fs.writeFileSync(path.resolve(__dirname, '../test_multipage.pdf'), pdfBuf);
  console.log('Saved test_multipage.pdf');

  const browser = await chromium.launch();
  for (let pageNum of [1, 2, 3]) {
    const page = await browser.newPage();
    const b64 = pdfBuf.toString('base64');
    const html = `
      <!DOCTYPE html><html><head>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
      <script>pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';</script>
      </head><body><canvas id="c"></canvas><script>
      const pdfData = atob("${b64}");
      const u = new Uint8Array(pdfData.length);
      for (let i=0; i<pdfData.length; i++) u[i] = pdfData.charCodeAt(i);
      pdfjsLib.getDocument({data: u}).promise.then(doc => doc.getPage(${pageNum})).then(p => {
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
    await c.screenshot({ path: path.resolve(__dirname, `../preview_multipage_p${pageNum}.png`) });
    console.log(`Rendered preview_multipage_p${pageNum}.png`);
    await page.close();
  }
  await browser.close();
  console.log('Multi-page test finished successfully!');
}

testMultiPage().catch(console.error);
