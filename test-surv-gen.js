import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateSurveillanceLetter } from './services/surveillanceLetterGenerator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testLetterGen() {
  console.log('Testing surveillance letter generator...');
  try {
    const pdfBuf = await generateSurveillanceLetter({
      letter_number: 'HFA-SURV-854244',
      issue_date: '2026-08-24',
      next_due_date: '2027-08-24',
      recipient_name: 'Adebayo Foods Ltd',
      recipient_address: '123 Halal Industrial Park, Birmingham B12 0AA, United Kingdom',
      recipient_attention: 'Quality Assurance & Halal Management Team',
      products_covered: 'Fresh Beef, Poultry, Seasoned Cuts, Prepared Halal Meals',
      standards: 'UAE.S 2055-1:2015 / GSO 2055-1:2015 Halal Standards',
      signatory_name: 'Dr. Abdul-Rahman Malik',
      signatory_title: 'Head of Halal Auditing & Certification Board'
    });

    const outPath = path.join(__dirname, 'scratch/test-surv-letter.pdf');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, pdfBuf);
    console.log('Surveillance letter generated successfully at:', outPath, 'Size:', pdfBuf.length);
  } catch (err) {
    console.error('Surveillance letter generation test failed:', err);
  }
}

testLetterGen();
