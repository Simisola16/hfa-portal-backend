import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateCertificate } from '../services/certificateGenerator.js';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

async function renderPdfToPng(browser, pdfBuf, outPngPath) {
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
  const err = await page.evaluate('window._err');
  if (err) {
    console.log('❌ Error rendering', path.basename(outPngPath), err);
  } else {
    const c = await page.$('#c');
    await c.screenshot({ path: outPngPath });
    console.log('✅ Generated preview:', path.basename(outPngPath));
  }
  await page.close();
}

async function run() {
  const browser = await chromium.launch();
  const scratchDir = path.join(rootDir, 'scratch');
  if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });

  const tests = [
    {
      scheme: 'GSO meat',
      outName: 'current_gen_gso_meat.png',
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
          { code: 'LM-002', name: 'Chilled Halal Lamb Chops' }
        ]
      }
    },
    {
      scheme: 'Cosmetics',
      outName: 'current_gen_cosmetics.png',
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
    }
  ];

  for (const t of tests) {
    const pdfBuf = await generateCertificate(t.data);
    await renderPdfToPng(browser, pdfBuf, path.join(scratchDir, t.outName));
  }

  await browser.close();
  console.log('🎉 Comparison generation completed.');
}

run().catch(console.error);
