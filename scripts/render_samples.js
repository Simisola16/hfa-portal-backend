import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

async function render() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const files = [
    'Template GSO Scheme (meat) Cert.pdf',
    'Template HFA Scheme (Cosmetic) Cert 11 Oct 22.pdf',
    'COSMETICS.pdf',
    'GSO MEAT.pdf',
    'GSO NON MEAT.pdf',
    'HFA SCHEME.pdf',
    'SMIIC.pdf'
  ];

  const outDir = path.resolve('..', 'scratch', 'pdf_renders');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
      <script>
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      </script>
      <style>body { margin: 0; background: #333; display: flex; flex-direction: column; align-items: center; gap: 20px; }</style>
    </head>
    <body>
      <div id="container"></div>
      <script>
        window.renderPdf = async function(base64Data) {
          const container = document.getElementById('container');
          container.innerHTML = '';
          const pdfData = atob(base64Data);
          const uint8Array = new Uint8Array(pdfData.length);
          for (let i = 0; i < pdfData.length; i++) {
            uint8Array[i] = pdfData.charCodeAt(i);
          }
          const pdf = await pdfjsLib.getDocument({ data: uint8Array }).promise;
          const textContentPages = [];
          for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const viewport = page.getViewport({ scale: 2.0 });
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            container.appendChild(canvas);
            await page.render({ canvasContext: ctx, viewport: viewport }).promise;

            const textContent = await page.getTextContent();
            textContentPages.push(textContent.items.map(item => ({
              str: item.str,
              x: item.transform[4],
              y: item.transform[5],
              fontName: item.fontName,
              width: item.width,
              height: item.height
            })));
          }
          return { numPages: pdf.numPages, textContentPages };
        };
      </script>
    </body>
    </html>
  `;

  await page.setContent(html);

  for (const f of files) {
    const filePath = path.resolve('..', f);
    if (!fs.existsSync(filePath)) continue;
    const base64 = fs.readFileSync(filePath).toString('base64');
    console.log('Rendering:', f);
    const result = await page.evaluate((b64) => window.renderPdf(b64), base64);
    console.log(f, 'has pages:', result.numPages);
    
    // Save text content JSON
    const textOutName = f.replace(/[^a-zA-Z0-9]/g, '_') + '_text.json';
    fs.writeFileSync(path.join(outDir, textOutName), JSON.stringify(result.textContentPages, null, 2));

    await page.waitForTimeout(1000);
    const canvases = await page.$$('#container canvas');
    for (let p = 0; p < canvases.length; p++) {
      const outName = f.replace(/[^a-zA-Z0-9]/g, '_') + '_p' + (p + 1) + '.png';
      await canvases[p].screenshot({ path: path.join(outDir, outName) });
      console.log('Saved page', p + 1, 'to', outName);
    }
  }

  await browser.close();
  console.log('All done!');
}

render().catch(console.error);
