import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateCertificate } from '../services/certificateGenerator.js';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const scratchDir = path.join(rootDir, 'scratch');

async function renderTest(browser, name, data) {
  console.log(`Generating test certificate for ${name}...`);
  const pdfBuf = await generateCertificate(data);
  const b64 = pdfBuf.toString('base64');
  const page = await browser.newPage({ viewport: { width: 1200, height: 1700 } });
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
      return p.render({canvasContext: c.getContext('2d'), viewport: v}).promise;
    }).then(() => { window._done = true; }).catch(err => { window._err = err.message; });
    </script></body></html>
  `;
  await page.setContent(html);
  await page.waitForFunction('window._done === true || window._err', { timeout: 30000 });
  const c = await page.$('#c');
  const outPng = path.join(scratchDir, `test_${name}.png`);
  await c.screenshot({ path: outPng });
  console.log(`Saved screenshot: test_${name}.png`);
  await page.close();
}

async function run() {
  const browser = await chromium.launch();

  // Test HFA Scheme Meat with 4 products
  await renderTest(browser, 'hfa_scheme_meat_4prods', {
    certificateType: 'HFA Scheme (meat)',
    certificateNumber: 'HFA-24-HM-0105',
    companyName: 'ROYAL HALAL MEATS LTD',
    companyAddress: '88 COMMERCIAL ROAD, BIRMINGHAM B1 1AA',
    manufacturingAddress: '88 COMMERCIAL ROAD, BIRMINGHAM B1 1AA',
    scope: 'HALAL POULTRY AND RED MEAT SLAUGHTERING AND PACKAGING',
    productCategory: 'HALAL POULTRY AND RED MEAT SLAUGHTERING AND PACKAGING',
    issueDate: '13-Sep-2026',
    certificationStartDate: '13-Sep-2026',
    expiryDate: '12-Sep-2027',
    products: [
      { name: 'Fresh Halal Whole Chicken Grade A' },
      { name: 'Chilled Halal Lamb Diced Mutton' },
      { name: 'Fresh Halal Beef Sirloin Steak' },
      { name: 'Halal Gourmet Lamb Sausages 400g' }
    ]
  });

  // Test Cosmetics with 4 products
  await renderTest(browser, 'cosmetics_4prods', {
    certificateType: 'Cosmetics',
    certificateNumber: 'HFA-24-COS-0112',
    companyName: 'LUMEN BEAUTY LABS UK LTD',
    companyAddress: '10 HARLEY STREET, LONDON W1G 9PF',
    manufacturingAddress: 'UNIT 2, COSMETIC PARK, MANCHESTER M1 7ED',
    scope: 'HALAL CERTIFIED SKINCARE AND PERSONAL CARE FORMULATIONS',
    productCategory: 'HALAL CERTIFIED SKINCARE AND PERSONAL CARE FORMULATIONS',
    issueDate: '13-Sep-2026',
    certificationStartDate: '13-Sep-2026',
    expiryDate: '12-Sep-2027',
    products: [
      { name: 'Hydrating Botanical Facial Cleanser' },
      { name: 'Pure Rosewater Hydrosol Toner' },
      { name: 'Nourishing Shea Butter Body Lotion' },
      { name: 'Rejuvenating Vitamin C Serum 30ml' }
    ]
  });

  await browser.close();
}

run().catch(console.error);
