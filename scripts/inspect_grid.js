import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

async function inspectGrid(browser, filePath) {
  console.log('========================================');
  console.log('INSPECTING GRID IN:', path.basename(filePath));
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
        const ops = [];
        let curStrokeR = 0, curStrokeG = 0, curStrokeB = 0;
        let curFillR = 0, curFillG = 0, curFillB = 0;
        let curLineWidth = 1;
        for (let i = 0; i < opList.fnArray.length; i++) {
          const fn = opList.fnArray[i];
          const args = opList.argsArray[i];
          if (fn === pdfjsLib.OPS.setStrokeRGBColor) {
            curStrokeR = args[0]; curStrokeG = args[1]; curStrokeB = args[2];
          } else if (fn === pdfjsLib.OPS.setFillRGBColor) {
            curFillR = args[0]; curFillG = args[1]; curFillB = args[2];
          } else if (fn === pdfjsLib.OPS.setLineWidth) {
            curLineWidth = args[0];
          } else if (fn === pdfjsLib.OPS.constructPath) {
            ops.push({
              pathOps: args[0],
              coords: args[1],
              stroke: [curStrokeR, curStrokeG, curStrokeB],
              fill: [curFillR, curFillG, curFillB],
              lineWidth: curLineWidth
            });
          }
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
    console.log('Found path constructions:', ops.length);
    for (const op of ops) {
      if (op.coords && Array.isArray(op.coords)) {
        // Look for table bounding box ~ y: 250 - 320
        const hasTableCoords = op.coords.some(c => typeof c === 'number' && c >= 240 && c <= 320);
        if (hasTableCoords) {
          console.log('Table Op: stroke =', op.stroke, 'fill =', op.fill, 'lineWidth =', op.lineWidth, 'coords =', op.coords.slice(0, 10));
        }
      }
    }
  }
  await page.close();
}

async function main() {
  const browser = await chromium.launch();
  await inspectGrid(browser, 'Template GSO Scheme (meat) Cert.pdf');
  await inspectGrid(browser, 'Template HFA Scheme (Cosmetic) Cert 11 Oct 22.pdf');
  await browser.close();
}

main().catch(console.error);
