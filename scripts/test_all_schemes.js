import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateCertificate, CERTIFICATE_SCHEMES } from '../services/certificateGenerator.js';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testAll() {
  const schemes = ['GSO meat', 'GSO non-meat', 'HFA Scheme', 'Smiic', 'Cosmetics'];
  
  const sampleProducts = [
    { code: 'PRD-01', name: 'awwal' },
    { code: 'PRD-02', name: 'awwal (Copy)' },
    { code: 'PRD-03', name: 'awwal (Copy)' }
  ];

  const browser = await chromium.launch();

  for (const s of schemes) {
    console.log('Testing scheme:', s);
    const pdfBuf = await generateCertificate({
      certificateType: s,
      certificateNumber: 'HFA-AW-62442',
      companyName: 'AWZI',
      companyAddress: 'OLUWO STADIUM, IWO, OSUN STATE',
      manufacturingAddress: '—',
      scope: 'PRODUCTION AND SUPPLY OF HALAL CERTIFIED FOOD INGREDIENTS AND FLAVOURS',
      issueDate: '13-Sep-2026',
      currentCycleStartDate: '13-Sep-2026',
      originalCycleStartDate: '13-Sep-2026',
      certificationStartDate: '13-Sep-2026',
      expiryDate: '13-Sep-2027',
      products: sampleProducts
    });

    const safeName = s.replace(/[^a-zA-Z0-9]/g, '_');
    const pdfPath = path.resolve(__dirname, `../test_${safeName}.pdf`);
    fs.writeFileSync(pdfPath, pdfBuf);
    console.log(`Saved test_${safeName}.pdf`);

    // Render with pdfjs on Playwright
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
    const outPng = path.resolve(__dirname, `../preview_final_${safeName}.png`);
    await c.screenshot({ path: outPng });
    console.log(`Rendered preview_final_${safeName}.png`);
    await page.close();
  }

  await browser.close();
  console.log('All schemes verified and rendered!');
}

testAll().catch(console.error);
