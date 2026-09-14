import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateCertificate } from '../services/certificateGenerator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const randomCompanies = [
  {
    businessName: 'Global Poultry & Food Processing Ltd',
    businessAddress: 'Unit 4 Industrial Estate, Birmingham, B12 0QU',
    scopeOfCertification: 'Poultry Slaughtering, Portioning & Modified Atmosphere Packaging',
    productCategories: [
      { code: 'PLT-101', name: 'Whole Fresh Halal Chicken (Grade A)' },
      { code: 'PLT-102', name: 'Halal Boneless Skinless Chicken Breast Fillets' },
      { code: 'PLT-103', name: 'Halal Seasoned Chicken Thigh Meat' },
      { code: 'PLT-104', name: 'Halal Chicken Wings (IQF 10kg)' }
    ]
  },
  {
    businessName: 'Al-Noor Bakery & Confectionery Solutions',
    businessAddress: '15 Meadow Lane, Bradford, BD5 7TR',
    scopeOfCertification: 'Bread, Baked Goods & Confectionery Production (Gelatin-Free)',
    productCategories: [
      { code: 'BKR-201', name: 'Halal Artisanal Tandoori Naan Bread' },
      { code: 'BKR-202', name: 'Halal Pistachio & Honey Baklava Box' },
      { code: 'BKR-203', name: 'All-Vegetable Shortcrust Pastry Blocks' },
      { code: 'BKR-204', name: 'Fruit Preserves & Glazes (Alcohol-Free)' }
    ]
  },
  {
    businessName: 'Apex Spice & Flavor Technologies Ltd',
    businessAddress: '8 Trade Park Way, Manchester, M17 1TN',
    scopeOfCertification: 'Blending of Dry Spices, Seasoning Powders & Liquid Marinades',
    productCategories: [
      { code: 'SPC-301', name: 'Halal Shawarma Seasoning Blend Grade A' },
      { code: 'SPC-302', name: 'Halal Smokey BBQ Liquid Marinade' },
      { code: 'SPC-303', name: 'Pure Ground Cardamom & Cumin Mix' },
      { code: 'SPC-304', name: 'Halal Garlic & Herb Rub' }
    ]
  },
  {
    businessName: 'Highland Pure Dairy & Beverage Ltd',
    businessAddress: '72 Riverbank Road, Glasgow, G5 8QS',
    scopeOfCertification: 'Pasteurised Milk, Cheese & Dairy Desserts Processing',
    productCategories: [
      { code: 'DRY-401', name: 'Halal Organic Whole Milk (2L)' },
      { code: 'DRY-402', name: 'Halal Natural Greek Style Yogurt' },
      { code: 'DRY-403', name: 'Halal Mild Cheddar Cheese Block' },
      { code: 'DRY-404', name: 'Microbial Rennet Cottage Cheese' }
    ]
  }
];

async function run() {
  const chosen = randomCompanies[Math.floor(Math.random() * randomCompanies.length)];
  const randomCertNum = `HFA-UK-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;

  const certData = {
    ...chosen,
    certificateNumber: randomCertNum,
    issueDate: new Date(),
    expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    verificationUrl: `https://hfa-uk-portal.com/verify/${randomCertNum}`
  };

  console.log(`Generating random certificate for: ${chosen.businessName} (${randomCertNum})`);
  const pdfBuffer = await generateCertificate(certData);

  const outputPath = path.join(__dirname, 'random-cert-out.pdf');
  fs.writeFileSync(outputPath, pdfBuffer);
  console.log(`Saved random certificate to ${outputPath}`);
}

run().catch(err => {
  console.error('Error generating random cert:', err);
  process.exit(1);
});
