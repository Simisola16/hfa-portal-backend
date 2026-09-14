import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, StandardFonts, rgb, PDFName } from 'pdf-lib';
import zlib from 'zlib';
import QRCode from 'qrcode';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testGenerate() {
  // 1. Prepare CLEAN_BASE without sample asterisks
  const templateBuf = fs.readFileSync(path.join(__dirname, 'assets/certificates/Template GSO Scheme (meat) Cert.pdf'));
  const baseDoc = await PDFDocument.load(templateBuf);
  const basePage = baseDoc.getPage(0);
  
  // Clear Fm1 (TEMPLATE)
  const xObject = baseDoc.context.lookup(basePage.node.Resources().get(PDFName.of('XObject')));
  const fm1 = baseDoc.context.lookup(xObject.get(PDFName.of('Fm1')));
  if (fm1) {
    fm1.contents = zlib.deflateSync(Buffer.from(''));
  }

  // Clear Stream 4 placeholders & sample table & sample asterisks
  const contents = basePage.node.Contents();
  const s4 = baseDoc.context.lookup(contents.get(4));
  let s4Text = zlib.inflateSync(s4.asUint8Array()).toString('utf-8');
  s4Text = s4Text.replace(/\(x+\)Tj/g, '()Tj');
  s4Text = s4Text.replace(/\(\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\)Tj/g, '()Tj');
  
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
  s4.contents = zlib.deflateSync(Buffer.from(s4Text, 'utf-8'));

  // Clear Stream 7 placeholders
  const s7 = baseDoc.context.lookup(contents.get(7));
  let s7Text = zlib.inflateSync(s7.asUint8Array()).toString('utf-8');
  s7Text = s7Text.replace(/\(x+\)Tj/g, '()Tj');
  s7.contents = zlib.deflateSync(Buffer.from(s7Text, 'utf-8'));

  // Save cleaned base to buffer
  const cleanBasePdfBytes = await baseDoc.save();
  const cleanDoc = await PDFDocument.load(cleanBasePdfBytes);

  // Now create output PDF
  const pdfDoc = await PDFDocument.create();
  const [page] = await pdfDoc.copyPages(cleanDoc, [0]);
  pdfDoc.addPage(page);

  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const cEmerald = rgb(11 / 255, 124 / 255, 71 / 255);
  const cDark = rgb(17 / 255, 24 / 255, 39 / 255);
  const cWhite = rgb(1, 1, 1);
  const cTableGrid = rgb(194 / 255, 222 / 255, 203 / 255);

  const PAGE_WIDTH = 595.28;

  // 1. Certificate Number
  const certNumber = 'HFA-AW-62442';
  page.drawText(certNumber, {
    x: 263.98,
    y: 632.91,
    size: 9.0,
    font: fontRegular,
    color: cDark
  });

  // 2. Dates
  page.drawText('13-Sep-2026', { x: 108.2, y: 611.28, size: 8.5, font: fontRegular, color: cDark });
  page.drawText('13-Sep-2026', { x: 310.5, y: 611.28, size: 8.5, font: fontRegular, color: cDark });
  page.drawText('13-Sep-2027', { x: 466.5, y: 611.28, size: 8.5, font: fontRegular, color: cDark });
  page.drawText('13-Sep-2026', { x: 309.8, y: 589.55, size: 8.5, font: fontRegular, color: cDark });

  // 3. Company Info Values
  page.drawText('AWZI', { x: 191.0, y: 479.98, size: 8.5, font: fontRegular, color: cDark });
  page.drawText('OLUWO STADIUM, IWO, OSUN STATE', { x: 191.0, y: 447.04, size: 8.5, font: fontRegular, color: cDark });
  page.drawText('—', { x: 191.0, y: 402.82, size: 8.5, font: fontRegular, color: cDark });
  page.drawText('PRODUCTION AND SUPPLY OF HALAL CERTIFIED FOOD INGREDIENTS AND FLAVOURS', {
    x: 191.0,
    y: 365.81,
    size: 7.5,
    font: fontRegular,
    color: cDark
  });

  // 4. Products Table (NO., CODE, DESCRIPTION)
  const products = [
    { code: 'PRD-01', name: 'awwal' },
    { code: 'PRD-02', name: 'awwal (Copy)' },
    { code: 'PRD-03', name: 'awwal (Copy)' }
  ];

  const tableWidth = 370;
  const tableLeftX = (PAGE_WIDTH - tableWidth) / 2;
  const col1W = 35;
  const col2W = 120;
  const col3W = tableWidth - col1W - col2W; // 215

  const headerHeight = 16;
  const rowHeight = 15;
  const tableStartY = 316;

  // Header Background
  page.drawRectangle({
    x: tableLeftX,
    y: tableStartY - headerHeight,
    width: tableWidth,
    height: headerHeight,
    color: cEmerald
  });

  // Header Labels: NO. | CODE | DESCRIPTION
  const hSize = 8.0;
  page.drawText('NO.', {
    x: tableLeftX + (col1W - fontBold.widthOfTextAtSize('NO.', hSize)) / 2,
    y: tableStartY - headerHeight + 4.5,
    size: hSize,
    font: fontBold,
    color: cWhite
  });

  page.drawText('CODE', {
    x: tableLeftX + col1W + (col2W - fontBold.widthOfTextAtSize('CODE', hSize)) / 2,
    y: tableStartY - headerHeight + 4.5,
    size: hSize,
    font: fontBold,
    color: cWhite
  });

  page.drawText('DESCRIPTION', {
    x: tableLeftX + col1W + col2W + (col3W - fontBold.widthOfTextAtSize('DESCRIPTION', hSize)) / 2,
    y: tableStartY - headerHeight + 4.5,
    size: hSize,
    font: fontBold,
    color: cWhite
  });

  // White vertical dividers in header
  page.drawLine({
    start: { x: tableLeftX + col1W, y: tableStartY - headerHeight },
    end: { x: tableLeftX + col1W, y: tableStartY },
    thickness: 0.75,
    color: cWhite
  });
  page.drawLine({
    start: { x: tableLeftX + col1W + col2W, y: tableStartY - headerHeight },
    end: { x: tableLeftX + col1W + col2W, y: tableStartY },
    thickness: 0.75,
    color: cWhite
  });

  let curY = tableStartY - headerHeight;
  products.forEach((p, idx) => {
    curY -= rowHeight;

    // Solid white background for maximum visibility
    page.drawRectangle({
      x: tableLeftX,
      y: curY,
      width: tableWidth,
      height: rowHeight,
      color: cWhite,
      borderColor: cTableGrid,
      borderWidth: 0.65
    });

    // Column dividers
    page.drawLine({
      start: { x: tableLeftX + col1W, y: curY },
      end: { x: tableLeftX + col1W, y: curY + rowHeight },
      thickness: 0.65,
      color: cTableGrid
    });
    page.drawLine({
      start: { x: tableLeftX + col1W + col2W, y: curY },
      end: { x: tableLeftX + col1W + col2W, y: curY + rowHeight },
      thickness: 0.65,
      color: cTableGrid
    });

    const cellFontSize = 7.5;
    const noStr = String(idx + 1);
    page.drawText(noStr, {
      x: tableLeftX + (col1W - fontRegular.widthOfTextAtSize(noStr, cellFontSize)) / 2,
      y: curY + 4,
      size: cellFontSize,
      font: fontRegular,
      color: cDark
    });

    page.drawText(p.code, {
      x: tableLeftX + col1W + (col2W - fontRegular.widthOfTextAtSize(p.code, cellFontSize)) / 2,
      y: curY + 4,
      size: cellFontSize,
      font: fontRegular,
      color: cDark
    });

    page.drawText(p.name, {
      x: tableLeftX + col1W + col2W + 10,
      y: curY + 4,
      size: cellFontSize,
      font: fontRegular,
      color: cDark
    });
  });

  // Table Outer Border
  page.drawRectangle({
    x: tableLeftX,
    y: curY,
    width: tableWidth,
    height: tableStartY - curY,
    borderColor: cEmerald,
    borderWidth: 0.85
  });

  // Asterisks directly below table
  const ast = '********************';
  const astW = fontRegular.widthOfTextAtSize(ast, 8.5);
  page.drawText(ast, {
    x: (PAGE_WIDTH - astW) / 2,
    y: curY - 10,
    size: 8.5,
    font: fontRegular,
    color: cDark
  });

  // 5. Signatures
  if (fs.existsSync(path.join(__dirname, 'assets/certificates/sig_amir_clean.png'))) {
    const amirSigBuf = fs.readFileSync(path.join(__dirname, 'assets/certificates/sig_amir_clean.png'));
    const amirSigImg = await pdfDoc.embedPng(amirSigBuf);
    page.drawImage(amirSigImg, {
      x: 34,
      y: 154,
      width: 78,
      height: 35
    });
  }

  if (fs.existsSync(path.join(__dirname, 'assets/certificates/sig_mufti_clean.png'))) {
    const muftiSigBuf = fs.readFileSync(path.join(__dirname, 'assets/certificates/sig_mufti_clean.png'));
    const muftiSigImg = await pdfDoc.embedPng(muftiSigBuf);
    page.drawImage(muftiSigImg, {
      x: 418,
      y: 154,
      width: 95,
      height: 35
    });
  }

  // 6. QR Code
  const qrPng = await QRCode.toBuffer('https://hfaportal.company/verify/HFA-AW-62442', { width: 300, margin: 0 });
  const qrImg = await pdfDoc.embedPng(qrPng);
  page.drawRectangle({
    x: 34,
    y: 44,
    width: 56,
    height: 56,
    color: cWhite
  });
  page.drawImage(qrImg, {
    x: 36,
    y: 46,
    width: 52,
    height: 52
  });

  const finalBytes = await pdfDoc.save();
  fs.writeFileSync('test_output_cert.pdf', finalBytes);
  console.log('Saved test_output_cert.pdf');

  // Render to PNG with puppeteer
  const browser = await puppeteer.launch({ headless: 'new' });
  const bPage = await browser.newPage();
  await bPage.setViewport({ width: 1200, height: 1600 });
  await bPage.goto('file://' + path.resolve('test_output_cert.pdf'), { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 2000));
  await bPage.screenshot({ path: 'test_output_cert.png' });
  await browser.close();
  console.log('Saved test_output_cert.png');
}

testGenerate().catch(console.error);
