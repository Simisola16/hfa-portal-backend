import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const files = [
  'Template HFA Scheme (Cosmetic) Cert 11 Oct 22.pdf',
  'Template GSO Scheme (meat) Cert.pdf',
  'COSMETICS.pdf',
  'GSO MEAT.pdf',
  'GSO NON MEAT.pdf',
  'HFA SCHEME.pdf',
  'SMIIC.pdf'
];

async function run() {
  const browser = await puppeteer.launch({ 
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const outDir = path.join(__dirname, '../scratch/cert_previews');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  for (const f of files) {
    const filePath = path.resolve(__dirname, '../../', f);
    if (!fs.existsSync(filePath)) {
      console.log('File not found:', filePath);
      continue;
    }
    console.log('Processing:', f);
    const page = await browser.newPage();
    await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 2 });
    
    // Puppeteer can open PDF with pdfjs or direct file url
    const fileUrl = 'file:///' + filePath.replace(/\\/g, '/');
    try {
      await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      await new Promise(r => setTimeout(r, 1000));
      const safeName = f.replace(/[^a-zA-Z0-9]/g, '_');
      await page.screenshot({ path: path.join(outDir, `${safeName}.png`), fullPage: false });
      console.log('Saved preview:', safeName);
    } catch (e) {
      console.error('Error loading', f, e.message);
    } finally {
      await page.close();
    }
  }
  await browser.close();
  console.log('Done rendering previews!');
}

run().catch(console.error);
