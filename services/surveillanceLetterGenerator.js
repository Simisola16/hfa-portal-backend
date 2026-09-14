import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';
import QRCode from 'qrcode';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Generate a base64 encoded QR Code image from a URL.
 */
async function generateQRCode(url) {
  try {
    return await QRCode.toDataURL(url, {
      margin: 0,
      width: 200,
      color: {
        dark: '#0f3a22',
        light: '#ffffff'
      }
    });
  } catch (err) {
    console.error('Error generating QR Code for surveillance letter:', err);
    return '';
  }
}

/**
 * Formats a Date object or date string into standard UK format (e.g. 24 August 2026).
 */
function formatLetterDate(dateVal) {
  if (!dateVal) return '—';
  const date = new Date(dateVal);
  if (isNaN(date.getTime())) return String(dateVal);
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

function formatShortDate(dateVal) {
  if (!dateVal) return '—';
  const date = new Date(dateVal);
  if (isNaN(date.getTime())) return String(dateVal);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Builds the complete HTML string for the Official Surveillance Letter.
 */
export async function buildSurveillanceLetterHtml(letterData = {}) {
  const {
    letter_number = 'HFA-SURV-' + Date.now().toString().slice(-6),
    issue_date = new Date(),
    next_due_date = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    surveillance_cycle = 'Annual Halal Surveillance Audit (UAE/GSO 3-Year Scheme)',
    recipient_name = 'Halal Certified Facility',
    recipient_address = '—',
    recipient_attention = 'Quality Assurance & Regulatory Compliance Management',
    letter_subject = 'CONFIRMATION OF CONTINUED HALAL CERTIFICATION COMPLIANCE — ANNUAL SURVEILLANCE',
    letter_salutation = 'Dear Sir / Madam,',
    letter_body = '',
    products_covered = 'As per approved Halal Certified Product Schedule and Facility Scope.',
    standards = 'UAE.S 2055-1:2015, GSO 2055-1:2015 & HFA Scheme Standards',
    signatory_name = 'HFA Halal Certification Committee',
    signatory_title = 'Director of Auditing & Halal Compliance',
    signatory_org = 'Halal Food Authority (HFA)',
    verification_url
  } = letterData;

  // Load HFA logo as base64
  let logoBase64 = '';
  const logoPath = path.join(__dirname, '../assets/hfa-logo.png');
  if (fs.existsSync(logoPath)) {
    const logoBuf = fs.readFileSync(logoPath);
    logoBase64 = `data:image/png;base64,${logoBuf.toString('base64')}`;
  }

  const formattedIssue = formatLetterDate(issue_date);
  const formattedNextDue = formatLetterDate(next_due_date);
  const formattedIssueShort = formatShortDate(issue_date);
  const formattedNextDueShort = formatShortDate(next_due_date);

  const qrTarget = verification_url || `${process.env.FRONTEND_CLIENT_URL || 'https://hfaportal.company'}/verify/${letter_number}`;
  const qrCodeBase64 = await generateQRCode(qrTarget);

  // Default body paragraphs if none provided
  const resolvedBody = letter_body && letter_body.trim()
    ? letter_body.trim()
    : `We are pleased to confirm that the Halal Food Authority (HFA) has successfully concluded the Annual Halal Surveillance Audit for ${recipient_name} in accordance with ${standards}.

Following a comprehensive audit and verification of your facility operations, raw materials, ingredient traceability, sanitation protocols, and Halal Assurance System (HAS), the HFA Certification Committee confirms that your operations continue to satisfy all required Halal compliance standards.

Consequently, your UAE/GSO 3-Year Halal Certification remains fully active and in good standing. This confirmation letter serves as official endorsement of continued compliance until your next scheduled surveillance milestone.`;

  // Split paragraphs by newlines for clean rendering
  const paragraphs = resolvedBody
    .split(/\n\s*\n|\n/)
    .map(p => p.trim())
    .filter(Boolean);

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>HFA Official Surveillance Letter - ${letter_number}</title>
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
          min-height: 297mm;
          margin: 0;
          padding: 16mm 20mm 16mm 20mm;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          color: #1e293b;
          background: #ffffff;
          -webkit-print-color-adjust: exact;
          position: relative;
          line-height: 1.55;
          font-size: 10pt;
        }

        /* Top Decorative Border */
        .top-accent-bar {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 6px;
          background: linear-gradient(90deg, #047857 0%, #059669 40%, #10b981 70%, #d97706 100%);
        }

        /* Header / Letterhead */
        .letterhead {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-bottom: 12px;
          border-bottom: 2px solid #047857;
          margin-bottom: 18px;
        }
        .letterhead-logo-container {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .letterhead-logo {
          width: 76px;
          height: auto;
          max-height: 76px;
          object-fit: contain;
        }
        .letterhead-title {
          font-size: 18pt;
          font-weight: 800;
          color: #047857;
          letter-spacing: -0.5px;
          line-height: 1.1;
        }
        .letterhead-subtitle {
          font-size: 8.5pt;
          font-weight: 600;
          color: #475569;
          margin-top: 3px;
          text-transform: uppercase;
          letter-spacing: 0.6px;
        }
        .letterhead-contact {
          text-align: right;
          font-size: 7.5pt;
          color: #64748b;
          line-height: 1.45;
        }
        .letterhead-contact strong {
          color: #1e293b;
        }

        /* Ref and Date Meta Bar */
        .meta-strip {
          display: flex;
          justify-content: space-between;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-left: 4px solid #047857;
          border-radius: 6px;
          padding: 8px 14px;
          margin-bottom: 16px;
          font-size: 8.8pt;
        }
        .meta-item {
          display: flex;
          gap: 6px;
        }
        .meta-label {
          font-weight: 700;
          color: #475569;
        }
        .meta-value {
          font-weight: 800;
          color: #0f172a;
        }

        /* Recipient Section */
        .recipient-block {
          margin-bottom: 16px;
          font-size: 9.5pt;
          line-height: 1.4;
        }
        .recipient-to {
          font-size: 8pt;
          font-weight: 700;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 2px;
        }
        .recipient-company {
          font-size: 11pt;
          font-weight: 800;
          color: #047857;
        }
        .recipient-address {
          color: #334155;
          max-width: 420px;
          margin-top: 2px;
          white-space: pre-line;
        }
        .recipient-attn {
          font-size: 8.5pt;
          color: #64748b;
          margin-top: 3px;
        }

        /* Subject Line */
        .subject-box {
          background: #ecfdf5;
          border: 1px solid #a7f3d0;
          border-radius: 6px;
          padding: 8px 12px;
          margin-bottom: 14px;
        }
        .subject-title {
          font-size: 10pt;
          font-weight: 800;
          color: #065f46;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }

        /* Salutation */
        .salutation {
          font-weight: 700;
          color: #1e293b;
          margin-bottom: 10px;
          font-size: 10pt;
        }

        /* Body Paragraphs */
        .body-text {
          font-size: 9.5pt;
          color: #334155;
          text-align: justify;
        }
        .body-p {
          margin-bottom: 10px;
          line-height: 1.55;
        }

        /* Scope & Standards Callout Card */
        .scope-card {
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
          border-radius: 8px;
          padding: 10px 14px;
          margin: 14px 0;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          font-size: 8.8pt;
        }
        .scope-card-full {
          grid-column: span 2;
        }
        .scope-field-label {
          font-size: 7.5pt;
          font-weight: 700;
          color: #047857;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          margin-bottom: 2px;
        }
        .scope-field-val {
          font-weight: 700;
          color: #0f172a;
        }

        /* Next Due Date Banner */
        .milestone-banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #fefce8;
          border: 1px solid #fef08a;
          border-radius: 6px;
          padding: 8px 12px;
          margin-bottom: 16px;
          font-size: 8.8pt;
        }
        .milestone-title {
          font-weight: 700;
          color: #854d0e;
        }
        .milestone-badge {
          background: #ca8a04;
          color: #ffffff;
          font-size: 8.5pt;
          font-weight: 800;
          padding: 3px 8px;
          border-radius: 4px;
        }

        /* Signatory & Official Endorsement Block */
        .footer-endorsement {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          margin-top: 18px;
          padding-top: 12px;
          border-top: 1px solid #e2e8f0;
        }
        .signatory-box {
          font-size: 9pt;
          line-height: 1.4;
        }
        .signatory-sig {
          font-family: 'Brush Script MT', 'Lucida Handwriting', cursive;
          font-size: 20pt;
          color: #047857;
          margin-bottom: 4px;
          letter-spacing: 1px;
        }
        .signatory-name {
          font-weight: 800;
          color: #0f172a;
        }
        .signatory-title {
          color: #475569;
          font-size: 8.5pt;
        }
        .signatory-org {
          color: #047857;
          font-weight: 700;
          font-size: 8.5pt;
        }

        .seal-qr-group {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .official-seal-box {
          text-align: center;
          border: 2px dashed #047857;
          border-radius: 50%;
          width: 72px;
          height: 72px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 4px;
          background: #f0fdf4;
        }
        .seal-title {
          font-size: 6pt;
          font-weight: 800;
          color: #047857;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }
        .seal-star {
          color: #059669;
          font-size: 9pt;
          line-height: 1;
          margin: 1px 0;
        }
        .seal-sub {
          font-size: 5.5pt;
          font-weight: 700;
          color: #065f46;
          text-transform: uppercase;
        }

        .qr-box {
          text-align: center;
        }
        .qr-box img {
          width: 64px;
          height: 64px;
          display: block;
          margin: 0 auto;
        }
        .qr-label {
          font-size: 6.5pt;
          color: #64748b;
          font-weight: 600;
          margin-top: 2px;
        }

        /* Document Footer */
        .doc-footer {
          position: absolute;
          bottom: 12mm;
          left: 20mm;
          right: 20mm;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-top: 1px solid #cbd5e1;
          padding-top: 6px;
          font-size: 7pt;
          color: #64748b;
        }
        .doc-footer strong {
          color: #334155;
        }
      </style>
    </head>
    <body>
      <div class="top-accent-bar"></div>

      <!-- Letterhead -->
      <div class="letterhead">
        <div class="letterhead-logo-container">
          ${logoBase64 ? `<img src="${logoBase64}" class="letterhead-logo" alt="HFA Logo" />` : ''}
          <div>
            <div class="letterhead-title">HALAL FOOD AUTHORITY</div>
            <div class="letterhead-subtitle">UK & International Halal Certification Body</div>
          </div>
        </div>
        <div class="letterhead-contact">
          <strong>Halal Food Authority (HFA)</strong><br />
          3rd Floor, 55 New Oxford Street<br />
          London WC1A 1BS, United Kingdom<br />
          Tel: +44 (0) 20 7404 0700 &bull; info@halalfoodauthority.com<br />
          www.halalfoodauthority.com
        </div>
      </div>

      <!-- Reference & Date Strip -->
      <div class="meta-strip">
        <div class="meta-item">
          <span class="meta-label">Letter Ref:</span>
          <span class="meta-value">${letter_number}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Date Issued:</span>
          <span class="meta-value">${formattedIssue}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Cycle / Scheme:</span>
          <span class="meta-value">${surveillance_cycle}</span>
        </div>
      </div>

      <!-- Recipient Block -->
      <div class="recipient-block">
        <div class="recipient-to">Issued To:</div>
        <div class="recipient-company">${recipient_name}</div>
        ${recipient_address && recipient_address !== '—' ? `<div class="recipient-address">${recipient_address}</div>` : ''}
        ${recipient_attention ? `<div class="recipient-attn"><strong>Attn:</strong> ${recipient_attention}</div>` : ''}
      </div>

      <!-- Subject Box -->
      <div class="subject-box">
        <div class="subject-title">Subject: ${letter_subject}</div>
      </div>

      <!-- Salutation -->
      <div class="salutation">${letter_salutation}</div>

      <!-- Body Content -->
      <div class="body-text">
        ${paragraphs.map(p => `<p class="body-p">${p}</p>`).join('')}
      </div>

      <!-- Scope & Standards Callout Card -->
      <div class="scope-card">
        <div class="scope-card-full">
          <div class="scope-field-label">Certified Product & Operations Scope</div>
          <div class="scope-field-val">${products_covered || 'All certified products registered under active HFA schedule.'}</div>
        </div>
        <div>
          <div class="scope-field-label">Applicable Standards</div>
          <div class="scope-field-val">${standards}</div>
        </div>
        <div>
          <div class="scope-field-label">Audit Outcome Status</div>
          <div class="scope-field-val" style="color: #047857;">✓ Approved & Endorsed</div>
        </div>
      </div>

      <!-- Next Milestone Banner -->
      <div class="milestone-banner">
        <div class="milestone-title">
          📌 <strong>Next Surveillance Audit / Cycle Renewal Due:</strong> ${formattedNextDue}
        </div>
        <div class="milestone-badge">Active & Compliant</div>
      </div>

      <!-- Signatory & Seal Block -->
      <div class="footer-endorsement">
        <div class="signatory-box">
          <div style="font-size: 8.5pt; color: #64748b; margin-bottom: 2px;">For and on behalf of Halal Food Authority:</div>
          <div class="signatory-sig">HFA Certification Board</div>
          <div class="signatory-name">${signatory_name}</div>
          <div class="signatory-title">${signatory_title}</div>
          <div class="signatory-org">${signatory_org}</div>
        </div>

        <div class="seal-qr-group">
          <div class="official-seal-box">
            <div class="seal-title">Official Seal</div>
            <div class="seal-star">★ ★ ★</div>
            <div class="seal-sub">HFA UK</div>
            <div class="seal-sub" style="font-size: 5pt; color: #047857;">VERIFIED</div>
          </div>

          ${qrCodeBase64 ? `
            <div class="qr-box">
              <img src="${qrCodeBase64}" alt="Verification QR" />
              <div class="qr-label">Scan to Verify</div>
            </div>
          ` : ''}
        </div>
      </div>

      <!-- Document Footer -->
      <div class="doc-footer">
        <div><strong>Document:</strong> Official Halal Surveillance Letter &bull; Ref: ${letter_number}</div>
        <div>Halal Food Authority (HFA) is registered in England & Wales &bull; ISO/IEC 17065 Accredited</div>
        <div>Page 1 of 1</div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Generates a Surveillance Letter PDF Buffer using Puppeteer.
 * @param {Object} letterData - Surveillance letter parameters
 * @returns {Promise<Buffer>} PDF Buffer
 */
export async function generateSurveillanceLetter(letterData = {}) {
  const htmlContent = await buildSurveillanceLetterHtml(letterData);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'load', timeout: 15000 });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      landscape: false,
      printBackground: true,
      margin: {
        top: '0mm',
        right: '0mm',
        bottom: '0mm',
        left: '0mm'
      }
    });

    return pdfBuffer;
  } catch (error) {
    console.error('Puppeteer Surveillance Letter PDF Generation failed:', error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
