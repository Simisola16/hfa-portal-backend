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
  
  // Get total pages
  const html = `
    <!DOCTYPE html><html><head>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
    <script>pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';</script>
    </head><body style="margin:0;padding:0;"><div id="container"></div><script>
    const pdfData = atob("${b64}");
    window.renderPage = async function(pageNum) {
      if (!window._doc) {
        const u = new Uint8Array(pdfData.length);
        for (let i=0; i<pdfData.length; i++) u[i] = pdfData.charCodeAt(i);
        window._doc = await pdfjsLib.getDocument({data: u}).promise;
        window._numPages = window._doc.numPages;
      }
      const p = await window._doc.getPage(pageNum);
      const v = p.getViewport({scale: 2.0});
      const container = document.getElementById('container');
      container.innerHTML = '<canvas id="c"></canvas>';
      const c = document.getElementById('c');
      c.width = v.width; c.height = v.height;
      await p.render({canvasContext: c.getContext('2d'), viewport: v}).promise;
      return true;
    };
    window.renderPage(1).then(() => { window._done = true; }).catch(err => { window._err = err.message; });
    </script></body></html>
  `;
  await page.setContent(html);
  await page.waitForFunction('window._done === true || window._err', { timeout: 30000 });
  const numPages = await page.evaluate(() => window._numPages || 1);
  
  for (let pNum = 1; pNum <= numPages; pNum++) {
    if (pNum > 1) {
      await page.evaluate(async (n) => { await window.renderPage(n); }, pNum);
      await page.waitForTimeout(300);
    }
    const c = await page.$('#c');
    const suffix = numPages > 1 ? `_p${pNum}` : '';
    const outPng = path.join(scratchDir, `test_${name}${suffix}.png`);
    await c.screenshot({ path: outPng });
    console.log(`Saved screenshot: test_${name}${suffix}.png`);
  }
  await page.close();
}

async function run() {
  const browser = await chromium.launch();

  // Test GSO Meat with 4 products matching user exact screenshot
  await renderTest(browser, 'gso_meat_4prods', {
    certificateType: 'GSO MEAT',
    certificateNumber: 'GSO-24-MEAT-0099',
    companyName: 'TEST',
    companyAddress: 'UNITED KINGDOM (UK)',
    manufacturingAddress: '',
    scope: 'HALAL FOOD CERTIFICATION & PROCESSING OPERATIONS',
    productCategory: 'HALAL FOOD CERTIFICATION & PROCESSING OPERATIONS',
    issueDate: '13-Sep-2026',
    currentCycleStartDate: '13-Sep-2026',
    originalCycleStartDate: '13-Sep-2026',
    expiryDate: '12-Sep-2027',
    products: [
      { code: 'PRD-BF-01', name: 'Premium Halal Beef Patty 150g' },
      { code: 'PRD-CK-02', name: 'Fresh Halal Chicken Breast Fillets 1kg' },
      { code: 'PRD-LM-03', name: 'Halal Gourmet Lamb Sausages 400g' },
      { code: 'PRD-SC-04', name: 'Halal Artisan Garlic Mayo Sauce 250ml' }
    ]
  });

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

  // Test GSO Meat with 12 products (multi-digit numbers & continuation page)
  await renderTest(browser, 'gso_meat_12prods', {
    certificateType: 'GSO MEAT',
    certificateNumber: 'GSO-24-MEAT-0100',
    companyName: 'INTERNATIONAL MEAT PROCESSORS GROUP PLC',
    companyAddress: '124 INDUSTRIAL WAY, LONDON E14 5QQ',
    manufacturingAddress: 'UNIT 4, MEAT PACKING ZONE, BIRMINGHAM B2 4AB',
    scope: 'SLAUGHTERING, PROCESSING, DEBONING, PACKAGING AND DISTRIBUTION OF HALAL BEEF, LAMB AND POULTRY PRODUCTS',
    productCategory: 'HALAL MEAT & POULTRY PRODUCTS',
    issueDate: '13-Sep-2026',
    currentCycleStartDate: '13-Sep-2026',
    originalCycleStartDate: '13-Sep-2026',
    expiryDate: '12-Sep-2027',
    products: [
      { code: 'BF-PRM-101', name: 'Premium Angus Beef Striploin 200g' },
      { code: 'BF-PRM-102', name: 'Halal Beef Ribeye Steak 250g' },
      { code: 'BF-MIN-103', name: 'Lean Minced Beef 500g 5% Fat' },
      { code: 'CK-BST-201', name: 'Fresh Chicken Breast Fillets 1kg' },
      { code: 'CK-THG-202', name: 'Boneless Skinless Chicken Thighs 800g' },
      { code: 'CK-DRM-203', name: 'Fresh Chicken Drumsticks Pack 1.2kg' },
      { code: 'LM-CHP-301', name: 'Gourmet Lamb Loin Chops 450g' },
      { code: 'LM-DC-302', name: 'Diced Boneless Lamb Shoulder 600g' },
      { code: 'LM-LEG-303', name: 'Whole Halal Lamb Leg 2.2kg' },
      { code: 'SG-BF-401', name: 'Artisan Halal Beef Sausages 400g' },
      { code: 'SG-CK-402', name: 'Spicy Herb Halal Chicken Sausages 400g' },
      { code: 'SG-LM-403', name: 'Merguez Halal Lamb Sausages 350g' }
    ]
  });

  await browser.close();
}

run().catch(console.error);
