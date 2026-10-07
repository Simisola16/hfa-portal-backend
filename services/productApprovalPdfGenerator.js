import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Pre-load base64 logo once
let cachedLogoBase64 = null;
function getLogoBase64() {
  if (cachedLogoBase64) return cachedLogoBase64;
  try {
    const logoPath = path.resolve(__dirname, '../assets/hfa-logo.png');
    if (fs.existsSync(logoPath)) {
      cachedLogoBase64 = `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`;
      return cachedLogoBase64;
    }
  } catch (err) {
    console.error('Failed to load logo from backend/assets/hfa-logo.png:', err);
  }
  return '';
}

export function generateProductApprovalHtml({ formData = {}, product = {}, company = {} }) {
  const form = typeof formData === 'string' ? (() => {
    try { return JSON.parse(formData); } catch (e) { return {}; }
  })() : (formData || {});

  const productName = form.product_name || product?.name || 'Product Specification';
  const productCode = form.product_code || product?.code || '—';
  const productDesc = form.product_description || product?.description || '—';
  const companyName = form.company_name_address || [company?.company_name || company?.full_name, company?.address].filter(Boolean).join(', ') || '—';
  const brandOwner = form.brand_owner_name_address || 'Same as Manufacturing Facility';
  const facilityAddress = form.manufacturing_facility_address || company?.address || '—';

  const logoSrc = getLogoBase64();

  const renderRadio = (val, target, label) => {
    const isChecked = String(val || '').toLowerCase() === String(target).toLowerCase();
    return `
      <span class="radio-pill ${isChecked ? 'radio-checked' : 'radio-unchecked'}">
        <span class="radio-box">${isChecked ? '✓' : ''}</span>
        <span class="radio-label">${label}</span>
      </span>
    `;
  };

  const escapeHtml = (str) => {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return escapeHtml(dateStr);
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch {
      return escapeHtml(dateStr);
    }
  };

  const currentDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  // Filter valid ingredient rows
  const ingredients = (Array.isArray(form.ingredients) ? form.ingredients : []).filter(i => 
    i && (i.name || i.code || i.source || i.supplier || i.manufacturer || i.certificate_statement || i.halal_body_expiry)
  );

  // Filter valid processing aids
  const processingAids = (Array.isArray(form.processing_aids) ? form.processing_aids : []).filter(p =>
    p && (p.name || p.function || p.source || p.supplier_manufacturer || p.halal_status)
  );

  // Filter valid animal derivatives
  const animalDerivatives = (Array.isArray(form.animal_derivatives) ? form.animal_derivatives : []).filter(a =>
    a && (a.constituent || a.source || a.certificate_statement)
  );

  // Filter valid porcine products
  const porcineProducts = (Array.isArray(form.porcine_products) ? form.porcine_products : []).filter(p =>
    p && (p.product_name || p.code)
  );

  // Filter valid packaging details
  const packagingDetails = (Array.isArray(form.packaging_details) ? form.packaging_details : []).filter(pkg =>
    pkg && (pkg.packaging_material || pkg.chemical_composition || pkg.migration_certificate || pkg.suitability)
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Product Approval Request Form - ${escapeHtml(productName)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Great+Vibes&display=swap');

    @page {
      size: A4 portrait;
      margin: 10mm 12mm 12mm 12mm;
    }

    * {
      box-sizing: border-box;
      -webkit-font-smoothing: antialiased;
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: 0;
      font-size: 11px;
      line-height: 1.45;
    }

    .doc-container {
      max-width: 800px;
      margin: 0 auto;
      padding: 0;
    }

    /* Header Bar */
    .doc-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 12px;
      border-bottom: 2px solid #0f766e;
      margin-bottom: 12px;
    }

    .brand-col {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .brand-logo {
      width: 58px;
      height: 58px;
      object-fit: contain;
    }

    .brand-text h1 {
      font-size: 17px;
      font-weight: 900;
      color: #0f766e;
      margin: 0;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }

    .brand-text p {
      font-size: 9.5px;
      color: #475569;
      margin: 1px 0 0;
      font-weight: 500;
    }

    .doc-badge-col {
      text-align: right;
      font-size: 9.5px;
      color: #334155;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      padding: 6px 12px;
      border-radius: 6px;
    }

    .doc-badge-col strong {
      color: #0f172a;
      font-size: 10.5px;
      display: block;
      margin-bottom: 2px;
    }

    /* Title Banner */
    .title-banner {
      background: linear-gradient(135deg, #0f766e 0%, #115e59 100%);
      color: #ffffff;
      padding: 10px 16px;
      border-radius: 6px;
      text-align: center;
      margin-bottom: 14px;
    }

    .title-banner h2 {
      font-size: 15px;
      font-weight: 900;
      margin: 0;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .title-banner .sub {
      font-size: 10.5px;
      color: #ccfbf1;
      margin-top: 2px;
      font-weight: 500;
    }

    /* Section Headers */
    .section-header {
      background: #0f766e;
      color: #ffffff;
      font-size: 10.5px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 6px 10px;
      border-radius: 5px 5px 0 0;
      margin-top: 14px;
    }

    .section-box {
      border: 1px solid #cbd5e1;
      border-top: none;
      border-radius: 0 0 6px 6px;
      padding: 10px 12px;
      background: #ffffff;
      margin-bottom: 12px;
    }

    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .grid-3 {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 10px;
    }

    .field-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 5px;
      padding: 8px 10px;
    }

    .field-card .label {
      font-size: 9px;
      font-weight: 800;
      text-transform: uppercase;
      color: #475569;
      letter-spacing: 0.03em;
      margin-bottom: 3px;
    }

    .field-card .value {
      font-size: 11px;
      font-weight: 600;
      color: #0f172a;
      word-break: break-word;
    }

    .q-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 0;
      border-bottom: 1px solid #f1f5f9;
      font-size: 10.5px;
    }

    .q-row:last-child {
      border-bottom: none;
    }

    .q-text {
      flex: 1;
      padding-right: 12px;
      color: #1e293b;
      font-weight: 600;
    }

    .q-text .q-sub {
      font-size: 9px;
      color: #64748b;
      font-weight: normal;
      display: block;
      margin-top: 1px;
    }

    .radio-group {
      display: flex;
      gap: 6px;
      flex-shrink: 0;
    }

    .radio-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 9.5px;
      font-weight: 700;
      border: 1px solid #cbd5e1;
    }

    .radio-checked {
      background: #f0fdf4;
      border-color: #86efac;
      color: #15803d;
    }

    .radio-unchecked {
      background: #f8fafc;
      border-color: #e2e8f0;
      color: #94a3b8;
    }

    .radio-box {
      font-size: 11px;
      line-height: 1;
      font-weight: 900;
      width: 10px;
      display: inline-block;
      text-align: center;
    }

    table.data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10px;
      margin-top: 6px;
      background: #ffffff;
      border: 1px solid #cbd5e1;
    }

    table.data-table th {
      background: #f1f5f9;
      color: #334155;
      font-weight: 800;
      text-align: left;
      padding: 5px 7px;
      border: 1px solid #cbd5e1;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }

    table.data-table td {
      padding: 5px 7px;
      border: 1px solid #cbd5e1;
      color: #0f172a;
      vertical-align: top;
      word-break: break-word;
    }

    table.data-table tbody tr:nth-child(even) {
      background: #fafbfc;
    }

    .empty-notice {
      padding: 8px 10px;
      background: #f8fafc;
      border: 1px dashed #cbd5e1;
      border-radius: 4px;
      font-size: 10px;
      color: #64748b;
      font-style: italic;
      text-align: center;
      margin-top: 4px;
    }

    .signatory-box {
      background: #f8fafc;
      border: 1.5px solid #0f766e;
      border-radius: 6px;
      padding: 12px 14px;
      margin-top: 14px;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .legal-declaration {
      font-size: 9.5px;
      color: #334155;
      line-height: 1.45;
      margin-bottom: 12px;
      padding-bottom: 10px;
      border-bottom: 1px solid #e2e8f0;
      font-style: italic;
    }

    .sig-grid {
      display: grid;
      grid-template-columns: 1.4fr 1.2fr 1.2fr 1fr;
      gap: 12px;
      align-items: flex-end;
    }

    .sig-field .sig-label {
      font-size: 8.5px;
      font-weight: 800;
      text-transform: uppercase;
      color: #475569;
      margin-bottom: 2px;
    }

    .sig-field .sig-val {
      font-size: 11px;
      font-weight: 700;
      color: #0f172a;
      border-bottom: 1.5px solid #0f766e;
      padding-bottom: 3px;
      min-height: 20px;
    }

    .sig-field .sig-script {
      font-family: 'Great Vibes', cursive, 'Brush Script MT', sans-serif;
      font-size: 20px;
      color: #0f766e;
      line-height: 1.1;
      font-weight: 500;
    }

    .doc-footer {
      margin-top: 16px;
      padding-top: 8px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      font-size: 8.5px;
      color: #64748b;
    }

    .avoid-break {
      break-inside: avoid;
      page-break-inside: avoid;
    }
  </style>
</head>
<body>
  <div class="doc-container">

    <!-- Official Header -->
    <div class="doc-header">
      <div class="brand-col">
        ${logoSrc ? `<img class="brand-logo" src="${logoSrc}" alt="HFA Logo" />` : ''}
        <div class="brand-text">
          <h1>Halal Food Authority</h1>
          <p>UK &amp; International Halal Certification Body &bull; Registered Office: 55 Ludgate Hill, London EC4M 7JW</p>
          <p>Email: info@halalfoodauthority.com &bull; Tel: +44 20 8446 7127 &bull; www.halalfoodauthority.com</p>
        </div>
      </div>
      <div class="doc-badge-col">
        <strong>FORM REF: HFA-PAF-V2</strong>
        <span>Date: ${currentDate}</span><br/>
        <span>Halal Assurance System</span>
      </div>
    </div>

    <!-- Title Banner -->
    <div class="title-banner">
      <h2>Product Approval Request Form</h2>
      <div class="sub">Official Halal Certification Technical Specification &amp; Formulation Declaration</div>
    </div>

    <!-- Company & Facility Header Box -->
    <div class="grid-2" style="margin-bottom: 10px;">
      <div class="field-card">
        <div class="label">Manufacturing Company &amp; Address</div>
        <div class="value">${escapeHtml(companyName)}</div>
      </div>
      <div class="field-card">
        <div class="label">Brand Owner Name &amp; Address (if different)</div>
        <div class="value">${escapeHtml(brandOwner)}</div>
      </div>
    </div>

    <!-- SECTION I: PRODUCT IDENTIFICATION -->
    <div class="section-header">Section I &bull; Information About Products Submitted for Halal Certification</div>
    <div class="section-box">
      
      <div class="grid-3" style="margin-bottom: 8px;">
        <div class="field-card">
          <div class="label">1. Product Name</div>
          <div class="value" style="color: #0f766e; font-size: 12px; font-weight: 800;">${escapeHtml(productName)}</div>
        </div>
        <div class="field-card">
          <div class="label">2. Product Code</div>
          <div class="value">${escapeHtml(productCode)}</div>
        </div>
        <div class="field-card">
          <div class="label">4. Manufacturing Facility Address</div>
          <div class="value">${escapeHtml(facilityAddress)}</div>
        </div>
      </div>

      <div class="field-card" style="margin-bottom: 10px;">
        <div class="label">3. Product Description &amp; Technical Scope</div>
        <div class="value">${escapeHtml(productDesc)}</div>
      </div>

      <!-- Question 5: Already Halal Certified -->
      <div class="q-row">
        <div class="q-text">
          5. Is this product currently certified as Halal by another certification body?
        </div>
        <div class="radio-group">
          ${renderRadio(form.is_already_halal_certified, 'Yes', 'Yes')}
          ${renderRadio(form.is_already_halal_certified, 'No', 'No')}
        </div>
      </div>

      ${form.is_already_halal_certified === 'Yes' ? `
        <div class="grid-3" style="margin: 6px 0 10px; padding: 6px 8px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 5px;">
          <div>
            <div style="font-size: 8.5px; font-weight: 800; color: #166534; text-transform: uppercase;">6. Cert Body</div>
            <div style="font-size: 10.5px; font-weight: 700; color: #14532d;">${escapeHtml(form.halal_cert_body || '—')}</div>
          </div>
          <div>
            <div style="font-size: 8.5px; font-weight: 800; color: #166534; text-transform: uppercase;">Issue Date</div>
            <div style="font-size: 10.5px; font-weight: 700; color: #14532d;">${formatDate(form.halal_cert_issue_date)}</div>
          </div>
          <div>
            <div style="font-size: 8.5px; font-weight: 800; color: #166534; text-transform: uppercase;">Expiry Date</div>
            <div style="font-size: 10.5px; font-weight: 700; color: #14532d;">${formatDate(form.halal_cert_expiry_date)}</div>
          </div>
        </div>
      ` : ''}

      <!-- Question 7: Porcine Handling -->
      <div class="q-row">
        <div class="q-text">
          7. Is pork or porcine material handled/processed at the manufacturing facility?
        </div>
        <div class="radio-group">
          ${renderRadio(form.is_porcine_handled, 'Yes', 'Yes')}
          ${renderRadio(form.is_porcine_handled, 'No', 'No')}
        </div>
      </div>

      ${form.is_porcine_handled === 'Yes' ? `
        <div style="margin: 6px 0 10px; padding: 8px 10px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 5px;">
          <div style="font-size: 9px; font-weight: 800; color: #991b1b; text-transform: uppercase; margin-bottom: 2px;">
            7.1 Porcine Segregation &amp; Containment Details:
          </div>
          <div style="font-size: 10.5px; color: #7f1d1d; margin-bottom: 8px;">
            ${escapeHtml(form.porcine_segregation_details || 'No segregation notes provided.')}
          </div>

          <div style="font-size: 9px; font-weight: 800; color: #991b1b; text-transform: uppercase; margin-bottom: 4px;">
            7.2 Products containing porcine ingredients handled on-site:
          </div>
          ${porcineProducts.length > 0 ? `
            <table class="data-table">
              <thead>
                <tr>
                  <th style="width: 30px;">#</th>
                  <th>Product Name</th>
                  <th>Product Code</th>
                </tr>
              </thead>
              <tbody>
                ${porcineProducts.map((p, idx) => `
                  <tr>
                    <td style="text-align: center;">${idx + 1}</td>
                    <td>${escapeHtml(p.product_name || '—')}</td>
                    <td>${escapeHtml(p.code || '—')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<div class="empty-notice">No porcine products listed.</div>'}
        </div>
      ` : ''}

      <!-- Question 7.3: Shared Equipment Porcine -->
      <div class="q-row">
        <div class="q-text">
          7.3 Is equipment used for this product shared with products containing porcine derivative?
        </div>
        <div class="radio-group">
          ${renderRadio(form.is_equipment_shared_porcine, 'Yes', 'Yes')}
          ${renderRadio(form.is_equipment_shared_porcine, 'No', 'No')}
        </div>
      </div>

      <!-- Question 7.4: Shared Equipment Non-Halal Animal -->
      <div class="q-row">
        <div class="q-text">
          7.4 Are processing lines shared with products containing animal materials without Halal certificates?
          <span class="q-sub">(If yes, cleaning verification and validation procedure must be maintained)</span>
        </div>
        <div class="radio-group">
          ${renderRadio(form.is_equipment_shared_unhalal_animal, 'Yes', 'Yes')}
          ${renderRadio(form.is_equipment_shared_unhalal_animal, 'No', 'No')}
        </div>
      </div>

      ${form.is_equipment_shared_unhalal_animal === 'Yes' && form.cleaning_validation_procedure ? `
        <div style="margin: 6px 0 2px; padding: 6px 10px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 5px;">
          <div style="font-size: 9px; font-weight: 800; color: #92400e; text-transform: uppercase;">
            Cleaning Validation &amp; Sanitization Procedure:
          </div>
          <div style="font-size: 10px; color: #78350f;">
            ${escapeHtml(form.cleaning_validation_procedure)}
          </div>
        </div>
      ` : ''}

    </div>

    <!-- SECTION II: INGREDIENTS & PROCESSING AIDS -->
    <div class="avoid-break">
      <div class="section-header">Section II &bull; Ingredients &amp; Processing Aids Specification</div>
      <div class="section-box">
        
        <div style="font-size: 10.5px; font-weight: 800; color: #0f172a; margin-bottom: 4px;">
          8. Complete List of Ingredients Used in Product Formulation
        </div>

        ${ingredients.length > 0 ? `
          <table class="data-table">
            <thead>
              <tr>
                <th style="width: 26px; text-align: center;">#</th>
                <th>Ingredient Name</th>
                <th>Code</th>
                <th>Source</th>
                <th>Supplier</th>
                <th>Manufacturer</th>
                <th>Halal Body</th>
                <th>Halal Expiry</th>
              </tr>
            </thead>
            <tbody>
              ${ingredients.map((ing, idx) => `
                <tr>
                  <td style="text-align: center; font-weight: 700;">${idx + 1}</td>
                  <td style="font-weight: 600;">${escapeHtml(ing.name || '—')}</td>
                  <td>${escapeHtml(ing.code || '—')}</td>
                  <td>${escapeHtml(ing.source || '—')}</td>
                  <td>${escapeHtml(ing.supplier || '—')}</td>
                  <td>${escapeHtml(ing.manufacturer || '—')}</td>
                  <td>${escapeHtml(ing.certificate_statement || '—')}</td>
                  <td>${escapeHtml(ing.halal_body_expiry || '—')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : `
          <div class="empty-notice">No individual ingredient formulation items registered.</div>
        `}

        <div style="font-size: 10.5px; font-weight: 800; color: #0f172a; margin: 12px 0 4px;">
          9. Processing Aids (Enzymes, Catalysts, Microbial Cultures, Filtration Aids)
        </div>

        ${processingAids.length > 0 ? `
          <table class="data-table">
            <thead>
              <tr>
                <th style="width: 26px; text-align: center;">#</th>
                <th>Processing Aid Name</th>
                <th>Function</th>
                <th>Source</th>
                <th>Supplier / Manufacturer</th>
                <th>Halal Status</th>
              </tr>
            </thead>
            <tbody>
              ${processingAids.map((pa, idx) => `
                <tr>
                  <td style="text-align: center; font-weight: 700;">${idx + 1}</td>
                  <td style="font-weight: 600;">${escapeHtml(pa.name || '—')}</td>
                  <td>${escapeHtml(pa.function || '—')}</td>
                  <td>${escapeHtml(pa.source || '—')}</td>
                  <td>${escapeHtml(pa.supplier_manufacturer || '—')}</td>
                  <td>${escapeHtml(pa.halal_status || '—')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : `
          <div class="empty-notice">No processing aids declared for this product formulation.</div>
        `}

      </div>
    </div>

    <!-- SECTION III: ANIMAL BASED PRODUCTS & ETHANOL -->
    <div class="avoid-break">
      <div class="section-header">Section III &bull; Animal Derivatives &amp; Ethanol Content</div>
      <div class="section-box">
        
        <!-- 10. Animal Derivatives -->
        <div class="q-row">
          <div class="q-text">
            10.1 Are any animal derivatives (Bovine, Ovine, Poultry, Insects, Gelatin, etc.) used in the formulation or manufacturing?
          </div>
          <div class="radio-group">
            ${renderRadio(form.has_animal_derivatives, 'Yes', 'Yes')}
            ${renderRadio(form.has_animal_derivatives, 'No', 'No')}
          </div>
        </div>

        ${form.has_animal_derivatives === 'Yes' ? `
          <div style="margin: 6px 0 10px;">
            <div style="font-size: 9px; font-weight: 800; color: #0f172a; text-transform: uppercase; margin-bottom: 4px;">
              10.2 Details of Animal Derivatives Used:
            </div>
            ${animalDerivatives.length > 0 ? `
              <table class="data-table">
                <thead>
                  <tr>
                    <th style="width: 26px; text-align: center;">#</th>
                    <th>Constituent</th>
                    <th>Source (Species / Organ)</th>
                    <th>Halal Certificate / Statement Ref</th>
                  </tr>
                </thead>
                <tbody>
                  ${animalDerivatives.map((ad, idx) => `
                    <tr>
                      <td style="text-align: center;">${idx + 1}</td>
                      <td style="font-weight: 600;">${escapeHtml(ad.constituent || '—')}</td>
                      <td>${escapeHtml(ad.source || '—')}</td>
                      <td>${escapeHtml(ad.certificate_statement || '—')}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            ` : '<div class="empty-notice">No animal constituents detailed.</div>'}
          </div>
        ` : ''}

        <!-- 11. Ethanol -->
        <div class="q-row" style="margin-top: 6px;">
          <div class="q-text">
            11.1 Are the ingredient(s) free from ethanol and/or its derivatives (fusel oil, cognac, isoamyl alcohol)?
          </div>
          <div class="radio-group">
            ${renderRadio(form.is_ethanol_free, 'Yes', 'Yes')}
            ${renderRadio(form.is_ethanol_free, 'No', 'No')}
          </div>
        </div>

        <div class="grid-2" style="margin-top: 6px;">
          ${form.is_ethanol_free === 'No' ? `
            <div class="field-card">
              <div class="label">Ethanol Source Details</div>
              <div class="value">${escapeHtml(form.ethanol_source_details || '—')}</div>
            </div>
          ` : `
            <div class="field-card">
              <div class="label">Ethanol Source</div>
              <div class="value" style="color: #15803d; font-weight: 700;">Ethanol Free Formulation</div>
            </div>
          `}
          <div class="field-card">
            <div class="label">11.2 Ethanol % in Final Product</div>
            <div class="value">${escapeHtml(form.ethanol_percentage || '0.00%')}</div>
          </div>
        </div>

      </div>
    </div>

    <!-- SECTION IV: FOOD CONTACT PACKAGING -->
    <div class="avoid-break">
      <div class="section-header">Section IV &bull; Food Contact Packaging Specification</div>
      <div class="section-box">
        
        <!-- 12.1 Artwork / Labelling -->
        <div class="q-row">
          <div class="q-text">
            12.1 Is artwork / packaging labelling required for Halal certification approval?
            ${form.artwork_labelling_details ? `<span class="q-sub">Notes: ${escapeHtml(form.artwork_labelling_details)}</span>` : ''}
          </div>
          <div class="radio-group">
            ${renderRadio(form.is_artwork_labelling_required, 'Yes', 'Yes')}
            ${renderRadio(form.is_artwork_labelling_required, 'No', 'No')}
          </div>
        </div>

        <!-- 12.2 Animal free packaging -->
        <div class="q-row">
          <div class="q-text">
            12.2 Is the primary food contact packaging free from animal derivatives (stearates, animal slip agents)?
            ${form.packaging_animal_free_details ? `<span class="q-sub">Notes: ${escapeHtml(form.packaging_animal_free_details)}</span>` : ''}
          </div>
          <div class="radio-group">
            ${renderRadio(form.is_packaging_animal_free, 'Yes', 'Yes')}
            ${renderRadio(form.is_packaging_animal_free, 'No', 'No')}
          </div>
        </div>

        <div style="font-size: 10.5px; font-weight: 800; color: #0f172a; margin: 10px 0 4px;">
          12.3 Food Contact Packaging Material Specifications:
        </div>

        ${packagingDetails.length > 0 ? `
          <table class="data-table">
            <thead>
              <tr>
                <th style="width: 26px; text-align: center;">#</th>
                <th>Packaging Material</th>
                <th>Nature &amp; Chemical Composition</th>
                <th>Migration Certificate</th>
                <th>Product Suitability</th>
              </tr>
            </thead>
            <tbody>
              ${packagingDetails.map((pkg, idx) => `
                <tr>
                  <td style="text-align: center; font-weight: 700;">${idx + 1}</td>
                  <td style="font-weight: 600;">${escapeHtml(pkg.packaging_material || '—')}</td>
                  <td>${escapeHtml(pkg.chemical_composition || '—')}</td>
                  <td>${escapeHtml(pkg.migration_certificate || '—')}</td>
                  <td>${escapeHtml(pkg.suitability || '—')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : `
          <div class="empty-notice">No food contact packaging specifications registered.</div>
        `}

      </div>
    </div>

    <!-- SECTION V: AUTHORIZED SIGNATORY DECLARATION -->
    <div class="signatory-box">
      <div style="font-size: 11px; font-weight: 900; text-transform: uppercase; color: #0f766e; letter-spacing: 0.04em; margin-bottom: 4px;">
        Authorized Signatory Declaration
      </div>
      <div class="legal-declaration">
        "I/We hereby solemnly declare and certify that all the information, ingredient disclosures, supplier references, and manufacturing specifications provided in this Product Approval Request Form are true, accurate, and complete to the best of our knowledge. No unapproved substances, porcine derivatives, or non-compliant ingredients are utilized in the preparation or packaging of the stated product. We undertake to notify Halal Food Authority (HFA) immediately in the event of any recipe, ingredient, process, or supplier modifications."
      </div>

      <div class="sig-grid">
        <div class="sig-field">
          <div class="sig-label">Digital Signature</div>
          <div class="sig-val sig-script">
            ${escapeHtml(form.signature_text || form.print_name || 'Authorized Signatory')}
          </div>
        </div>
        <div class="sig-field">
          <div class="sig-label">Print Name</div>
          <div class="sig-val">${escapeHtml(form.print_name || '—')}</div>
        </div>
        <div class="sig-field">
          <div class="sig-label">Designation / Title</div>
          <div class="sig-val">${escapeHtml(form.designation || '—')}</div>
        </div>
        <div class="sig-field">
          <div class="sig-label">Date of Signing</div>
          <div class="sig-val">${formatDate(form.sign_date || new Date().toISOString())}</div>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="doc-footer">
      <span>Halal Food Authority (HFA) &bull; Official Product Approval Request Form (Ref: HFA-PAF-V2)</span>
      <span>Confidential Commercial Halal Compliance Record &bull; Page 1 of 1</span>
    </div>

  </div>
</body>
</html>`;
}

/**
 * Generates an official Product Approval Form PDF Buffer using Puppeteer.
 * @param {Object} params - { formData, product, company }
 * @returns {Promise<Buffer>} PDF Buffer
 */
export async function generateProductApprovalPdfBuffer({ formData = {}, product = {}, company = {} }) {
  const html = generateProductApprovalHtml({ formData, product, company });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '10mm',
        bottom: '12mm',
        left: '12mm',
        right: '12mm'
      }
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}
