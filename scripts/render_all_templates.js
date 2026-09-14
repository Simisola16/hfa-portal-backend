import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

async function renderPdf(browser, pdfPath, outPngPath) {
  if (!fs.existsSync(pdfPath)) {
    console.log('❌ File not found:', pdfPath);
    return;
  }
  const pdfBuf = fs.readFileSync(pdfPath);
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
    console.log('❌ Error rendering', path.basename(pdfPath), err);
  } else {
    const c = await page.$('#c');
    await c.screenshot({ path: outPngPath });
    console.log('✅ Saved:', path.basename(outPngPath));
  }
  await page.close();
}

async function run() {
  const browser = await chromium.launch();
  const files = [
    { in: path.join(rootDir, 'Template GSO Scheme (meat) Cert.pdf'), out: path.join(rootDir, 'scratch/master_template_gso.png') },
    { in: path.join(rootDir, 'Template HFA Scheme (Cosmetic) Cert 11 Oct 22.pdf'), out: path.join(rootDir, 'scratch/master_template_hfa.png') },
    { in: path.join(rootDir, 'GSO MEAT.pdf'), out: path.join(rootDir, 'scratch/bg_gso_meat.png') },
    { in: path.join(rootDir, 'GSO NON MEAT.pdf'), out: path.join(rootDir, 'scratch/bg_gso_non_meat.png') },
    { in: path.join(rootDir, 'COSMETICS.pdf'), out: path.join(rootDir, 'scratch/bg_cosmetics.png') },
    { in: path.join(rootDir, 'HFA SCHEME.pdf'), out: path.join(rootDir, 'scratch/bg_hfa_scheme.png') },
    { in: path.join(rootDir, 'SMIIC.pdf'), out: path.join(rootDir, 'scratch/bg_smiic.png') }
  ];

  const scratchDir = path.join(rootDir, 'scratch');
  if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });

  for (const f of files) {
    await renderPdf(browser, f.in, f.out);
  }
  await browser.close();
  console.log('🎉 All template master renders finished.');
}

run().catch(console.error);
