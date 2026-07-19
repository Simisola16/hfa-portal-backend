import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';
import QRCode from 'qrcode';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Generate a base64 encoded QR Code image from a URL.
 * @param {string} url - The verification URL
 * @returns {Promise<string>} base64 data URL
 */
async function generateQRCode(url) {
  try {
    return await QRCode.toDataURL(url, {
      margin: 1,
      width: 150,
      color: {
        dark: '#1e3a1e',
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
  if (!dateVal) return '';
  const date = new Date(dateVal);
  if (isNaN(date.getTime())) return String(dateVal);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Generates a Halal certificate PDF buffer.
 * @param {Object} certData - Certificate fields
 * @returns {Promise<Buffer>} PDF Buffer
 */
export async function generateCertificate(certData) {
  const {
    businessName,
    certificateNumber,
    scopeOfCertification,
    productCategories = [],
    issueDate,
    expiryDate,
    verificationUrl
  } = certData;

  // Validate required fields
  if (!businessName || !certificateNumber || !issueDate || !expiryDate) {
    throw new Error('Missing required fields for certificate: businessName, certificateNumber, issueDate, and expiryDate are required.');
  }

  // Load and base64-encode background image
  const imagePath = path.join(__dirname, '../assets/certificates/Halal-Certificate.jpg');
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Certificate template image not found at ${imagePath}`);
  }
  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;

  // Generate QR Code
  const qrCodeUrl = verificationUrl || `https://hfa-uk-portal.com/verify/${certificateNumber}`;
  const qrBase64 = await generateQRCode(qrCodeUrl);

  const formattedIssueDate = formatDate(issueDate);
  const formattedExpiryDate = formatDate(expiryDate);

  // Generate HTML content
  const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Halal Certificate ${certificateNumber}</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap');
        
        @page {
          size: A4 portrait;
          margin: 0;
        }
        
        * {
          box-sizing: border-box;
        }

        body {
          margin: 0;
          padding: 0;
          width: 210mm;
          height: 297mm;
          font-family: 'Playfair Display', 'Georgia', serif;
          background-image: url('${base64Image}');
          background-size: 100% 100%;
          background-position: center;
          background-repeat: no-repeat;
          position: relative;
          -webkit-print-color-adjust: exact;
          color: #1e3a1e;
        }

        /* Cover-up elements to hide default image text */
        .cover-box {
          position: absolute;
          z-index: 1;
        }

        .cover-cert-no {
          top: 23.5%;
          left: 48%;
          width: 25%;
          height: 2.2%;
          background-color: #f1f6f1;
        }

        .cover-issue-date {
          top: 27%;
          left: 14%;
          width: 14%;
          height: 2.2%;
          background-color: #f1f6f1;
        }

        .cover-cycle-dates {
          top: 26.5%;
          left: 52%;
          width: 16%;
          height: 3.5%;
          background-color: #f1f6f1;
        }

        .cover-expiry-date {
          top: 27%;
          left: 78%;
          width: 14%;
          height: 2.2%;
          background-color: #f1f6f1;
        }

        .cover-company-details {
          top: 38.2%;
          left: 31%;
          width: 58%;
          height: 15.5%;
          background-color: #edf4ed;
        }

        .cover-table {
          top: 56.5%;
          left: 28%;
          width: 44%;
          height: 12.8%;
          background-color: #e9f0e9;
        }

        .cover-qr {
          top: 86.5%;
          left: 10%;
          width: 10%;
          height: 7.2%;
          background-color: #f6faf6;
        }

        /* Content Overlay styling */
        .overlay-text {
          position: absolute;
          z-index: 2;
          font-family: 'Playfair Display', 'Georgia', serif;
        }

        .cert-no-val {
          top: 23.5%;
          left: 48%;
          font-size: 13.5pt;
          font-weight: 700;
          color: #113311;
        }

        .issue-date-val {
          top: 27%;
          left: 14%;
          font-size: 10.5pt;
          font-weight: 700;
          color: #113311;
        }

        .expiry-date-val {
          top: 27%;
          left: 78%;
          font-size: 10.5pt;
          font-weight: 700;
          color: #113311;
        }

        .cycle-dates-val {
          top: 26.5%;
          left: 52%;
          font-size: 10pt;
          font-weight: 700;
          color: #113311;
          line-height: 1.5;
        }

        .company-name-val {
          top: 38.2%;
          left: 31%;
          font-size: 14pt;
          font-weight: 700;
          color: #111111;
          font-family: 'Playfair Display', serif;
        }

        .company-address-val {
          top: 41.2%;
          left: 31%;
          width: 58%;
          font-size: 10.5pt;
          color: #333333;
          line-height: 1.3;
          font-family: 'Playfair Display', serif;
        }

        .manufacturer-address-val {
          top: 45.2%;
          left: 31%;
          width: 58%;
          font-size: 10.5pt;
          color: #333333;
          line-height: 1.3;
          font-family: 'Playfair Display', serif;
        }

        .product-category-val {
          top: 50.8%;
          left: 31%;
          font-size: 11pt;
          color: #222222;
          font-weight: 700;
          font-family: 'Playfair Display', serif;
        }

        /* Product Table */
        .product-table {
          position: absolute;
          z-index: 2;
          top: 56.5%;
          left: 28.5%;
          width: 43%;
          border-collapse: collapse;
          font-family: Arial, sans-serif;
          font-size: 8pt;
          text-align: left;
        }

        .product-table th {
          background-color: #008b50;
          color: white;
          padding: 4px 8px;
          font-weight: bold;
          border: 1px solid #ccd9cc;
        }

        .product-table td {
          padding: 4px 8px;
          border: 1px solid #ccd9cc;
          background-color: white;
        }

        .product-table tr:nth-child(even) td {
          background-color: #f4f8f4;
        }

        .qr-code-img {
          position: absolute;
          z-index: 2;
          top: 86.3%;
          left: 10.2%;
          width: 9.6%;
          height: auto;
          mix-blend-mode: multiply;
        }
      </style>
    </head>
    <body>
      <!-- Cover Boxes -->
      <div class="cover-box cover-cert-no"></div>
      <div class="cover-box cover-issue-date"></div>
      <div class="cover-box cover-cycle-dates"></div>
      <div class="cover-box cover-expiry-date"></div>
      <div class="cover-box cover-company-details"></div>
      <div class="cover-box cover-table"></div>
      <div class="cover-box cover-qr"></div>

      <!-- Overlaid values -->
      <div class="overlay-text cert-no-val">${certificateNumber}</div>
      <div class="overlay-text issue-date-val">${formattedIssueDate}</div>
      <div class="overlay-text expiry-date-val">${formattedExpiryDate}</div>
      <div class="overlay-text cycle-dates-val">
        <div>${formattedIssueDate}</div>
        <div style="margin-top: 2px;">${formattedIssueDate}</div>
      </div>
      
      <div class="overlay-text company-name-val">${businessName}</div>
      <div class="overlay-text company-address-val">${certData.businessAddress || '—'}</div>
      <div class="overlay-text manufacturer-address-val">${certData.manufacturerAddress || 'Same as above'}</div>
      <div class="overlay-text product-category-val">${scopeOfCertification}</div>

      <!-- Products table -->
      <table class="product-table">
        <thead>
          <tr>
            <th style="width: 12%">NO.</th>
            <th style="width: 25%">CODE</th>
            <th style="width: 63%">PRODUCT NAME</th>
          </tr>
        </thead>
        <tbody>
          ${
            productCategories && productCategories.length > 0
              ? productCategories.slice(0, 3).map((prod, idx) => `
                <tr>
                  <td>${idx + 1}</td>
                  <td>${prod.code || 'GEN'}</td>
                  <td>${prod.name || prod}</td>
                </tr>
              `).join('')
              : `
                <tr>
                  <td>1</td>
                  <td>GEN</td>
                  <td>Certified Halal Food Products</td>
                </tr>
                <tr>
                  <td>2</td>
                  <td>GEN-02</td>
                  <td>Standard Processing Operations</td>
                </tr>
                <tr>
                  <td>3</td>
                  <td>GEN-03</td>
                  <td>Packaging & Distribution</td>
                </tr>
              `
          }
        </tbody>
      </table>

      <!-- QR Code -->
      <img class="qr-code-img" src="${qrBase64}" alt="QR Code" />
    </body>
    </html>
  `;

  // Puppeteer PDF Generation
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    
    // Set content and wait for it to load completely
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    // Generate PDF using format A4 (portrait default, landscape: false)
    const pdfBuffer = await page.pdf({
      format: 'A4',
      landscape: false,
      printBackground: true
    });

    return pdfBuffer;
  } catch (error) {
    console.error('Puppeteer PDF Generation failed:', error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
