import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateCertificate, CERTIFICATE_SCHEMES } from '../services/certificateGenerator.js';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const scratchDir = path.join(rootDir, 'scratch');

if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });

async function renderPdfToPng(browser, pdfBuf, outPngPath, pageNum = 1) {
  const b64 = pdfBuf.toString('base64');
  const page = await browser.newPage();
  const html = `
    <!DOCTYPE html><html><head>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
    <script>pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';</script>
    </head><body style="margin:0;padding:0;"><canvas id="c"></canvas><script>
    const pdfData = atob("${b64}");
    const u = new Uint8Array(pdfData.length);
    for (let i=0; i<pdfData.length; i++) u[i] = pdfData.charCodeAt(i);
    pdfjsLib.getDocument({data: u}).promise.then(doc => doc.getPage(${pageNum})).then(p => {
      const v = p.getViewport({scale: 2.0});
      const c = document.getElementById('c');
      c.width = v.width; c.height = v.height;
      return p.render({canvasContext: c.getContext('2d'), viewport: v}).promise;
    }).then(() => { window._done = true; }).catch(err => { window._err = err.message; });
    </script></body></html>
  `;
  await page.setContent(html);
  await page.waitForFunction('window._done === true || window._err', { timeout: 30000 });
  const err = await page.evaluate('window._err');
  if (err) {
    console.error('❌ Error rendering:', err);
  } else {
    const c = await page.$('#c');
    await c.screenshot({ path: outPngPath });
    console.log('✅ Generated preview image:', path.basename(outPngPath));
  }
  await page.close();
}

async function run() {
  const browser = await chromium.launch();

  const testCases = [
    {
      scheme: 'GSO meat',
      outName: 'sample_gso_meat.png',
      data: {
        certificateType: 'GSO meat',
        certificateNumber: 'HFA-24-GM-0891',
        companyName: 'ANIK FOODS UK LIMITED',
        companyAddress: 'UNIT 4, PREMIER PARK, PARK ROYAL, LONDON NW10 7NZ',
        manufacturingAddress: 'UNIT 4, PREMIER PARK, PARK ROYAL, LONDON NW10 7NZ',
        scope: 'FRESH & CHILLED HALAL BEEF & LAMB CUTS',
        productCategory: 'FRESH & CHILLED HALAL BEEF & LAMB CUTS',
        issueDate: '13-Sep-2026',
        currentCycleStartDate: '13-Sep-2026',
        originalCycleStartDate: '13-Sep-2024',
        expiryDate: '12-Sep-2027',
        products: [
          { code: 'BF-001', name: 'Fresh Halal Beef Ribeye Steak' },
          { code: 'LM-002', name: 'Chilled Halal Lamb Chops' },
          { code: 'CK-003', name: 'Fresh Halal Chicken Breast Fillets' }
        ]
      }
    },
    {
      scheme: 'GSO non-meat',
      outName: 'sample_gso_non_meat.png',
      data: {
        certificateType: 'GSO non-meat',
        certificateNumber: 'HFA-24-GNM-0452',
        companyName: 'AL-BARAKAH FOOD INDUSTRIES UK',
        companyAddress: '15 OLYMPIC WAY, WEMBLEY, MIDDLESEX HA9 0NP',
        manufacturingAddress: '15 OLYMPIC WAY, WEMBLEY, MIDDLESEX HA9 0NP',
        scope: 'HALAL BAKERY PRODUCTS AND CONFECTIONERY',
        productCategory: 'HALAL BAKERY PRODUCTS AND CONFECTIONERY',
        issueDate: '13-Sep-2026',
        currentCycleStartDate: '13-Sep-2026',
        originalCycleStartDate: '13-Sep-2024',
        expiryDate: '12-Sep-2027',
        products: [
          { code: 'BK-101', name: 'Artisan Halal Sourdough Bread' },
          { code: 'BK-102', name: 'Halal Butter Croissants 4-Pack' },
          { code: 'CF-201', name: 'Halal Chocolate Chip Cookies' }
        ]
      }
    },
    {
      scheme: 'Cosmetics',
      outName: 'sample_cosmetics.png',
      data: {
        certificateType: 'Cosmetics',
        certificateNumber: 'HFA-24-COS-0112',
        companyName: 'LUMEN BEAUTY LABS UK LTD',
        companyAddress: '12 KENSINGTON HIGH STREET, LONDON W8 4SG',
        manufacturingAddress: '12 KENSINGTON HIGH STREET, LONDON W8 4SG',
        scope: 'HALAL CERTIFIED SKINCARE AND HYDRATING SERUMS',
        productCategory: 'HALAL CERTIFIED SKINCARE AND HYDRATING SERUMS',
        issueDate: '13-Sep-2026',
        certificationStartDate: '13-Sep-2026',
        expiryDate: '12-Sep-2027',
        products: [
          { name: 'Radiance Hydrating Facial Serum 50ml' },
          { name: 'Organic Rosewater Botanical Toner 100ml' },
          { name: 'Gentle Foaming Cleanser 150ml' }
        ]
      }
    },
    {
      scheme: 'HFA Scheme',
      outName: 'sample_hfa_scheme.png',
      data: {
        certificateType: 'HFA Scheme',
        certificateNumber: 'HFA-24-STD-7781',
        companyName: 'ROYAL ESSENTIALS UK LIMITED',
        companyAddress: 'UNIT 8, TRADING ESTATE, BIRMINGHAM B6 7JJ',
        manufacturingAddress: 'UNIT 8, TRADING ESTATE, BIRMINGHAM B6 7JJ',
        scope: 'PRODUCTION AND SUPPLY OF HALAL INGREDIENTS',
        productCategory: 'PRODUCTION AND SUPPLY OF HALAL INGREDIENTS',
        issueDate: '13-Sep-2026',
        certificationStartDate: '13-Sep-2026',
        expiryDate: '12-Sep-2027',
        products: [
          { name: 'Pure Halal Vanilla Extract 250ml' },
          { name: 'Natural Halal Food Colouring - Red' },
          { name: 'Organic Halal Palm Olein 5L' }
        ]
      }
    },
    {
      scheme: 'SMIIC',
      outName: 'sample_smiic.png',
      data: {
        certificateType: 'Smiic',
        certificateNumber: 'HFA-24-SMC-9902',
        companyName: 'GLOBAL FLAVOURS & EXTRACTS LTD',
        companyAddress: '24 VICTORIA ROAD, LEEDS LS11 5AB',
        manufacturingAddress: '24 VICTORIA ROAD, LEEDS LS11 5AB',
        scope: 'HALAL CERTIFIED FLAVOURING EMULSIONS AND SEASONINGS',
        productCategory: 'HALAL CERTIFIED FLAVOURING EMULSIONS AND SEASONINGS',
        issueDate: '13-Sep-2026',
        certificationStartDate: '13-Sep-2026',
        expiryDate: '12-Sep-2027',
        products: [
          { name: 'Halal Lemon Emulsion Flavour 1L' },
          { name: 'Halal Roasted Onion Seasoning 25kg' },
          { name: 'Halal Savory Yeast Extract Paste 10kg' }
        ]
      }
    }
  ];

  for (const tc of testCases) {
    console.log(`Generating certificate for scheme: ${tc.scheme}...`);
    const pdfBuf = await generateCertificate(tc.data);
    const pdfPath = path.join(scratchDir, tc.outName.replace('.png', '.pdf'));
    fs.writeFileSync(pdfPath, pdfBuf);
    await renderPdfToPng(browser, pdfBuf, path.join(scratchDir, tc.outName));
  }

  // Multi-page test (15 products)
  console.log('Generating multi-page certificate test...');
  const multiProducts = Array.from({ length: 14 }, (_, i) => ({
    code: `PRD-${String(i + 1).padStart(2, '0')}`,
    name: `Certified Halal Speciality Product ${i + 1}`
  }));
  const multiPdfBuf = await generateCertificate({
    certificateType: 'GSO meat',
    certificateNumber: 'HFA-24-GM-MULTI-09',
    companyName: 'PREMIUM HALAL EXPORTS GLOBAL PLC',
    companyAddress: 'HARBOUR POINT, DOVER CT17 9TF',
    manufacturingAddress: 'HARBOUR POINT, DOVER CT17 9TF',
    scope: 'CHILLED & FROZEN MEAT PRODUCTS',
    issueDate: '13-Sep-2026',
    currentCycleStartDate: '13-Sep-2026',
    originalCycleStartDate: '13-Sep-2024',
    expiryDate: '12-Sep-2027',
    products: multiProducts
  });

  fs.writeFileSync(path.join(scratchDir, 'sample_multipage.pdf'), multiPdfBuf);
  await renderPdfToPng(browser, multiPdfBuf, path.join(scratchDir, 'sample_multipage_p1.png'), 1);
  await renderPdfToPng(browser, multiPdfBuf, path.join(scratchDir, 'sample_multipage_p2.png'), 2);

  await browser.close();
  console.log('🎉 All showcase certificates generated successfully!');
}

run().catch(console.error);
