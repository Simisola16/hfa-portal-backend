import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * In-memory cache for certificate background image buffers to optimize generation speed.
 */
const bgCache = new Map();

function getBackgroundBuffer(bgFile) {
  if (bgCache.has(bgFile)) {
    return bgCache.get(bgFile);
  }
  const bgPath = path.join(__dirname, '../assets/certificates', bgFile);
  if (!fs.existsSync(bgPath)) {
    throw new Error(`Certificate background image not found: ${bgPath}`);
  }
  const buffer = fs.readFileSync(bgPath);
  bgCache.set(bgFile, buffer);
  return buffer;
}

/**
 * Sanitizes strings for pdf-lib standard Helvetica (WinAnsi) encoding.
 * Converts bullets, dashes, smart quotes, checkmarks, etc. to valid Latin-1 characters
 * and strips any characters that WinAnsi cannot encode.
 */
function sanitizeForPdf(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2022\u25CF\u25CB]/g, '*')
    .replace(/[\u2713\u2714]/g, 'v')
    .replace(/[\u00A0]/g, ' ')
    .replace(/[^\x00-\xFF]/g, '') // strip characters outside ISO-8859-1 / WinAnsi
    .trim();
}

/**
 * Truncates text to fit within a maximum point width in pdf-lib.
 */
function truncateToWidth(text, maxWidth, font, size) {
  if (!text) return '';
  const str = sanitizeForPdf(text);
  if (!str) return '';
  try {
    if (font.widthOfTextAtSize(str, size) <= maxWidth) return str;
    let len = str.length;
    while (len > 0) {
      const sub = str.slice(0, len) + '...';
      if (font.widthOfTextAtSize(sub, size) <= maxWidth) return sub;
      len--;
    }
    return str.slice(0, 1);
  } catch (e) {
    return str.replace(/[^\x20-\x7E]/g, '');
  }
}

/**
 * Wraps text into multiple lines for pdf-lib table/metadata layout.
 */
function wrapTextLines(text, maxWidth, font, size, maxLines = 2) {
  if (!text) return ['—'];
  const sanitized = sanitizeForPdf(text);
  if (!sanitized) return ['—'];
  const words = sanitized.split(/\s+/);
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    try {
      if (font.widthOfTextAtSize(testLine, size) <= maxWidth) {
        currentLine = testLine;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
        if (lines.length === maxLines - 1) break;
      }
    } catch (e) {
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  if (lines.length > maxLines) {
    lines.length = maxLines;
  }
  return lines.map(line => truncateToWidth(line, maxWidth, font, size));
}

/**
 * Generate a base64 encoded QR Code image from a URL.
 * @param {string} url - The verification URL
 * @returns {Promise<string>} base64 data URL
 */
async function generateQRCode(url) {
  try {
    return await QRCode.toDataURL(url, {
      margin: 0,
      width: 250,
      color: {
        dark: '#112211',
        light: '#ffffff'
      }
    });
  } catch (err) {
    console.error('Error generating QR Code:', err);
    throw err;
  }
}

/**
 * Formats a Date object or date string into DD/MM/YYYY.
 * @param {Date|string} dateVal
 * @returns {string} Formatted date
 */
function formatDate(dateVal) {
  if (!dateVal) return '—';
  if (typeof dateVal === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(dateVal.trim())) {
    return dateVal.trim();
  }
  const date = new Date(dateVal);
  if (isNaN(date.getTime())) return String(dateVal);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

export const CERTIFICATE_SCHEMES = {
  'HFA Scheme': {
    name: 'HFA Scheme',
    templateType: 'hfa',
    bgFile: 'hfa_scheme_bg.png',
    docFooter: 'Doc: Halal Certificate (HFA Scheme)   Created by: MH   Approved by: HI   Version: 2   Date: 11.10.2022',
    certNoTop: '23.4%',
    datesTop: '25.3%',
    infoTop: '34.6%',
    tableTop: '48.6%',
    certNoTopPct: 0.234,
    datesTopPct: 0.253,
    infoTopPct: 0.346,
    tableTopPct: 0.486
  },
  'Cosmetics': {
    name: 'Cosmetics',
    templateType: 'hfa',
    bgFile: 'cosmetics_bg.png',
    docFooter: 'Doc: Halal Certificate (HFA Cosmetic Scheme)   Created by: MH   Approved by: HI   Version: 2   Date: 11.10.2022',
    certNoTop: '27.0%',
    datesTop: '29.3%',
    infoTop: '37.4%',
    tableTop: '51.0%',
    certNoTopPct: 0.270,
    datesTopPct: 0.293,
    infoTopPct: 0.374,
    tableTopPct: 0.510
  },
  'Smiic': {
    name: 'Smiic',
    templateType: 'hfa',
    bgFile: 'smiic_bg.png',
    docFooter: 'Doc: Halal Certificate (SMIIC Scheme)   Created by: MH   Approved by: HI   Version: 2   Date: 11.10.2022',
    certNoTop: '24.4%',
    datesTop: '26.6%',
    infoTop: '36.5%',
    tableTop: '50.2%',
    certNoTopPct: 0.244,
    datesTopPct: 0.266,
    infoTopPct: 0.365,
    tableTopPct: 0.502
  },
  'GSO meat': {
    name: 'GSO meat',
    templateType: 'gso',
    bgFile: 'gso_meat_bg.png',
    docFooter: 'Doc: Halal Certificate (GSO meat)   Created by: AH   Amended by: TO   Approved by: AM   Version: 16   Date: 28.10.2024',
    certNoTop: '24.4%',
    datesTop: '26.6%',
    infoTop: '38.5%',
    tableTop: '51.8%',
    certNoTopPct: 0.244,
    datesTopPct: 0.266,
    infoTopPct: 0.385,
    tableTopPct: 0.518
  },
  'GSO non-meat': {
    name: 'GSO non-meat',
    templateType: 'gso',
    bgFile: 'gso_non_meat_bg.png',
    docFooter: 'Doc: Halal Certificate (GSO non-meat)   Created by: AH   Amended by: TO   Approved by: AM   Version: 16   Date: 28.10.2024',
    certNoTop: '24.4%',
    datesTop: '26.6%',
    infoTop: '38.5%',
    tableTop: '51.8%',
    certNoTopPct: 0.244,
    datesTopPct: 0.266,
    infoTopPct: 0.385,
    tableTopPct: 0.518
  }
};

/**
 * Normalize certificate type to one of the 5 official schemes
 */
export function normalizeCertificateType(rawType) {
  if (!rawType) return 'HFA Scheme';
  const str = String(rawType).trim().toLowerCase();
  
  if (str === 'cosmetics' || str.includes('cosmetic')) return 'Cosmetics';
  if (str === 'smiic' || str.includes('smiic')) return 'Smiic';
  if (str === 'gso meat' || (str.includes('gso') && str.includes('meat') && !str.includes('non'))) return 'GSO meat';
  if (str === 'gso non-meat' || str === 'gso non meat' || (str.includes('gso') && (str.includes('non') || str.includes('food') || str.includes('uae')))) return 'GSO non-meat';
  if (str === 'hfa scheme' || str.includes('hfa') || str.includes('annual') || str.includes('standard')) return 'HFA Scheme';
  
  return CERTIFICATE_SCHEMES[rawType] ? rawType : 'HFA Scheme';
}

/**
 * Builds the complete, pixel-perfect HTML for any of the 5 certificate types.
 */
export async function buildCertificateHtml(certData) {
  const {
    certificateType = 'HFA Scheme',
    certificateNumber = 'HFA-UK-2026-00123',
    businessName = 'Halal Certified Client',
    companyName,
    businessAddress = '—',
    companyAddress,
    manufacturerAddress,
    manufacturingAddress,
    scopeOfCertification,
    scope,
    issueDate = new Date(),
    expiryDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    certificationStartDate,
    currentCycleStartDate,
    originalCycleStartDate,
    productCategories = [],
    products = [],
    verificationUrl
  } = certData;

  const resolvedName = companyName || businessName || 'Halal Certified Client';
  const resolvedAddress = companyAddress || businessAddress || '—';
  const resolvedMfgAddress = manufacturingAddress || manufacturerAddress || resolvedAddress || 'Same as above';
  const resolvedScope = scope || scopeOfCertification || 'Halal Food and Consumer Products Certification';

  const normalizedScheme = normalizeCertificateType(certificateType);
  const config = CERTIFICATE_SCHEMES[normalizedScheme] || CERTIFICATE_SCHEMES['HFA Scheme'];

  const bgPath = path.join(__dirname, '../assets/certificates', config.bgFile);
  if (!fs.existsSync(bgPath)) {
    throw new Error(`Certificate background image not found: ${bgPath}`);
  }
  const bgBuffer = fs.readFileSync(bgPath);
  const bgBase64 = `data:image/png;base64,${bgBuffer.toString('base64')}`;

  const qrUrl = verificationUrl || `${process.env.FRONTEND_CLIENT_URL || 'https://hfaportal.company'}/verify/${certificateNumber}`;
  const qrBase64 = await generateQRCode(qrUrl);

  const formattedIssue = formatDate(issueDate);
  const formattedExpiry = formatDate(expiryDate);
  const formattedCertStart = formatDate(certificationStartDate || issueDate);
  const formattedCurrentCycle = formatDate(currentCycleStartDate || issueDate);
  const formattedOrigCycle = formatDate(originalCycleStartDate || issueDate);

  const rawProducts = (products && products.length > 0) ? products : productCategories;
  const isGso = config.templateType === 'gso';

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Halal Certificate - ${certificateNumber}</title>
      <style>
        @page {
          size: A4 portrait;
          margin: 0;
        }
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }
        body {
          width: 210mm;
          height: 297mm;
          margin: 0;
          padding: 0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          background-image: url('${bgBase64}');
          background-size: 100% 100%;
          background-position: center;
          background-repeat: no-repeat;
          position: relative;
          -webkit-print-color-adjust: exact;
          color: #111827;
          overflow: hidden;
        }

        /* Certificate Number */
        .cert-no-container {
          position: absolute;
          top: ${config.certNoTop};
          left: 0;
          width: 100%;
          text-align: center;
          z-index: 10;
        }
        .cert-no-label {
          font-size: 9.5pt;
          font-weight: 700;
          color: #0b7c47;
        }
        .cert-no-value {
          font-size: 9.8pt;
          font-weight: 800;
          color: #111827;
          margin-left: 4px;
        }

        /* Dates Section */
        .dates-container-hfa {
          position: absolute;
          top: ${config.datesTop};
          left: 6.5%;
          width: 87%;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 8.5pt;
          z-index: 10;
        }
        .dates-container-gso {
          position: absolute;
          top: ${config.datesTop};
          left: 6.5%;
          width: 87%;
          display: flex;
          flex-direction: column;
          gap: 2px;
          font-size: 8.0pt;
          z-index: 10;
        }
        .date-item {
          display: inline-flex;
          align-items: baseline;
          gap: 4px;
        }
        .date-label {
          color: #0b7c47;
          font-weight: 700;
        }
        .date-val {
          color: #111827;
          font-weight: 700;
        }

        /* Company & Category Info Block */
        .info-block {
          position: absolute;
          top: ${config.infoTop};
          left: 6.5%;
          width: 87%;
          z-index: 10;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .info-row {
          display: flex;
          align-items: flex-start;
          font-size: 8.0pt;
          line-height: 1.35;
          border-bottom: 1px solid #7cb594;
          padding-bottom: 2px;
        }
        .info-label {
          width: 32%;
          font-weight: 700;
          color: #111827;
          letter-spacing: 0.01em;
          text-transform: uppercase;
          flex-shrink: 0;
        }
        .info-val {
          width: 68%;
          font-weight: 700;
          color: #0f172a;
          text-transform: uppercase;
        }

        /* Products Table */
        .products-table-container {
          position: absolute;
          top: ${config.tableTop};
          left: 14%;
          width: 72%;
          z-index: 10;
        }
        .products-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 7.8pt;
          border: 1px solid #0b7c47;
          background: #ffffff;
        }
        .products-table th {
          background-color: #0b7c47;
          color: #ffffff;
          padding: 4px 8px;
          font-weight: 700;
          font-size: 7.8pt;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          border: 1px solid #0b7c47;
        }
        .products-table td {
          padding: 4px 8px;
          border: 1px solid #c2decb;
          color: #111827;
          font-weight: 600;
        }
        .products-table tr:nth-child(even) td {
          background-color: #f7faf7;
        }
        .table-asterisks {
          text-align: center;
          font-size: 8.5pt;
          color: #111827;
          font-weight: 800;
          margin-top: 4px;
          letter-spacing: 0.15em;
        }

        /* QR Code */
        .qr-code-box {
          position: absolute;
          top: 86.8%;
          left: 6.8%;
          width: 8.4%;
          height: auto;
          z-index: 20;
          background: #ffffff;
          padding: 2px;
          border-radius: 2px;
        }
        .qr-code-box img {
          width: 100%;
          height: auto;
          display: block;
        }

        /* Page Numbering */
        .page-no {
          position: absolute;
          top: 94.0%;
          right: 6%;
          font-size: 7.5pt;
          font-style: italic;
          color: #334155;
          z-index: 10;
        }

        /* Bottom Doc Control Footer */
        .doc-footer {
          position: absolute;
          bottom: 1.0%;
          left: 6%;
          width: 88%;
          text-align: center;
          font-size: 6.5pt;
          color: #475569;
          font-weight: 500;
          z-index: 10;
        }
      </style>
    </head>
    <body>

      <!-- Certificate Number -->
      <div class="cert-no-container">
        <span class="cert-no-label">Certificate No.:</span>
        <span class="cert-no-value">${certificateNumber}</span>
      </div>

      <!-- Dates Section -->
      ${!isGso ? `
        <div class="dates-container-hfa">
          <div class="date-item">
            <span class="date-label">Issue Date:</span>
            <span class="date-val">${formattedIssue}</span>
          </div>
          <div class="date-item">
            <span class="date-label">Certification Start Date:</span>
            <span class="date-val">${formattedCertStart}</span>
          </div>
          <div class="date-item">
            <span class="date-label">Expiry Date:</span>
            <span class="date-val">${formattedExpiry}</span>
          </div>
        </div>
      ` : `
        <div class="dates-container-gso">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div class="date-item">
              <span class="date-label">Issue Date:</span>
              <span class="date-val">${formattedIssue}</span>
            </div>
            <div class="date-item">
              <span class="date-label">Current Cycle Start Date:</span>
              <span class="date-val">${formattedCurrentCycle}</span>
            </div>
            <div class="date-item">
              <span class="date-label">Expiry Date:</span>
              <span class="date-val">${formattedExpiry}</span>
            </div>
          </div>
          <div style="display: flex; justify-content: center; align-items: center; margin-top: 1px;">
            <div class="date-item">
              <span class="date-label">Original Cycle Start Date:</span>
              <span class="date-val">${formattedOrigCycle}</span>
            </div>
          </div>
        </div>
      `}

      <!-- Company & Facility Details -->
      <div class="info-block">
        <div class="info-row">
          <div class="info-label">COMPANY NAME:</div>
          <div class="info-val">${resolvedName}</div>
        </div>
        <div class="info-row">
          <div class="info-label">COMPANY ADDRESS:</div>
          <div class="info-val">${resolvedAddress}</div>
        </div>
        <div class="info-row">
          <div class="info-label">MANUFACTURING FACILITY(IES) ADDRESS (IF DIFFERENT):</div>
          <div class="info-val">${resolvedMfgAddress}</div>
        </div>
        <div class="info-row">
          <div class="info-label">PRODUCT CATEGORY:</div>
          <div class="info-val">${resolvedScope}</div>
        </div>
      </div>

      <!-- Products Table -->
      <div class="products-table-container">
        ${!isGso ? `
          <table class="products-table">
            <thead>
              <tr>
                <th style="width: 15%; text-align: center;">NO.</th>
                <th style="width: 85%; text-align: left; padding-left: 12px;">NAME OF THE PRODUCTS</th>
              </tr>
            </thead>
            <tbody>
              ${
                rawProducts && rawProducts.length > 0
                  ? rawProducts.slice(0, 6).map((p, idx) => `
                    <tr>
                      <td style="text-align: center;">${idx + 1}</td>
                      <td style="padding-left: 12px;">${p.name || p.title || p}</td>
                    </tr>
                  `).join('')
                  : `
                    <tr>
                      <td style="text-align: center;">1</td>
                      <td style="padding-left: 12px;">Certified Halal Products & Formulations</td>
                    </tr>
                    <tr>
                      <td style="text-align: center;">2</td>
                      <td style="padding-left: 12px;">Premium Quality Line Series</td>
                    </tr>
                    <tr>
                      <td style="text-align: center;">3</td>
                      <td style="padding-left: 12px;">Standard Halal Inspected Batch</td>
                    </tr>
                  `
              }
            </tbody>
          </table>
        ` : `
          <table class="products-table">
            <thead>
              <tr>
                <th style="width: 12%; text-align: center;">NO.</th>
                <th style="width: 28%; text-align: center;">CODE</th>
                <th style="width: 60%; text-align: left; padding-left: 12px;">DESCRIPTION</th>
              </tr>
            </thead>
            <tbody>
              ${
                rawProducts && rawProducts.length > 0
                  ? rawProducts.slice(0, 6).map((p, idx) => `
                    <tr>
                      <td style="text-align: center;">${idx + 1}</td>
                      <td style="text-align: center;">${p.code || `PRD-${String(idx + 1).padStart(2, '0')}`}</td>
                      <td style="padding-left: 12px;">${p.name || p.description || p.title || p}</td>
                    </tr>
                  `).join('')
                  : `
                    <tr>
                      <td style="text-align: center;">1</td>
                      <td style="text-align: center;">PRD-01</td>
                      <td style="padding-left: 12px;">Certified Halal Products & Formulations</td>
                    </tr>
                    <tr>
                      <td style="text-align: center;">2</td>
                      <td style="text-align: center;">PRD-02</td>
                      <td style="padding-left: 12px;">Premium Quality Line Series</td>
                    </tr>
                    <tr>
                      <td style="text-align: center;">3</td>
                      <td style="text-align: center;">PRD-03</td>
                      <td style="padding-left: 12px;">Standard Halal Inspected Batch</td>
                    </tr>
                  `
              }
            </tbody>
          </table>
        `}
        <div class="table-asterisks">****************</div>
      </div>

      <!-- Verification QR Code -->
      <div class="qr-code-box">
        <img src="${qrBase64}" alt="QR Verification" />
      </div>

      <!-- Page Number -->
      <div class="page-no">Page 1 of 1</div>

      <!-- Document Metadata Footer -->
      <div class="doc-footer">${config.docFooter}</div>

    </body>
    </html>
  `;
}

/**
 * Generates an official Halal certificate PDF buffer using pdf-lib.
 * Pure JavaScript rendering: zero headless browser overhead, <100ms generation, minimal memory.
 * Supports all 5 schemes: HFA Scheme, Cosmetics, Smiic, GSO meat, GSO non-meat.
 * @param {Object} certData - Certificate fields
 * @returns {Promise<Buffer>} PDF Buffer
 */
export async function generateCertificate(certData) {
  const {
    certificateType = 'HFA Scheme',
    certificateNumber = 'HFA-UK-2026-00123',
    businessName = 'Halal Certified Client',
    companyName,
    businessAddress = '—',
    companyAddress,
    manufacturerAddress,
    manufacturingAddress,
    scopeOfCertification,
    scope,
    issueDate = new Date(),
    expiryDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    certificationStartDate,
    currentCycleStartDate,
    originalCycleStartDate,
    productCategories = [],
    products = [],
    verificationUrl
  } = certData;

  const sanitizedCertNo = sanitizeForPdf(certificateNumber || 'HFA-UK-2026-00123');
  const resolvedName = sanitizeForPdf((companyName || businessName || 'Halal Certified Client').toUpperCase());
  const resolvedAddress = sanitizeForPdf((companyAddress || businessAddress || '—').toUpperCase());
  const resolvedMfgAddress = sanitizeForPdf((manufacturingAddress || manufacturerAddress || resolvedAddress || 'SAME AS ABOVE').toUpperCase());
  const resolvedScope = sanitizeForPdf((scope || scopeOfCertification || 'Halal Food and Consumer Products Certification').toUpperCase());

  const normalizedScheme = normalizeCertificateType(certificateType);
  const config = CERTIFICATE_SCHEMES[normalizedScheme] || CERTIFICATE_SCHEMES['HFA Scheme'];

  const bgBuffer = getBackgroundBuffer(config.bgFile);

  const qrUrl = verificationUrl || `${process.env.FRONTEND_CLIENT_URL || 'https://hfaportal.company'}/verify/${certificateNumber}`;
  const qrPngBuffer = await QRCode.toBuffer(qrUrl, {
    type: 'png',
    margin: 0,
    width: 300,
    color: { dark: '#112211', light: '#ffffff' }
  });

  const formattedIssue = formatDate(issueDate);
  const formattedExpiry = formatDate(expiryDate);
  const formattedCertStart = formatDate(certificationStartDate || issueDate);
  const formattedCurrentCycle = formatDate(currentCycleStartDate || issueDate);
  const formattedOrigCycle = formatDate(originalCycleStartDate || issueDate);

  const rawProducts = (products && products.length > 0) ? products : productCategories;
  const isGso = config.templateType === 'gso';

  // Standard A4 dimensions in points
  const PAGE_WIDTH = 595.28;
  const PAGE_HEIGHT = 841.89;

  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const bgImage = await pdfDoc.embedPng(bgBuffer);
  const qrImage = await pdfDoc.embedPng(qrPngBuffer);

  // Palettes
  const cEmerald = rgb(11 / 255, 124 / 255, 71 / 255); // #0b7c47
  const cDark = rgb(17 / 255, 24 / 255, 39 / 255);     // #111827
  const cSlate = rgb(51 / 255, 65 / 255, 85 / 255);    // #334155
  const cMuted = rgb(71 / 255, 85 / 255, 105 / 255);   // #475569
  const cTableBorder = rgb(11 / 255, 124 / 255, 71 / 255);
  const cTableGrid = rgb(194 / 255, 222 / 255, 203 / 255);
  const cTableEven = rgb(247 / 255, 250 / 255, 247 / 255);
  const cWhite = rgb(1, 1, 1);
  const cDivider = rgb(124 / 255, 181 / 255, 148 / 255);

  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  // 1. Draw Background Image
  page.drawImage(bgImage, {
    x: 0,
    y: 0,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT
  });

  // 2. Certificate Number
  const certNoY = PAGE_HEIGHT * (1 - config.certNoTopPct);
  const lblText = 'Certificate No.: ';
  const valText = sanitizedCertNo;
  const lblW = fontBold.widthOfTextAtSize(lblText, 9.5);
  const valW = fontBold.widthOfTextAtSize(valText, 9.8);
  const certStartX = (PAGE_WIDTH - (lblW + valW)) / 2;

  page.drawText(lblText, {
    x: certStartX,
    y: certNoY,
    size: 9.5,
    font: fontBold,
    color: cEmerald
  });
  page.drawText(valText, {
    x: certStartX + lblW,
    y: certNoY,
    size: 9.8,
    font: fontBold,
    color: cDark
  });

  // 3. Dates Section
  const leftX = PAGE_WIDTH * 0.065;
  const rightX = PAGE_WIDTH * 0.935;
  const datesY = PAGE_HEIGHT * (1 - config.datesTopPct);

  if (!isGso) {
    // Non-GSO (HFA, Cosmetics, Smiic): 3 dates across single line
    const issueLbl = 'Issue Date: ';
    page.drawText(issueLbl, { x: leftX, y: datesY, size: 8.5, font: fontBold, color: cEmerald });
    page.drawText(formattedIssue, { x: leftX + fontBold.widthOfTextAtSize(issueLbl, 8.5), y: datesY, size: 8.5, font: fontBold, color: cDark });

    const startLbl = 'Certification Start Date: ';
    const startTotalW = fontBold.widthOfTextAtSize(startLbl + formattedCertStart, 8.5);
    const startX = (PAGE_WIDTH - startTotalW) / 2;
    page.drawText(startLbl, { x: startX, y: datesY, size: 8.5, font: fontBold, color: cEmerald });
    page.drawText(formattedCertStart, { x: startX + fontBold.widthOfTextAtSize(startLbl, 8.5), y: datesY, size: 8.5, font: fontBold, color: cDark });

    const expLbl = 'Expiry Date: ';
    const expTotalW = fontBold.widthOfTextAtSize(expLbl + formattedExpiry, 8.5);
    const expX = rightX - expTotalW;
    page.drawText(expLbl, { x: expX, y: datesY, size: 8.5, font: fontBold, color: cEmerald });
    page.drawText(formattedExpiry, { x: expX + fontBold.widthOfTextAtSize(expLbl, 8.5), y: datesY, size: 8.5, font: fontBold, color: cDark });
  } else {
    // GSO: 2 rows of dates
    const issueLbl = 'Issue Date: ';
    page.drawText(issueLbl, { x: leftX, y: datesY, size: 8.0, font: fontBold, color: cEmerald });
    page.drawText(formattedIssue, { x: leftX + fontBold.widthOfTextAtSize(issueLbl, 8.0), y: datesY, size: 8.0, font: fontBold, color: cDark });

    const currLbl = 'Current Cycle Start Date: ';
    const currTotalW = fontBold.widthOfTextAtSize(currLbl + formattedCurrentCycle, 8.0);
    const currX = (PAGE_WIDTH - currTotalW) / 2;
    page.drawText(currLbl, { x: currX, y: datesY, size: 8.0, font: fontBold, color: cEmerald });
    page.drawText(formattedCurrentCycle, { x: currX + fontBold.widthOfTextAtSize(currLbl, 8.0), y: datesY, size: 8.0, font: fontBold, color: cDark });

    const expLbl = 'Expiry Date: ';
    const expTotalW = fontBold.widthOfTextAtSize(expLbl + formattedExpiry, 8.0);
    const expX = rightX - expTotalW;
    page.drawText(expLbl, { x: expX, y: datesY, size: 8.0, font: fontBold, color: cEmerald });
    page.drawText(formattedExpiry, { x: expX + fontBold.widthOfTextAtSize(expLbl, 8.0), y: datesY, size: 8.0, font: fontBold, color: cDark });

    const row2Y = datesY - 11;
    const origLbl = 'Original Cycle Start Date: ';
    const origTotalW = fontBold.widthOfTextAtSize(origLbl + formattedOrigCycle, 8.0);
    const origX = (PAGE_WIDTH - origTotalW) / 2;
    page.drawText(origLbl, { x: origX, y: row2Y, size: 8.0, font: fontBold, color: cEmerald });
    page.drawText(formattedOrigCycle, { x: origX + fontBold.widthOfTextAtSize(origLbl, 8.0), y: row2Y, size: 8.0, font: fontBold, color: cDark });
  }

  // 4. Company & Category Info Block
  const infoTopY = PAGE_HEIGHT * (1 - config.infoTopPct);
  const infoW = PAGE_WIDTH * 0.87;
  const labelColW = infoW * 0.32;
  const valColW = infoW * 0.68;
  const valStartX = leftX + labelColW;

  const infoRows = [
    { label: 'COMPANY NAME:', val: resolvedName },
    { label: 'COMPANY ADDRESS:', val: resolvedAddress },
    { label: 'MANUFACTURING FACILITY(IES) ADDRESS (IF DIFFERENT):', val: resolvedMfgAddress },
    { label: 'PRODUCT CATEGORY:', val: resolvedScope }
  ];

  let curY = infoTopY;
  for (const row of infoRows) {
    const valLines = wrapTextLines(row.val, valColW - 6, fontBold, 7.8, 2);
    const rowHeight = Math.max(15, valLines.length * 9.5 + 4);

    page.drawText(row.label, {
      x: leftX,
      y: curY - 9,
      size: 7.8,
      font: fontBold,
      color: cDark
    });

    valLines.forEach((line, lineIdx) => {
      page.drawText(line, {
        x: valStartX,
        y: curY - 9 - (lineIdx * 9.5),
        size: 7.8,
        font: fontBold,
        color: cDark
      });
    });

    page.drawLine({
      start: { x: leftX, y: curY - rowHeight },
      end: { x: leftX + infoW, y: curY - rowHeight },
      thickness: 0.75,
      color: cDivider
    });

    curY -= (rowHeight + 3);
  }

  // 5. Products Table
  const tableTopY = PAGE_HEIGHT * (1 - config.tableTopPct);
  const tableLeftX = PAGE_WIDTH * 0.14;
  const tableWidth = PAGE_WIDTH * 0.72;
  const headerHeight = 16.5;
  const rowHeight = 15;

  const displayProducts = (rawProducts && rawProducts.length > 0)
    ? rawProducts.slice(0, 6)
    : [
        { code: 'PRD-01', name: 'Certified Halal Products & Formulations' },
        { code: 'PRD-02', name: 'Premium Quality Line Series' },
        { code: 'PRD-03', name: 'Standard Halal Inspected Batch' }
      ];

  if (!isGso) {
    const col1W = tableWidth * 0.15;
    const col2W = tableWidth * 0.85;

    page.drawRectangle({
      x: tableLeftX,
      y: tableTopY - headerHeight,
      width: tableWidth,
      height: headerHeight,
      color: cTableBorder
    });

    const h1 = 'NO.';
    const h2 = 'NAME OF THE PRODUCTS';
    page.drawText(h1, {
      x: tableLeftX + (col1W - fontBold.widthOfTextAtSize(h1, 7.8)) / 2,
      y: tableTopY - headerHeight + 4.5,
      size: 7.8,
      font: fontBold,
      color: cWhite
    });
    page.drawText(h2, {
      x: tableLeftX + col1W + 10,
      y: tableTopY - headerHeight + 4.5,
      size: 7.8,
      font: fontBold,
      color: cWhite
    });

    let rowY = tableTopY - headerHeight;
    displayProducts.forEach((p, idx) => {
      rowY -= rowHeight;
      const isEven = idx % 2 === 1;

      page.drawRectangle({
        x: tableLeftX,
        y: rowY,
        width: tableWidth,
        height: rowHeight,
        color: isEven ? cTableEven : cWhite
      });

      page.drawRectangle({
        x: tableLeftX,
        y: rowY,
        width: tableWidth,
        height: rowHeight,
        borderColor: cTableGrid,
        borderWidth: 0.75
      });

      page.drawLine({
        start: { x: tableLeftX + col1W, y: rowY },
        end: { x: tableLeftX + col1W, y: rowY + rowHeight },
        thickness: 0.75,
        color: cTableGrid
      });

      const noStr = String(idx + 1);
      page.drawText(noStr, {
        x: tableLeftX + (col1W - fontBold.widthOfTextAtSize(noStr, 7.5)) / 2,
        y: rowY + 4,
        size: 7.5,
        font: fontBold,
        color: cDark
      });

      const rawName = sanitizeForPdf(p.name || p.product_name || p.title || p.description || (typeof p === 'string' ? p : 'Certified Halal Product'));
      const nameStr = truncateToWidth(rawName, col2W - 18, fontBold, 7.5);
      page.drawText(nameStr, {
        x: tableLeftX + col1W + 10,
        y: rowY + 4,
        size: 7.5,
        font: fontBold,
        color: cDark
      });
    });

    page.drawRectangle({
      x: tableLeftX,
      y: rowY,
      width: tableWidth,
      height: tableTopY - rowY,
      borderColor: cTableBorder,
      borderWidth: 1.0
    });

    const asterisks = '****************';
    const astW = fontBold.widthOfTextAtSize(asterisks, 8.5);
    page.drawText(asterisks, {
      x: (PAGE_WIDTH - astW) / 2,
      y: rowY - 10,
      size: 8.5,
      font: fontBold,
      color: cDark
    });
  } else {
    const col1W = tableWidth * 0.12;
    const col2W = tableWidth * 0.28;
    const col3W = tableWidth * 0.60;

    page.drawRectangle({
      x: tableLeftX,
      y: tableTopY - headerHeight,
      width: tableWidth,
      height: headerHeight,
      color: cTableBorder
    });

    const h1 = 'NO.';
    const h2 = 'CODE';
    const h3 = 'DESCRIPTION';
    page.drawText(h1, {
      x: tableLeftX + (col1W - fontBold.widthOfTextAtSize(h1, 7.8)) / 2,
      y: tableTopY - headerHeight + 4.5,
      size: 7.8,
      font: fontBold,
      color: cWhite
    });
    page.drawText(h2, {
      x: tableLeftX + col1W + (col2W - fontBold.widthOfTextAtSize(h2, 7.8)) / 2,
      y: tableTopY - headerHeight + 4.5,
      size: 7.8,
      font: fontBold,
      color: cWhite
    });
    page.drawText(h3, {
      x: tableLeftX + col1W + col2W + 10,
      y: tableTopY - headerHeight + 4.5,
      size: 7.8,
      font: fontBold,
      color: cWhite
    });

    let rowY = tableTopY - headerHeight;
    displayProducts.forEach((p, idx) => {
      rowY -= rowHeight;
      const isEven = idx % 2 === 1;

      page.drawRectangle({
        x: tableLeftX,
        y: rowY,
        width: tableWidth,
        height: rowHeight,
        color: isEven ? cTableEven : cWhite
      });

      page.drawRectangle({
        x: tableLeftX,
        y: rowY,
        width: tableWidth,
        height: rowHeight,
        borderColor: cTableGrid,
        borderWidth: 0.75
      });

      page.drawLine({
        start: { x: tableLeftX + col1W, y: rowY },
        end: { x: tableLeftX + col1W, y: rowY + rowHeight },
        thickness: 0.75,
        color: cTableGrid
      });
      page.drawLine({
        start: { x: tableLeftX + col1W + col2W, y: rowY },
        end: { x: tableLeftX + col1W + col2W, y: rowY + rowHeight },
        thickness: 0.75,
        color: cTableGrid
      });

      const noStr = String(idx + 1);
      page.drawText(noStr, {
        x: tableLeftX + (col1W - fontBold.widthOfTextAtSize(noStr, 7.5)) / 2,
        y: rowY + 4,
        size: 7.5,
        font: fontBold,
        color: cDark
      });

      const rawCode = sanitizeForPdf(p.code || p.product_code || `PRD-${String(idx + 1).padStart(2, '0')}`);
      const codeStr = truncateToWidth(rawCode, col2W - 10, fontBold, 7.5);
      page.drawText(codeStr, {
        x: tableLeftX + col1W + (col2W - fontBold.widthOfTextAtSize(codeStr, 7.5)) / 2,
        y: rowY + 4,
        size: 7.5,
        font: fontBold,
        color: cDark
      });

      const rawDesc = sanitizeForPdf(p.name || p.description || p.product_name || p.title || (typeof p === 'string' ? p : 'Certified Halal Product'));
      const descStr = truncateToWidth(rawDesc, col3W - 16, fontBold, 7.5);
      page.drawText(descStr, {
        x: tableLeftX + col1W + col2W + 10,
        y: rowY + 4,
        size: 7.5,
        font: fontBold,
        color: cDark
      });
    });

    page.drawRectangle({
      x: tableLeftX,
      y: rowY,
      width: tableWidth,
      height: tableTopY - rowY,
      borderColor: cTableBorder,
      borderWidth: 1.0
    });

    const asterisks = '****************';
    const astW = fontBold.widthOfTextAtSize(asterisks, 8.5);
    page.drawText(asterisks, {
      x: (PAGE_WIDTH - astW) / 2,
      y: rowY - 10,
      size: 8.5,
      font: fontBold,
      color: cDark
    });
  }

  // 6. QR Code
  const qrSize = 50;
  const qrX = PAGE_WIDTH * 0.068;
  const qrY = PAGE_HEIGHT * (1 - 0.868) - qrSize;

  page.drawRectangle({
    x: qrX - 2,
    y: qrY - 2,
    width: qrSize + 4,
    height: qrSize + 4,
    color: cWhite
  });
  page.drawImage(qrImage, {
    x: qrX,
    y: qrY,
    width: qrSize,
    height: qrSize
  });

  // 7. Page Numbering
  const pageNoStr = 'Page 1 of 1';
  const pageNoW = fontOblique.widthOfTextAtSize(pageNoStr, 7.5);
  page.drawText(pageNoStr, {
    x: PAGE_WIDTH * 0.94 - pageNoW,
    y: PAGE_HEIGHT * (1 - 0.94),
    size: 7.5,
    font: fontOblique,
    color: cSlate
  });

  // 8. Document Metadata Footer
  const footerW = fontRegular.widthOfTextAtSize(config.docFooter, 6.5);
  page.drawText(config.docFooter, {
    x: (PAGE_WIDTH - footerW) / 2,
    y: PAGE_HEIGHT * 0.01 + 3,
    size: 6.5,
    font: fontRegular,
    color: cMuted
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
