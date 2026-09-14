import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * In-memory cache for base PDF template buffers to optimize generation speed.
 */
const pdfCache = new Map();

function getBasePdfBuffer(basePdfFile) {
  if (pdfCache.has(basePdfFile)) {
    return pdfCache.get(basePdfFile);
  }
  
  // Look in assets/certificates first, then workspace root
  const candidates = [
    path.join(__dirname, '../assets/certificates', basePdfFile),
    path.join(__dirname, '../../', basePdfFile),
    path.join(process.cwd(), basePdfFile),
    path.join(process.cwd(), 'assets/certificates', basePdfFile)
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const buffer = fs.readFileSync(p);
      pdfCache.set(basePdfFile, buffer);
      return buffer;
    }
  }

  throw new Error(`Base certificate PDF template not found: ${basePdfFile}. Checked: ${candidates.join(', ')}`);
}

/**
 * Sanitizes strings for pdf-lib standard Helvetica (WinAnsi) encoding.
 * Converts bullets, dashes, smart quotes, checkmarks, etc. to valid Latin-1 characters
 * and strips any characters that WinAnsi cannot encode.
 */
export function sanitizeForPdf(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2022\u25CF\u25CB]/g, '*')
    .replace(/[\u2713\u2714]/g, 'v')
    .replace(/[\u00A0]/g, ' ')
    .replace(/[^\x00-\xFF]/g, '')
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

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Formats a Date object or date string into DD-MMM-YYYY (e.g. 11-Sep-2026, 22-Sep-2023).
 */
export function formatDate(dateVal) {
  if (!dateVal) return '—';

  // If already in DD-MMM-YYYY format (e.g. 11-Sep-2026)
  if (typeof dateVal === 'string' && /^\d{1,2}-[A-Za-z]{3}-\d{4}$/.test(dateVal.trim())) {
    const parts = dateVal.trim().split('-');
    const day = parts[0].padStart(2, '0');
    const month = parts[1].charAt(0).toUpperCase() + parts[1].slice(1, 3).toLowerCase();
    const year = parts[2];
    return `${day}-${month}-${year}`;
  }

  // If in YYYY-MM-DD or YYYY/MM/DD (e.g. "2026-09-11")
  if (typeof dateVal === 'string' && /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(dateVal.trim())) {
    const match = dateVal.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (match) {
      const year = match[1];
      const monthIdx = parseInt(match[2], 10) - 1;
      const day = match[3].padStart(2, '0');
      const monthStr = MONTH_NAMES[monthIdx] || 'Jan';
      return `${day}-${monthStr}-${year}`;
    }
  }

  // If in DD/MM/YYYY or DD-MM-YYYY (e.g. "11/09/2026" or "11-09-2026")
  if (typeof dateVal === 'string' && /^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(dateVal.trim())) {
    const parts = dateVal.trim().split(/[/-]/);
    const day = parts[0].padStart(2, '0');
    const monthIdx = parseInt(parts[1], 10) - 1;
    const year = parts[2];
    const monthStr = MONTH_NAMES[monthIdx] || 'Jan';
    return `${day}-${monthStr}-${year}`;
  }

  // Parse Date instance / ISO string
  const date = new Date(dateVal);
  if (isNaN(date.getTime())) return String(dateVal);
  const day = String(date.getDate()).padStart(2, '0');
  const monthStr = MONTH_NAMES[date.getMonth()] || 'Jan';
  const year = date.getFullYear();
  return `${day}-${monthStr}-${year}`;
}

/**
 * Scheme definitions, vector base PDF files, footer doc control texts, and layout coordinates.
 */
export const CERTIFICATE_SCHEMES = {
  'HFA Scheme': {
    name: 'HFA Scheme',
    templateType: 'hfa',
    basePdf: 'HFA SCHEME.pdf',
    docFooter: 'Doc: Halal Certificate (HFA Scheme)   Created by: MH   Approved by: HI   Version: 2   Date: 11.10.2022',
    certNoY: 646,
    datesY: 624,
    infoTopY: 512,
    tableTopY: 375
  },
  'HFA SCHEME': {
    name: 'HFA Scheme',
    templateType: 'hfa',
    basePdf: 'HFA SCHEME.pdf',
    docFooter: 'Doc: Halal Certificate (HFA Scheme)   Created by: MH   Approved by: HI   Version: 2   Date: 11.10.2022',
    certNoY: 646,
    datesY: 624,
    infoTopY: 512,
    tableTopY: 375
  },
  'Cosmetics': {
    name: 'Cosmetics',
    templateType: 'hfa',
    basePdf: 'COSMETICS.pdf',
    docFooter: 'Doc: Halal Certificate (HFA Cosmetic Scheme)   Created by: MH   Approved by: HI   Version: 2   Date: 11.10.2022',
    certNoY: 628,
    datesY: 606,
    infoTopY: 512,
    tableTopY: 375
  },
  'COSMETICS': {
    name: 'Cosmetics',
    templateType: 'hfa',
    basePdf: 'COSMETICS.pdf',
    docFooter: 'Doc: Halal Certificate (HFA Cosmetic Scheme)   Created by: MH   Approved by: HI   Version: 2   Date: 11.10.2022',
    certNoY: 628,
    datesY: 606,
    infoTopY: 512,
    tableTopY: 375
  },
  'Smiic': {
    name: 'Smiic',
    templateType: 'hfa',
    basePdf: 'SMIIC.pdf',
    docFooter: 'Doc: Halal Certificate (SMIIC Scheme)   Created by: MH   Approved by: HI   Version: 2   Date: 11.10.2022',
    certNoY: 646,
    datesY: 624,
    infoTopY: 512,
    tableTopY: 375
  },
  'SMIIC': {
    name: 'Smiic',
    templateType: 'hfa',
    basePdf: 'SMIIC.pdf',
    docFooter: 'Doc: Halal Certificate (SMIIC Scheme)   Created by: MH   Approved by: HI   Version: 2   Date: 11.10.2022',
    certNoY: 646,
    datesY: 624,
    infoTopY: 512,
    tableTopY: 375
  },
  'GSO meat': {
    name: 'GSO meat',
    templateType: 'gso',
    basePdf: 'GSO MEAT.pdf',
    docFooter: 'Doc: Halal Certificate (GSO meat)   Created by: AH   Amended by: TO   Approved by: AM   Version: 16   Date: 28.10.2024',
    certNoY: 648,
    datesY: 631,
    datesRow2Y: 617,
    infoTopY: 512,
    tableTopY: 375
  },
  'GSO MEAT': {
    name: 'GSO meat',
    templateType: 'gso',
    basePdf: 'GSO MEAT.pdf',
    docFooter: 'Doc: Halal Certificate (GSO meat)   Created by: AH   Amended by: TO   Approved by: AM   Version: 16   Date: 28.10.2024',
    certNoY: 648,
    datesY: 631,
    datesRow2Y: 617,
    infoTopY: 512,
    tableTopY: 375
  },
  'GSO non-meat': {
    name: 'GSO non-meat',
    templateType: 'gso',
    basePdf: 'GSO NON MEAT.pdf',
    docFooter: 'Doc: Halal Certificate (GSO non-meat)   Created by: AH   Amended by: TO   Approved by: AM   Version: 16   Date: 28.10.2024',
    certNoY: 648,
    datesY: 631,
    datesRow2Y: 617,
    infoTopY: 512,
    tableTopY: 375
  },
  'GSO NON MEAT': {
    name: 'GSO non-meat',
    templateType: 'gso',
    basePdf: 'GSO NON MEAT.pdf',
    docFooter: 'Doc: Halal Certificate (GSO non-meat)   Created by: AH   Amended by: TO   Approved by: AM   Version: 16   Date: 28.10.2024',
    certNoY: 648,
    datesY: 631,
    datesRow2Y: 617,
    infoTopY: 512,
    tableTopY: 375
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
 * Generate a base64 encoded QR Code image from a URL.
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
 * Generates an official Halal certificate PDF buffer using pdf-lib.
 * Directly loads the original vector base PDF (GSO MEAT, GSO NON MEAT, HFA SCHEME, SMIIC, COSMETICS)
 * and overlays exact dynamic certificate data in matching regular Helvetica fonts (non-bold) and positions.
 * 
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

  const normalizedScheme = normalizeCertificateType(certificateType || certData.certificate_type);
  const scheme = CERTIFICATE_SCHEMES[normalizedScheme] || CERTIFICATE_SCHEMES['HFA Scheme'];
  const isGso = scheme.templateType === 'gso';

  // Load vector base PDF template
  const basePdfBuffer = getBasePdfBuffer(scheme.basePdf);
  const baseDoc = await PDFDocument.load(basePdfBuffer, { ignoreEncryption: true });

  // Resolve and sanitize all products
  const rawProducts = (products && products.length > 0)
    ? products
    : (productCategories && productCategories.length > 0)
      ? productCategories
      : (certData.product_details && certData.product_details.length > 0)
        ? certData.product_details
        : (certData.products_covered && certData.products_covered.length > 0)
          ? certData.products_covered
          : [];

  const allProducts = (rawProducts && rawProducts.length > 0)
    ? rawProducts.map((p, idx) => {
        let code = '';
        let name = '';
        if (typeof p === 'string') {
          code = `PRD-${String(idx + 1).padStart(2, '0')}`;
          name = p;
        } else if (p && typeof p === 'object') {
          code = p.code || p.product_code || `PRD-${String(idx + 1).padStart(2, '0')}`;
          name = p.name || p.product_name || p.title || p.description || `Product ${idx + 1}`;
        } else {
          code = `PRD-${String(idx + 1).padStart(2, '0')}`;
          name = `Product ${idx + 1}`;
        }
        return {
          code: sanitizeForPdf(code),
          name: sanitizeForPdf(name)
        };
      })
    : [{ code: 'PRD-01', name: 'Certified Halal Products & Formulations' }];

  // Pagination capacity:
  // Page 1: Space from tableStartY (curY - 6 ≈ 367) to signatures (180) fits 11 products cleanly.
  // Pages 2+: Space from top (480) to signatures (180) fits 25 products per page with clean breathing room below the statement.
  const PAGE1_LIMIT = 11;
  const SUBSEQUENT_PAGE_LIMIT = 25;

  let pagesProducts = [];
  if (allProducts.length <= PAGE1_LIMIT) {
    pagesProducts = [allProducts];
  } else {
    pagesProducts.push(allProducts.slice(0, PAGE1_LIMIT));
    let remaining = allProducts.slice(PAGE1_LIMIT);
    while (remaining.length > 0) {
      pagesProducts.push(remaining.slice(0, SUBSEQUENT_PAGE_LIMIT));
      remaining = remaining.slice(SUBSEQUENT_PAGE_LIMIT);
    }
  }

  const totalPages = pagesProducts.length;

  // Create destination multi-page PDF document
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  // Standard Colors
  const cEmerald = rgb(11 / 255, 124 / 255, 71 / 255); // #0b7c47 / HFA Green
  const cDark = rgb(17 / 255, 24 / 255, 39 / 255);     // #111827 / Deep Black
  const cSlate = rgb(51 / 255, 65 / 255, 85 / 255);    // #334155
  const cMuted = rgb(71 / 255, 85 / 255, 105 / 255);   // #475569
  const cTableBorder = rgb(11 / 255, 124 / 255, 71 / 255);
  const cTableGrid = rgb(194 / 255, 222 / 255, 203 / 255);
  const cWhite = rgb(1, 1, 1);
  const cDivider = rgb(124 / 255, 181 / 255, 148 / 255);

  const sanitizedCertNo = sanitizeForPdf(certificateNumber || certData.certificate_number);
  const formattedIssue = formatDate(issueDate || certData.issue_date);
  const formattedExpiry = formatDate(expiryDate || certData.expiry_date);
  const formattedCertStart = formatDate(certificationStartDate || certData.certification_start_date || issueDate || certData.issue_date);
  const formattedCurrentCycle = formatDate(currentCycleStartDate || certData.current_cycle_start_date || issueDate || certData.issue_date);
  const formattedOrigCycle = formatDate(originalCycleStartDate || certData.original_cycle_start_date || issueDate || certData.issue_date);

  const resolvedName = sanitizeForPdf((companyName || businessName || certData.company_name || 'Halal Certified Client').toUpperCase());
  const resolvedAddress = sanitizeForPdf((companyAddress || businessAddress || certData.company_address || '—').toUpperCase());
  const resolvedMfgAddress = sanitizeForPdf((manufacturingAddress || manufacturerAddress || certData.manufacturing_address || certData.manufacturer_address || resolvedAddress || 'SAME AS ABOVE').toUpperCase());
  const resolvedScope = sanitizeForPdf((scope || scopeOfCertification || certData.scope || certData.scopeOfCertification || 'Halal Food and Consumer Products Certification').toUpperCase());

  // Generate QR Code
  const qrUrl = verificationUrl || `${process.env.FRONTEND_CLIENT_URL || 'https://hfaportal.company'}/verify/${sanitizedCertNo}`;
  const qrPngBuffer = await QRCode.toBuffer(qrUrl, {
    type: 'png',
    margin: 0,
    width: 300,
    color: { dark: '#112211', light: '#ffffff' }
  });
  const qrImage = await pdfDoc.embedPng(qrPngBuffer);

  const PAGE_WIDTH = 595.28;
  const PAGE_HEIGHT = 841.89;

  let globalProductIndex = 0;

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const isFirstPage = pageIdx === 0;
    const isLastPage = pageIdx === totalPages - 1;
    const currentProducts = pagesProducts[pageIdx];

    // Clone vector base PDF template page
    const [page] = await pdfDoc.copyPages(baseDoc, [0]);
    pdfDoc.addPage(page);

    // 1. Certificate Number (regular font matching template)
    const certNoLbl = 'Certificate No.: ';
    const lblW = fontRegular.widthOfTextAtSize(certNoLbl, 8.5);
    const valW = fontRegular.widthOfTextAtSize(sanitizedCertNo, 8.5);
    const certStartX = (PAGE_WIDTH - (lblW + valW)) / 2;

    page.drawText(certNoLbl, {
      x: certStartX,
      y: scheme.certNoY,
      size: 8.5,
      font: fontRegular,
      color: cEmerald
    });
    page.drawText(sanitizedCertNo, {
      x: certStartX + lblW,
      y: scheme.certNoY,
      size: 8.5,
      font: fontRegular,
      color: cDark
    });

    // 2. Dates Block (regular font matching template)
    const leftMargin = 45;
    const rightMargin = PAGE_WIDTH - 45;

    if (!isGso) {
      // Non-GSO (HFA, Cosmetics, SMIIC): Single line of 3 dates
      const dY = scheme.datesY;

      // Issue Date (left)
      const issueLbl = 'Issue Date: ';
      page.drawText(issueLbl, { x: leftMargin, y: dY, size: 8.0, font: fontRegular, color: cEmerald });
      page.drawText(formattedIssue, { x: leftMargin + fontRegular.widthOfTextAtSize(issueLbl, 8.0), y: dY, size: 8.0, font: fontRegular, color: cDark });

      // Certification Start Date (center)
      const startLbl = 'Certification Start Date: ';
      const startTotalW = fontRegular.widthOfTextAtSize(startLbl + formattedCertStart, 8.0);
      const startX = (PAGE_WIDTH - startTotalW) / 2;
      page.drawText(startLbl, { x: startX, y: dY, size: 8.0, font: fontRegular, color: cEmerald });
      page.drawText(formattedCertStart, { x: startX + fontRegular.widthOfTextAtSize(startLbl, 8.0), y: dY, size: 8.0, font: fontRegular, color: cDark });

      // Expiry Date (right)
      const expLbl = 'Expiry Date: ';
      const expTotalW = fontRegular.widthOfTextAtSize(expLbl + formattedExpiry, 8.0);
      const expX = rightMargin - expTotalW;
      page.drawText(expLbl, { x: expX, y: dY, size: 8.0, font: fontRegular, color: cEmerald });
      page.drawText(formattedExpiry, { x: expX + fontRegular.widthOfTextAtSize(expLbl, 8.0), y: dY, size: 8.0, font: fontRegular, color: cDark });
    } else {
      // GSO (GSO meat, GSO non-meat): 2 rows of dates
      const dY = scheme.datesY;

      // Row 1: Issue Date (left), Current Cycle Start Date (center), Expiry Date (right)
      const issueLbl = 'Issue Date: ';
      page.drawText(issueLbl, { x: leftMargin, y: dY, size: 8.0, font: fontRegular, color: cEmerald });
      page.drawText(formattedIssue, { x: leftMargin + fontRegular.widthOfTextAtSize(issueLbl, 8.0), y: dY, size: 8.0, font: fontRegular, color: cDark });

      const currLbl = 'Current Cycle Start Date: ';
      const currTotalW = fontRegular.widthOfTextAtSize(currLbl + formattedCurrentCycle, 8.0);
      const currX = (PAGE_WIDTH - currTotalW) / 2;
      page.drawText(currLbl, { x: currX, y: dY, size: 8.0, font: fontRegular, color: cEmerald });
      page.drawText(formattedCurrentCycle, { x: currX + fontRegular.widthOfTextAtSize(currLbl, 8.0), y: dY, size: 8.0, font: fontRegular, color: cDark });

      const expLbl = 'Expiry Date: ';
      const expTotalW = fontRegular.widthOfTextAtSize(expLbl + formattedExpiry, 8.0);
      const expX = rightMargin - expTotalW;
      page.drawText(expLbl, { x: expX, y: dY, size: 8.0, font: fontRegular, color: cEmerald });
      page.drawText(formattedExpiry, { x: expX + fontRegular.widthOfTextAtSize(expLbl, 8.0), y: dY, size: 8.0, font: fontRegular, color: cDark });

      // Row 2: Original Cycle Start Date (center)
      const row2Y = scheme.datesRow2Y;
      const origLbl = 'Original Cycle Start Date: ';
      const origTotalW = fontRegular.widthOfTextAtSize(origLbl + formattedOrigCycle, 8.0);
      const origX = (PAGE_WIDTH - origTotalW) / 2;
      page.drawText(origLbl, { x: origX, y: row2Y, size: 8.0, font: fontRegular, color: cEmerald });
      page.drawText(formattedOrigCycle, { x: origX + fontRegular.widthOfTextAtSize(origLbl, 8.0), y: row2Y, size: 8.0, font: fontRegular, color: cDark });
    }

    let tableStartY = 0;
    let headerHeight = 0;
    let rowHeight = 0;

    if (isFirstPage) {
      // 3. Company & Category Info Block (Page 1 only)
      const infoW = 505;
      const leftX = 45;
      const valStartX = 230;
      const valColW = infoW - (valStartX - leftX);

      const infoRows = [
        { label: 'COMPANY NAME:', val: resolvedName, isMfg: false },
        { label: 'COMPANY ADDRESS:', val: resolvedAddress, isMfg: false },
        { label: 'MANUFACTURING FACILITY(IES) ADDRESS (IF DIFFERENT):', val: resolvedMfgAddress, isMfg: true },
        { label: 'PRODUCT CATEGORY:', val: resolvedScope, isMfg: false }
      ];

      let curY = scheme.infoTopY;
      for (const row of infoRows) {
        const valLines = wrapTextLines(row.val, valColW - 10, fontRegular, 7.8, 2);
        const rHeight = row.isMfg ? 28 : Math.max(16, valLines.length * 9.5 + 5);

        if (row.isMfg) {
          page.drawText('MANUFACTURING', { x: leftX, y: curY - 8, size: 7.8, font: fontRegular, color: cDark });
          page.drawText('FACILITY(IES)', { x: leftX, y: curY - 16, size: 7.8, font: fontRegular, color: cDark });
          page.drawText('ADDRESS (IF DIFFERENT):', { x: leftX, y: curY - 24, size: 7.8, font: fontRegular, color: cDark });
        } else {
          page.drawText(row.label, { x: leftX, y: curY - 9, size: 7.8, font: fontRegular, color: cDark });
        }

        valLines.forEach((line, lineIdx) => {
          page.drawText(line, {
            x: valStartX,
            y: curY - 9 - (lineIdx * 9.5),
            size: 7.8,
            font: fontRegular,
            color: cDark
          });
        });

        page.drawLine({
          start: { x: leftX, y: curY - rHeight },
          end: { x: leftX + infoW, y: curY - rHeight },
          thickness: 0.75,
          color: cDivider
        });

        curY -= (rHeight + 3);
      }

      tableStartY = curY - 6;
      headerHeight = 15;
      rowHeight = 13.5;
    } else {
      // Subsequent pages: Table starts cleanly under header/statement area (25 products per page)
      tableStartY = 480;
      headerHeight = 14;
      rowHeight = 11.2;
    }

    // 4. Products Table (regular font for rows, bold only for table header, transparent row backgrounds)
    const tableWidth = 440;
    const tableLeftX = (PAGE_WIDTH - tableWidth) / 2;
    const hSize = isFirstPage ? 7.8 : 7.2;
    const cellFontSize = isFirstPage ? 7.5 : 6.8;

    if (!isGso) {
      // 2 Columns: NO. (width 50), NAME OF THE PRODUCTS (width 390)
      const col1W = 50;
      const col2W = tableWidth - col1W;

      // Header Fill
      page.drawRectangle({
        x: tableLeftX,
        y: tableStartY - headerHeight,
        width: tableWidth,
        height: headerHeight,
        color: cTableBorder
      });

      const h1 = 'NO.';
      const h2 = 'NAME OF THE PRODUCTS';
      page.drawText(h1, {
        x: tableLeftX + (col1W - fontBold.widthOfTextAtSize(h1, hSize)) / 2,
        y: tableStartY - headerHeight + (headerHeight - hSize) / 2 + 0.5,
        size: hSize,
        font: fontBold,
        color: cWhite
      });
      page.drawText(h2, {
        x: tableLeftX + col1W + (col2W - fontBold.widthOfTextAtSize(h2, hSize)) / 2,
        y: tableStartY - headerHeight + (headerHeight - hSize) / 2 + 0.5,
        size: hSize,
        font: fontBold,
        color: cWhite
      });

      let rowY = tableStartY - headerHeight;
      currentProducts.forEach((p) => {
        globalProductIndex++;
        rowY -= rowHeight;

        // Row cell borders (transparent background)
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

        const noStr = String(globalProductIndex);
        page.drawText(noStr, {
          x: tableLeftX + (col1W - fontRegular.widthOfTextAtSize(noStr, cellFontSize)) / 2,
          y: rowY + (rowHeight - cellFontSize) / 2 + 0.5,
          size: cellFontSize,
          font: fontRegular,
          color: cDark
        });

        const nameStr = truncateToWidth(p.name, col2W - 18, fontRegular, cellFontSize);
        page.drawText(nameStr, {
          x: tableLeftX + col1W + 12,
          y: rowY + (rowHeight - cellFontSize) / 2 + 0.5,
          size: cellFontSize,
          font: fontRegular,
          color: cDark
        });
      });

      // Outer table border
      page.drawRectangle({
        x: tableLeftX,
        y: rowY,
        width: tableWidth,
        height: tableStartY - rowY,
        borderColor: cTableBorder,
        borderWidth: 1.0
      });

      // Asterisks ONLY on final page below the last product
      if (isLastPage) {
        const asterisks = '****************';
        const astW = fontRegular.widthOfTextAtSize(asterisks, 8.5);
        page.drawText(asterisks, {
          x: (PAGE_WIDTH - astW) / 2,
          y: rowY - 9,
          size: 8.5,
          font: fontRegular,
          color: cDark
        });
      }
    } else {
      // 3 Columns: NO. (width 40), DESCRIPTION (width 290), CODE (width 110)
      const col1W = 40;
      const col2W = 290;
      const col3W = tableWidth - col1W - col2W;

      page.drawRectangle({
        x: tableLeftX,
        y: tableStartY - headerHeight,
        width: tableWidth,
        height: headerHeight,
        color: cTableBorder
      });

      const h1 = 'NO.';
      const h2 = 'DESCRIPTION';
      const h3 = 'CODE';
      page.drawText(h1, {
        x: tableLeftX + (col1W - fontBold.widthOfTextAtSize(h1, hSize)) / 2,
        y: tableStartY - headerHeight + (headerHeight - hSize) / 2 + 0.5,
        size: hSize,
        font: fontBold,
        color: cWhite
      });
      page.drawText(h2, {
        x: tableLeftX + col1W + (col2W - fontBold.widthOfTextAtSize(h2, hSize)) / 2,
        y: tableStartY - headerHeight + (headerHeight - hSize) / 2 + 0.5,
        size: hSize,
        font: fontBold,
        color: cWhite
      });
      page.drawText(h3, {
        x: tableLeftX + col1W + col2W + (col3W - fontBold.widthOfTextAtSize(h3, hSize)) / 2,
        y: tableStartY - headerHeight + (headerHeight - hSize) / 2 + 0.5,
        size: hSize,
        font: fontBold,
        color: cWhite
      });

      let rowY = tableStartY - headerHeight;
      currentProducts.forEach((p) => {
        globalProductIndex++;
        rowY -= rowHeight;

        // Row cell borders (transparent background)
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

        const noStr = String(globalProductIndex);
        page.drawText(noStr, {
          x: tableLeftX + (col1W - fontRegular.widthOfTextAtSize(noStr, cellFontSize)) / 2,
          y: rowY + (rowHeight - cellFontSize) / 2 + 0.5,
          size: cellFontSize,
          font: fontRegular,
          color: cDark
        });

        const descStr = truncateToWidth(p.name, col2W - 16, fontRegular, cellFontSize);
        page.drawText(descStr, {
          x: tableLeftX + col1W + 12,
          y: rowY + (rowHeight - cellFontSize) / 2 + 0.5,
          size: cellFontSize,
          font: fontRegular,
          color: cDark
        });

        const codeStr = truncateToWidth(p.code, col3W - 10, fontRegular, cellFontSize);
        page.drawText(codeStr, {
          x: tableLeftX + col1W + col2W + (col3W - fontRegular.widthOfTextAtSize(codeStr, cellFontSize)) / 2,
          y: rowY + (rowHeight - cellFontSize) / 2 + 0.5,
          size: cellFontSize,
          font: fontRegular,
          color: cDark
        });
      });

      // Outer table border
      page.drawRectangle({
        x: tableLeftX,
        y: rowY,
        width: tableWidth,
        height: tableStartY - rowY,
        borderColor: cTableBorder,
        borderWidth: 1.0
      });

      // Asterisks ONLY on final page below the last product
      if (isLastPage) {
        const asterisks = '****************';
        const astW = fontRegular.widthOfTextAtSize(asterisks, 8.5);
        page.drawText(asterisks, {
          x: (PAGE_WIDTH - astW) / 2,
          y: rowY - 9,
          size: 8.5,
          font: fontRegular,
          color: cDark
        });
      }
    }

    // 5. QR Code
    const qrSize = 52;
    const qrX = 36;
    const qrY = 46;

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

    // 6. Dynamic Page Numbering: "Page X of Y"
    const pageNoStr = `Page ${pageIdx + 1} of ${totalPages}`;
    const pageNoW = fontOblique.widthOfTextAtSize(pageNoStr, 7.5);
    page.drawText(pageNoStr, {
      x: PAGE_WIDTH - 45 - pageNoW,
      y: 72,
      size: 7.5,
      font: fontOblique,
      color: cSlate
    });

    // 7. Document Metadata Footer
    const footerW = fontRegular.widthOfTextAtSize(scheme.docFooter, 6.2);
    page.drawText(scheme.docFooter, {
      x: (PAGE_WIDTH - footerW) / 2,
      y: 12,
      size: 6.2,
      font: fontRegular,
      color: cMuted
    });
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

/**
 * Builds HTML representation for web previews.
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
        @page { size: A4 portrait; margin: 0; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          width: 210mm;
          height: 297mm;
          margin: 0;
          padding: 0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          position: relative;
          color: #111827;
          background: #ffffff;
        }
        .cert-no-container { text-align: center; margin-top: 180px; }
        .cert-no-label { font-size: 8.5pt; font-weight: 400; color: #0b7c47; }
        .cert-no-value { font-size: 8.5pt; font-weight: 400; color: #111827; }
      </style>
    </head>
    <body>
      <div class="cert-no-container">
        <span class="cert-no-label">Certificate No.:</span>
        <span class="cert-no-value">${certificateNumber}</span>
      </div>
      <div style="text-align: center; margin-top: 20px;">
        <p>${resolvedName}</p>
        <p>${resolvedAddress}</p>
      </div>
    </body>
    </html>
  `;
}
