import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateCertificate } from '../services/certificateGenerator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set system Chrome path
process.env.PUPPETEER_EXECUTABLE_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

async function getRandomCompanyFromDatabase() {
  const jsonPath = path.join(__dirname, '../sql-server-export/export/tables/dbo.CompRegis.json');
  
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`File not found: ${jsonPath}`);
  }

  const fileContent = fs.readFileSync(jsonPath, 'utf-8');
  const compDb = JSON.parse(fileContent);
  const rows = compDb.rows || [];

  // Filter companies that have valid names
  const validCompanies = rows.filter(r => r.CCompanyName && r.CCompanyName.trim().length > 1);

  if (validCompanies.length === 0) {
    throw new Error('No valid companies found in database.');
  }

  const randomIndex = Math.floor(Math.random() * validCompanies.length);
  return validCompanies[randomIndex];
}

async function main() {
  try {
    const compRow = await getRandomCompanyFromDatabase();

    const companyName = compRow.CCompanyName.trim();
    const certNumber = `HFA-UK-${new Date().getFullYear()}-${String(compRow.CID || Math.floor(1000 + Math.random() * 9000)).padStart(5, '0')}`;
    
    // Address building
    const addressParts = [compRow.Address1, compRow.Address2, compRow.City, compRow.PostCode, compRow.Country].filter(Boolean);
    const fullAddress = addressParts.length > 0 ? addressParts.join(', ') : 'Registered Business Facility, United Kingdom';
    
    const natureOfBusiness = (compRow.NatureOfBusiness && compRow.NatureOfBusiness !== '16') ? compRow.NatureOfBusiness : 'Halal Food Processing & Slaughtering Operations';

    const issueDate = compRow.DateReg ? new Date(compRow.DateReg.trim()) : new Date('2025-06-01');
    const expiryDate = compRow.ExperyDate ? new Date(compRow.ExperyDate.trim()) : new Date(issueDate.getTime() + 365 * 24 * 60 * 60 * 1000);

    const certData = {
      businessName: companyName,
      businessAddress: fullAddress,
      manufacturerAddress: fullAddress,
      certificateNumber: certNumber,
      scopeOfCertification: `${natureOfBusiness} — Certification of Compliance with HFA Halal Standards`,
      productCategories: [
        { code: `PRD-${compRow.CID || '01'}A`, name: `${natureOfBusiness} - Line A (Certified)` },
        { code: `PRD-${compRow.CID || '01'}B`, name: `${natureOfBusiness} - Premium Range` }
      ],
      issueDate: isNaN(issueDate.getTime()) ? new Date('2025-06-01') : issueDate,
      expiryDate: isNaN(expiryDate.getTime()) ? new Date('2026-05-31') : expiryDate,
      verificationUrl: `https://hfa-uk-portal.com/verify/${certNumber}`
    };

    console.log('\nSelected Random Database Company:', companyName);
    console.log('Generating PDF Certificate for:', certNumber, '...');

    const pdfBuffer = await generateCertificate(certData);

    const outputPath = path.join(__dirname, 'random-db-cert-out.pdf');
    fs.writeFileSync(outputPath, pdfBuffer);

    console.log(`\n✅ Random Database Certificate created successfully at: ${outputPath}`);
    console.log('\n--- Certificate Details ---');
    console.log(`Company Name: ${companyName}`);
    console.log(`Cert Number : ${certNumber}`);
    console.log(`Address     : ${fullAddress}`);
    console.log(`Nature/Scope: ${natureOfBusiness}`);
    console.log(`Issue Date  : ${certData.issueDate.toISOString().split('T')[0]}`);
    console.log(`Expiry Date : ${certData.expiryDate.toISOString().split('T')[0]}`);

  } catch (err) {
    console.error('Error generating random database certificate:', err);
    process.exit(1);
  }
}

main();
