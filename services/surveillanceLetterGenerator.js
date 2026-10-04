import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';
import QRCode from 'qrcode';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getClientUrl, getBackendUrl, resolveCertificateUrl } from '../lib/urls.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Formats a Date object or date string into DD-Month-YYYY (e.g. 08-September-2025).
 */
export function formatDate(dateVal) {
  if (!dateVal) return '—';
  // Handle already-formatted strings (abbreviated or full month name)
  if (typeof dateVal === 'string' && /^\d{1,2}-[A-Za-z]+-\d{4}$/.test(dateVal.trim())) {
    const parts = dateVal.trim().split('-');
    const day = parts[0].padStart(2, '0');
    const year = parts[2];
    const shortToFull = {
      jan: 'January', feb: 'February', mar: 'March', apr: 'April',
      may: 'May', jun: 'June', jul: 'July', aug: 'August',
      sep: 'September', oct: 'October', nov: 'November', dec: 'December'
    };
    const key = parts[1].slice(0, 3).toLowerCase();
    const month = shortToFull[key] || (parts[1].charAt(0).toUpperCase() + parts[1].slice(1).toLowerCase());
    return `${day}-${month}-${year}`;
  }
  const date = new Date(dateVal);
  if (isNaN(date.getTime())) return String(dateVal);
  const day = String(date.getDate()).padStart(2, '0');
  const month = MONTH_NAMES[date.getMonth()] || 'January';
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
  const candidates = [
    path.resolve(__dirname, '../assets/certificates/SURVEILLANCE_TEMPLATE.pdf'),
    path.resolve(__dirname, '../assets/SURVEILLANCE_TEMPLATE.pdf'),
    path.resolve(__dirname, '../survellance-unlocked template.pdf'),
    path.resolve(__dirname, '../../survellance-unlocked template.pdf')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(`Official Surveillance Letter template not found at: ${candidates[0]}`);
}

/**
 * Generates the official Surveillance Letter PDF Buffer using pdf-lib on the vector template.
 * @param {Object} letterData - Surveillance letter parameters
 * @returns {Promise<Buffer>} PDF Buffer
 */
export async function generateSurveillanceLetter(letterData = {}) {
  const {
    letter_number,
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

  const resolvedCertNumber = (certificate_number && String(certificate_number).trim()) || '';
  const resolvedLetterNumber = (letter_number && String(letter_number).trim()) || resolvedCertNumber || `HFA-SURV-${Date.now().toString().slice(-8)}`;

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

  // 1. Reference Number / Certificate Number
  page.drawText(resolvedLetterNumber, {
    x: leftX,
    y: 679,
    size: 11,
    font: fontArial,
    color: cBlack
  });

  // 2. Recipient Address Block (Only address, with "The" before the address)
  let addressLines = [];
  if (recipient_address && recipient_address.trim()) {
    let cleanAddress = recipient_address.trim();
    if (!/^the\b/i.test(cleanAddress)) {
      cleanAddress = `The ${cleanAddress}`;
    }

    if (cleanAddress.includes('\n')) {
      const parts = cleanAddress.split('\n').map(s => s.trim()).filter(Boolean);
      parts.forEach(p => addressLines.push(p));
    } else {
      const rawParts = cleanAddress.split(',').map(s => s.trim()).filter(Boolean);
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

  // 4. Salutation (Dear {company name},)
  const salutationTarget = (recipient_name && recipient_name.trim()) || (recipient_attention && recipient_attention.trim()) || '';
  const salutation = salutationTarget
    ? `Dear ${salutationTarget},`
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
    // 6. Standard Paragraph 1 (Outcome statement - only address, company name not included)
    const facilityLocation = (recipient_address || '').trim().replace(/\s+/g, ' ');
    const resolvedStandards = standards && standards.trim() ? standards.trim() : 'UAE.S.2055-1:2015';
    const p1Text = `The Surveillance audit carried out at ${facilityLocation} on ${dateFormatted} has now been successfully concluded and your site was found to be in conformance with ${manual} and ${resolvedStandards}.`;

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

    // 7. Standard Paragraph 2 (Certification maintenance - exactly as in template)
    const p2Text = `Therefore, your certification for the process and products stipulated in your halal certificate number is hereby maintained subject to your continued conformance with the requirements of aforementioned manual and terms of your certification.`;

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
    letter_number,
    issue_date = new Date(),
    recipient_name = '',
    recipient_address = '',
    recipient_attention = '',
    letter_subject = 'Re: Surveillance Audit Outcome',
    certificate_number = '',
    standards = 'UAE.S.2055-1:2015',
    manual = 'HFA Halal Certification Requirements Manual HFP-1005-20/5'
  } = letterData;

  const resolvedCertNumber = (certificate_number && String(certificate_number).trim()) || '';
  const resolvedLetterNumber = (letter_number && String(letter_number).trim()) || resolvedCertNumber || `HFA-SURV-${Date.now().toString().slice(-8)}`;

  const dateFormatted = formatDate(issue_date);
  let cleanAddress = (recipient_address || '').trim();
  if (cleanAddress && !/^the\b/i.test(cleanAddress)) {
    cleanAddress = `The ${cleanAddress}`;
  }
  const facilityLocation = (recipient_address || '').trim().replace(/\s+/g, ' ');

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Surveillance Letter - ${resolvedLetterNumber}</title>
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
      <div class="ref">${resolvedLetterNumber}</div>
      <div class="address">${(cleanAddress || '').replace(/,\s*/g, '<br>')}</div>
      <div class="date">${dateFormatted}</div>
      <div class="salutation">Dear ${recipient_name || recipient_attention || ''},</div>
      <div class="subject">${letter_subject}</div>
      <p>The Surveillance audit carried out at ${facilityLocation} on ${dateFormatted} has now been successfully concluded and your site was found to be in conformance with ${manual} and ${standards}.</p>
      <p>Therefore, your certification for the process and products stipulated in your halal certificate number is hereby maintained subject to your continued conformance with the requirements of aforementioned manual and terms of your certification.</p>
      <p>If you have any queries or questions, please do not hesitate to contact us.</p>
      <p>Thank you.</p>
      <p>Kind regards,</p>
      <p><strong>Dr Amir Masoom</strong><br>CEO</p>
    </body>
    </html>
  `;
}
