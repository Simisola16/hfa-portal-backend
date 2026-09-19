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
  
  const candidates = [
    path.join(__dirname, '../assets/certificates', basePdfFile),
    path.join(__dirname, '../../', basePdfFile),
    path.join(process.cwd(), 'assets/certificates', basePdfFile),
    path.join(process.cwd(), basePdfFile)
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const buffer = fs.readFileSync(p);
      pdfCache.set(basePdfFile, buffer);
      return buffer;
    }
  }

  // Fallback to Template GSO Scheme if specific base is not found
  const fallbackPath = path.join(__dirname, '../assets/certificates/Template GSO Scheme (meat) Cert.pdf');
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
 * Exactly matches official templates:
 * - GSO Meat: 4 dates, 3-column table [NO., CODE, DESCRIPTION], 4-line declaration
 * - GSO Non-Meat: 4 dates, 3-column table [NO., CODE, DESCRIPTION], 3-line declaration
 * - Cosmetics: 3 dates, 2-column table [NO., NAME OF THE PRODUCTS], 2-line declaration
 * - HFA Scheme: 3 dates, 2-column table [NO., NAME OF THE PRODUCTS], 3-line declaration
 * - SMIIC: 3 dates, 2-column table [NO., NAME OF THE PRODUCTS], 3-line declaration
 */
export const CERTIFICATE_SCHEMES = {
  'HFA Scheme (meat)': {
    name: 'HFA Scheme (meat)',
    templateType: 'hfa',
    basePdf: 'Template HFA Scheme (meat) Cert 11 Oct 22-unlocked 1.pdf',
    docFooter: 'Doc: Halal Certificate (HFA Meat Scheme)   Created by: AH   Amended by: MH   Approved by: AM   Version: 3   Date: 11.10.2022',
    declarationLines: [
      'We certify and confirm that the company/manufacturing facility(ies) and the product/s listed',
      'below has/have been sucessfully evaluated and audited in accordance with HFA Halal',
      'Certification Requirements Manual HFP-1005-20/5 & HMP-1105-21/2.'
    ]
  },
  'HFA SCHEME MEAT': {
    name: 'HFA Scheme (meat)',
    templateType: 'hfa',
    basePdf: 'Template HFA Scheme (meat) Cert 11 Oct 22-unlocked 1.pdf',
    docFooter: 'Doc: Halal Certificate (HFA Meat Scheme)   Created by: AH   Amended by: MH   Approved by: AM   Version: 3   Date: 11.10.2022',
    declarationLines: [
      'We certify and confirm that the company/manufacturing facility(ies) and the product/s listed',
      'below has/have been sucessfully evaluated and audited in accordance with HFA Halal',
      'Certification Requirements Manual HFP-1005-20/5 & HMP-1105-21/2.'
    ]
  },
  'HFA Scheme Meat': {
    name: 'HFA Scheme (meat)',
    templateType: 'hfa',
    basePdf: 'Template HFA Scheme (meat) Cert 11 Oct 22-unlocked 1.pdf',
    docFooter: 'Doc: Halal Certificate (HFA Meat Scheme)   Created by: AH   Amended by: MH   Approved by: AM   Version: 3   Date: 11.10.2022',
    declarationLines: [
      'We certify and confirm that the company/manufacturing facility(ies) and the product/s listed',
      'below has/have been sucessfully evaluated and audited in accordance with HFA Halal',
      'Certification Requirements Manual HFP-1005-20/5 & HMP-1105-21/2.'
    ]
  },
  'HFA Scheme (non-meat)': {
    name: 'HFA Scheme (non-meat)',
    templateType: 'hfa',
    basePdf: 'Template HFA Scheme (Non-meat) Cert 11 Oct 22-unlocked 2.pdf',
    docFooter: 'Doc: Halal Certificate (HFA non meat Scheme)   Created by: AH   Amended by: MH   Approved by: HI   Version: 9   Date: 11.10.2022',
    declarationLines: [
      'We certify and confirm that the company/manufacturing facility(ies) and the product/s listed',
      'below has/have been sucessfully evaluated and audited in accordance with HFA Halal',
      'Certification Requirements Manual HFP-1005-20/5.'
    ]
  },
  'HFA SCHEME NON MEAT': {
    name: 'HFA Scheme (non-meat)',
    templateType: 'hfa',
    basePdf: 'Template HFA Scheme (Non-meat) Cert 11 Oct 22-unlocked 2.pdf',
    docFooter: 'Doc: Halal Certificate (HFA non meat Scheme)   Created by: AH   Amended by: MH   Approved by: HI   Version: 9   Date: 11.10.2022',
    declarationLines: [
      'We certify and confirm that the company/manufacturing facility(ies) and the product/s listed',
      'below has/have been sucessfully evaluated and audited in accordance with HFA Halal',
      'Certification Requirements Manual HFP-1005-20/5.'
    ]
  },
  'HFA Scheme Non-Meat': {
    name: 'HFA Scheme (non-meat)',
    templateType: 'hfa',
    basePdf: 'Template HFA Scheme (Non-meat) Cert 11 Oct 22-unlocked 2.pdf',
    docFooter: 'Doc: Halal Certificate (HFA non meat Scheme)   Created by: AH   Amended by: MH   Approved by: HI   Version: 9   Date: 11.10.2022',
    declarationLines: [
      'We certify and confirm that the company/manufacturing facility(ies) and the product/s listed',
      'below has/have been sucessfully evaluated and audited in accordance with HFA Halal',
      'Certification Requirements Manual HFP-1005-20/5.'
    ]
  },
  'HFA Scheme': {
    name: 'HFA Scheme (meat)',
    templateType: 'hfa',
    basePdf: 'Template HFA Scheme (meat) Cert 11 Oct 22-unlocked 1.pdf',
    docFooter: 'Doc: Halal Certificate (HFA Meat Scheme)   Created by: AH   Amended by: MH   Approved by: AM   Version: 3   Date: 11.10.2022',
    declarationLines: [
      'We certify and confirm that the company/manufacturing facility(ies) and the product/s listed',
      'below has/have been sucessfully evaluated and audited in accordance with HFA Halal',
      'Certification Requirements Manual HFP-1005-20/5 & HMP-1105-21/2.'
    ]
  },
  'HFA SCHEME': {
    name: 'HFA Scheme (meat)',
    templateType: 'hfa',
    basePdf: 'Template HFA Scheme (meat) Cert 11 Oct 22-unlocked 1.pdf',
    docFooter: 'Doc: Halal Certificate (HFA Meat Scheme)   Created by: AH   Amended by: MH   Approved by: AM   Version: 3   Date: 11.10.2022',
    declarationLines: [
      'We certify and confirm that the company/manufacturing facility(ies) and the product/s listed',
      'below has/have been sucessfully evaluated and audited in accordance with HFA Halal',
      'Certification Requirements Manual HFP-1005-20/5 & HMP-1105-21/2.'
    ]
  },
  'Cosmetics': {
    name: 'Cosmetics',
    templateType: 'hfa',
    basePdf: 'Template HFA Scheme (Cosmetic) Cert 11 Oct 22-unlocked 1.pdf',
    docFooter: 'Doc: Halal Certificate (HFA Cosmetic Scheme)   Created by: MH   Approved by: HI   Version: 2   Date: 11.10.2022',
    declarationLines: [
      'We certify and confirm that the company/manufacturing facility(ies) and the product/s listed',
      'below has/have been successfully evaluated and audited in accordance with OIC/SMIIC 4:2018.'
    ]
  },
  'COSMETICS': {
    name: 'Cosmetics',
    templateType: 'hfa',
    basePdf: 'Template HFA Scheme (Cosmetic) Cert 11 Oct 22-unlocked 1.pdf',
    docFooter: 'Doc: Halal Certificate (HFA Cosmetic Scheme)   Created by: MH   Approved by: HI   Version: 2   Date: 11.10.2022',
    declarationLines: [
      'We certify and confirm that the company/manufacturing facility(ies) and the product/s listed',
      'below has/have been successfully evaluated and audited in accordance with OIC/SMIIC 4:2018.'
    ]
  },
  'Smiic': {
    name: 'Smiic',
    templateType: 'hfa',
    basePdf: 'SMIIC.pdf',
    docFooter: 'Doc: Halal Certificate (SMIIC Scheme)   Created by: MH   Approved by: HI   Version: 2   Date: 11.10.2022',
    declarationLines: [
      'We certify and confirm that the company/manufacturing facility(ies) and the product/s listed',
      'below has/have been successfully evaluated and audited in accordance with GSO 2055-1,',
      'OIC/SMIIC 1 and HFA Halal Certification Requirements Manual HFP-1005-20/5.'
    ]
  },
  'SMIIC': {
    name: 'Smiic',
    templateType: 'hfa',
    basePdf: 'SMIIC.pdf',
    docFooter: 'Doc: Halal Certificate (SMIIC Scheme)   Created by: MH   Approved by: HI   Version: 2   Date: 11.10.2022',
    declarationLines: [
      'We certify and confirm that the company/manufacturing facility(ies) and the product/s listed',
      'below has/have been successfully evaluated and audited in accordance with GSO 2055-1,',
      'OIC/SMIIC 1 and HFA Halal Certification Requirements Manual HFP-1005-20/5.'
    ]
  },
  'GSO meat': {
    name: 'GSO meat',
    templateType: 'gso',
    basePdf: 'Template GSO Scheme (meat) Cert-unlocked (1) 2.pdf',
    docFooter: 'Doc: Halal Certificate (GSO meat)   Created by: AH   Amended by: TO   Approved by: AM   Version: 16   Date: 28.10.2024',
    declarationLines: [
      'We certify and confirm that the company/manufacturing facility(ies) and the product/s listed',
      'below has/have been successfully evaluated and audited in accordance with HFA Halal',
      'Certification Requirements Manual HFP-1005-20/5, HMP-1105-21/2, and other relevant',
      'standards including SMIIC -1:2019/UAE.S.993/UAE.S.2055-1:2015.'
    ]
  },
  'GSO MEAT': {
    name: 'GSO meat',
    templateType: 'gso',
    basePdf: 'Template GSO Scheme (meat) Cert-unlocked (1) 2.pdf',
    docFooter: 'Doc: Halal Certificate (GSO meat)   Created by: AH   Amended by: TO   Approved by: AM   Version: 16   Date: 28.10.2024',
    declarationLines: [
      'We certify and confirm that the company/manufacturing facility(ies) and the product/s listed',
      'below has/have been successfully evaluated and audited in accordance with HFA Halal',
      'Certification Requirements Manual HFP-1005-20/5, HMP-1105-21/2, and other relevant',
      'standards including SMIIC -1:2019/UAE.S.993/UAE.S.2055-1:2015.'
    ]
  },
  'GSO Meat': {
    name: 'GSO meat',
    templateType: 'gso',
    basePdf: 'Template GSO Scheme (meat) Cert-unlocked (1) 2.pdf',
    docFooter: 'Doc: Halal Certificate (GSO meat)   Created by: AH   Amended by: TO   Approved by: AM   Version: 16   Date: 28.10.2024',
    declarationLines: [
      'We certify and confirm that the company/manufacturing facility(ies) and the product/s listed',
      'below has/have been successfully evaluated and audited in accordance with HFA Halal',
      'Certification Requirements Manual HFP-1005-20/5, HMP-1105-21/2, and other relevant',
      'standards including SMIIC -1:2019/UAE.S.993/UAE.S.2055-1:2015.'
    ]
  },
  'GSO non-meat': {
    name: 'GSO non-meat',
    templateType: 'gso',
    basePdf: 'Template GSO Scheme (Non-meat) Cert-unlocked 2.pdf',
    docFooter: 'Doc: Halal Certificate (GSO non-meat)   Created by: AH   Amended by: TO   Approved by: AM   Version: 16   Date: 28.10.2024',
    declarationLines: [
      'We certify and confirm that the company/manufacturing facility(ies) and the product/s listed',
      'below has/have been successfully evaluated and audited in accordance with HFA Halal',
      'Certification Requirements Manual HFP-1005-20/5 and UAE.S.2055-1:2015.'
    ]
  },
  'GSO NON MEAT': {
    name: 'GSO non-meat',
    templateType: 'gso',
    basePdf: 'Template GSO Scheme (Non-meat) Cert-unlocked 2.pdf',
    docFooter: 'Doc: Halal Certificate (GSO non-meat)   Created by: AH   Amended by: TO   Approved by: AM   Version: 16   Date: 28.10.2024',
    declarationLines: [
      'We certify and confirm that the company/manufacturing facility(ies) and the product/s listed',
      'below has/have been successfully evaluated and audited in accordance with HFA Halal',
      'Certification Requirements Manual HFP-1005-20/5 and UAE.S.2055-1:2015.'
    ]
  },
  'GSO Non-Meat': {
    name: 'GSO non-meat',
    templateType: 'gso',
    basePdf: 'Template GSO Scheme (Non-meat) Cert-unlocked 2.pdf',
    docFooter: 'Doc: Halal Certificate (GSO non-meat)   Created by: AH   Amended by: TO   Approved by: AM   Version: 16   Date: 28.10.2024',
    declarationLines: [
      'We certify and confirm that the company/manufacturing facility(ies) and the product/s listed',
      'below has/have been successfully evaluated and audited in accordance with HFA Halal',
      'Certification Requirements Manual HFP-1005-20/5 and UAE.S.2055-1:2015.'
    ]
  },
  'GSO Non Meat': {
    name: 'GSO non-meat',
    templateType: 'gso',
    basePdf: 'Template GSO Scheme (Non-meat) Cert-unlocked 2.pdf',
    docFooter: 'Doc: Halal Certificate (GSO non-meat)   Created by: AH   Amended by: TO   Approved by: AM   Version: 16   Date: 28.10.2024',
    declarationLines: [
      'We certify and confirm that the company/manufacturing facility(ies) and the product/s listed',
      'below has/have been successfully evaluated and audited in accordance with HFA Halal',
      'Certification Requirements Manual HFP-1005-20/5 and UAE.S.2055-1:2015.'
    ]
  }
};

/**
 * Normalize certificate type to one of the official schemes.
 */
export function normalizeCertificateType(rawType) {
  if (!rawType) return 'HFA Scheme (meat)';
  const str = String(rawType).trim().toLowerCase();
  
  if (str === 'cosmetics' || str.includes('cosmetic')) return 'Cosmetics';
  if (str === 'smiic' || str.includes('smiic')) return 'Smiic';

  // GSO Meat vs Non-Meat
  if (str.includes('gso')) {
    if (str.includes('non') || str.includes('food') || str.includes('bakery')) {
      return 'GSO non-meat';
    }
    return 'GSO meat';
  }

  // HFA Scheme Meat vs Non-Meat
  if (str.includes('hfa') || str.includes('scheme') || str.includes('standard') || str.includes('annual')) {
    if (str.includes('non')) {
      return 'HFA Scheme (non-meat)';
    }
    if (str.includes('meat')) {
      return 'HFA Scheme (meat)';
    }
    return 'HFA Scheme (meat)';
  }
  
  return CERTIFICATE_SCHEMES[rawType] ? rawType : 'HFA Scheme (meat)';
}

/**
 * Generates an official Halal certificate PDF buffer using pdf-lib.
 * High-fidelity rendering matching official master templates:
 * - GSO schemes use 3-column table [NO., CODE, DESCRIPTION] and 4 date fields.
 * - HFA / Cosmetics / SMIIC schemes use 2-column table [NO., NAME OF THE PRODUCTS] and 3 date fields.
 * - Clean signature overlays, scannable QR code, and official emerald header styling.
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
    productCategory,
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

  const seenProductNames = new Set();
  const allProducts = [];
  if (rawProducts && rawProducts.length > 0) {
    rawProducts.forEach((p, idx) => {
      let code = '';
      let name = '';
      if (typeof p === 'string') {
        code = `PRD-${String(idx + 1).padStart(2, '0')}`;
        name = p.trim();
      } else if (p && typeof p === 'object') {
        code = p.code || p.product_code || p.brand || `PRD-${String(idx + 1).padStart(2, '0')}`;
        name = (p.name || p.product_name || p.title || p.description || `Product ${idx + 1}`).trim();
      } else {
        code = `PRD-${String(idx + 1).padStart(2, '0')}`;
        name = `Product ${idx + 1}`;
      }
      const key = name.toLowerCase();
      if (name && !seenProductNames.has(key)) {
        seenProductNames.add(key);
        allProducts.push({
          code: sanitizeForPdf(code),
          name: sanitizeForPdf(name)
        });
      }
    });
  }
  if (allProducts.length === 0) {
    allProducts.push({ code: 'PRD-01', name: 'Certified Halal Products & Formulations' });
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

  // Create destination multi-page PDF document
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  // Standard Colors
  const cEmerald = rgb(11 / 255, 124 / 255, 71 / 255); // #0b7c47 Emerald Green
  const cDark = rgb(17 / 255, 24 / 255, 39 / 255);     // #111827 Deep Black/Charcoal
  const cWhite = rgb(1, 1, 1);
  const cTableGrid = rgb(89 / 255, 91 / 255, 97 / 255); // Subtle slate gray grid stroke [89, 91, 97]
  const cGrayText = rgb(71 / 255, 85 / 255, 105 / 255);

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

  let resolvedMfgAddress = '';
  if (rawMfg && rawMfg !== '-' && rawMfg !== '—' && rawMfg.toUpperCase() !== 'N/A') {
    resolvedMfgAddress = sanitizeForPdf(rawMfg.toUpperCase());
  } else if (!isCompanyAddrEmpty) {
    resolvedMfgAddress = 'SAME AS ABOVE';
  } else {
    resolvedMfgAddress = 'SAME AS ABOVE';
  }

  const resolvedName = sanitizeForPdf((companyName || businessName || certData.company_name || 'Halal Certified Client').toUpperCase());
  const resolvedScope = sanitizeForPdf((scope || scopeOfCertification || productCategory || certData.scope || certData.scopeOfCertification || certData.productCategory || 'PRODUCTION AND SUPPLY OF HALAL CERTIFIED PRODUCTS').toUpperCase());

  // Generate QR Code PNG
  const qrUrl = verificationUrl || `${process.env.FRONTEND_CLIENT_URL || 'https://hfaportal.company'}/verify/${sanitizedCertNo}`;
  const qrPngBuffer = await QRCode.toBuffer(qrUrl, {
    type: 'png',
    margin: 0,
    width: 300,
    color: { dark: '#112211', light: '#ffffff' }
  });
  const qrImage = await pdfDoc.embedPng(qrPngBuffer);

  // Embed signatures if available
  let amirSigImg = null;
  let muftiSigImg = null;
  const amirSigPath = path.join(__dirname, '../assets/certificates/sig_amir_clean.png');
  const muftiSigPath = path.join(__dirname, '../assets/certificates/sig_mufti_clean.png');

  if (fs.existsSync(amirSigPath)) {
    try {
      amirSigImg = await pdfDoc.embedPng(fs.readFileSync(amirSigPath));
    } catch (e) {
      console.warn('Could not embed Amir signature:', e.message);
    }
  }

  if (fs.existsSync(muftiSigPath)) {
    try {
      muftiSigImg = await pdfDoc.embedPng(fs.readFileSync(muftiSigPath));
    } catch (e) {
      console.warn('Could not embed Mufti signature:', e.message);
    }
  }

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

    const basePdfName = scheme.basePdf || '';
    const isGsoMeat = basePdfName.includes('(meat)') && isGso;
    const isGsoNonMeat = basePdfName.includes('(Non-meat)') && isGso;

    // 1. Certificate Number (rendered next to pre-printed "Certificate No.:")
    let certNoX = 264.0;
    let certNoY = 633.99;
    if (!isGso) {
      certNoX = 282.0;
      certNoY = 637.50;
    }
    page.drawText(sanitizedCertNo, {
      x: certNoX,
      y: certNoY,
      size: 9.5,
      font: fontBold,
      color: cDark
    });

    // 2. Dates Block (Font size 9.0 bold to match pre-printed labels with high clarity)
    const dateFontSize = 9.0;

    if (!isGso) {
      // Non-GSO (HFA Meat, HFA Non-Meat, Cosmetics, SMIIC):
      const dateY = 607.21;
      page.drawText(formattedIssue, { x: 114.0, y: dateY, size: dateFontSize, font: fontBold, color: cDark });
      page.drawText(formattedCertStart, { x: 330.0, y: dateY, size: dateFontSize, font: fontBold, color: cDark });
      page.drawText(formattedExpiry, { x: 486.0, y: dateY, size: dateFontSize, font: fontBold, color: cDark });
    } else {
      // GSO (GSO Meat, GSO Non-Meat):
      const dateY = 611.28;
      // Row 1: Issue Date, Current Cycle Start Date, Expiry Date
      page.drawText(formattedIssue, { x: 108.0, y: dateY, size: dateFontSize, font: fontBold, color: cDark });
      page.drawText(formattedCurrentCycle, { x: 310.0, y: dateY, size: dateFontSize, font: fontBold, color: cDark });
      page.drawText(formattedExpiry, { x: 468.0, y: dateY, size: dateFontSize, font: fontBold, color: cDark });

      // Row 2: Original Cycle Start Date
      page.drawText(formattedOrigCycle, { x: 310.0, y: 589.55, size: dateFontSize, font: fontBold, color: cDark });
    }

    const isUnlockedBase = scheme.basePdf && scheme.basePdf.includes('unlocked');

    // 3. Scheme-Specific Declaration Text (drawn ONLY if base template is an old blank background)
    if (!isUnlockedBase && scheme.declarationLines && scheme.declarationLines.length > 0) {
      const decLines = scheme.declarationLines.filter(Boolean);
      const decFontSize = 9.8;
      const decLineHeight = 14.4;
      
      let startY = 561.36;
      if (decLines.length === 2) {
        startY = 554.0;
      } else if (decLines.length === 3) {
        startY = 560.0;
      } else if (decLines.length >= 4) {
        startY = 561.36;
      }

      decLines.forEach((line, lIdx) => {
        const lWidth = fontRegular.widthOfTextAtSize(line, decFontSize);
        const lX = (PAGE_WIDTH - lWidth) / 2;
        page.drawText(line, {
          x: lX,
          y: startY - (lIdx * decLineHeight),
          size: decFontSize,
          font: fontRegular,
          color: cDark
        });
      });
    }

    if (isFirstPage) {
      // 4. Company & Category Info Block Values (Labels and lines are pre-printed on base template!)
      const valStartX = 186.0;
      const maxValW = 358;
      const companyInfoFontSize = 9.5;

      // Exact PDF baseline coordinates per template scheme
      let nameY, addrY1, addrY2, mfgY1, mfgY2, scopeY1, scopeY2, scopeSingleY;
      if (isGsoMeat) {
        nameY = 478.00;
        addrY1 = 448.00;
        addrY2 = 432.00;
        mfgY1 = 403.00;
        mfgY2 = 388.00;
        scopeSingleY = 365.00;
        scopeY1 = 369.00;
        scopeY2 = 356.00;
      } else if (isGsoNonMeat) {
        nameY = 507.00;
        addrY1 = 477.00;
        addrY2 = 461.00;
        mfgY1 = 433.00;
        mfgY2 = 417.00;
        scopeSingleY = 394.00;
        scopeY1 = 398.00;
        scopeY2 = 385.00;
      } else {
        // HFA Scheme Meat, HFA Scheme Non-Meat, Cosmetics, SMIIC
        nameY = 498.00;
        addrY1 = 468.00;
        addrY2 = 452.00;
        mfgY1 = 423.00;
        mfgY2 = 407.00;
        scopeSingleY = 381.00;
        scopeY1 = 385.00;
        scopeY2 = 372.00;
      }

      // Company Name (Prominent bold font, size 9.5pt)
      const nameLines = wrapTextLines(resolvedName, maxValW, fontBold, companyInfoFontSize, 1);
      page.drawText(nameLines[0] || '—', {
        x: valStartX,
        y: nameY,
        size: companyInfoFontSize,
        font: fontBold,
        color: cDark
      });

      // Company Address (only if provided and not '-')
      if (resolvedAddress) {
        const addrLines = wrapTextLines(resolvedAddress, maxValW, fontBold, companyInfoFontSize, 2);
        if (addrLines.length > 1) {
          page.drawText(addrLines[0], { x: valStartX, y: addrY1, size: companyInfoFontSize, font: fontBold, color: cDark });
          page.drawText(addrLines[1], { x: valStartX, y: addrY2, size: companyInfoFontSize, font: fontBold, color: cDark });
        } else {
          page.drawText(addrLines[0], { x: valStartX, y: addrY1, size: companyInfoFontSize, font: fontBold, color: cDark });
        }
      }

      // Manufacturing Facility Address (Prominent bold font, size 9.5pt, aligned at valStartX)
      if (resolvedMfgAddress && resolvedMfgAddress !== '—') {
        const mfgLines = wrapTextLines(resolvedMfgAddress, maxValW, fontBold, companyInfoFontSize, 2);
        if (mfgLines.length > 1) {
          page.drawText(mfgLines[0], { x: valStartX, y: mfgY1, size: companyInfoFontSize, font: fontBold, color: cDark });
          page.drawText(mfgLines[1], { x: valStartX, y: mfgY2, size: companyInfoFontSize, font: fontBold, color: cDark });
        } else {
          page.drawText(mfgLines[0], { x: valStartX, y: mfgY1, size: companyInfoFontSize, font: fontBold, color: cDark });
        }
      }

      // Product Category / Scope (prominent bold font, size 9.5pt, aligned at valStartX)
      const scopeLines = wrapTextLines(resolvedScope, maxValW, fontBold, companyInfoFontSize, 2);
      if (scopeLines.length > 1) {
        page.drawText(scopeLines[0], { x: valStartX, y: scopeY1, size: companyInfoFontSize, font: fontBold, color: cDark });
        page.drawText(scopeLines[1], { x: valStartX, y: scopeY2, size: companyInfoFontSize, font: fontBold, color: cDark });
      } else {
        page.drawText(scopeLines[0] || '—', { x: valStartX, y: scopeSingleY, size: companyInfoFontSize, font: fontBold, color: cDark });
      }
    }

    // Header & Row Dimensions (Big, spacious, and professional)
    const headerHeight = 18.0;
    const rowHeight = 18.0;

    let headerBottomY;
    if (!isFirstPage) {
      headerBottomY = 511.0;
    } else if (isGsoMeat) {
      headerBottomY = 308.0;
    } else if (isGsoNonMeat) {
      headerBottomY = 308.0;
    } else {
      headerBottomY = 312.0;
    }

    // Unified Full Width for table across all pages (aligned exactly with 45pt margins: width 505pt)
    const tableLeftX = 45.0;
    const tableWidth = 505.0;

    if (!isFirstPage) {
      // Subsequent continuation pages: Clean continuation panel for annex
      page.drawRectangle({
        x: tableLeftX,
        y: 190,
        width: tableWidth,
        height: 380,
        color: cWhite
      });

      // Annex Header
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

    // 5. Products Table Layout (Big, High-Legibility, Professional)
    const hFontSize = 9.5;
    const cellFontSize = 9.0;

    if (isGso) {
      // 3-Column Table: NO. | CODE | DESCRIPTION (for GSO Meat and GSO Non-Meat)
      const col1W = 38.0;
      const col2W = 122.0;
      const col3W = tableWidth - col1W - col2W; // 345.0 pt

      // Draw Header Background (Emerald Green)
      page.drawRectangle({
        x: tableLeftX,
        y: headerBottomY,
        width: tableWidth,
        height: headerHeight,
        color: cEmerald
      });

      // Header Text (Bold White)
      const hNo = 'NO.';
      const hCode = 'CODE';
      const hDesc = 'DESCRIPTION';
      const headerTextY = headerBottomY + (headerHeight - hFontSize) / 2 + 1.0;

      page.drawText(hNo, {
        x: tableLeftX + (col1W - fontBold.widthOfTextAtSize(hNo, hFontSize)) / 2,
        y: headerTextY,
        size: hFontSize,
        font: fontBold,
        color: cWhite
      });

      page.drawText(hCode, {
        x: tableLeftX + col1W + 8.0,
        y: headerTextY,
        size: hFontSize,
        font: fontBold,
        color: cWhite
      });

      page.drawText(hDesc, {
        x: tableLeftX + col1W + col2W + 8.0,
        y: headerTextY,
        size: hFontSize,
        font: fontBold,
        color: cWhite
      });

      // Header white vertical dividers
      page.drawLine({
        start: { x: tableLeftX + col1W, y: headerBottomY },
        end: { x: tableLeftX + col1W, y: headerBottomY + headerHeight },
        thickness: 0.75,
        color: cWhite
      });
      page.drawLine({
        start: { x: tableLeftX + col1W + col2W, y: headerBottomY },
        end: { x: tableLeftX + col1W + col2W, y: headerBottomY + headerHeight },
        thickness: 0.75,
        color: cWhite
      });

      // Table Rows
      let curRowY = headerBottomY;
      currentProducts.forEach((p) => {
        globalProductIndex++;
        curRowY -= rowHeight;

        // Horizontal bottom row divider
        page.drawLine({
          start: { x: tableLeftX, y: curRowY },
          end: { x: tableLeftX + tableWidth, y: curRowY },
          thickness: 0.5,
          color: cTableGrid
        });

        // Vertical column dividers
        page.drawLine({
          start: { x: tableLeftX + col1W, y: curRowY },
          end: { x: tableLeftX + col1W, y: curRowY + rowHeight },
          thickness: 0.5,
          color: cTableGrid
        });
        page.drawLine({
          start: { x: tableLeftX + col1W + col2W, y: curRowY },
          end: { x: tableLeftX + col1W + col2W, y: curRowY + rowHeight },
          thickness: 0.5,
          color: cTableGrid
        });

        // Cell 1: Number (centered, bold, 9pt)
        const noStr = String(globalProductIndex);
        page.drawText(noStr, {
          x: tableLeftX + (col1W - fontBold.widthOfTextAtSize(noStr, cellFontSize)) / 2,
          y: curRowY + (rowHeight - cellFontSize) / 2 + 1.0,
          size: cellFontSize,
          font: fontBold,
          color: cDark
        });

        // Cell 2: Product Code (left-aligned with 8pt padding, bold, 9pt)
        const codeFit = fitText(p.code, col2W - 16, fontBold, cellFontSize);
        page.drawText(codeFit.text, {
          x: tableLeftX + col1W + 8.0,
          y: curRowY + (rowHeight - codeFit.size) / 2 + 1.0,
          size: codeFit.size,
          font: fontBold,
          color: cDark
        });

        // Cell 3: Product Description / Name (left-aligned with 8pt padding, regular, 9pt)
        const descFit = fitText(p.name, col3W - 16, fontRegular, cellFontSize);
        page.drawText(descFit.text, {
          x: tableLeftX + col1W + col2W + 8.0,
          y: curRowY + (rowHeight - descFit.size) / 2 + 1.0,
          size: descFit.size,
          font: fontRegular,
          color: cDark
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
          y: curRowY - 10,
          size: 9.0,
          font: fontBold,
          color: cDark
        });
      }
    } else {
      // 2-Column Table: NO. | NAME OF THE PRODUCTS (for HFA Scheme, Cosmetics, SMIIC)
      const col1W = 40.0;
      const col2W = tableWidth - col1W; // 465.0 pt

      // Draw Header Background (Emerald Green)
      page.drawRectangle({
        x: tableLeftX,
        y: headerBottomY,
        width: tableWidth,
        height: headerHeight,
        color: cEmerald
      });

      // Header Text (Bold White)
      const hNo = 'NO.';
      const hName = 'NAME OF THE PRODUCTS';
      const headerTextY = headerBottomY + (headerHeight - hFontSize) / 2 + 1.0;

      page.drawText(hNo, {
        x: tableLeftX + (col1W - fontBold.widthOfTextAtSize(hNo, hFontSize)) / 2,
        y: headerTextY,
        size: hFontSize,
        font: fontBold,
        color: cWhite
      });

      page.drawText(hName, {
        x: tableLeftX + col1W + 10.0,
        y: headerTextY,
        size: hFontSize,
        font: fontBold,
        color: cWhite
      });

      // Header white vertical divider
      page.drawLine({
        start: { x: tableLeftX + col1W, y: headerBottomY },
        end: { x: tableLeftX + col1W, y: headerBottomY + headerHeight },
        thickness: 0.75,
        color: cWhite
      });

      // Table Rows
      let curRowY = headerBottomY;
      currentProducts.forEach((p) => {
        globalProductIndex++;
        curRowY -= rowHeight;

        // Horizontal bottom row divider
        page.drawLine({
          start: { x: tableLeftX, y: curRowY },
          end: { x: tableLeftX + tableWidth, y: curRowY },
          thickness: 0.5,
          color: cTableGrid
        });

        // Vertical column divider
        page.drawLine({
          start: { x: tableLeftX + col1W, y: curRowY },
          end: { x: tableLeftX + col1W, y: curRowY + rowHeight },
          thickness: 0.5,
          color: cTableGrid
        });

        // Cell 1: Number (centered, bold, 9pt)
        const noStr = String(globalProductIndex);
        page.drawText(noStr, {
          x: tableLeftX + (col1W - fontBold.widthOfTextAtSize(noStr, cellFontSize)) / 2,
          y: curRowY + (rowHeight - cellFontSize) / 2 + 1.0,
          size: cellFontSize,
          font: fontBold,
          color: cDark
        });

        // Cell 2: Product Name (left-aligned with 10pt padding, regular, 9pt)
        const nameFit = fitText(p.name, col2W - 20, fontRegular, cellFontSize);
        page.drawText(nameFit.text, {
          x: tableLeftX + col1W + 10.0,
          y: curRowY + (rowHeight - nameFit.size) / 2 + 1.0,
          size: nameFit.size,
          font: fontRegular,
          color: cDark
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
          y: curRowY - 10,
          size: 9.0,
          font: fontBold,
          color: cDark
        });
      }
    }

    // 6. Signatures (Clean PNG overlays directly above CEO and Mufti titles)
    if (amirSigImg) {
      page.drawImage(amirSigImg, {
        x: 34,
        y: 154,
        width: 78,
        height: 35
      });
    }

    if (muftiSigImg) {
      page.drawImage(muftiSigImg, {
        x: 415,
        y: 154,
        width: 95,
        height: 35
      });
    }

    // 7. QR Code (Bottom Left)
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

    // 8. Dynamic Page Numbering: "Page X of Y" (drawn on multi-page certs or clean bases)
    if (totalPages > 1 || !isUnlockedBase) {
      if (totalPages > 1) {
        page.drawRectangle({
          x: 502,
          y: 58,
          width: 72,
          height: 20,
          color: cWhite
        });
      }
      const pageNoStr = `Page ${pageIdx + 1} of ${totalPages}`;
      page.drawText(pageNoStr, {
        x: 509,
        y: 68.5,
        size: 8.5,
        font: fontOblique,
        color: cDark
      });
    }

    // 9. QR Verification Notice & Doc Footer (drawn if not already pre-printed on template)
    if (!isUnlockedBase) {
      const verifyText = 'TO VERIFY THE CONTENTS OF THIS DOCUMENT, PLEASE SCAN THE QR CODE';
      const verifyW = fontBold.widthOfTextAtSize(verifyText, 7.5);
      page.drawText(verifyText, {
        x: (PAGE_WIDTH - verifyW) / 2,
        y: 34.2,
        size: 7.5,
        font: fontBold,
        color: cDark
      });

      const footerText = scheme.docFooter || 'Doc: Halal Certificate';
      const footerW = fontRegular.widthOfTextAtSize(footerText, 6.5);
      page.drawText(footerText, {
        x: (PAGE_WIDTH - footerW) / 2,
        y: 10.94,
        size: 6.5,
        font: fontRegular,
        color: cDark
      });
    }
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

/**
 * Builds HTML representation for web previews matching the exact official template.
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
    productCategory,
    issueDate = new Date(),
    expiryDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    certificationStartDate,
    currentCycleStartDate,
    originalCycleStartDate,
    productCategories = [],
    products = [],
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

  let resolvedMfgAddress = '';
  if (rawMfg && rawMfg !== '-' && rawMfg !== '—' && rawMfg.toUpperCase() !== 'N/A') {
    resolvedMfgAddress = rawMfg.toUpperCase();
  } else if (!isCompanyAddrEmpty) {
    resolvedMfgAddress = 'SAME AS ABOVE';
  } else {
    resolvedMfgAddress = 'SAME AS ABOVE';
  }

  const resolvedName = (companyName || businessName || certData.company_name || 'Halal Certified Client').toUpperCase();
  const resolvedScope = (scope || scopeOfCertification || productCategory || certData.scope || certData.scopeOfCertification || certData.productCategory || 'PRODUCTION AND SUPPLY OF HALAL CERTIFIED PRODUCTS').toUpperCase();

  const normalizedScheme = normalizeCertificateType(certificateType || certData.certificate_type);
  const scheme = CERTIFICATE_SCHEMES[normalizedScheme] || CERTIFICATE_SCHEMES['HFA Scheme'];
  const isGso = scheme.templateType === 'gso';

  const qrUrl = verificationUrl || `${process.env.FRONTEND_CLIENT_URL || 'https://hfaportal.company'}/verify/${certificateNumber}`;
  const qrBase64 = await QRCode.toDataURL(qrUrl, { margin: 0, width: 250 });

  const formattedIssue = formatDate(issueDate);
  const formattedExpiry = formatDate(expiryDate);
  const formattedCertStart = formatDate(certificationStartDate || issueDate);
  const formattedCurrentCycle = formatDate(currentCycleStartDate || issueDate);
  const formattedOrigCycle = formatDate(originalCycleStartDate || issueDate);

  const rawProducts = (products && products.length > 0) ? products : productCategories;
  const productList = (rawProducts && rawProducts.length > 0)
    ? rawProducts.map((p, idx) => {
        if (typeof p === 'string') return { code: `PRD-${String(idx + 1).padStart(2, '0')}`, name: p };
        return {
          code: p.code || p.product_code || p.brand || `PRD-${String(idx + 1).padStart(2, '0')}`,
          name: p.name || p.product_name || p.description || `Product ${idx + 1}`
        };
      })
    : [{ code: 'PRD-01', name: 'Certified Halal Products' }];

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
        .cert-no-label { color: #0b7c47; }
        .dates-row { display: flex; justify-content: space-between; font-size: 8pt; margin-top: 8px; }
        .dates-row-center { text-align: center; font-size: 8pt; margin-top: 4px; }
        .date-label { color: #0b7c47; }
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
              ${isGso ? `
                <th style="width: 38pt; text-align: center;">NO.</th>
                <th style="width: 122pt; text-align: left; padding-left: 8px;">CODE</th>
                <th style="text-align: left; padding-left: 8px;">DESCRIPTION</th>
              ` : `
                <th style="width: 40pt; text-align: center;">NO.</th>
                <th style="text-align: left; padding-left: 10px;">NAME OF THE PRODUCTS</th>
              `}
            </tr>
          </thead>
          <tbody>
            ${productList.map((p, idx) => `
              <tr>
                <td style="text-align: center; font-weight: 700;">${idx + 1}</td>
                ${isGso ? `<td style="text-align: left; padding-left: 8px; font-weight: 700;">${p.code}</td><td style="text-align: left; padding-left: 8px;">${p.name}</td>` : `<td style="text-align: left; padding-left: 10px;">${p.name}</td>`}
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

