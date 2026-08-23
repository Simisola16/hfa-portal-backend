import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';
import QRCode from 'qrcode';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function generateQRCode(url) {
  return await QRCode.toDataURL(url, {
    margin: 0,
    width: 250,
    color: { dark: '#112211', light: '#ffffff' }
  });
}

function formatDate(dateVal) {
  if (!dateVal) return '—';
  const date = new Date(dateVal);
  if (isNaN(date.getTime())) return String(dateVal);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

export const CERT_CONFIGS = {
  'HFA Scheme': {
    templateType: 'hfa',
    bgFile: 'hfa_scheme_bg.png',
    docFooter: 'Doc: Halal Certificate (HFA Scheme)   Created by: MH   Approved by: HI   Version: 2   Date: 11.10.2022',
    certNoTop: '23.4%',
    datesTop: '25.3%',
    infoTop: '34.6%',
    tableTop: '48.6%'
  },
  'Cosmetics': {
    templateType: 'hfa',
    bgFile: 'cosmetics_bg.png',
    docFooter: 'Doc: Halal Certificate (HFA Cosmetic Scheme)   Created by: MH   Approved by: HI   Version: 2   Date: 11.10.2022',
    certNoTop: '27.0%',
    datesTop: '29.3%',
    infoTop: '37.4%',
    tableTop: '51.0%'
  },
  'Smiic': {
    templateType: 'hfa',
    bgFile: 'smiic_bg.png',
    docFooter: 'Doc: Halal Certificate (SMIIC Scheme)   Created by: MH   Approved by: HI   Version: 2   Date: 11.10.2022',
    certNoTop: '24.4%',
    datesTop: '26.6%',
    infoTop: '36.5%',
    tableTop: '50.2%'
  },
  'GSO meat': {
    templateType: 'gso',
    bgFile: 'gso_meat_bg.png',
    docFooter: 'Doc: Halal Certificate (GSO meat)   Created by: AH   Amended by: TO   Approved by: AM   Version: 16   Date: 28.10.2024',
    certNoTop: '24.4%',
    datesTop: '26.6%',
    infoTop: '38.5%',
    tableTop: '51.8%'
  },
  'GSO non-meat': {
    templateType: 'gso',
    bgFile: 'gso_non_meat_bg.png',
    docFooter: 'Doc: Halal Certificate (GSO non-meat)   Created by: AH   Amended by: TO   Approved by: AM   Version: 16   Date: 28.10.2024',
    certNoTop: '24.4%',
    datesTop: '26.6%',
    infoTop: '38.5%',
    tableTop: '51.8%'
  }
};

export async function renderCertificateHtml(certData) {
  const {
    certificateType = 'HFA Scheme',
    certificateNumber = 'HFA-UK-2026-00123',
    companyName = 'Apex Global Foods Ltd',
    companyAddress = 'Unit 4, Royal Industrial Estate, Manchester, M12 4HR, UK',
    manufacturingAddress = 'Unit 4, Royal Industrial Estate, Manchester, M12 4HR, UK',
    scope = 'Processing, Packaging and Distribution of Halal Certified Food Products',
    issueDate = new Date(),
    expiryDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    certificationStartDate = new Date(),
    currentCycleStartDate = new Date(),
    originalCycleStartDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
    products = [],
    verificationUrl
  } = certData;

  const normalizedType = CERT_CONFIGS[certificateType] ? certificateType : 'HFA Scheme';
  const config = CERT_CONFIGS[normalizedType];
  const bgPath = path.join(__dirname, '../assets/certificates', config.bgFile);
  const bgBuffer = fs.readFileSync(bgPath);
  const bgBase64 = `data:image/png;base64,${bgBuffer.toString('base64')}`;

  const qrUrl = verificationUrl || `https://hfa-uk-portal.com/verify/${certificateNumber}`;
  const qrBase64 = await generateQRCode(qrUrl);

  const formattedIssue = formatDate(issueDate);
  const formattedExpiry = formatDate(expiryDate);
  const formattedCertStart = formatDate(certificationStartDate || issueDate);
  const formattedCurrentCycle = formatDate(currentCycleStartDate || issueDate);
  const formattedOrigCycle = formatDate(originalCycleStartDate || issueDate);

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
          <div class="info-val">${companyName}</div>
        </div>
        <div class="info-row">
          <div class="info-label">COMPANY ADDRESS:</div>
          <div class="info-val">${companyAddress}</div>
        </div>
        <div class="info-row">
          <div class="info-label">MANUFACTURING FACILITY(IES) ADDRESS (IF DIFFERENT):</div>
          <div class="info-val">${manufacturingAddress || 'Same as above'}</div>
        </div>
        <div class="info-row">
          <div class="info-label">PRODUCT CATEGORY:</div>
          <div class="info-val">${scope}</div>
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
                products && products.length > 0
                  ? products.slice(0, 6).map((p, idx) => `
                    <tr>
                      <td style="text-align: center;">${idx + 1}</td>
                      <td style="padding-left: 12px;">${p.name || p}</td>
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
                products && products.length > 0
                  ? products.slice(0, 6).map((p, idx) => `
                    <tr>
                      <td style="text-align: center;">${idx + 1}</td>
                      <td style="text-align: center;">${p.code || `PRD-${String(idx + 1).padStart(2, '0')}`}</td>
                      <td style="padding-left: 12px;">${p.name || p.description || p}</td>
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

async function testAll() {
  const browser = await puppeteer.launch({ 
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const testTypes = ['HFA Scheme', 'Cosmetics', 'Smiic', 'GSO meat', 'GSO non-meat'];
  const outDir = path.resolve(__dirname, '../scratch/test_cert_output');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  for (const t of testTypes) {
    const html = await renderCertificateHtml({
      certificateType: t,
      certificateNumber: `HFA-UK-2026-${Math.floor(1000 + Math.random() * 9000)}`,
      companyName: 'Al-Madina Food & Consumer Industries Ltd',
      companyAddress: 'Unit 12, Park Royal Road, London, NW10 7JH, United Kingdom',
      manufacturingAddress: 'Unit 12, Park Royal Road, London, NW10 7JH, United Kingdom',
      scope: t === 'Cosmetics' ? 'Manufacture of Halal Cosmetics & Personal Care' : 'Slaughtering, Processing and Packaging of Halal Meat and Food Products',
      issueDate: new Date('2026-03-01'),
      expiryDate: new Date('2027-02-28'),
      certificationStartDate: new Date('2026-03-01'),
      currentCycleStartDate: new Date('2026-03-01'),
      originalCycleStartDate: new Date('2024-03-01'),
      products: [
        { code: 'PRD-01', name: 'Premium Grade Organic Halal Product A' },
        { code: 'PRD-02', name: 'Refined Quality Halal Batch Formulation B' },
        { code: 'PRD-03', name: 'Standard Inspected Halal Certified C' }
      ]
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load', timeout: 15000 });
    const pdfPath = path.join(outDir, `${t.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true
    });

    const previewPngPath = path.join(outDir, `${t.replace(/[^a-zA-Z0-9]/g, '_')}.png`);
    await page.screenshot({ path: previewPngPath, fullPage: true });

    console.log(`Generated: ${t} -> ${pdfPath} and ${previewPngPath}`);
    await page.close();
  }

  await browser.close();
  console.log('All 5 certificate test outputs generated successfully!');
}

testAll().catch(console.error);
