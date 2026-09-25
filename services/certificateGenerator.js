import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { encryptPDF } from '@pdfsmaller/pdf-encrypt-lite';
import QRCode from 'qrcode';
import { getClientUrl } from '../lib/urls.js';

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
  
  const candidates = [
    path.join(__dirname, '../assets/certificates', basePdfFile),
    path.join(__dirname, '../../', basePdfFile),
    path.join(process.cwd(), 'assets/certificates', basePdfFile),
    path.join(process.cwd(), basePdfFile),
    path.join(process.cwd(), '..', basePdfFile)
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const buffer = fs.readFileSync(p);
      pdfCache.set(basePdfFile, buffer);
      return buffer;
    }
  }

  // Fallback to GSO MEAT.pdf if specific base is not found
  const fallbackPath = path.join(__dirname, '../assets/certificates/GSO MEAT.pdf');
  if (fs.existsSync(fallbackPath)) {
    const buffer = fs.readFileSync(fallbackPath);
    pdfCache.set(basePdfFile, buffer);
    return buffer;
  }

  throw new Error(`Base certificate PDF template not found: ${basePdfFile}. Checked: ${candidates.join(', ')}`);
}

/**
 * Sanitizes strings for pdf-lib standard Helvetica (WinAnsi) encoding.
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
 * Automatically fits text within maxWidth by dynamically scaling font size down to minSize before truncating.
 */
function fitText(text, maxWidth, font, baseSize, minSize = 5.8) {
  if (!text) return { text: '', size: baseSize };
  const str = sanitizeForPdf(text);
  if (!str) return { text: '', size: baseSize };
  try {
    const naturalWidth = font.widthOfTextAtSize(str, baseSize);
    if (naturalWidth <= maxWidth) return { text: str, size: baseSize };
    const scaledSize = Math.max(minSize, (maxWidth / (naturalWidth / baseSize)));
    if (font.widthOfTextAtSize(str, scaledSize) <= maxWidth) {
      return { text: str, size: scaledSize };
    }
    return { text: truncateToWidth(str, maxWidth, font, minSize), size: minSize };
  } catch (e) {
    return { text: str, size: baseSize };
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
 * Formats a Date object or date string into DD-MMM-YYYY (e.g. 13-Sep-2026).
 */
export function formatDate(dateVal) {
  if (!dateVal) return '—';

  // If already in DD-MMM-YYYY format (e.g. 13-Sep-2026)
  if (typeof dateVal === 'string' && /^\d{1,2}-[A-Za-z]{3}-\d{4}$/.test(dateVal.trim())) {
    const parts = dateVal.trim().split('-');
    const day = parts[0].padStart(2, '0');
    const month = parts[1].charAt(0).toUpperCase() + parts[1].slice(1, 3).toLowerCase();
    const year = parts[2];
    return `${day}-${month}-${year}`;
  }

  // If in YYYY-MM-DD or YYYY/MM/DD (e.g. "2026-09-13")
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

  // If in DD/MM/YYYY or DD-MM-YYYY (e.g. "13/09/2026")
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
 * Scheme definitions, base PDFs, declarations, and document control texts.
 * Supporting all 5 official types (6 schemes):
 * - GSO MEAT: base GSO MEAT.pdf, 4 dates, default Option 2 (3 columns: NO., CODE, DESCRIPTION)
 * - GSO NON MEAT: base GSO NON MEAT.pdf, 4 dates, default Option 2 (3 columns: NO., CODE, DESCRIPTION)
 * - HFA SCHEME MEAT: base HFA SCHEME.pdf, 3 dates, default Option 1 (2 columns: NO., NAME OF THE PRODUCTS)
 * - HFA SCHEME NON MEAT: base HFA SCHEME.pdf, 3 dates, default Option 1 (2 columns: NO., NAME OF THE PRODUCTS)
 * - COSMETICS: base COSMETICS.pdf, 3 dates, default Option 1 (2 columns: NO., NAME OF THE PRODUCTS)
 * - SMIIC: base SMIIC.pdf, 3 dates, default Option 1 (2 columns: NO., NAME OF THE PRODUCTS)
 */
export const CERTIFICATE_SCHEMES = {
  'GSO MEAT': {
    name: 'GSO MEAT',
    templateType: 'gso',
    basePdf: 'GSO MEAT.pdf',
    defaultColumns: 2,
    docFooter: 'Doc: Halal Certificate (GSO meat)   Created by: AH   Amended by: TO   Approved by: AM   Version: 16   Date: 28.10.2024',
    declarationLines: [
      'We certify and confirm that the company/manufacturing facility(ies) and the product/s listed',
      'below has/have been successfully evaluated and audited in accordance with HFA Halal',
      'Certification Requirements Manual HFP-1005-20/5, HMP 1105-21/2, and other relevant',
      'standards including SMIIC -1:2011/UAE.S.993/UAE.S.2055-1:2015.'
    ]
  },
  'GSO NON MEAT': {
    name: 'GSO NON MEAT',
    templateType: 'gso',
    basePdf: 'GSO NON MEAT.pdf',
    defaultColumns: 2,
    docFooter: 'Doc: Halal Certificate (GSO non-meat)   Created by: AH   Amended by: TO   Approved by: AM   Version: 16   Date: 28.10.2024',
    declarationLines: [
      'We certify and confirm that the company/manufacturing facility(ies) and the product/s listed',
      'below has/have been successfully evaluated and audited in accordance with HFA Halal',
      'Certification Requirements Manual HFP-1005-20/5 and UAE.S.2055-1:2015.'
    ]
  },
  'HFA SCHEME MEAT': {
    name: 'HFA SCHEME MEAT',
    templateType: 'hfa',
    basePdf: 'HFA SCHEME.pdf',
    defaultColumns: 1,
    docFooter: 'Doc: Halal Certificate (HFA Meat Scheme)   Created by: AH   Amended by: MH   Approved by: AM   Version: 3   Date: 11.10.2022',
    declarationLines: [
      'We certify and confirm that the company/manufacturing facility(ies) and the product/s listed',
      'below has/have been successfully evaluated and audited in accordance with HFA Halal',
      'Certification Requirements Manual HFP-1005-20/5 & HMP-1105-21/2.'
    ]
  },
  'HFA SCHEME NON MEAT': {
    name: 'HFA SCHEME NON MEAT',
    templateType: 'hfa',
    basePdf: 'HFA SCHEME.pdf',
    defaultColumns: 1,
    docFooter: 'Doc: Halal Certificate (HFA non meat Scheme)   Created by: AH   Amended by: MH   Approved by: HI   Version: 9   Date: 11.10.2022',
    declarationLines: [
      'We certify and confirm that the company/manufacturing facility(ies) and the product/s listed',
      'below has/have been successfully evaluated and audited in accordance with HFA Halal',
      'Certification Requirements Manual HFP-1005-20/5.'
    ]
  },
  'COSMETICS': {
    name: 'COSMETICS',
    templateType: 'hfa',
    basePdf: 'COSMETICS.pdf',
    defaultColumns: 1,
    docFooter: 'Doc: Halal Certificate (HFA Cosmetic Scheme)   Created by: MH   Approved by: HI   Version: 2   Date: 11.10.2022',
    declarationLines: [
      'We certify and confirm that the company/manufacturing facility(ies) and the product/s listed',
      'below has/have been successfully evaluated and audited in accordance with OIC/SMIIC 4:2018.'
    ]
  },
  'SMIIC': {
    name: 'SMIIC',
    templateType: 'gso',
    basePdf: 'SMIIC.pdf',
    defaultColumns: 2,
    docFooter: 'Doc: Halal Certificate (SMIIC Scheme)   Created by: MH   Approved by: HI   Version: 2   Date: 11.10.2022',
    declarationLines: [
      'We certify and confirm that the company/manufacturing facility(ies) and the product/s listed',
      'below has/have been successfully evaluated and audited in accordance with GSO 2055-1,',
      'OIC/SMIIC 1 and HFA Halal Certification Requirements Manual HFP-1005-20/5.'
    ]
  }
};

// Compatibility aliases
CERTIFICATE_SCHEMES['GSO meat'] = CERTIFICATE_SCHEMES['GSO MEAT'];
CERTIFICATE_SCHEMES['GSO non-meat'] = CERTIFICATE_SCHEMES['GSO NON MEAT'];
CERTIFICATE_SCHEMES['HFA Scheme (meat)'] = CERTIFICATE_SCHEMES['HFA SCHEME MEAT'];
CERTIFICATE_SCHEMES['HFA Scheme Meat'] = CERTIFICATE_SCHEMES['HFA SCHEME MEAT'];
CERTIFICATE_SCHEMES['HFA Scheme'] = CERTIFICATE_SCHEMES['HFA SCHEME MEAT'];
CERTIFICATE_SCHEMES['HFA SCHEME'] = CERTIFICATE_SCHEMES['HFA SCHEME MEAT'];
CERTIFICATE_SCHEMES['HFA Scheme (non-meat)'] = CERTIFICATE_SCHEMES['HFA SCHEME NON MEAT'];
CERTIFICATE_SCHEMES['HFA Scheme Non-Meat'] = CERTIFICATE_SCHEMES['HFA SCHEME NON MEAT'];
CERTIFICATE_SCHEMES['Cosmetics'] = CERTIFICATE_SCHEMES['COSMETICS'];
CERTIFICATE_SCHEMES['Smiic'] = CERTIFICATE_SCHEMES['SMIIC'];

/**
 * Normalize certificate type to one of the 6 official schemes.
 */
export function normalizeCertificateType(rawType) {
  if (!rawType) return 'GSO MEAT';
  const str = String(rawType).trim().toUpperCase();
  
  if (str === 'COSMETICS' || str.includes('COSMETIC')) return 'COSMETICS';
  if (str === 'SMIIC' || str.includes('SMIIC')) return 'SMIIC';

  // GSO Meat vs Non-Meat
  if (str.includes('GSO')) {
    if (str.includes('NON') || str.includes('FOOD') || str.includes('BAKERY')) {
      return 'GSO NON MEAT';
    }
    return 'GSO MEAT';
  }

  // HFA Scheme Meat vs Non-Meat
  if (str.includes('HFA') || str.includes('SCHEME') || str.includes('STANDARD') || str.includes('ANNUAL')) {
    if (str.includes('NON')) {
      return 'HFA SCHEME NON MEAT';
    }
    if (str.includes('MEAT')) {
      return 'HFA SCHEME MEAT';
    }
    return 'HFA SCHEME MEAT';
  }
  
  return CERTIFICATE_SCHEMES[str] ? str : 'GSO MEAT';
}

/**
 * Generates an official Halal certificate PDF buffer using pdf-lib.
 * 
 * High-fidelity rendering matching official master templates:
 * - Dynamic 5 types & 6 schemes mapped to clean vector backgrounds
 * - Dates: 4 dates for GSO vs 3 dates for Non-GSO
 * - Strict left alignment on valStartX = 186.0 with dividers spanning 45.0 to 550.0 pt
 * - "SAME AS ABOVE" fallback for facility address
 * - Dynamic product table layout: Option 1 (1 col), Option 2 (2 cols), Option 3 (3 cols)
 * 
 * @param {Object} certData - Certificate fields
 * @returns {Promise<Buffer>} PDF Buffer
 */
export async function generateCertificate(certData) {
  const {
    certificateType = 'GSO MEAT',
    certificateNumber = 'HFA-UK-2026-00123',
    businessName = 'Halal Certified Client',
    companyName,
    businessAddress = '—',
    companyAddress,
    manufacturerAddress,
    manufacturingAddress,
    scopeOfCertification,
    scope,
    productCategory,
    issueDate = new Date(),
    expiryDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    certificationStartDate,
    currentCycleStartDate,
    originalCycleStartDate,
    productCategories = [],
    products = [],
    productTableColumns,
    tableLayout,
    product_table_columns,
    table_layout,
    verificationUrl
  } = certData;

  const normalizedScheme = normalizeCertificateType(certificateType || certData.certificate_type);
  const scheme = CERTIFICATE_SCHEMES[normalizedScheme] || CERTIFICATE_SCHEMES['GSO MEAT'];
  const isGso = scheme.templateType === 'gso';

  // Resolve table column count: Option 1 (1 value col), Option 2 (2 value cols), Option 3 (3 value cols)
  const rawColOption = parseInt(productTableColumns || tableLayout || product_table_columns || table_layout, 10);
  const numColumns = (rawColOption >= 1 && rawColOption <= 3) ? rawColOption : scheme.defaultColumns;

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

  const seenProductNames = new Set();
  const allProducts = [];
  if (rawProducts && rawProducts.length > 0) {
    rawProducts.forEach((p, idx) => {
      let code = '';
      let name = '';
      let category = '';
      let description = '';

      if (typeof p === 'string') {
        code = `PRD-${String(idx + 1).padStart(2, '0')}`;
        name = p.trim();
        description = name;
        category = 'Halal Certified';
      } else if (p && typeof p === 'object') {
        code = p.code || p.product_code || p.barcode || `PRD-${String(idx + 1).padStart(2, '0')}`;
        name = (p.name || p.product_name || p.title || p.description || `Product ${idx + 1}`).trim();
        description = (p.description || p.name || p.product_name || `Product ${idx + 1}`).trim();
        category = (p.category || 'Halal Certified').trim();
      } else {
        code = `PRD-${String(idx + 1).padStart(2, '0')}`;
        name = `Product ${idx + 1}`;
        description = name;
        category = 'Halal Certified';
      }

      const key = name.toLowerCase();
      if (name && !seenProductNames.has(key)) {
        seenProductNames.add(key);
        allProducts.push({
          code: sanitizeForPdf(code),
          name: sanitizeForPdf(name),
          description: sanitizeForPdf(description),
          category: sanitizeForPdf(category)
        });
      }
    });
  }
  if (allProducts.length === 0) {
    allProducts.push({
      code: 'PRD-01',
      name: 'Certified Halal Products & Schedule',
      description: 'Certified Halal Products & Schedule',
      category: 'Halal Certified'
    });
  }

  // Pagination capacity:
  // Page 1 fits up to 6 products cleanly above the signatures and below the company info.
  // Subsequent pages fit up to 20 products per page in the dedicated annex container.
  const PAGE1_LIMIT = 6;
  const SUBSEQUENT_PAGE_LIMIT = 20;

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

  // Load clean annex base PDF template for multi-page certificates (Page 2+)
  let annexDoc = null;
  if (totalPages > 1) {
    try {
      const annexBuffer = getBasePdfBuffer('ANNEX_BASE.pdf');
      annexDoc = await PDFDocument.load(annexBuffer, { ignoreEncryption: true });
    } catch (e) {
      try {
        const clonedBase = await PDFDocument.load(basePdfBuffer, { ignoreEncryption: true });
        const p = clonedBase.getPage(0);
        const stream = clonedBase.context.lookup(p.node.Contents());
        if (stream) {
          const u8 = stream.asUint8Array ? stream.asUint8Array() : stream.getContents();
          let decomp = zlib.inflateSync(u8).toString('utf-8');
          const declRegex = /BT[\r\n\s]+(\/P\s*<<[^>]*>>BDC[\r\n\s]+)?\/C2_0\s+1\s+Tf[\r\n\s]+12\s+0\s+0\s+12\s+56\.9698\s+556\.0353\s+Tm[\s\S]*?ET/g;
          decomp = decomp.replace(declRegex, '');
          stream.contents = zlib.deflateSync(Buffer.from(decomp, 'utf-8'));
          const cleanAnnexBuf = await clonedBase.save();
          pdfCache.set('ANNEX_BASE.pdf', Buffer.from(cleanAnnexBuf));
          annexDoc = await PDFDocument.load(cleanAnnexBuf, { ignoreEncryption: true });
        } else {
          annexDoc = baseDoc;
        }
      } catch (err) {
        annexDoc = baseDoc;
      }
    }
  }

  // Create destination multi-page PDF document
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  // Standard Colors
  const cEmerald = rgb(11 / 255, 124 / 255, 71 / 255);       // #0b7c47 Emerald Green
  const cDark = rgb(17 / 255, 24 / 255, 39 / 255);           // #111827 Deep Black/Charcoal
  const cWhite = rgb(1, 1, 1);
  const cTableGrid = rgb(89 / 255, 91 / 255, 97 / 255);      // Subtle slate gray grid stroke [89, 91, 97]
  const cDivider = rgb(124 / 255, 181 / 255, 148 / 255);    // Subtle emerald divider lines #7cb594

  const sanitizedCertNo = sanitizeForPdf(certificateNumber || certData.certificate_number);
  const formattedIssue = formatDate(issueDate || certData.issue_date);
  const formattedExpiry = formatDate(expiryDate || certData.expiry_date);
  const formattedCertStart = formatDate(certificationStartDate || certData.certification_start_date || issueDate || certData.issue_date);
  const formattedCurrentCycle = formatDate(currentCycleStartDate || certData.current_cycle_start_date || issueDate || certData.issue_date);
  const formattedOrigCycle = formatDate(originalCycleStartDate || certData.original_cycle_start_date || issueDate || certData.issue_date);

  const rawCompanyAddr = (
    companyAddress ||
    businessAddress ||
    certData.company_address ||
    certData.companyAddress ||
    certData.registered_address ||
    certData.address ||
    (certData.application_id && certData.application_id.establishment_address) ||
    ''
  ).trim();
  const isCompanyAddrEmpty = !rawCompanyAddr || rawCompanyAddr === '-' || rawCompanyAddr === '—' || rawCompanyAddr.toUpperCase() === 'N/A';
  const resolvedAddress = isCompanyAddrEmpty ? '—' : sanitizeForPdf(rawCompanyAddr.toUpperCase());

  const rawMfg = (
    manufacturingAddress ||
    manufacturerAddress ||
    certData.manufacturing_address ||
    certData.manufacturer_address ||
    certData.manufacturing_facility_address ||
    certData.facility_address ||
    certData.facilityAddress ||
    certData.manufacturingFacility ||
    certData.manufacturing_facility ||
    certData.site_address ||
    (certData.site_id && (certData.site_id.address || certData.site_id.address_1)) ||
    (certData.application_id && (certData.application_id.manufacturer_address || certData.application_id.site_address)) ||
    ''
  ).trim();

  let resolvedMfgAddress = 'SAME AS ABOVE';
  if (rawMfg && rawMfg !== '-' && rawMfg !== '—' && rawMfg.toUpperCase() !== 'N/A') {
    resolvedMfgAddress = sanitizeForPdf(rawMfg.toUpperCase());
  }

  const resolvedName = sanitizeForPdf((companyName || businessName || certData.company_name || 'Halal Certified Client').toUpperCase());
  const resolvedScope = sanitizeForPdf((scope || scopeOfCertification || productCategory || certData.scope || certData.scopeOfCertification || certData.productCategory || 'PRODUCTION AND SUPPLY OF HALAL CERTIFIED PRODUCTS').toUpperCase());

  // Generate QR Code PNG
  const qrUrl = verificationUrl || `${getClientUrl()}/verify/${sanitizedCertNo}`;
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

    // Clone vector base PDF template page (baseDoc for Page 1, clean annexDoc for Page 2+)
    const sourceDoc = (isFirstPage || !annexDoc) ? baseDoc : annexDoc;
    const [page] = await pdfDoc.copyPages(sourceDoc, [0]);
    pdfDoc.addPage(page);

    // 1. Certificate Number (Centered prominently below Halal Certificate header)
    const certNoLabel = 'Certificate No.:';
    const certNoLabelW = fontBold.widthOfTextAtSize(certNoLabel, 8.5);
    const certNoValW = fontBold.widthOfTextAtSize(sanitizedCertNo, 9.5);
    const totalCertNoW = certNoLabelW + 6.0 + certNoValW;
    const certNoStartX = (PAGE_WIDTH - totalCertNoW) / 2;
    const certNoY = isGso ? 633.0 : 635.0;

    page.drawText(certNoLabel, {
      x: certNoStartX,
      y: certNoY,
      size: 8.5,
      font: fontBold,
      color: cEmerald
    });
    page.drawText(sanitizedCertNo, {
      x: certNoStartX + certNoLabelW + 6.0,
      y: certNoY,
      size: 9.5,
      font: fontBold,
      color: cDark
    });

    // 2. Dates Block (Exact coordinates matching layout standard)
    const dateLabelSize = 8.0;
    const dateValSize = 8.5;

    if (!isGso) {
      // Non-GSO (HFA Meat, HFA Non-Meat, Cosmetics, SMIIC): 3 dates
      const dateY = 610.0;
      
      // Date 1: Issue Date
      page.drawText('Issue Date:', { x: 45.0, y: dateY, size: dateLabelSize, font: fontBold, color: cEmerald });
      page.drawText(formattedIssue, { x: 96.0, y: dateY, size: dateValSize, font: fontBold, color: cDark });

      // Date 2: Certification Start Date
      page.drawText('Certification Start Date:', { x: 195.0, y: dateY, size: dateLabelSize, font: fontBold, color: cEmerald });
      page.drawText(formattedCertStart, { x: 300.0, y: dateY, size: dateValSize, font: fontBold, color: cDark });

      // Date 3: Expiry Date
      page.drawText('Expiry Date:', { x: 420.0, y: dateY, size: dateLabelSize, font: fontBold, color: cEmerald });
      page.drawText(formattedExpiry, { x: 476.0, y: dateY, size: dateValSize, font: fontBold, color: cDark });
    } else {
      // GSO (GSO Meat, GSO Non-Meat): 4 dates
      const dateY1 = 611.0;
      const dateY2 = 590.0;

      // Row 1: Issue Date | Current Cycle Start Date | Expiry Date
      page.drawText('Issue Date:', { x: 45.0, y: dateY1, size: dateLabelSize, font: fontBold, color: cEmerald });
      page.drawText(formattedIssue, { x: 96.0, y: dateY1, size: dateValSize, font: fontBold, color: cDark });

      page.drawText('Current Cycle Start Date:', { x: 195.0, y: dateY1, size: dateLabelSize, font: fontBold, color: cEmerald });
      page.drawText(formattedCurrentCycle, { x: 302.0, y: dateY1, size: dateValSize, font: fontBold, color: cDark });

      page.drawText('Expiry Date:', { x: 420.0, y: dateY1, size: dateLabelSize, font: fontBold, color: cEmerald });
      page.drawText(formattedExpiry, { x: 476.0, y: dateY1, size: dateValSize, font: fontBold, color: cDark });

      // Row 2: Original Cycle Start Date
      page.drawText('Original Cycle Start Date:', { x: 195.0, y: dateY2, size: dateLabelSize, font: fontBold, color: cEmerald });
      page.drawText(formattedOrigCycle, { x: 306.0, y: dateY2, size: dateValSize, font: fontBold, color: cDark });
    }

    if (isFirstPage) {
      // 2.5 Scheme Declaration Lines (Centered dynamically between Dates and Company details)
      if (scheme.declarationLines && scheme.declarationLines.length > 0) {
        const declFontSize = 7.9;
        let declY = isGso ? 562.0 : 565.0;
        for (const line of scheme.declarationLines) {
          if (!line.trim()) continue;
          const sanitizedLine = sanitizeForPdf(line);
          const lineW = fontRegular.widthOfTextAtSize(sanitizedLine, declFontSize);
          page.drawText(sanitizedLine, {
            x: (PAGE_WIDTH - lineW) / 2,
            y: declY,
            size: declFontSize,
            font: fontRegular,
            color: cDark
          });
          declY -= 11.5;
        }
      }

      // 3. Company & Category Info Block
      // Strict Left Alignment on valStartX = 186.0 with horizontal dividers spanning 45.0 to 550.0 pt
      const labelStartX = 45.0;
      const valStartX = 186.0;
      const dividerLeftX = 45.0;
      const dividerRightX = 550.0;
      const maxValW = dividerRightX - valStartX; // 364 pt

      const rowLabelSize = 8.5;
      const rowValSize = 9.0;

      // Row 1: COMPANY NAME
      const r1Y = 480.0;
      page.drawText('COMPANY NAME:', { x: labelStartX, y: r1Y, size: rowLabelSize, font: fontBold, color: cDark });
      const nameLines = wrapTextLines(resolvedName, maxValW, fontBold, rowValSize, 1);
      page.drawText(nameLines[0] || '—', { x: valStartX, y: r1Y, size: rowValSize, font: fontBold, color: cDark });
      page.drawLine({
        start: { x: dividerLeftX, y: 468.0 },
        end: { x: dividerRightX, y: 468.0 },
        thickness: 0.5,
        color: cDivider
      });

      // Row 2: COMPANY ADDRESS
      const r2Y = 450.0;
      page.drawText('COMPANY ADDRESS:', { x: labelStartX, y: r2Y, size: rowLabelSize, font: fontBold, color: cDark });
      const addrLines = wrapTextLines(resolvedAddress, maxValW, fontBold, rowValSize, 2);
      if (addrLines.length > 1) {
        page.drawText(addrLines[0], { x: valStartX, y: r2Y, size: rowValSize, font: fontBold, color: cDark });
        page.drawText(addrLines[1], { x: valStartX, y: r2Y - 12.0, size: rowValSize, font: fontBold, color: cDark });
      } else {
        page.drawText(addrLines[0], { x: valStartX, y: r2Y, size: rowValSize, font: fontBold, color: cDark });
      }
      page.drawLine({
        start: { x: dividerLeftX, y: 428.0 },
        end: { x: dividerRightX, y: 428.0 },
        thickness: 0.5,
        color: cDivider
      });

      // Row 3: MANUFACTURING FACILITY(IES) ADDRESS (IF DIFFERENT):
      page.drawText('MANUFACTURING FACILITY(IES)', { x: labelStartX, y: 412.0, size: 7.8, font: fontBold, color: cDark });
      page.drawText('ADDRESS (IF DIFFERENT):', { x: labelStartX, y: 401.0, size: 7.8, font: fontBold, color: cDark });
      const mfgLines = wrapTextLines(resolvedMfgAddress, maxValW, fontBold, rowValSize, 2);
      if (mfgLines.length > 1) {
        page.drawText(mfgLines[0], { x: valStartX, y: 410.0, size: rowValSize, font: fontBold, color: cDark });
        page.drawText(mfgLines[1], { x: valStartX, y: 398.0, size: rowValSize, font: fontBold, color: cDark });
      } else {
        page.drawText(mfgLines[0], { x: valStartX, y: 406.0, size: rowValSize, font: fontBold, color: cDark });
      }
      page.drawLine({
        start: { x: dividerLeftX, y: 388.0 },
        end: { x: dividerRightX, y: 388.0 },
        thickness: 0.5,
        color: cDivider
      });

      // Row 4: PRODUCT CATEGORY
      const r4Y = 368.0;
      page.drawText('PRODUCT CATEGORY:', { x: labelStartX, y: r4Y, size: rowLabelSize, font: fontBold, color: cDark });
      const scopeLines = wrapTextLines(resolvedScope, maxValW, fontBold, rowValSize, 2);
      if (scopeLines.length > 1) {
        page.drawText(scopeLines[0], { x: valStartX, y: r4Y, size: rowValSize, font: fontBold, color: cDark });
        page.drawText(scopeLines[1], { x: valStartX, y: r4Y - 11.0, size: rowValSize, font: fontBold, color: cDark });
      } else {
        page.drawText(scopeLines[0] || '—', { x: valStartX, y: r4Y, size: rowValSize, font: fontBold, color: cDark });
      }
      page.drawLine({
        start: { x: dividerLeftX, y: 350.0 },
        end: { x: dividerRightX, y: 350.0 },
        thickness: 0.5,
        color: cDivider
      });
    }

    // 4. Products Table Layout (Dynamic 1, 2, or 3 columns)
    const tableLeftX = 45.0;
    const tableWidth = 505.0;
    const headerHeight = 18.0;
    const rowHeight = 18.0;

    let headerBottomY = isFirstPage ? 326.0 : 511.0;

    if (!isFirstPage) {
      // Continuation Annex Header for subsequent pages
      const annexTitle = 'SCHEDULE OF CERTIFIED PRODUCTS (ANNEX)';
      const annexTitleW = fontBold.widthOfTextAtSize(annexTitle, 10.5);
      page.drawText(annexTitle, {
        x: (PAGE_WIDTH - annexTitleW) / 2,
        y: 556,
        size: 10.5,
        font: fontBold,
        color: cEmerald
      });

      const annexSub = `Certificate No: ${sanitizedCertNo}   |   ${resolvedName}`;
      const annexSubW = fontRegular.widthOfTextAtSize(annexSub, 9.0);
      page.drawText(annexSub, {
        x: (PAGE_WIDTH - annexSubW) / 2,
        y: 542,
        size: 9.0,
        font: fontRegular,
        color: cDark
      });
    }

    // Column definitions based on chosen option:
    // Option 1: NO. (60pt), NAME OF THE PRODUCTS (445pt)
    // Option 2: NO. (50pt), CODE (125pt), DESCRIPTION (330pt)
    // Option 3: NO. (50pt), CODE (100pt), DESCRIPTION (230pt), CATEGORY (125pt)
    let colDefs = [];
    if (numColumns === 1) {
      colDefs = [
        { header: 'NO.', width: 60.0, align: 'center', pad: 0 },
        { header: 'NAME OF THE PRODUCTS', width: 445.0, align: 'left', pad: 10.0 }
      ];
    } else if (numColumns === 3) {
      colDefs = [
        { header: 'NO.', width: 50.0, align: 'center', pad: 0 },
        { header: 'CODE', width: 100.0, align: 'left', pad: 8.0 },
        { header: 'DESCRIPTION', width: 230.0, align: 'left', pad: 8.0 },
        { header: 'CATEGORY', width: 125.0, align: 'left', pad: 8.0 }
      ];
    } else {
      // Default: Option 2 (Two value columns)
      colDefs = [
        { header: 'NO.', width: 50.0, align: 'center', pad: 0 },
        { header: 'CODE', width: 125.0, align: 'left', pad: 8.0 },
        { header: 'DESCRIPTION', width: 330.0, align: 'left', pad: 8.0 }
      ];
    }

    // Draw Table Header Background (Emerald Green)
    page.drawRectangle({
      x: tableLeftX,
      y: headerBottomY,
      width: tableWidth,
      height: headerHeight,
      color: cEmerald
    });

    // Draw Table Header Texts & Vertical Column Dividers
    const hFontSize = 9.0;
    const headerTextY = headerBottomY + (headerHeight - hFontSize) / 2 + 1.0;
    let colXCursor = tableLeftX;

    colDefs.forEach((col, cIdx) => {
      if (col.align === 'center') {
        const textW = fontBold.widthOfTextAtSize(col.header, hFontSize);
        page.drawText(col.header, {
          x: colXCursor + (col.width - textW) / 2,
          y: headerTextY,
          size: hFontSize,
          font: fontBold,
          color: cWhite
        });
      } else {
        page.drawText(col.header, {
          x: colXCursor + col.pad,
          y: headerTextY,
          size: hFontSize,
          font: fontBold,
          color: cWhite
        });
      }

      // Header vertical white divider (except after last column)
      if (cIdx < colDefs.length - 1) {
        const divX = colXCursor + col.width;
        page.drawLine({
          start: { x: divX, y: headerBottomY },
          end: { x: divX, y: headerBottomY + headerHeight },
          thickness: 0.75,
          color: cWhite
        });
      }

      colXCursor += col.width;
    });

    // Draw Table Rows
    const cellFontSize = 9.0;
    let curRowY = headerBottomY;

    currentProducts.forEach((p) => {
      globalProductIndex++;
      curRowY -= rowHeight;

      // Horizontal bottom divider
      page.drawLine({
        start: { x: tableLeftX, y: curRowY },
        end: { x: tableLeftX + tableWidth, y: curRowY },
        thickness: 0.5,
        color: cTableGrid
      });

      let rowXCursor = tableLeftX;
      colDefs.forEach((col, cIdx) => {
        // Vertical divider between columns
        if (cIdx < colDefs.length - 1) {
          const divX = rowXCursor + col.width;
          page.drawLine({
            start: { x: divX, y: curRowY },
            end: { x: divX, y: curRowY + rowHeight },
            thickness: 0.5,
            color: cTableGrid
          });
        }

        // Cell content rendering based on active option
        if (cIdx === 0) {
          // NO. column (centered bold)
          const noStr = String(globalProductIndex);
          const noW = fontBold.widthOfTextAtSize(noStr, cellFontSize);
          page.drawText(noStr, {
            x: rowXCursor + (col.width - noW) / 2,
            y: curRowY + (rowHeight - cellFontSize) / 2 + 1.0,
            size: cellFontSize,
            font: fontBold,
            color: cDark
          });
        } else if (numColumns === 1) {
          // Option 1: NAME OF THE PRODUCTS
          const nameFit = fitText(p.name, col.width - 20.0, fontRegular, cellFontSize);
          page.drawText(nameFit.text, {
            x: rowXCursor + col.pad,
            y: curRowY + (rowHeight - nameFit.size) / 2 + 1.0,
            size: nameFit.size,
            font: fontRegular,
            color: cDark
          });
        } else if (numColumns === 2) {
          // Option 2: CODE | DESCRIPTION
          if (cIdx === 1) {
            const codeFit = fitText(p.code, col.width - 16.0, fontBold, cellFontSize);
            page.drawText(codeFit.text, {
              x: rowXCursor + col.pad,
              y: curRowY + (rowHeight - codeFit.size) / 2 + 1.0,
              size: codeFit.size,
              font: fontBold,
              color: cDark
            });
          } else if (cIdx === 2) {
            const descVal = p.description || p.name;
            const descFit = fitText(descVal, col.width - 16.0, fontRegular, cellFontSize);
            page.drawText(descFit.text, {
              x: rowXCursor + col.pad,
              y: curRowY + (rowHeight - descFit.size) / 2 + 1.0,
              size: descFit.size,
              font: fontRegular,
              color: cDark
            });
          }
        } else if (numColumns === 3) {
          // Option 3: CODE | DESCRIPTION | CATEGORY
          if (cIdx === 1) {
            const codeFit = fitText(p.code, col.width - 16.0, fontBold, cellFontSize);
            page.drawText(codeFit.text, {
              x: rowXCursor + col.pad,
              y: curRowY + (rowHeight - codeFit.size) / 2 + 1.0,
              size: codeFit.size,
              font: fontBold,
              color: cDark
            });
          } else if (cIdx === 2) {
            const descVal = p.description || p.name;
            const descFit = fitText(descVal, col.width - 16.0, fontRegular, cellFontSize);
            page.drawText(descFit.text, {
              x: rowXCursor + col.pad,
              y: curRowY + (rowHeight - descFit.size) / 2 + 1.0,
              size: descFit.size,
              font: fontRegular,
              color: cDark
            });
          } else if (cIdx === 3) {
            const catFit = fitText(p.category || 'Halal Certified', col.width - 16.0, fontRegular, cellFontSize);
            page.drawText(catFit.text, {
              x: rowXCursor + col.pad,
              y: curRowY + (rowHeight - catFit.size) / 2 + 1.0,
              size: catFit.size,
              font: fontRegular,
              color: cDark
            });
          }
        }

        rowXCursor += col.width;
      });
    });

    // Outer table border (covering entire table including header)
    page.drawRectangle({
      x: tableLeftX,
      y: curRowY,
      width: tableWidth,
      height: (headerBottomY + headerHeight) - curRowY,
      borderColor: cEmerald,
      borderWidth: 0.85
    });

    // Centered Asterisks directly below table on final page
    if (isLastPage) {
      const asterisks = '********************';
      const astW = fontBold.widthOfTextAtSize(asterisks, 9.0);
      page.drawText(asterisks, {
        x: (PAGE_WIDTH - astW) / 2,
        y: curRowY - 10.0,
        size: 9.0,
        font: fontBold,
        color: cDark
      });
    }

    // 5. Dynamic QR Code (Bottom Left)
    const qrSize = 52;
    page.drawRectangle({
      x: 34,
      y: 44,
      width: qrSize + 4,
      height: qrSize + 4,
      color: cWhite
    });
    page.drawImage(qrImage, {
      x: 36,
      y: 46,
      width: qrSize,
      height: qrSize
    });

    // 6. Dynamic Page Numbering: "Page X of Y"
    const pageNoStr = `Page ${pageIdx + 1} of ${totalPages}`;
    page.drawText(pageNoStr, {
      x: 509,
      y: 68.5,
      size: 8.5,
      font: fontOblique,
      color: cDark
    });

    // 7. Controlled Document Footer (Centered at bottom)
    if (scheme.docFooter) {
      const footerText = sanitizeForPdf(scheme.docFooter);
      const footerW = fontRegular.widthOfTextAtSize(footerText, 6.5);
      page.drawText(footerText, {
        x: (PAGE_WIDTH - footerW) / 2,
        y: 18.0,
        size: 6.5,
        font: fontRegular,
        color: cDark
      });
    }
  }

  const pdfBytes = await pdfDoc.save();

  // Apply Permissions / Owner Password protection to lock document against unauthorized editing
  const ownerPassword = process.env.CERTIFICATE_OWNER_PASSWORD || '@Muhayad2000';
  if (ownerPassword) {
    try {
      const encryptedBytes = await encryptPDF(pdfBytes, '', {
        ownerPassword,
        allowPrinting: true,
        allowModifying: false,
        allowCopying: false,
        allowAnnotating: false,
        allowFillingForms: false
      });
      return Buffer.from(encryptedBytes);
    } catch (encErr) {
      console.error('[CertificateGenerator] Failed to apply permissions password:', encErr?.message || encErr);
      return Buffer.from(pdfBytes);
    }
  }

  return Buffer.from(pdfBytes);
}

/**
 * Builds HTML representation for web previews matching the exact official template.
 */
export async function buildCertificateHtml(certData) {
  const {
    certificateType = 'GSO MEAT',
    certificateNumber = 'HFA-UK-2026-00123',
    businessName = 'Halal Certified Client',
    companyName,
    businessAddress = '—',
    companyAddress,
    manufacturerAddress,
    manufacturingAddress,
    scopeOfCertification,
    scope,
    productCategory,
    issueDate = new Date(),
    expiryDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    certificationStartDate,
    currentCycleStartDate,
    originalCycleStartDate,
    productCategories = [],
    products = [],
    productTableColumns,
    tableLayout,
    product_table_columns,
    table_layout,
    verificationUrl
  } = certData;

  const rawCompanyAddr = (
    companyAddress ||
    businessAddress ||
    certData.company_address ||
    certData.companyAddress ||
    certData.registered_address ||
    certData.address ||
    ''
  ).trim();
  const isCompanyAddrEmpty = !rawCompanyAddr || rawCompanyAddr === '-' || rawCompanyAddr === '—' || rawCompanyAddr.toUpperCase() === 'N/A';
  const resolvedAddress = isCompanyAddrEmpty ? '—' : rawCompanyAddr.toUpperCase();

  const rawMfg = (
    manufacturingAddress ||
    manufacturerAddress ||
    certData.manufacturing_address ||
    certData.manufacturer_address ||
    certData.manufacturing_facility_address ||
    certData.facility_address ||
    certData.facilityAddress ||
    certData.manufacturingFacility ||
    certData.manufacturing_facility ||
    certData.site_address ||
    ''
  ).trim();

  let resolvedMfgAddress = 'SAME AS ABOVE';
  if (rawMfg && rawMfg !== '-' && rawMfg !== '—' && rawMfg.toUpperCase() !== 'N/A') {
    resolvedMfgAddress = rawMfg.toUpperCase();
  }

  const resolvedName = (companyName || businessName || certData.company_name || 'Halal Certified Client').toUpperCase();
  const resolvedScope = (scope || scopeOfCertification || productCategory || certData.scope || certData.scopeOfCertification || certData.productCategory || 'PRODUCTION AND SUPPLY OF HALAL CERTIFIED PRODUCTS').toUpperCase();

  const normalizedScheme = normalizeCertificateType(certificateType || certData.certificate_type);
  const scheme = CERTIFICATE_SCHEMES[normalizedScheme] || CERTIFICATE_SCHEMES['GSO MEAT'];
  const isGso = scheme.templateType === 'gso';

  // Resolve table column count: Option 1 (1 col), Option 2 (2 cols), Option 3 (3 cols)
  const rawColOption = parseInt(productTableColumns || tableLayout || product_table_columns || table_layout, 10);
  const numColumns = (rawColOption >= 1 && rawColOption <= 3) ? rawColOption : scheme.defaultColumns;

 
  const qrUrl = verificationUrl || `${getClientUrl()}/verify/${certificateNumber}`;
  const qrBase64 = await QRCode.toDataURL(qrUrl, { margin: 0, width: 250 });

  const formattedIssue = formatDate(issueDate);
  const formattedExpiry = formatDate(expiryDate);
  const formattedCertStart = formatDate(certificationStartDate || issueDate);
  const formattedCurrentCycle = formatDate(currentCycleStartDate || issueDate);
  const formattedOrigCycle = formatDate(originalCycleStartDate || issueDate);

  const rawProducts = (products && products.length > 0) ? products : productCategories;
  const productList = (rawProducts && rawProducts.length > 0)
    ? rawProducts.map((p, idx) => {
        if (typeof p === 'string') {
          return {
            code: `PRD-${String(idx + 1).padStart(2, '0')}`,
            name: p,
            description: p,
            category: 'Halal Certified'
          };
        }
        return {
          code: p.code || p.product_code || p.barcode || `PRD-${String(idx + 1).padStart(2, '0')}`,
          name: p.name || p.product_name || p.description || `Product ${idx + 1}`,
          description: p.description || p.name || p.product_name || `Product ${idx + 1}`,
          category: p.category || 'Halal Certified'
        };
      })
    : [{ code: 'PRD-01', name: 'Certified Halal Products', description: 'Certified Halal Products', category: 'Halal Certified' }];

  const declarationText = scheme.declarationLines.join(' ');

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
          min-height: 297mm;
          margin: 0 auto;
          padding: 24mm 16mm;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          color: #111827;
          background: #ffffff;
          position: relative;
        }
        .cert-header { text-align: center; margin-bottom: 12px; }
        .cert-title { font-size: 20pt; font-weight: 700; color: #0b7c47; margin-top: 6px; }
        .cert-no { font-size: 8.5pt; margin-top: 4px; }
        .cert-no-label { color: #0b7c47; font-weight: 700; }
        .dates-row { display: flex; justify-content: space-between; font-size: 8pt; margin-top: 8px; }
        .dates-row-center { text-align: center; font-size: 8pt; margin-top: 4px; }
        .date-label { color: #0b7c47; font-weight: 700; }
        .declaration { font-size: 8.2pt; text-align: center; margin: 16px 0; line-height: 1.4; color: #111827; }
        .info-table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 16px; font-size: 9.5pt; }
        .info-table tr { border-bottom: 1px solid #7cb594; }
        .info-table td { padding: 6px 0; border-bottom: 1px solid #7cb594; vertical-align: top; line-height: 1.4; box-sizing: border-box; }
        .info-label { width: 280px; min-width: 280px; max-width: 280px; color: #111827; vertical-align: top; font-weight: 700; text-align: left; padding: 6px 14px 6px 0; margin: 0; box-sizing: border-box; }
        .info-val { color: #111827; font-weight: 700; vertical-align: top; text-align: left; word-break: break-word; padding: 6px 0; margin: 0; box-sizing: border-box; }
        .products-table-container { display: flex; justify-content: center; margin-top: 10px; width: 100%; }
        .products-table { width: 100%; border-collapse: collapse; border: 1px solid #0b7c47; font-size: 9pt; background: transparent; }
        .products-table th { background: #0b7c47; color: #ffffff; padding: 7px 8px; font-weight: 700; border: 1px solid #0b7c47; }
        .products-table td { padding: 6px 8px; border: 1px solid #4b5563; color: #111827; background: transparent; }
        .asterisks { text-align: center; margin: 10px 0; font-size: 9.5pt; font-weight: 700; letter-spacing: 2px; }
        .footer-signatures { display: flex; justify-content: space-between; margin-top: 24px; font-size: 8.5pt; }
        .footer-meta { display: flex; align-items: center; margin-top: 20px; font-size: 7.5pt; border-top: 1px solid #7cb594; padding-top: 8px; }
        .footer-qr { width: 52px; height: 52px; margin-right: 12px; }
        .footer-text { flex: 1; text-align: center; }
        .doc-control { text-align: center; font-size: 6.5pt; color: #64748b; margin-top: 10px; }
      </style>
    </head>
    <body>
      <div class="cert-header">
        <div class="cert-title">Halal Certificate</div>
        <div class="cert-no">
          <span class="cert-no-label">Certificate No.:</span>
          <strong>${certificateNumber}</strong>
        </div>
      </div>

      <div class="dates-row">
        <div><span class="date-label">Issue Date:</span> ${formattedIssue}</div>
        <div><span class="date-label">${isGso ? 'Current Cycle Start Date:' : 'Certification Start Date:'}</span> ${isGso ? formattedCurrentCycle : formattedCertStart}</div>
        <div><span class="date-label">Expiry Date:</span> ${formattedExpiry}</div>
      </div>
      ${isGso ? `<div class="dates-row-center"><span class="date-label">Original Cycle Start Date:</span> ${formattedOrigCycle}</div>` : ''}

      <div class="declaration">
        ${declarationText}
      </div>

      <table class="info-table">
        <colgroup>
          <col style="width: 280px; min-width: 280px; max-width: 280px;" />
          <col style="width: auto;" />
        </colgroup>
        <tbody>
          <tr>
            <td class="info-label">COMPANY NAME:</td>
            <td class="info-val">${resolvedName}</td>
          </tr>
          <tr>
            <td class="info-label">COMPANY ADDRESS:</td>
            <td class="info-val">${resolvedAddress}</td>
          </tr>
          <tr>
            <td class="info-label">MANUFACTURING FACILITY(IES)<br>ADDRESS (IF DIFFERENT):</td>
            <td class="info-val">${resolvedMfgAddress}</td>
          </tr>
          <tr>
            <td class="info-label">PRODUCT CATEGORY:</td>
            <td class="info-val">${resolvedScope}</td>
          </tr>
        </tbody>
      </table>

      <div class="products-table-container">
        <table class="products-table">
          <thead>
            <tr>
              ${numColumns === 1 ? `
                <th style="width: 15%; text-align: center;">NO.</th>
                <th style="width: 85%; text-align: left; padding-left: 10px;">NAME OF THE PRODUCTS</th>
              ` : numColumns === 3 ? `
                <th style="width: 10%; text-align: center;">NO.</th>
                <th style="width: 20%; text-align: left; padding-left: 8px;">CODE</th>
                <th style="width: 45%; text-align: left; padding-left: 8px;">DESCRIPTION</th>
                <th style="width: 25%; text-align: left; padding-left: 8px;">CATEGORY</th>
              ` : `
                <th style="width: 10%; text-align: center;">NO.</th>
                <th style="width: 25%; text-align: left; padding-left: 8px;">CODE</th>
                <th style="width: 65%; text-align: left; padding-left: 8px;">DESCRIPTION</th>
              `}
            </tr>
          </thead>
          <tbody>
            ${productList.map((p, idx) => `
              <tr>
                <td style="text-align: center; font-weight: 700;">${idx + 1}</td>
                ${numColumns === 1 ? `
                  <td style="text-align: left; padding-left: 10px;">${p.name}</td>
                ` : numColumns === 3 ? `
                  <td style="text-align: left; padding-left: 8px; font-weight: 700;">${p.code}</td>
                  <td style="text-align: left; padding-left: 8px;">${p.description || p.name}</td>
                  <td style="text-align: left; padding-left: 8px;">${p.category || 'Halal Certified'}</td>
                ` : `
                  <td style="text-align: left; padding-left: 8px; font-weight: 700;">${p.code}</td>
                  <td style="text-align: left; padding-left: 8px;">${p.description || p.name}</td>
                `}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div class="asterisks">********************</div>

      <div class="footer-signatures">
        <div style="text-align: left;">
          <div style="color: #0b7c47; font-weight: 700;">Dr Amir Masoom</div>
          <div>CEO</div>
        </div>
        <div style="text-align: right;">
          <div style="color: #0b7c47; font-weight: 700;">Mufti Abdulkadir Barkatulla</div>
          <div>Head of Islamic Scholars' Board</div>
        </div>
      </div>

      <div class="footer-meta">
        <img src="${qrBase64}" class="footer-qr" alt="QR Code" />
        <div class="footer-text">
          <div>Halal Food Authority Ltd. Company Registration Number: 6273989. VAT Number: 912380938</div>
          <div>Address: Unit 15, Linen House, 253 Kilburn Lane, Queen's Park, London W10 4BQ</div>
          <div>Telephone: +44 (0) 208 4467 127 Email: info@halalfoodauthority.com</div>
          <div style="font-weight: 700; margin-top: 4px;">TO VERIFY THE CONTENTS OF THIS DOCUMENT, PLEASE SCAN THE QR CODE</div>
        </div>
      </div>
      <div class="doc-control">${scheme.docFooter}</div>
    </body>
    </html>
  `;
}

export const generateHtmlCertificate = buildCertificateHtml;
