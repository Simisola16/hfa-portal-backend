import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateCertificate, CERTIFICATE_SCHEMES } from '../services/certificateGenerator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const scratchDir = path.join(rootDir, 'scratch');

if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });

async function run() {
  const testCases = [
    {
      scheme: 'GSO meat',
      outName: 'output_gso_meat.pdf',
      data: {
        certificateType: 'GSO meat',
        certificateNumber: 'HFA-24-GM-0891',
        companyName: 'ANIK FOODS UK LIMITED',
        companyAddress: 'UNIT 4, PREMIER PARK, PARK ROYAL, LONDON NW10 7NZ',
        manufacturingAddress: 'UNIT 4, PREMIER PARK, PARK ROYAL, LONDON NW10 7NZ',
        scope: 'FRESH & CHILLED HALAL BEEF & LAMB CUTS',
        productCategory: 'FRESH & CHILLED HALAL BEEF & LAMB CUTS',
        issueDate: '13-Sep-2026',
        currentCycleStartDate: '13-Sep-2026',
        originalCycleStartDate: '13-Sep-2024',
        expiryDate: '12-Sep-2027',
        products: [
          { code: 'BF-001', name: 'Fresh Halal Beef Ribeye Steak' },
          { code: 'LM-002', name: 'Chilled Halal Lamb Chops' },
          { code: 'CK-003', name: 'Fresh Halal Chicken Breast Fillets' }
        ]
      }
    },
    {
      scheme: 'GSO non-meat',
      outName: 'output_gso_non_meat.pdf',
      data: {
        certificateType: 'GSO non-meat',
        certificateNumber: 'HFA-24-GNM-0452',
        companyName: 'AL-BARAKAH FOOD INDUSTRIES UK',
        companyAddress: '15 OLYMPIC WAY, WEMBLEY, MIDDLESEX HA9 0NP',
        manufacturingAddress: '15 OLYMPIC WAY, WEMBLEY, MIDDLESEX HA9 0NP',
        scope: 'HALAL BAKERY PRODUCTS AND CONFECTIONERY',
        productCategory: 'HALAL BAKERY PRODUCTS AND CONFECTIONERY',
        issueDate: '13-Sep-2026',
        currentCycleStartDate: '13-Sep-2026',
        originalCycleStartDate: '13-Sep-2024',
        expiryDate: '12-Sep-2027',
        products: [
          { code: 'BK-101', name: 'Artisan Halal Sourdough Bread' },
          { code: 'BK-102', name: 'Halal Butter Croissants 4-Pack' },
          { code: 'CF-201', name: 'Halal Chocolate Chip Cookies' }
        ]
      }
    },
    {
      scheme: 'HFA Scheme (meat)',
      outName: 'output_hfa_scheme_meat.pdf',
      data: {
        certificateType: 'HFA Scheme (meat)',
        certificateNumber: 'HFA-24-HM-0105',
        companyName: 'ROYAL HALAL MEATS LTD',
        companyAddress: '88 COMMERCIAL ROAD, BIRMINGHAM B1 1AA',
        manufacturingAddress: '88 COMMERCIAL ROAD, BIRMINGHAM B1 1AA',
        scope: 'HALAL POULTRY AND RED MEAT SLAUGHTERING AND PACKAGING',
        productCategory: 'HALAL POULTRY AND RED MEAT SLAUGHTERING AND PACKAGING',
        issueDate: '13-Sep-2026',
        certificationStartDate: '13-Sep-2026',
        expiryDate: '12-Sep-2027',
        products: [
          { name: 'Fresh Halal Whole Chicken Grade A' },
          { name: 'Chilled Halal Lamb Diced Mutton' },
          { name: 'Fresh Halal Beef Sirloin' }
        ]
      }
    },
    {
      scheme: 'HFA Scheme (non-meat)',
      outName: 'output_hfa_scheme_non_meat.pdf',
      data: {
        certificateType: 'HFA Scheme (non-meat)',
        certificateNumber: 'HFA-24-HNM-0220',
        companyName: 'NATURES HARVEST FLAVOURS UK',
        companyAddress: '22 BOTANY BAY LANE, LEEDS LS1 4HY',
        manufacturingAddress: '22 BOTANY BAY LANE, LEEDS LS1 4HY',
        scope: 'HALAL FOOD INGREDIENTS, EMULSIFIERS AND SEASONINGS',
        productCategory: 'HALAL FOOD INGREDIENTS, EMULSIFIERS AND SEASONINGS',
        issueDate: '13-Sep-2026',
        certificationStartDate: '13-Sep-2026',
        expiryDate: '12-Sep-2027',
        products: [
          { name: 'Natural Vanilla Extract Halal Grade' },
          { name: 'Organic Lecithin Emulsifier E322' },
          { name: 'Halal Roasted Paprika Seasoning Blend' }
        ]
      }
    },
    {
      scheme: 'Cosmetics',
      outName: 'output_cosmetics.pdf',
      data: {
        certificateType: 'Cosmetics',
        certificateNumber: 'HFA-24-COS-0112',
        companyName: 'LUMEN BEAUTY LABS UK LTD',
        companyAddress: '10 HARLEY STREET, LONDON W1G 9PF',
        manufacturingAddress: 'UNIT 2, COSMETIC PARK, MANCHESTER M1 7ED',
        scope: 'HALAL CERTIFIED SKINCARE AND PERSONAL CARE FORMULATIONS',
        productCategory: 'HALAL CERTIFIED SKINCARE AND PERSONAL CARE FORMULATIONS',
        issueDate: '13-Sep-2026',
        certificationStartDate: '13-Sep-2026',
        expiryDate: '12-Sep-2027',
        products: [
          { name: 'Hydrating Botanical Facial Cleanser' },
          { name: 'Pure Rosewater Hydrosol Toner' },
          { name: 'Nourishing Shea Butter Body Lotion' }
        ]
      }
    },
    {
      scheme: 'SMIIC',
      outName: 'output_smiic.pdf',
      data: {
        certificateType: 'SMIIC',
        certificateNumber: 'HFA-24-SM-0077',
        companyName: 'CRESCENT GLOBAL BEVERAGES LTD',
        companyAddress: '45 INDUSTRIAL WAY, COVENTRY CV1 2AB',
        manufacturingAddress: '45 INDUSTRIAL WAY, COVENTRY CV1 2AB',
        scope: 'HALAL BEVERAGES, SYRUPS AND FRUIT CONCENTRATES',
        productCategory: 'HALAL BEVERAGES, SYRUPS AND FRUIT CONCENTRATES',
        issueDate: '13-Sep-2026',
        certificationStartDate: '13-Sep-2026',
        expiryDate: '12-Sep-2027',
        products: [
          { name: 'Sparkling Pomegranate Beverage 330ml' },
          { name: 'Organic Mango Puree Concentrate' }
        ]
      }
    }
  ];

  console.log(`Starting generation for ${testCases.length} certificate schemes...`);

  for (const tc of testCases) {
    try {
      console.log(`\nGenerating: ${tc.scheme}...`);
      const pdfBuf = await generateCertificate(tc.data);
      const outPdf = path.join(scratchDir, tc.outName);
      fs.writeFileSync(outPdf, pdfBuf);
      console.log(`✅ Successfully generated ${tc.scheme} -> ${tc.outName} (${pdfBuf.length} bytes)`);
    } catch (err) {
      console.error(`❌ Error generating ${tc.scheme}:`, err);
    }
  }

  console.log('\nAll certificate generation tests completed successfully!');
}

run().catch(console.error);
