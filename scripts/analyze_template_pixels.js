import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scratchDir = path.join(__dirname, '../../scratch');

async function analyzeImage(browser, imgName) {
  const page = await browser.newPage();
  const imgPath = path.join(scratchDir, imgName);
  const b64 = fs.readFileSync(imgPath).toString('base64');
  
  const results = await page.evaluate(async (dataUrl) => {
    const img = new Image();
    img.src = dataUrl;
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
    });
    
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const id = ctx.getImageData(0, 0, c.width, c.height);
    const data = id.data;
    
    const midX = Math.floor(c.width / 2);
    let greenRanges = [];
    let inGreen = false;
    let greenStart = 0;
    
    for (let y = 0; y < c.height; y++) {
      const idx = (y * c.width + midX) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      
      const isGreen = (g > 90 && r < 60 && b < 80);
      if (isGreen && !inGreen) {
        inGreen = true;
        greenStart = y;
      } else if (!isGreen && inGreen) {
        inGreen = false;
        greenRanges.push({ startY: greenStart, endY: y, h: y - greenStart });
      }
    }
    
    return {
      width: c.width,
      height: c.height,
      greenRanges
    };
  }, `data:image/png;base64,${b64}`);
  
  console.log(`\n=== Analysis for ${imgName} (Canvas ${results.width}x${results.height}, PDF scale=${results.width/595.28}) ===`);
  const scale = results.width / 595.28;
  const pdfH = results.height / scale;
  results.greenRanges.forEach(gr => {
    const pdfTopY = pdfH - (gr.startY / scale);
    const pdfBottomY = pdfH - (gr.endY / scale);
    console.log(`  Green band: px Y=[${gr.startY}..${gr.endY}] h=${gr.h}px -> PDF Y=[${pdfBottomY.toFixed(2)}..${pdfTopY.toFixed(2)}] h=${(gr.h/scale).toFixed(2)}pt`);
  });
  
  await page.close();
}

async function run() {
  const browser = await chromium.launch();
  await analyzeImage(browser, 'raw_gso_meat.png');
  await analyzeImage(browser, 'raw_gso_non_meat.png');
  await analyzeImage(browser, 'raw_hfa_meat.png');
  await analyzeImage(browser, 'raw_hfa_non_meat.png');
  await analyzeImage(browser, 'raw_cosmetics.png');
  await browser.close();
}

run().catch(console.error);
