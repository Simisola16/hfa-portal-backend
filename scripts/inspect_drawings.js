import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

async function inspectDrawing(browser, filePath) {
  console.log('========================================');
  console.log('DRAWING INSPECTION FOR:', path.basename(filePath));
  console.log('========================================');
  const fullPath = path.resolve(rootDir, filePath);
  const pdfBuf = fs.readFileSync(fullPath);
  const b64 = pdfBuf.toString('base64');
  const page = await browser.newPage();
  const html = `
    <!DOCTYPE html><html><head>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
    <script>pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';</script>
    </head><body><script>
    const pdfData = atob("${b64}");
    const u = new Uint8Array(pdfData.length);
    for (let i=0; i<pdfData.length; i++) u[i] = pdfData.charCodeAt(i);
    pdfjsLib.getDocument({data: u}).promise.then(doc => doc.getPage(1)).then(p => {
      return p.getOperatorList().then(opList => {
        // Collect draw rects, fill colors, stroke colors
        const ops = [];
        for (let i = 0; i < opList.fnArray.length; i++) {
          const fn = opList.fnArray[i];
          const args = opList.argsArray[i];
          ops.push({ fn, args });
        }
        window._ops = ops;
      });
    }).catch(err => { window._err = err.message; });
    </script></body></html>
  `;
  await page.setContent(html);
  await page.waitForFunction('window._ops || window._err', { timeout: 30000 });
  const ops = await page.evaluate('window._ops');
  if (ops) {
    console.log('Total ops:', ops.length);
    // Find rectangles (constructPath args)
    const rects = [];
    for (const op of ops) {
      if (op.args && Array.isArray(op.args)) {
        // Look for arrays with 4 numbers or path constructions
        const json = JSON.stringify(op.args);
        if (json.includes('300') || json.includes('284') || json.includes('268') || json.includes('250') || json.includes('228') || json.includes('258')) {
          console.log('Op:', op.fn, json.slice(0, 200));
        }
      }
    }
  }
  await page.close();
}

async function main() {
  const browser = await chromium.launch();
  await inspectDrawing(browser, 'Template GSO Scheme (meat) Cert.pdf');
  await inspectDrawing(browser, 'Template HFA Scheme (Cosmetic) Cert 11 Oct 22.pdf');
  await browser.close();
}

main().catch(console.error);
