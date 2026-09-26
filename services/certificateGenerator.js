import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { encryptPDF } from '@pdfsmaller/pdf-encrypt-lite';
import QRCode from 'qrcode';
import { getClientUrl, getBackendUrl, resolveCertificateUrl } from '../lib/urls.js';

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
  if (!text) return [];
  const sanitized = sanitizeForPdf(text);
  if (!sanitized) return [];
  const words = sanitized.split(/\s+/);
  const lines = [];
  let currentLine = '';

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    try {
      if (font.widthOfTextAtSize(testLine, size) <= maxWidth) {
        currentLine = testLine;
      } else {
        if (currentLine) lines.push(currentLine);
        if (lines.length === maxLines - 1) {
          const remainingWords = words.slice(i).join(' ');
          lines.push(truncateToWidth(remainingWords, maxWidth, font, size));
          currentLine = '';
          break;
        }
        currentLine = word;
      }
    } catch (e) {
      currentLine = word;
    }
  }
  if (currentLine && lines.length < maxLines) {
    lines.push(truncateToWidth(currentLine, maxWidth, font, size));
  }
  return lines;
}

/**
 * Dynamically computes optimal table column widths based on the actual length
 * of product codes, descriptions/names, and categories across all products in the certificate.
 * Adjusts each column tightly to where the text finishes, and ensures the table is centralized.
 * Maximum table width is 505.0 pt.
 */
function computeProductTableColumns(products, numColumns, fontBold, fontRegular) {
  const MAX_TABLE_WIDTH = 505.0;
  const list = Array.isArray(products) && products.length > 0
    ? products
    : [{ name: 'Certified Halal Products' }];

  // 1. Measure NO. column text width
  const maxIdxStr = String(list.length);
  let maxNoTextW = 18.0;
  if (fontBold) {
    try {
      const hW = fontBold.widthOfTextAtSize('NO.', 9.0);
      const valW = fontBold.widthOfTextAtSize(maxIdxStr, 9.0);
      maxNoTextW = Math.max(hW, valW);
    } catch (e) {}
  }
  const noColWidth = Math.max(38.0, Math.ceil(maxNoTextW + 16.0));

  if (numColumns === 1) {
    // Option 1: NO. | NAME OF THE PRODUCTS
    // Balanced centered width: not edge-to-edge 505pt, but dynamically fitted to content (~280pt to 460pt)
    let maxNameTextW = 120.0;
    if (fontRegular) {
      try {
        const hW = fontBold ? fontBold.widthOfTextAtSize('NAME OF THE PRODUCTS', 9.0) : 120.0;
        maxNameTextW = hW;
        for (const p of list) {
          const str = sanitizeForPdf(p.name || '');
          if (str) {
            const w = fontRegular.widthOfTextAtSize(str, 9.0);
            if (w > maxNameTextW) maxNameTextW = w;
          }
        }
      } catch (e) {}
    }
    const nameColWidth = Math.min(
      MAX_TABLE_WIDTH - noColWidth,
      Math.max(260.0, Math.ceil(maxNameTextW + 40.0))
    );
    return [
      { header: 'NO.', width: noColWidth, align: 'center', pad: 0 },
      { header: 'NAME OF THE PRODUCTS', width: nameColWidth, align: 'left', pad: 10.0 }
    ];
  }

  // Measure max width of CODE across all products
  let maxCodeTextW = 28.0;
  try {
    if (fontBold) {
      maxCodeTextW = fontBold.widthOfTextAtSize('CODE', 9.0);
      for (const p of list) {
        const codeStr = sanitizeForPdf(p.code || '');
        if (codeStr) {
          const w = fontBold.widthOfTextAtSize(codeStr, 9.0);
          if (w > maxCodeTextW) maxCodeTextW = w;
        }
      }
    }
  } catch (e) {}
  const neededCodeW = Math.max(65.0, Math.min(120.0, Math.ceil(maxCodeTextW + 20.0)));

  // Measure max width of DESCRIPTION across all products
  let maxDescTextW = 60.0;
  try {
    if (fontRegular) {
      maxDescTextW = fontRegular.widthOfTextAtSize('DESCRIPTION', 9.0);
      for (const p of list) {
        const descStr = sanitizeForPdf(p.description || p.name || '');
        if (descStr) {
          const w = fontRegular.widthOfTextAtSize(descStr, 9.0);
          if (w > maxDescTextW) maxDescTextW = w;
        }
      }
    }
  } catch (e) {}

  if (numColumns === 2) {
    // Option 2: NO. | CODE | DESCRIPTION
    // Balanced centered width (~300pt to 480pt)
    const codeColWidth = neededCodeW;
    const maxAvailableDesc = MAX_TABLE_WIDTH - noColWidth - codeColWidth;
    const neededDescW = Math.max(200.0, Math.ceil(maxDescTextW + 30.0));
    const descColWidth = Math.min(maxAvailableDesc, neededDescW);

    return [
      { header: 'NO.', width: noColWidth, align: 'center', pad: 0 },
      { header: 'CODE', width: codeColWidth, align: 'left', pad: 8.0 },
      { header: 'DESCRIPTION', width: descColWidth, align: 'left', pad: 8.0 }
    ];
  }

  // Option 3: NO. | CODE | DESCRIPTION | CATEGORY
  let maxCatTextW = 52.0;
  try {
    if (fontRegular) {
      maxCatTextW = fontRegular.widthOfTextAtSize('CATEGORY', 9.0);
      for (const p of list) {
        const catStr = sanitizeForPdf(p.category || 'Halal Certified');
        if (catStr) {
          const w = fontRegular.widthOfTextAtSize(catStr, 9.0);
          if (w > maxCatTextW) maxCatTextW = w;
        }
      }
    }
  } catch (e) {}

  const codeColWidth = neededCodeW;
  const availableForDescAndCat = MAX_TABLE_WIDTH - noColWidth - codeColWidth;

  const minDescW = 95.0;
  const minCatW = 110.0;
  const neededDesc = Math.max(minDescW, Math.ceil(maxDescTextW + 20.0));
  const neededCat = Math.max(minCatW, Math.ceil(maxCatTextW + 20.0));

  let descColWidth;
  let catColWidth;

  if (neededDesc + neededCat <= availableForDescAndCat) {
    descColWidth = neededDesc;
    catColWidth = neededCat;
    const extra = availableForDescAndCat - (descColWidth + catColWidth);
    if (neededCat > 160.0) {
      const bonus = Math.min(extra, Math.ceil(neededCat * 0.15) + 15.0);
      catColWidth += bonus;
    } else if (extra > 0) {
      descColWidth += Math.round(extra * 0.4);
      catColWidth += Math.round(extra * 0.6);
    }
  } else {
    const totalNeeded = neededDesc + neededCat;
    descColWidth = Math.max(minDescW, Math.round(availableForDescAndCat * (neededDesc / totalNeeded)));
    catColWidth = availableForDescAndCat - descColWidth;
    if (neededCat > neededDesc && catColWidth < 220.0 && availableForDescAndCat >= 310.0) {
      catColWidth = Math.min(neededCat, availableForDescAndCat - minDescW);
      descColWidth = availableForDescAndCat - catColWidth;
    }
  }

  return [
    { header: 'NO.', width: noColWidth, align: 'center', pad: 0 },
    { header: 'CODE', width: codeColWidth, align: 'left', pad: 8.0 },
    { header: 'DESCRIPTION', width: descColWidth, align: 'left', pad: 8.0 },
    { header: 'CATEGORY', width: catColWidth, align: 'left', pad: 8.0 }
  ];
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
    basePdf: 'GSO NON MEAT.pdf',
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
    certificateNumber = '',
    businessName = '',
    companyName,
    businessAddress = '',
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

      const key = `${code.toLowerCase()}___${name.toLowerCase()}`;
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

  // Page 1 has company info, declaration & dates. Fits exactly up to 5 products with generous breathing room above signatures.
  // Subsequent pages fit up to 15 products per page cleanly above seals and signatures.
  const PAGE1_LIMIT = 5;
  const SUBSEQUENT_PAGE_LIMIT = 15;

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
  pdfDoc.registerFontkit(fontkit);

  // Load Arial font
  const fontCandidates = [
    path.join(__dirname, '../assets/fonts/arial.ttf'),
    path.join(process.cwd(), 'assets/fonts/arial.ttf'),
    path.join(process.cwd(), 'backend/assets/fonts/arial.ttf'),
    'C:/Windows/Fonts/arial.ttf',
    '/usr/share/fonts/truetype/msttcorefonts/arial.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'
  ];
  let fontRegular;
  for (const p of fontCandidates) {
    if (fs.existsSync(p)) {
      try {
        const arialBytes = fs.readFileSync(p);
        fontRegular = await pdfDoc.embedFont(arialBytes);
        break;
      } catch (err) {
        console.warn(`[CertificateGenerator] Could not embed Arial font from ${p}:`, err.message);
      }
    }
  }
  if (!fontRegular) {
    fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  }

  // Remove bold: fontBold points to regular Arial font so all text is regular (not bold)
  const fontBold = fontRegular;
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
  const resolvedAddress = isCompanyAddrEmpty ? '' : sanitizeForPdf(rawCompanyAddr.toUpperCase());

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

  let resolvedMfgAddress = '';
  if (rawMfg && rawMfg !== '-' && rawMfg !== '—' && rawMfg.toUpperCase() !== 'N/A') {
    resolvedMfgAddress = sanitizeForPdf(rawMfg.toUpperCase());
  }

  const rawName = (companyName || businessName || certData.company_name || '').trim();
  const isNameEmpty = !rawName || rawName === '-' || rawName === '—' || rawName.toUpperCase() === 'N/A';
  const resolvedName = isNameEmpty ? '' : sanitizeForPdf(rawName.toUpperCase());

  const rawScope = (scope || scopeOfCertification || productCategory || certData.scope || certData.scopeOfCertification || certData.productCategory || '').trim();
  const isScopeEmpty = !rawScope || rawScope === '-' || rawScope === '—' || rawScope.toUpperCase() === 'N/A';
  const resolvedScope = isScopeEmpty ? '' : sanitizeForPdf(rawScope.toUpperCase());

  // Generate QR Code PNG pointing directly to the certificate URL
  const certUrlCandidate = certData.certificate_url || certData.certificateUrl || certData.certificateFileUrl || certData.pdfUrl || certData.url;
  const qrUrl = resolveCertificateUrl(certUrlCandidate, sanitizedCertNo, verificationUrl) || `${getBackendUrl()}/api/certificates/public/${encodeURIComponent(sanitizedCertNo)}`;
  const qrPngBuffer = await QRCode.toBuffer(qrUrl, {
    type: 'png',
    margin: 0,
    width: 300,
    color: { dark: '#112211', light: '#ffffff' }
  });
  const qrImage = await pdfDoc.embedPng(qrPngBuffer);

  const PAGE_WIDTH = 595.28;
  const PAGE_HEIGHT = 841.89;

  // Dynamically compute optimal table column widths based on product lengths across all items
  const tableColDefs = computeProductTableColumns(allProducts, numColumns, fontBold, fontRegular);
  const dynamicTableWidth = tableColDefs.reduce((sum, c) => sum + c.width, 0);
  const dynamicTableLeftX = Math.round((PAGE_WIDTH - dynamicTableWidth) / 2);

  let globalProductIndex = 0;

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const isFirstPage = pageIdx === 0;
    const isLastPage = pageIdx === totalPages - 1;
    const currentProducts = pagesProducts[pageIdx];

    // Clone vector base PDF template page (all schemes use baseDoc on all pages so background is 100% identical to Page 1)
    const sourceDoc = baseDoc;
    const [page] = await pdfDoc.copyPages(sourceDoc, [0]);
    pdfDoc.addPage(page);

    // 1. Certificate Number (Centered, Arial 12pt, not bold)
    const certNoSize = 12.0;
    const certNoLabel = 'Certificate No.:';
    const certNoLabelW = fontRegular.widthOfTextAtSize(certNoLabel, certNoSize);
    const certNoValW = fontRegular.widthOfTextAtSize(sanitizedCertNo, certNoSize);
    const totalCertNoW = certNoLabelW + 6.0 + certNoValW;
    const certNoStartX = (PAGE_WIDTH - totalCertNoW) / 2;
    const isCosmetics = normalizedScheme === 'COSMETICS';
    const certNoY = isGso ? 633.0 : isCosmetics ? 624.0 : 635.0;

    page.drawText(certNoLabel, {
      x: certNoStartX,
      y: certNoY,
      size: certNoSize,
      font: fontRegular,
      color: cEmerald
    });
    page.drawText(sanitizedCertNo, {
      x: certNoStartX + certNoLabelW + 6.0,
      y: certNoY,
      size: certNoSize,
      font: fontRegular,
      color: cDark
    });

    // 2. Dates Block (Arial 12pt, not bold)
    const dateSize = 12.0;

    if (!isGso) {
      // Non-GSO (HFA Meat, HFA Non-Meat, Cosmetics, SMIIC): 3 dates
      const dateY = isCosmetics ? 604.0 : 610.0;
      
      // Date 1: Issue Date
      const issueLabel = 'Issue Date:';
      const issueLabelW = fontRegular.widthOfTextAtSize(issueLabel, dateSize);
      page.drawText(issueLabel, { x: 42.0, y: dateY, size: dateSize, font: fontRegular, color: cEmerald });
      page.drawText(formattedIssue, { x: 42.0 + issueLabelW + 5.0, y: dateY, size: dateSize, font: fontRegular, color: cDark });

      // Date 2: Certification Start Date
      const certStartLabel = 'Certification Start Date:';
      const certStartLabelW = fontRegular.widthOfTextAtSize(certStartLabel, dateSize);
      page.drawText(certStartLabel, { x: 188.0, y: dateY, size: dateSize, font: fontRegular, color: cEmerald });
      page.drawText(formattedCertStart, { x: 188.0 + certStartLabelW + 5.0, y: dateY, size: dateSize, font: fontRegular, color: cDark });

      // Date 3: Expiry Date
      const expLabel = 'Expiry Date:';
      const expLabelW = fontRegular.widthOfTextAtSize(expLabel, dateSize);
      page.drawText(expLabel, { x: 412.0, y: dateY, size: dateSize, font: fontRegular, color: cEmerald });
      page.drawText(formattedExpiry, { x: 412.0 + expLabelW + 5.0, y: dateY, size: dateSize, font: fontRegular, color: cDark });
    } else {
      // GSO (GSO Meat, GSO Non-Meat): 4 dates
      const dateY1 = 611.0;
      const dateY2 = 590.0;

      // Row 1: Issue Date | Current Cycle Start Date | Expiry Date
      const issueLabel = 'Issue Date:';
      const issueLabelW = fontRegular.widthOfTextAtSize(issueLabel, dateSize);
      page.drawText(issueLabel, { x: 42.0, y: dateY1, size: dateSize, font: fontRegular, color: cEmerald });
      page.drawText(formattedIssue, { x: 42.0 + issueLabelW + 5.0, y: dateY1, size: dateSize, font: fontRegular, color: cDark });

      const currLabel = 'Current Cycle Start Date:';
      const currLabelW = fontRegular.widthOfTextAtSize(currLabel, dateSize);
      page.drawText(currLabel, { x: 188.0, y: dateY1, size: dateSize, font: fontRegular, color: cEmerald });
      page.drawText(formattedCurrentCycle, { x: 188.0 + currLabelW + 5.0, y: dateY1, size: dateSize, font: fontRegular, color: cDark });

      const expLabel = 'Expiry Date:';
      const expLabelW = fontRegular.widthOfTextAtSize(expLabel, dateSize);
      page.drawText(expLabel, { x: 412.0, y: dateY1, size: dateSize, font: fontRegular, color: cEmerald });
      page.drawText(formattedExpiry, { x: 412.0 + expLabelW + 5.0, y: dateY1, size: dateSize, font: fontRegular, color: cDark });

      // Row 2: Original Cycle Start Date
      const origLabel = 'Original Cycle Start Date:';
      const origLabelW = fontRegular.widthOfTextAtSize(origLabel, dateSize);
      page.drawText(origLabel, { x: 188.0, y: dateY2, size: dateSize, font: fontRegular, color: cEmerald });
      page.drawText(formattedOrigCycle, { x: 188.0 + origLabelW + 5.0, y: dateY2, size: dateSize, font: fontRegular, color: cDark });
    }

    if (isFirstPage) {
      // 2.5 Scheme Declaration Lines (Centered dynamically between Dates and Company details)
      if (scheme.declarationLines && scheme.declarationLines.length > 0) {
        const declFontSize = 12.0;
        const lineSpacing = 15.5;
        const totalHeight = (scheme.declarationLines.length - 1) * lineSpacing;
        const centerDeclY = isGso ? 535.0 : isCosmetics ? 548.0 : 542.0;
        let declY = centerDeclY + (totalHeight / 2);
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
          declY -= lineSpacing;
        }
      }

      // 3. Company & Category Info Block (Arial 10.5pt, non-bold)
      // Strict Left Alignment on valStartX = 236.0 with horizontal dividers spanning 45.0 to 550.0 pt
      const labelStartX = 45.0;
      const valStartX = 236.0;
      const dividerLeftX = 45.0;
      const dividerRightX = 550.0;
      const maxValW = dividerRightX - valStartX; // 314 pt

      const rowLabelSize = 10.5;
      const rowValSize = 10.5;

      // Row 1: COMPANY NAME
      const r1Y = 488.0;
      page.drawText('COMPANY NAME:', { x: labelStartX, y: r1Y, size: rowLabelSize, font: fontRegular, color: cDark });
      if (resolvedName) {
        const nameLines = wrapTextLines(resolvedName, maxValW, fontRegular, rowValSize, 1);
        if (nameLines && nameLines[0]) {
          page.drawText(nameLines[0], { x: valStartX, y: r1Y, size: rowValSize, font: fontRegular, color: cDark });
        }
      }
      page.drawLine({
        start: { x: dividerLeftX, y: 474.0 },
        end: { x: dividerRightX, y: 474.0 },
        thickness: 0.5,
        color: cDivider
      });

      // Row 2: COMPANY ADDRESS
      const r2Y = 456.0;
      page.drawText('COMPANY ADDRESS:', { x: labelStartX, y: r2Y, size: rowLabelSize, font: fontRegular, color: cDark });
      if (resolvedAddress) {
        const addrLines = wrapTextLines(resolvedAddress, maxValW, fontRegular, rowValSize, 2);
        if (addrLines.length > 1) {
          if (addrLines[0]) page.drawText(addrLines[0], { x: valStartX, y: r2Y, size: rowValSize, font: fontRegular, color: cDark });
          if (addrLines[1]) page.drawText(addrLines[1], { x: valStartX, y: r2Y - 13.0, size: rowValSize, font: fontRegular, color: cDark });
        } else if (addrLines[0]) {
          page.drawText(addrLines[0], { x: valStartX, y: r2Y, size: rowValSize, font: fontRegular, color: cDark });
        }
      }
      page.drawLine({
        start: { x: dividerLeftX, y: 432.0 },
        end: { x: dividerRightX, y: 432.0 },
        thickness: 0.5,
        color: cDivider
      });

      // Row 3: MANUFACTURING FACILITY(IES) ADDRESS (IF DIFFERENT):
      page.drawText('MANUFACTURING FACILITY(IES)', { x: labelStartX, y: 414.0, size: rowLabelSize, font: fontRegular, color: cDark });
      page.drawText('ADDRESS (IF DIFFERENT):', { x: labelStartX, y: 401.0, size: rowLabelSize, font: fontRegular, color: cDark });
      if (resolvedMfgAddress) {
        const mfgLines = wrapTextLines(resolvedMfgAddress, maxValW, fontRegular, rowValSize, 2);
        if (mfgLines.length > 1) {
          if (mfgLines[0]) page.drawText(mfgLines[0], { x: valStartX, y: 414.0, size: rowValSize, font: fontRegular, color: cDark });
          if (mfgLines[1]) page.drawText(mfgLines[1], { x: valStartX, y: 401.0, size: rowValSize, font: fontRegular, color: cDark });
        } else if (mfgLines[0]) {
          page.drawText(mfgLines[0], { x: valStartX, y: 407.0, size: rowValSize, font: fontRegular, color: cDark });
        }
      }
      page.drawLine({
        start: { x: dividerLeftX, y: 386.0 },
        end: { x: dividerRightX, y: 386.0 },
        thickness: 0.5,
        color: cDivider
      });

      // Row 4: PRODUCT CATEGORY
      const r4Y = 368.0;
      page.drawText('PRODUCT CATEGORY:', { x: labelStartX, y: r4Y, size: rowLabelSize, font: fontRegular, color: cDark });
      if (resolvedScope) {
        const scopeLines = wrapTextLines(resolvedScope, maxValW, fontRegular, rowValSize, 2);
        if (scopeLines.length > 1) {
          if (scopeLines[0]) page.drawText(scopeLines[0], { x: valStartX, y: r4Y, size: rowValSize, font: fontRegular, color: cDark });
          if (scopeLines[1]) page.drawText(scopeLines[1], { x: valStartX, y: r4Y - 13.0, size: rowValSize, font: fontRegular, color: cDark });
        } else if (scopeLines[0]) {
          page.drawText(scopeLines[0], { x: valStartX, y: r4Y, size: rowValSize, font: fontRegular, color: cDark });
        }
      }
      // Product Category divider line positioned with clear spacing above the table
      page.drawLine({
        start: { x: dividerLeftX, y: 344.0 },
        end: { x: dividerRightX, y: 344.0 },
        thickness: 0.5,
        color: cDivider
      });
    }

    // 4. Products Table Layout (Dynamic 1, 2, or 3 columns, adjusted to text finish and centralized)
    const tableLeftX = dynamicTableLeftX;
    const tableWidth = dynamicTableWidth;
    const headerHeight = 18.0;
    const rowHeight = 17.5;

    // Page 1: Table top is at y=328.0 pt leaving a generous 16.0 pt spacing below Product Category divider (344.0 pt).
    // headerBottomY = 328.0 - 18.0 = 310.0 pt.
    // Subsequent pages: Table top is at y=560.0 pt, headerBottomY = 560.0 - 18.0 = 542.0 pt.
    let headerBottomY = isFirstPage ? 310.0 : 542.0;

    // Use dynamically computed column definitions based on product lengths
    const colDefs = tableColDefs;

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

      // Pre-compute wrapped lines for all cells in this row
      const colLines = [];
      let rowNeedsTwoLines = false;

      colDefs.forEach((col, cIdx) => {
        if (cIdx === 0) {
          colLines.push([String(globalProductIndex)]);
        } else if (numColumns === 1) {
          const lines = wrapTextLines(p.name, col.width - 16.0, fontRegular, cellFontSize, 2);
          if (lines.length > 1) rowNeedsTwoLines = true;
          colLines.push(lines);
        } else if (numColumns === 2) {
          if (cIdx === 1) {
            const lines = wrapTextLines(p.code, col.width - 12.0, fontBold, cellFontSize, 2);
            if (lines.length > 1) rowNeedsTwoLines = true;
            colLines.push(lines);
          } else {
            const descVal = p.description || p.name;
            const lines = wrapTextLines(descVal, col.width - 16.0, fontRegular, cellFontSize, 2);
            if (lines.length > 1) rowNeedsTwoLines = true;
            colLines.push(lines);
          }
        } else if (numColumns === 3) {
          if (cIdx === 1) {
            const lines = wrapTextLines(p.code, col.width - 12.0, fontBold, cellFontSize, 2);
            if (lines.length > 1) rowNeedsTwoLines = true;
            colLines.push(lines);
          } else if (cIdx === 2) {
            const descVal = p.description || p.name;
            const lines = wrapTextLines(descVal, col.width - 16.0, fontRegular, cellFontSize, 2);
            if (lines.length > 1) rowNeedsTwoLines = true;
            colLines.push(lines);
          } else if (cIdx === 3) {
            const catVal = p.category || 'Halal Certified';
            const lines = wrapTextLines(catVal, col.width - 16.0, fontRegular, cellFontSize, 2);
            if (lines.length > 1) rowNeedsTwoLines = true;
            colLines.push(lines);
          }
        }
      });

      const thisRowHeight = rowNeedsTwoLines ? 23.5 : rowHeight;
      curRowY -= thisRowHeight;

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
            end: { x: divX, y: curRowY + thisRowHeight },
            thickness: 0.5,
            color: cTableGrid
          });
        }

        const lines = colLines[cIdx] || [];
        const isBold = (cIdx === 0 || (cIdx === 1 && numColumns >= 2));
        const cellFont = isBold ? fontBold : fontRegular;

        if (col.align === 'center') {
          // NO. column (centered bold)
          const text = lines[0] || String(globalProductIndex);
          const noW = fontBold.widthOfTextAtSize(text, cellFontSize);
          page.drawText(text, {
            x: rowXCursor + (col.width - noW) / 2,
            y: curRowY + (thisRowHeight - cellFontSize) / 2 + 1.0,
            size: cellFontSize,
            font: fontBold,
            color: cDark
          });
        } else {
          const pad = col.pad || 8.0;
          if (lines.length > 1) {
            // Draw 2 lines cleanly at full cellFontSize (9.0pt) - maintaining exact same font size
            page.drawText(lines[0], {
              x: rowXCursor + pad,
              y: curRowY + thisRowHeight - 10.5,
              size: cellFontSize,
              font: cellFont,
              color: cDark
            });
            page.drawText(lines[1], {
              x: rowXCursor + pad,
              y: curRowY + 3.0,
              size: cellFontSize,
              font: cellFont,
              color: cDark
            });
          } else if (lines.length === 1) {
            // Single line vertically centered
            page.drawText(lines[0], {
              x: rowXCursor + pad,
              y: curRowY + (thisRowHeight - cellFontSize) / 2 + 1.0,
              size: cellFontSize,
              font: cellFont,
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
    certificateNumber = '',
    businessName = '',
    companyName,
    businessAddress = '',
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
  const resolvedAddress = isCompanyAddrEmpty ? '' : rawCompanyAddr.toUpperCase();

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

  let resolvedMfgAddress = '';
  if (rawMfg && rawMfg !== '-' && rawMfg !== '—' && rawMfg.toUpperCase() !== 'N/A') {
    resolvedMfgAddress = rawMfg.toUpperCase();
  }

  const rawName = (companyName || businessName || certData.company_name || '').trim();
  const isNameEmpty = !rawName || rawName === '-' || rawName === '—' || rawName.toUpperCase() === 'N/A';
  const resolvedName = isNameEmpty ? '' : rawName.toUpperCase();

  const rawScope = (scope || scopeOfCertification || productCategory || certData.scope || certData.scopeOfCertification || certData.productCategory || '').trim();
  const isScopeEmpty = !rawScope || rawScope === '-' || rawScope === '—' || rawScope.toUpperCase() === 'N/A';
  const resolvedScope = isScopeEmpty ? '' : rawScope.toUpperCase();

  const normalizedScheme = normalizeCertificateType(certificateType || certData.certificate_type);
  const scheme = CERTIFICATE_SCHEMES[normalizedScheme] || CERTIFICATE_SCHEMES['GSO MEAT'];
  const isGso = scheme.templateType === 'gso';

  // Resolve table column count: Option 1 (1 col), Option 2 (2 cols), Option 3 (3 cols)
  const rawColOption = parseInt(productTableColumns || tableLayout || product_table_columns || table_layout, 10);
  const numColumns = (rawColOption >= 1 && rawColOption <= 3) ? rawColOption : scheme.defaultColumns;

  const certUrlCandidate = certData.certificate_url || certData.certificateUrl || certData.certificateFileUrl || certData.pdfUrl || certData.url;
  const qrUrl = resolveCertificateUrl(certUrlCandidate, certificateNumber, verificationUrl) || `${getBackendUrl()}/api/certificates/public/${encodeURIComponent(certificateNumber)}`;
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

      // Dynamic HTML Table Columns based on product lengths
      const maxCodeLen = productList.reduce((max, p) => Math.max(max, (p.code || '').length), 4);
      const maxDescLen = productList.reduce((max, p) => Math.max(max, (p.description || p.name || '').length), 11);
      const maxCatLen = productList.reduce((max, p) => Math.max(max, (p.category || 'Halal Certified').length), 8);

      let htmlCols = [];
      if (numColumns === 1) {
        htmlCols = [
          { header: 'NO.', width: '12%', align: 'center' },
          { header: 'NAME OF THE PRODUCTS', width: '88%', align: 'left' }
        ];
      } else if (numColumns === 2) {
        const codePct = Math.max(16, Math.min(26, Math.round(maxCodeLen * 1.5 + 8)));
        const descPct = 100 - 9 - codePct;
        htmlCols = [
          { header: 'NO.', width: '9%', align: 'center' },
          { header: 'CODE', width: `${codePct}%`, align: 'left' },
          { header: 'DESCRIPTION', width: `${descPct}%`, align: 'left' }
        ];
      } else {
        const codePct = Math.max(14, Math.min(22, Math.round(maxCodeLen * 1.4 + 6)));
        const availForDescAndCat = 100 - 9 - codePct;
        const totalLen = Math.max(1, maxDescLen + maxCatLen);
        let descPct = Math.round(availForDescAndCat * (maxDescLen / totalLen));
        let catPct = availForDescAndCat - descPct;
        if (descPct < 26) {
          descPct = 26;
          catPct = availForDescAndCat - descPct;
        } else if (catPct < 18) {
          catPct = 18;
          descPct = availForDescAndCat - catPct;
        }
        htmlCols = [
          { header: 'NO.', width: '9%', align: 'center' },
          { header: 'CODE', width: `${codePct}%`, align: 'left' },
          { header: 'DESCRIPTION', width: `${descPct}%`, align: 'left' },
          { header: 'CATEGORY', width: `${catPct}%`, align: 'left' }
        ];
      }

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
          font-family: Arial, "Helvetica Neue", sans-serif;
          color: #111827;
          background: #ffffff;
          position: relative;
        }
        .cert-header { text-align: center; margin-bottom: 12px; }
        .cert-title { font-size: 20pt; font-weight: 700; color: #0b7c47; margin-top: 6px; }
        .cert-no { font-size: 12pt; font-weight: normal; margin-top: 4px; }
        .cert-no-label { color: #0b7c47; font-weight: normal; }
        .dates-row { display: flex; justify-content: space-between; font-size: 12pt; font-weight: normal; margin-top: 8px; }
        .dates-row-center { text-align: center; font-size: 12pt; font-weight: normal; margin-top: 4px; }
        .date-label { color: #0b7c47; font-weight: normal; }
        .declaration { font-size: 12pt; font-weight: normal; text-align: center; margin: 16px 0; line-height: 1.4; color: #111827; }
        .info-table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 16px; font-size: 10.5pt; }
        .info-table tr { border-bottom: 1px solid #7cb594; }
        .info-table td { padding: 6px 0; border-bottom: 1px solid #7cb594; vertical-align: top; line-height: 1.4; box-sizing: border-box; }
        .info-label { width: 280px; min-width: 280px; max-width: 280px; color: #111827; vertical-align: top; font-weight: normal; text-align: left; padding: 6px 14px 6px 0; margin: 0; box-sizing: border-box; }
        .info-val { color: #111827; font-weight: normal; vertical-align: top; text-align: left; word-break: break-word; padding: 6px 0; margin: 0; box-sizing: border-box; }
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
        <table class="products-table" style="width: auto; max-width: 100%; margin: 0 auto; border-collapse: collapse;">
          <thead>
            <tr>
              ${htmlCols.map((col) => `
                <th style="padding: 7px 12px; text-align: ${col.align};">${col.header}</th>
              `).join('')}
            </tr>
          </thead>
          <tbody>
            ${productList.map((p, idx) => `
              <tr>
                <td style="text-align: center; font-weight: 700; padding: 6px 12px;">${idx + 1}</td>
                ${numColumns === 1 ? `
                  <td style="text-align: left; padding: 6px 12px;">${p.name}</td>
                ` : numColumns === 3 ? `
                  <td style="text-align: left; padding: 6px 12px; font-weight: 700;">${p.code}</td>
                  <td style="text-align: left; padding: 6px 12px;">${p.description || p.name}</td>
                  <td style="text-align: left; padding: 6px 12px;">${p.category || 'Halal Certified'}</td>
                ` : `
                  <td style="text-align: left; padding: 6px 12px; font-weight: 700;">${p.code}</td>
                  <td style="text-align: left; padding: 6px 12px;">${p.description || p.name}</td>
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
    </body>
    </html>
  `;
}

export const generateHtmlCertificate = buildCertificateHtml;
