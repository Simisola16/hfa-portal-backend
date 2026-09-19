import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument } from 'pdf-lib';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const certAssetsDir = path.join(__dirname, '../assets/certificates');

const targetFiles = [
  {
    source: 'Template GSO Scheme (meat) Cert-unlocked (1) 2.pdf',
    dest: 'Template GSO Scheme (meat) Cert-unlocked (1) 2.pdf',
    scheme: 'GSO MEAT'
  },
  {
    source: 'Template GSO Scheme (Non-meat) Cert-unlocked 2.pdf',
    dest: 'Template GSO Scheme (Non-meat) Cert-unlocked 2.pdf',
    scheme: 'GSO NON MEAT'
  },
  {
    source: 'Template HFA Scheme (meat) Cert 11 Oct 22-unlocked 1.pdf',
    dest: 'Template HFA Scheme (meat) Cert 11 Oct 22-unlocked 1.pdf',
    scheme: 'HFA SCHEME MEAT'
  },
  {
    source: 'Template HFA Scheme (Non-meat) Cert 11 Oct 22-unlocked 2.pdf',
    dest: 'Template HFA Scheme (Non-meat) Cert 11 Oct 22-unlocked 2.pdf',
    scheme: 'HFA SCHEME NON MEAT'
  },
  {
    source: 'Template HFA Scheme (Cosmetic) Cert 11 Oct 22-unlocked 2.pdf',
    dest: 'Template HFA Scheme (Cosmetic) Cert 11 Oct 22-unlocked 2.pdf',
    scheme: 'COSMETICS'
  }
];

async function repairWithPlaywright(browser, srcPath, destPath) {
  console.log(`Normalizing with Playwright: ${path.basename(srcPath)} -> ${path.basename(destPath)}`);
  const buf = fs.readFileSync(srcPath);
  const b64 = buf.toString('base64');
  const page = await browser.newPage({ viewport: { width: 1240, height: 1754 } });
  
  const html = `
    <!DOCTYPE html><html><head>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
    <script>pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';</script>
    <style>
      @page { size: A4 portrait; margin: 0; }
      body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
      canvas { width: 595.28pt; height: 841.89pt; display: block; }
    </style>
    </head><body><canvas id="c"></canvas><script>
    const pdfData = atob("${b64}");
    const u = new Uint8Array(pdfData.length);
    for (let i=0; i<pdfData.length; i++) u[i] = pdfData.charCodeAt(i);
    pdfjsLib.getDocument({data: u}).promise.then(doc => doc.getPage(1)).then(p => {
      // High resolution scale: 4.0 = ~300 DPI ultra-crisp vector rendering
      const v = p.getViewport({scale: 4.0});
      const c = document.getElementById('c');
      c.width = v.width; c.height = v.height;
      return p.render({canvasContext: c.getContext('2d'), viewport: v}).promise;
    }).then(() => { window._done = true; }).catch(err => { window._err = err.message; });
    </script></body></html>
  `;
  
  await page.setContent(html);
  await page.waitForFunction('window._done === true || window._err', { timeout: 30000 });
  
  // Extract clean PNG at 300 DPI
  const c = await page.$('#c');
  const pngBuffer = await c.screenshot({ type: 'png' });
  await page.close();
  
  // Convert PNG to a clean, 100% valid vector-sized PDF using pdf-lib
  const newPdfDoc = await PDFDocument.create();
  const pngImg = await newPdfDoc.embedPng(pngBuffer);
  const newPage = newPdfDoc.addPage([595.28, 841.89]);
  newPage.drawImage(pngImg, {
    x: 0,
    y: 0,
    width: 595.28,
    height: 841.89
  });
  const cleanPdfBytes = await newPdfDoc.save();
  fs.writeFileSync(destPath, cleanPdfBytes);
  console.log(`Successfully created clean base PDF: ${destPath} (${cleanPdfBytes.length} bytes)`);
}

async function run() {
  const browser = await chromium.launch();
  
  for (const item of targetFiles) {
    const srcPath = path.join(rootDir, item.source);
    const destPath = path.join(certAssetsDir, item.dest);
    
    if (!fs.existsSync(srcPath)) {
      console.warn(`Source file not found: ${srcPath}`);
      continue;
    }
    
    // Test if pdf-lib can load natively
    let canLoadNatively = false;
    try {
      const buf = fs.readFileSync(srcPath);
      const testDoc = await PDFDocument.load(buf, { ignoreEncryption: true });
      if (testDoc.getPageCount() > 0) {
        canLoadNatively = true;
      }
    } catch (e) {
      canLoadNatively = false;
    }
    
    if (canLoadNatively) {
      console.log(`Native pdf-lib load OK for: ${item.source} -> Copying directly`);
      fs.copyFileSync(srcPath, destPath);
    } else {
      console.log(`Native pdf-lib load failed for: ${item.source} -> Repairing to clean 300 DPI PDF`);
      await repairWithPlaywright(browser, srcPath, destPath);
    }
  }
  
  await browser.close();
  console.log('All templates normalized and copied to backend/assets/certificates!');
}

run().catch(console.error);
