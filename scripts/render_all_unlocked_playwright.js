import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const scratchDir = path.join(rootDir, 'scratch');
if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });

const templates = [
  { name: 'GSO_Meat', file: 'Template GSO Scheme (meat) Cert-unlocked (1) 1.pdf' },
  { name: 'GSO_Non_Meat', file: 'Template GSO Scheme (Non-meat) Cert-unlocked 1.pdf' },
  { name: 'HFA_Scheme_Meat', file: 'Template HFA Scheme (meat) Cert 11 Oct 22-unlocked.pdf' },
  { name: 'HFA_Scheme_Non_Meat', file: 'Template HFA Scheme (Non-meat) Cert 11 Oct 22-unlocked.pdf' },
  { name: 'Cosmetics', file: 'Template HFA Scheme (Cosmetic) Cert 11 Oct 22-unlocked 1.pdf' }
];

async function renderTemplates() {
  const browser = await chromium.launch();
  
  for (const t of templates) {
    const fullPath = path.join(__dirname, '../assets/certificates', t.file);
    console.log('Rendering:', t.name, fullPath);
    if (!fs.existsSync(fullPath)) {
      console.log('Not found:', fullPath);
      continue;
    }
    const page = await browser.newPage({ viewport: { width: 1200, height: 1700 } });
    const fileUrl = 'file:///' + fullPath.replace(/\\/g, '/');
    await page.goto(fileUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const outPng = path.join(scratchDir, `template_${t.name}.png`);
    await page.screenshot({ path: outPng, fullPage: true });
    console.log('Saved:', outPng);
    await page.close();
  }
  
  await browser.close();
  console.log('Done rendering templates!');
}

renderTemplates().catch(console.error);
