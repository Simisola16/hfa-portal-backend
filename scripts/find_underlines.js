import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scratchDir = path.join(__dirname, '../../scratch');

async function findGreyUnderlines(browser, imgName) {
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
    
    // Test across x = 300..400 (where the underline is continuous)
    const testXs = [Math.floor(c.width * 0.35), Math.floor(c.width * 0.5), Math.floor(c.width * 0.65)];
    let lineYs = [];
    
    for (let y = Math.floor(c.height * 0.3); y < Math.floor(c.height * 0.7); y++) {
      let matchCount = 0;
      for (const tx of testXs) {
        const idx = (y * c.width + tx) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        // Grey line: dark grey, r, g, b close to each other, not green
        if (r < 180 && g < 180 && b < 180 && Math.abs(r - g) < 20 && Math.abs(g - b) < 20 && !(g > 100 && r < 70)) {
          matchCount++;
        }
      }
      if (matchCount === testXs.length) {
        // Group consecutive Ys
        if (lineYs.length === 0 || y > lineYs[lineYs.length - 1] + 4) {
          lineYs.push(y);
        }
      }
    }
    
    return { width: c.width, height: c.height, lineYs };
  }, `data:image/png;base64,${b64}`);
  
  const scale = results.width / 595.28;
  const pdfH = results.height / scale;
  console.log(`\n=== Grey Underlines for ${imgName} ===`);
  results.lineYs.forEach((ly, idx) => {
    const pdfY = pdfH - (ly / scale);
    console.log(`  Line ${idx + 1}: px Y=${ly} -> PDF Y=${pdfY.toFixed(2)}pt`);
  });
  
  await page.close();
}

async function run() {
  const browser = await chromium.launch();
  await findGreyUnderlines(browser, 'raw_gso_meat.png');
  await findGreyUnderlines(browser, 'raw_gso_non_meat.png');
  await findGreyUnderlines(browser, 'raw_hfa_meat.png');
  await findGreyUnderlines(browser, 'raw_hfa_non_meat.png');
  await findGreyUnderlines(browser, 'raw_cosmetics.png');
  await browser.close();
}

run().catch(console.error);
