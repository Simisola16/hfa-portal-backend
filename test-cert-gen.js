import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateCertificate } from './services/certificateGenerator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTest() {
  console.log('Starting certificate generation test...');
  
  const mockCertData = {
    businessName: 'Dunbia Carnaby (Test)',
    businessAddress: 'The Abattoir, Lancaster Road, Carnaby Bridlington YO15 3QY',
    manufacturerAddress: 'The Abattoir, Lancaster Road, Carnaby Bridlington YO15 3QY',
    certificateNumber: 'HFA-UK-2026-00999',
    scopeOfCertification: 'Lamb Slaughtering & Meat Processing Operations',
    productCategories: [
      { code: 'TST-001', name: 'Premium Lamb Shoulder' },
      { code: 'TST-002', name: 'Premium Lamb Breast' },
      { code: 'TST-003', name: 'Premium Lamb Carcass' }
    ],
    issueDate: new Date(),
    expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year later
    verificationUrl: 'https://hfa-uk-portal.com/verify/HFA-UK-2026-00999'
  };

  try {
    const pdfBuffer = await generateCertificate(mockCertData);
    
    // Ensure scratch directory exists
    const scratchDir = path.join(__dirname, 'scratch');
    if (!fs.existsSync(scratchDir)) {
      fs.mkdirSync(scratchDir, { recursive: true });
    }
    
    const outputPath = path.join(scratchDir, 'test-cert-out.pdf');
    fs.writeFileSync(outputPath, pdfBuffer);
    console.log(`Certificate successfully generated and written to ${outputPath}`);
  } catch (error) {
    console.error('Test failed with error:', error);
  }
}

runTest();
