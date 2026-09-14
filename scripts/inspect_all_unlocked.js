import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import PDFParser from 'pdf2json';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const templates = [
  { name: 'GSO Meat', file: 'Template GSO Scheme (meat) Cert-unlocked (1) 1.pdf' },
  { name: 'GSO Non-Meat', file: 'Template GSO Scheme (Non-meat) Cert-unlocked 1.pdf' },
  { name: 'HFA Scheme Meat', file: 'Template HFA Scheme (meat) Cert 11 Oct 22-unlocked.pdf' },
  { name: 'HFA Scheme Non-Meat', file: 'Template HFA Scheme (Non-meat) Cert 11 Oct 22-unlocked.pdf' },
  { name: 'Cosmetics', file: 'Template HFA Scheme (Cosmetic) Cert 11 Oct 22-unlocked 1.pdf' }
];

async function inspectPdf(template) {
  const filePath = path.join(__dirname, '../assets/certificates', template.file);
  console.log(`\n==================================================`);
  console.log(`INSPECTING: ${template.name} (${template.file})`);
  console.log(`==================================================`);

  if (!fs.existsSync(filePath)) {
    console.log(`File not found: ${filePath}`);
    return;
  }

  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();
    pdfParser.on("pdfParser_dataError", errData => {
      console.error(errData.parserError);
      resolve();
    });
    pdfParser.on("pdfParser_dataReady", pdfData => {
      try {
        const page = pdfData.Pages[0];
        console.log(`Page Width: ${page.Width}, Height: ${page.Height}`);
        console.log(`Texts count: ${page.Texts.length}`);

        // Sort texts by Y then X
        const texts = page.Texts.map(t => {
          const textStr = decodeURIComponent(t.R[0].T);
          // Coordinates in pdf2json are relative to page width/height units (approx 1 unit = 16 pt or 24 pt)
          // Let's print raw x, y, and fontSize
          return {
            x: t.x,
            y: t.y,
            w: t.w,
            text: textStr,
            ts: t.R[0].TS,
            fontFace: t.R[0].R,
            raw: t
          };
        });

        // Print top 40 texts
        texts.forEach(t => {
          console.log(`[x: ${t.x.toFixed(2)}, y: ${t.y.toFixed(2)}] "${t.text}" (font: ${JSON.stringify(t.ts)})`);
        });

        resolve();
      } catch (err) {
        console.error(err);
        resolve();
      }
    });
    pdfParser.loadPDF(filePath);
  });
}

async function run() {
  for (const t of templates) {
    await inspectPdf(t);
  }
}

run();
