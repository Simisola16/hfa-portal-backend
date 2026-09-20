import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, PDFName } from 'pdf-lib';
import zlib from 'zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCHEME_CONFIGS = {
  'GSO MEAT.pdf': {
    name: 'GSO meat',
    isGso: true,
    docFooter: 'Doc: Halal Certificate (GSO meat)   Created by: AH   Amended by: TO   Approved by: AM   Version: 16   Date: 28.10.2024',
    declarationLines: [
      'We certify and confirm that the company/manufacturing facility(ies) and the product/s listed',
      'below has/have been successfully evaluated and audited in accordance with HFA Halal',
      'Certification Requirements Manual HFP-1005-20/5, HMP-1105-21/2, and other relevant',
      'standards including SMIIC -1:2019/UAE.S.993/UAE.S.2055-1:2015.'
    ]
  },
  'GSO NON MEAT.pdf': {
    name: 'GSO non-meat',
    isGso: true,
    docFooter: 'Doc: Halal Certificate (GSO non-meat)   Created by: AH   Amended by: TO   Approved by: AM   Version: 16   Date: 28.10.2024',
    declarationLines: [
      'We certify and confirm that the company/manufacturing facility(ies) and the product/s listed',
      'below has/have been successfully evaluated and audited in accordance with HFA Halal',
      'Certification Requirements Manual HFP-1005-20/5 and UAE.S.2055-1:2015.',
      ''
    ]
  },
  'HFA SCHEME.pdf': {
    name: 'HFA Scheme',
    isGso: false,
    docFooter: 'Doc: Halal Certificate (HFA Scheme)   Created by: MH   Approved by: HI   Version: 2   Date: 11.10.2022',
    declarationLines: [
      'We certify and confirm that the company/manufacturing facility(ies) and the product/s listed',
      'below has/have been successfully evaluated and audited in accordance with HFA Halal',
      'Certification Requirements Manual HFP-1005-20/5.',
      ''
    ]
  },
  'SMIIC.pdf': {
    name: 'Smiic',
    isGso: true,
    docFooter: 'Doc: Halal Certificate (SMIIC Scheme)   Created by: MH   Approved by: HI   Version: 2   Date: 11.10.2022',
    declarationLines: [
      'We certify and confirm that the company/manufacturing facility(ies) and the product/s listed',
      'below has/have been successfully evaluated and audited in accordance with GSO 2055-1,',
      'OIC/SMIIC 1 and HFA Halal Certification Requirements Manual HFP-1005-20/5.',
      ''
    ]
  },
  'COSMETICS.pdf': {
    name: 'Cosmetics',
    isGso: false,
    docFooter: 'Doc: Halal Certificate (HFA Cosmetic Scheme)   Created by: MH   Approved by: HI   Version: 2   Date: 11.10.2022',
    declarationLines: [
      'We certify and confirm that the company/manufacturing facility(ies) and the product/s listed',
      'below has/have been successfully evaluated and audited in accordance with OIC/SMIIC 4:2018.',
      '',
      ''
    ]
  }
};

async function buildCleanBases() {
  const masterPath = path.resolve(__dirname, '../assets/certificates/Template GSO Scheme (meat) Cert.pdf');
  const masterBuf = fs.readFileSync(masterPath);

  for (const [filename, config] of Object.entries(SCHEME_CONFIGS)) {
    const doc = await PDFDocument.load(masterBuf);
    const page = doc.getPage(0);

    // 1. Remove Fm1 (TEMPLATE watermark)
    const xObject = doc.context.lookup(page.node.Resources().get(PDFName.of('XObject')));
    const fm1 = doc.context.lookup(xObject.get(PDFName.of('Fm1')));
    if (fm1) {
      fm1.contents = zlib.deflateSync(Buffer.from(''));
    }

    const contents = page.node.Contents();

    // 2. Stream 4: Remove xxxx placeholders, sample table, sample asterisks, Page 1 of 1, and adjust dates for non-GSO
    const s4 = doc.context.lookup(contents.get(4));
    let s4Text = zlib.inflateSync(s4.asUint8Array()).toString('utf-8');
    
    // Clear placeholders & sample asterisks
    s4Text = s4Text.replace(/\(x+\)Tj/g, '()Tj');
    s4Text = s4Text.replace(/\(\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\)Tj/g, '()Tj');

    // Remove pre-printed 'Page 1 of 1' so certificateGenerator can dynamically number pages
    s4Text = s4Text.replace(/\[\(P\).*?\(1 \)\s*\]TJ/g, '()Tj');

    // Remove table lines (from 160.868 311.474 to Current Cycle Start Date)
    const lines = s4Text.split('\n');
    let tStart = -1, tEnd = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('160.868 311.474') && tStart === -1) tStart = i;
      if (lines[i].includes('Current Cycle Start Date:') && tStart !== -1) {
        tEnd = i;
        break;
      }
    }
    if (tStart !== -1 && tEnd !== -1) {
      lines.splice(tStart - 1, tEnd - tStart);
      s4Text = lines.join('\n');
    }

    if (!config.isGso) {
      // Non-GSO: change 'Current Cycle Start Date: ' to 'Certification Start Date: ' and erase 'Original Cycle Start Date:'
      s4Text = s4Text.replace(/\(Current Cycle Start Date:\s*\)Tj/g, '(Certification Start Date: )Tj');
      s4Text = s4Text.replace(/\(Original Cycle Start Date:\s*\)Tj/g, '()Tj');
    }

    s4.contents = zlib.deflateSync(Buffer.from(s4Text, 'utf-8'));

    // 3. Stream 7: Clear xxxx, clear base doc footer and declaration lines so they are cleanly rendered dynamically
    const s7 = doc.context.lookup(contents.get(7));
    let s7Text = zlib.inflateSync(s7.asUint8Array()).toString('utf-8');
    s7Text = s7Text.replace(/\(x+\)Tj/g, '()Tj');

    const s7Lines = s7Text.split('\n');
    // Lines between 1130 and 1172 contain the baked-in footer and baked-in declaration text
    for (let i = 0; i < s7Lines.length; i++) {
      // Clear footer lines (Doc: Halal Certificate...)
      if (i >= 1130 && i <= 1172) {
        if (s7Lines[i].includes('Tj') || s7Lines[i].includes('TJ')) {
          s7Lines[i] = '()Tj';
        }
      }
    }
    s7Text = s7Lines.join('\n');
    s7.contents = zlib.deflateSync(Buffer.from(s7Text, 'utf-8'));

    const outPath = path.resolve(__dirname, '../assets/certificates', filename);
    const pdfBytes = await doc.save();
    fs.writeFileSync(outPath, pdfBytes);
    console.log(`Saved pristine base: ${filename} (${pdfBytes.length} bytes)`);
  }
  console.log('All 5 clean base templates built successfully!');
}

buildCleanBases().catch(console.error);
