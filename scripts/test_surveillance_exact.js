import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(dateVal) {
  if (!dateVal) return '—';
  if (typeof dateVal === 'string' && /^\d{1,2}-[A-Za-z]{3}-\d{4}$/.test(dateVal.trim())) {
    return dateVal.trim();
  }
  const date = new Date(dateVal);
  if (isNaN(date.getTime())) return String(dateVal);
  const day = String(date.getDate()).padStart(2, '0');
  const month = MONTH_NAMES[date.getMonth()] || 'Jan';
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

/**
 * Word wraps text into lines fitting within maxWidth.
 */
function wrapTextLines(text, font, fontSize, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let curLine = '';

  for (const w of words) {
    const testLine = curLine ? `${curLine} ${w}` : w;
    const testWidth = font.widthOfTextAtSize(testLine, fontSize);
    if (testWidth <= maxWidth) {
      curLine = testLine;
    } else {
      if (curLine) lines.push(curLine);
      curLine = w;
    }
  }
  if (curLine) lines.push(curLine);
  return lines;
}

export async function generateOfficialSurveillanceLetter(data = {}) {
  const {
    letter_number = 'DU-KH/QR250908121501',
    issue_date = '2025-09-08',
    recipient_name = 'The Abattoir',
    recipient_address = 'Lancaster Road, Carnaby Industrial Estate, YO15 3QY, UK',
    recipient_attention = '',
    letter_subject = 'Re: Surveillance Audit Outcome',
    certificate_number = '',
    standards = 'UAE.S.2055-1:2015',
    manual = 'HFA Halal Certification Requirements Manual HFP-1005-20/5',
    custom_body = ''
  } = data;

  const templatePath = path.resolve(__dirname, '../assets/certificates/SURVEILLANCE_TEMPLATE.pdf');
  const templateBuf = fs.readFileSync(templatePath);
  const pdfDoc = await PDFDocument.load(templateBuf);
  const page = pdfDoc.getPage(0);

  const fontArial = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontTimes = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const fontTimesBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);

  const cBlack = rgb(0.08, 0.08, 0.08);
  const leftX = 18;
  const maxWidth = 454; // from x=18 to x=472 before blue sidebar

  // 1. Reference Number
  page.drawText(letter_number, {
    x: leftX,
    y: 679,
    size: 11,
    font: fontArial,
    color: cBlack
  });

  // 2. Recipient Address Block
  // Split recipient lines neatly
  let addressLines = [];
  if (recipient_name && recipient_name.trim()) {
    addressLines.push(recipient_name.trim().replace(/,\s*$/, '') + ',');
  }
  if (recipient_address && recipient_address.trim()) {
    const rawParts = recipient_address.split(/\n|,/g).map(s => s.trim()).filter(Boolean);
    // Group into neat lines matching sample
    for (let i = 0; i < rawParts.length; i++) {
      const isLast = i === rawParts.length - 1;
      addressLines.push(rawParts[i] + (isLast ? '' : ','));
    }
  }

  // Draw address lines starting at y = 636
  let curY = 636;
  const addressLineHeight = 12;
  for (const line of addressLines) {
    page.drawText(line, {
      x: leftX,
      y: curY,
      size: 11,
      font: fontArial,
      color: cBlack
    });
    curY -= addressLineHeight;
  }

  // 3. Issue Date
  const dateFormatted = formatDate(issue_date);
  page.drawText(dateFormatted, {
    x: leftX,
    y: 545,
    size: 11,
    font: fontArial,
    color: cBlack
  });

  // 4. Salutation
  const salutation = recipient_attention && recipient_attention.trim()
    ? `Dear ${recipient_attention.trim()},`
    : `Dear ,`;
  page.drawText(salutation, {
    x: leftX,
    y: 502,
    size: 11,
    font: fontTimes,
    color: cBlack
  });

  // 5. Subject Line
  const subjectText = letter_subject || 'Re: Surveillance Audit Outcome';
  page.drawText(subjectText, {
    x: leftX,
    y: 459,
    size: 11,
    font: fontTimesBold,
    color: cBlack
  });

  // 6. Paragraph 1
  const fullFacility = [recipient_name, recipient_address].filter(Boolean).join(', ').replace(/\s+/g, ' ');
  const p1Text = `The Surveillance audit carried out at ${fullFacility} on ${dateFormatted} has now been successfully concluded and your site was found to be in conformance with ${manual} and ${standards}.`;
  
  const p1Lines = wrapTextLines(p1Text, fontTimes, 10, maxWidth);
  let p1Y = 417;
  for (const line of p1Lines) {
    page.drawText(line, {
      x: leftX,
      y: p1Y,
      size: 10,
      font: fontTimes,
      color: cBlack
    });
    p1Y -= 11;
  }

  // 7. Paragraph 2
  const certClause = certificate_number && certificate_number.trim()
    ? `number ${certificate_number.trim()} `
    : 'number ';
  const p2Text = `Therefore, your certification for the process and products stipulated in your halal certificate ${certClause}is hereby maintained subject to your continued conformance with the requirements of aforementioned manual and terms of your certification.`;
  
  const p2Lines = wrapTextLines(p2Text, fontTimes, 10, maxWidth);
  let p2Y = 355;
  for (const line of p2Lines) {
    page.drawText(line, {
      x: leftX,
      y: p2Y,
      size: 10,
      font: fontTimes,
      color: cBlack
    });
    p2Y -= 11;
  }

  // 8. Paragraph 3 (Questions/Queries)
  page.drawText('If you have any queries or questions, please do not hesitate to contact us.', {
    x: leftX,
    y: 302,
    size: 11,
    font: fontTimes,
    color: cBlack
  });

  // 9. Thank you
  page.drawText('Thank you.', {
    x: leftX,
    y: 278,
    size: 11,
    font: fontTimes,
    color: cBlack
  });

  // 10. Kind regards,
  page.drawText('Kind regards,', {
    x: leftX,
    y: 254,
    size: 11,
    font: fontTimes,
    color: cBlack
  });

  return await pdfDoc.save();
}

async function test() {
  const pdfBytes = await generateOfficialSurveillanceLetter({
    letter_number: 'DU-KH/QR250908121501',
    issue_date: '2025-09-08',
    recipient_name: 'The Abattoir',
    recipient_address: 'Lancaster Road, Carnaby Industrial Estate, YO15 3QY, UK',
    recipient_attention: '',
    letter_subject: 'Re: Surveillance Audit Outcome',
    certificate_number: '',
    standards: 'UAE.S.2055-1:2015'
  });

  const outPdf = path.resolve(__dirname, '../test_official_surveillance.pdf');
  fs.writeFileSync(outPdf, pdfBytes);
  console.log('Saved test_official_surveillance.pdf, size:', pdfBytes.length);

  // Render to PNG
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pdfBase64 = Buffer.from(pdfBytes).toString('base64');
  const html = `
    <!DOCTYPE html><html><head>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
    <script>pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';</script>
    </head><body style="margin:0;padding:0;"><canvas id="c"></canvas><script>
    const pdfData = atob("${pdfBase64}");
    const u = new Uint8Array(pdfData.length);
    for (let i=0; i<pdfData.length; i++) u[i] = pdfData.charCodeAt(i);
    pdfjsLib.getDocument({data: u}).promise.then(doc => doc.getPage(1)).then(p => {
      const v = p.getViewport({scale: 2.0});
      const c = document.getElementById('c');
      c.width = v.width; c.height = v.height;
      return p.render({canvasContext: c.getContext('2d'), viewport: v}).promise;
    }).then(() => { window._done = true; });
    </script></body></html>
  `;
  await page.setContent(html);
  await page.waitForFunction('window._done === true', { timeout: 30000 });
  const c = await page.$('#c');
  const outPng = path.resolve(__dirname, '../test_official_surveillance_preview.png');
  await c.screenshot({ path: outPng });
  await browser.close();
  console.log('Saved preview to', outPng);
}

test().catch(console.error);
