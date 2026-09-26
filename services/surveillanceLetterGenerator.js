import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';
import QRCode from 'qrcode';
import { getClientUrl, getBackendUrl, resolveCertificateUrl } from '../lib/urls.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Formats a Date object or date string into DD-MMM-YYYY (e.g. 08-Sep-2025).
 */
export function formatDate(dateVal) {
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

/**
 * Resolves the path to the official Surveillance Letter PDF template.
 */
function getTemplatePath() {
  const primary = path.resolve(__dirname, '../assets/certificates/SURVEILLANCE_TEMPLATE.pdf');
  if (fs.existsSync(primary)) return primary;

  const qrTarget = resolveCertificateUrl(letterData.letter_url || letterData.document_url || letterData.pdf_url, letter_number, verification_url) || `${getBackendUrl()}/api/certificates/public/${encodeURIComponent(letter_number)}`;
  const qrCodeBase64 = await generateQRCode(qrTarget);

  const fallback = path.resolve(__dirname, '../assets/SURVEILLANCE_TEMPLATE.pdf');
  if (fs.existsSync(fallback)) return fallback;

  throw new Error(`Official Surveillance Letter template not found at: ${primary}`);
}

/**
 * Generates the official Surveillance Letter PDF Buffer using pdf-lib on the vector template.
 * @param {Object} letterData - Surveillance letter parameters
 * @returns {Promise<Buffer>} PDF Buffer
 */
export async function generateSurveillanceLetter(letterData = {}) {
  const {
    letter_number = 'DU-KH/QR' + Date.now().toString().slice(-12),
    issue_date = new Date(),
    recipient_name = '',
    recipient_address = '',
    recipient_attention = '',
    letter_subject = 'Re: Surveillance Audit Outcome',
    certificate_number = '',
    standards = 'UAE.S.2055-1:2015',
    manual = 'HFA Halal Certification Requirements Manual HFP-1005-20/5',
    letter_body = ''
  } = letterData;

  const templatePath = getTemplatePath();
  const templateBuf = fs.readFileSync(templatePath);
  const pdfDoc = await PDFDocument.load(templateBuf);
  const page = pdfDoc.getPage(0);

  const fontArial = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontTimes = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const fontTimesBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);

  const cBlack = rgb(0.08, 0.08, 0.08);
  const leftX = 18;
  const maxWidth = 454; // left margin 18 to 472 before blue sidebar

  // 1. Reference Number (DU-KH/QR...)
  page.drawText(letter_number, {
    x: leftX,
    y: 679,
    size: 11,
    font: fontArial,
    color: cBlack
  });

  // 2. Recipient Address Block
  let addressLines = [];
  if (recipient_name && recipient_name.trim()) {
    addressLines.push(recipient_name.trim().replace(/,\s*$/, '') + ',');
  }
  if (recipient_address && recipient_address.trim()) {
    // If address contains newlines, preserve them; otherwise split by commas
    if (recipient_address.includes('\n')) {
      const parts = recipient_address.split('\n').map(s => s.trim()).filter(Boolean);
      parts.forEach(p => addressLines.push(p));
    } else {
      const rawParts = recipient_address.split(',').map(s => s.trim()).filter(Boolean);
      for (let i = 0; i < rawParts.length; i++) {
        const isLast = i === rawParts.length - 1;
        addressLines.push(rawParts[i] + (isLast ? '' : ','));
      }
    }
  }

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

  // Check if custom body was provided
  if (letter_body && letter_body.trim()) {
    // Custom body handling
    const paragraphs = letter_body.trim().split(/\n\s*\n|\n/).map(p => p.trim()).filter(Boolean);
    let bodyY = 417;
    for (const p of paragraphs) {
      const lines = wrapTextLines(p, fontTimes, 10, maxWidth);
      for (const line of lines) {
        page.drawText(line, {
          x: leftX,
          y: bodyY,
          size: 10,
          font: fontTimes,
          color: cBlack
        });
        bodyY -= 11;
      }
      bodyY -= 10; // gap between paragraphs
    }

    // Closing
    page.drawText('Kind regards,', {
      x: leftX,
      y: Math.max(254, bodyY - 10),
      size: 11,
      font: fontTimes,
      color: cBlack
    });
  } else {
    // 6. Standard Paragraph 1 (Outcome statement)
    const fullFacility = [recipient_name, recipient_address].filter(Boolean).join(', ').replace(/\s+/g, ' ');
    const resolvedStandards = standards && standards.trim() ? standards.trim() : 'UAE.S.2055-1:2015';
    const p1Text = `The Surveillance audit carried out at ${fullFacility} on ${dateFormatted} has now been successfully concluded and your site was found to be in conformance with ${manual} and ${resolvedStandards}.`;
    
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

    // 7. Standard Paragraph 2 (Certification maintenance)
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
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

/**
 * Builds HTML representation for preview if requested.
 */
export async function buildSurveillanceLetterHtml(letterData = {}) {
  const {
    letter_number = 'DU-KH/QR' + Date.now().toString().slice(-12),
    issue_date = new Date(),
    recipient_name = '',
    recipient_address = '',
    recipient_attention = '',
    letter_subject = 'Re: Surveillance Audit Outcome',
    certificate_number = '',
    standards = 'UAE.S.2055-1:2015',
    manual = 'HFA Halal Certification Requirements Manual HFP-1005-20/5'
  } = letterData;

  const dateFormatted = formatDate(issue_date);
  const fullFacility = [recipient_name, recipient_address].filter(Boolean).join(', ').replace(/\s+/g, ' ');
  const certClause = certificate_number && certificate_number.trim() ? `number ${certificate_number.trim()} ` : 'number ';

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Surveillance Letter - ${letter_number}</title>
      <style>
        body { font-family: "Times New Roman", Times, serif; font-size: 10pt; color: #111827; padding: 30px; line-height: 1.4; }
        .ref { font-family: Arial, sans-serif; font-size: 11pt; margin-bottom: 20px; }
        .address { font-family: Arial, sans-serif; font-size: 11pt; margin-bottom: 20px; }
        .date { font-family: Arial, sans-serif; font-size: 11pt; margin-bottom: 20px; }
        .salutation { font-size: 11pt; margin-bottom: 20px; }
        .subject { font-size: 11pt; font-weight: bold; margin-bottom: 20px; }
        p { margin-bottom: 16px; }
      </style>
    </head>
    <body>
      <div class="ref">${letter_number}</div>
      <div class="address">${recipient_name}<br>${(recipient_address || '').replace(/,\s*/g, '<br>')}</div>
      <div class="date">${dateFormatted}</div>
      <div class="salutation">Dear ${recipient_attention || ''},</div>
      <div class="subject">${letter_subject}</div>
      <p>The Surveillance audit carried out at ${fullFacility} on ${dateFormatted} has now been successfully concluded and your site was found to be in conformance with ${manual} and ${standards}.</p>
      <p>Therefore, your certification for the process and products stipulated in your halal certificate ${certClause}is hereby maintained subject to your continued conformance with the requirements of aforementioned manual and terms of your certification.</p>
      <p>If you have any queries or questions, please do not hesitate to contact us.</p>
      <p>Thank you.</p>
      <p>Kind regards,</p>
      <p><strong>Dr Amir Masoom</strong><br>CEO</p>
    </body>
    </html>
  `;
}
