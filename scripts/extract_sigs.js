import fs from 'fs';
import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function extractCleanSigs() {
  const browser = await puppeteer.launch({ 
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  const imgPath = path.resolve(__dirname, '../../scratch/pdf_renders/GSO_MEAT_pdf_p1.png');
  const imgBase64 = fs.readFileSync(imgPath).toString('base64');
  
  const html = `
    <!DOCTYPE html>
    <html>
    <body>
      <canvas id="amirCanvas"></canvas>
      <canvas id="muftiCanvas"></canvas>
      <script>
        const img = new Image();
        img.onload = () => {
          const w = img.width;
          const h = img.height;
          const scaleX = w / 595.28;
          const scaleY = h / 841.89;

          // Amir Masoom sig: PDF x: 25, y: 135 to 195 (from bottom)
          const amirX = Math.round(25 * scaleX);
          const amirY = Math.round((841.89 - 195) * scaleY);
          const amirW = Math.round(115 * scaleX);
          const amirH = Math.round(55 * scaleY);

          const aCan = document.getElementById('amirCanvas');
          aCan.width = amirW;
          aCan.height = amirH;
          const aCtx = aCan.getContext('2d');
          aCtx.drawImage(img, amirX, amirY, amirW, amirH, 0, 0, amirW, amirH);

          const aData = aCtx.getImageData(0, 0, amirW, amirH);
          for (let i = 0; i < aData.data.length; i += 4) {
            const r = aData.data[i];
            const g = aData.data[i+1];
            const b = aData.data[i+2];
            const brightness = (r + g + b) / 3;
            if (brightness > 140) {
              aData.data[i+3] = 0;
            } else {
              const alpha = Math.min(255, Math.round((140 - brightness) * 3));
              aData.data[i] = 20;
              aData.data[i+1] = 25;
              aData.data[i+2] = 30;
              aData.data[i+3] = alpha;
            }
          }
          aCtx.putImageData(aData, 0, 0);

          // Mufti sig: PDF x: 400, y: 135 to 195
          const mX = Math.round(400 * scaleX);
          const mY = Math.round((841.89 - 195) * scaleY);
          const mW = Math.round(145 * scaleX);
          const mH = Math.round(55 * scaleY);

          const mCan = document.getElementById('muftiCanvas');
          mCan.width = mW;
          mCan.height = mH;
          const mCtx = mCan.getContext('2d');
          mCtx.drawImage(img, mX, mY, mW, mH, 0, 0, mW, mH);

          const mData = mCtx.getImageData(0, 0, mW, mH);
          for (let i = 0; i < mData.data.length; i += 4) {
            const r = mData.data[i];
            const g = mData.data[i+1];
            const b = mData.data[i+2];
            const brightness = (r + g + b) / 3;
            if (brightness > 140) {
              mData.data[i+3] = 0;
            } else {
              const alpha = Math.min(255, Math.round((140 - brightness) * 3));
              mData.data[i] = 20;
              mData.data[i+1] = 25;
              mData.data[i+2] = 30;
              mData.data[i+3] = alpha;
            }
          }
          mCtx.putImageData(mData, 0, 0);

          window._done = {
            amir: aCan.toDataURL('image/png'),
            mufti: mCan.toDataURL('image/png')
          };
        };
        img.src = 'data:image/png;base64,' + "${imgBase64}";
      </script>
    </body>
    </html>
  `;

  await page.setContent(html);
  await page.waitForFunction('window._done !== undefined', { timeout: 30000 });
  const result = await page.evaluate(() => window._done);
  
  const outDir = path.resolve(__dirname, '../assets/certificates');
  fs.writeFileSync(path.join(outDir, 'sig_amir_clean.png'), Buffer.from(result.amir.replace(/^data:image\/png;base64,/, ''), 'base64'));
  fs.writeFileSync(path.join(outDir, 'sig_mufti_clean.png'), Buffer.from(result.mufti.replace(/^data:image\/png;base64,/, ''), 'base64'));
  console.log('Saved clean transparent signatures!');
  await browser.close();
}

extractCleanSigs().catch(console.error);
