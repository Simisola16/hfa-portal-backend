import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function removeAsterisksFromPdf(filePath) {
  let content = fs.readFileSync(filePath, 'latin1');
  // Check if string contains ****************
  if (content.includes('****************')) {
    console.log(`Found **************** in ${path.basename(filePath)}, removing...`);
    // In PDF streams, text is written as (****************) Tj or [(***)...] TJ
    // Replacing (****************) with () will remove the text completely while preserving exact byte structure
    const cleaned = content.replaceAll('****************', '                ');
    fs.writeFileSync(filePath, cleaned, 'latin1');
    console.log(`Cleaned ${path.basename(filePath)}`);
  } else {
    console.log(`No **************** in ${path.basename(filePath)}`);
  }
}

const certsDir = path.join(__dirname, '../assets/certificates');
const files = fs.readdirSync(certsDir).filter(f => f.endsWith('.pdf'));
files.forEach(f => {
  removeAsterisksFromPdf(path.join(certsDir, f));
});
