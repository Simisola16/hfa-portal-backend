/**
 * Built-in Intelligent HFA Certification Knowledge Base & Support Assistant Engine
 * Provides instant, highly accurate responses for Halal Food Authority inquiries.
 */

const HFA_KNOWLEDGE = [
  {
    topic: 'schemes',
    keywords: ['scheme', 'schemes', 'gso', 'smiic', 'cosmetic', 'cosmetics', 'standard', 'standards', 'meat', 'non-meat', 'non meat', 'halal scheme'],
    title: 'HFA Halal Certification Schemes',
    answer: `**HFA operates multiple international Halal certification schemes tailored to your export markets:**

1. **HFA Standard Scheme:** The foundational Halal standard for food, beverages, and meat processing for UK, European, and broader international distribution.
2. **GSO Non-Meat Scheme (GSO 2055-1):** Dedicated standard for non-meat products (dairy, snacks, confectioneries, bakery, beverages) destined for the Gulf Cooperation Council (GCC) countries (UAE, Saudi Arabia, Qatar, Kuwait, Oman, Bahrain).
3. **GSO Meat Scheme (GSO 993 / GSO 2055-1):** Specialized certification covering Halal slaughter, post-slaughter handling, cold chain, and stunning controls for poultry, beef, and lamb exports to the GCC.
4. **SMIIC Halal Standards (OIC/SMIIC 1):** Recognised Halal standard across member states of the Organisation of Islamic Cooperation (OIC).
5. **Halal Cosmetics & Personal Care:** Covers skincare, haircare, and personal hygiene products to verify ingredients are free from porcine derivatives, non-halal animal fats, and denatured alcohols.

*Tip: You can select your required scheme when creating a new application in the Applications tab.*`
  },
  {
    topic: 'application_process',
    keywords: ['apply', 'application', 'process', 'steps', 'step', 'stages', 'procedure', 'how to apply', 'new application', 'timeline', 'how long'],
    title: 'HFA Certification Process & Stages',
    answer: `**The Halal certification journey follows eight structured stages:**

1. **Application Submission:** Submit your company profile, site details, product specifications, and raw material declarations via the portal.
2. **Food Tech Vetting:** HFA Food Technologists inspect your ingredient lists, raw material declarations, and supply chain certificates.
3. **Certification Proposal:** Scheme Managers issue a formal certification proposal outlining audit scope and fees.
4. **Proposal Acceptance & Initial Invoice:** Review and sign the proposal, then complete the initial invoice deposit.
5. **Halal Audit / Site Inspection:** An HFA qualified auditor visits your manufacturing facility (or conducts remote evaluation where allowed) to inspect storage, handling, hygiene, and traceability.
6. **Corrective Actions (NC Resolution):** If any non-conformances are flagged during the audit, submit your corrective action evidence within the agreed window.
7. **Sharia Board & Technical Committee Review:** The independent committee reviews the audit report and technical vetting.
8. **Certificate Issuance:** Upon committee sign-off and final payment, your official Halal Certificate is generated and accessible on your portal.

*Standard lead time is typically 2 to 4 weeks depending on how promptly ingredient specs and audit dates are confirmed.*`
  },
  {
    topic: 'documents',
    keywords: ['document', 'documents', 'requirement', 'requirements', 'needed', 'upload', 'spec', 'specification', 'flow chart', 'raw material'],
    title: 'Required Documentation for Halal Certification',
    answer: `**To ensure fast-track evaluation of your Halal application, please prepare the following documents:**

1. **Company Registration & Quality Manuals:** Certificate of incorporation, HACCP / ISO / BRC / IFS certificates if available.
2. **Raw Material Specification Sheets (RMSS):** Detailed specifications from raw material manufacturers for all ingredients, processing aids, and enzymes.
3. **Halal Certificates for Ingredients:** Existing Halal certificates for any critical animal-derived, alcohol-solvent, or gelatin-containing inputs.
4. **Process Flow Charts:** Step-by-step manufacturing flow chart indicating critical hygiene and cross-contamination checkpoints.
5. **Cleaning & Sanitation Matrix:** Cleaning-in-place (CIP) protocols, detergents, and sanitiser food-grade documentation.
6. **Site Plan & Layout:** Highlighting receiving, raw storage, processing zones, packaging, and finished goods storage.

*You can upload all supporting documents directly under your Application Documents tab.*`
  },
  {
    topic: 'billing',
    keywords: ['bill', 'billing', 'invoice', 'invoices', 'cost', 'fee', 'fees', 'price', 'pricing', 'payment', 'pay', 'bank', 'receipt', 'charge'],
    title: 'Invoices, Fees & Payment Guidance',
    answer: `**Here is how billing and fee settlements work in the HFA Portal:**

1. **Fee Structure:** Certification fees are calculated based on your facility size, number of processing lines, product complexity, and selected certification scheme.
2. **Invoice Stages:**
   - **Initial / Deposit Invoice:** Issued upon proposal sign-off to initiate technical vetting and schedule the site audit.
   - **Final / Annual Fee Invoice:** Issued prior to official Halal Certificate generation.
3. **Viewing & Downloading Invoices:** Navigate to the **Invoices** page from the sidebar to view all issued, paid, and outstanding invoices with full breakdown and PDF receipts.
4. **Payment Methods:** Payments can be made via BACS / electronic bank transfer using the reference code indicated on your invoice, or via our online payment gateway if enabled.
5. **Confirmation:** Once payment reaches our accounts department, your invoice status updates to **Paid** within 24 hours.

*Need specific payment verification or credit terms? Click "Request Real Person" above to connect directly with the Billing Department.*`
  },
  {
    topic: 'audit',
    keywords: ['audit', 'audits', 'auditor', 'inspection', 'inspect', 'site visit', 'visit', 'nc', 'non-conformance', 'corrective', 'prepare audit'],
    title: 'Audit Preparation & Site Inspection',
    answer: `**Here is what you need to prepare for your Halal Site Audit:**

1. **Audit Coordination:** The HFA Audit Manager will liaise with your primary contact to agree upon an audit date and dispatch the audit agenda.
2. **Key Personnel Availability:** Ensure your Quality Assurance (QA) Manager, Production Supervisor, and Halal Leader / Representative are on site during the inspection.
3. **Physical Verification:** The auditor will inspect:
   - Segregation of raw materials and clean storage.
   - Traceability drills (matching raw material batch numbers to finished product lots).
   - Cross-contamination controls (dedicated utensils, color-coded equipment).
   - Staff training records regarding Halal awareness and hygiene standards.
4. **Audit Findings & NCs:** Any non-conformances identified will be documented in the audit summary. You will be provided with an NC closure sheet to submit photographic or documentary evidence within 14-30 days.

*You can track scheduled audits and view audit reports in your Audits tab.*`
  },
  {
    topic: 'addon',
    keywords: ['add on', 'addon', 'add-on', 'add product', 'new product', 'expand products', 'extra product'],
    title: 'Add-On Applications (Adding Products to Active Certificate)',
    answer: `**Want to add new products or formulas to your existing Halal certificate?**

1. Go to the **Add-on Applications** section in your portal.
2. Click **New Add-On Application** and link it to your existing certified application or certificate.
3. Add the details for your new products, including product names, intended brands, and recipe/ingredient specs.
4. Upload raw material sheets for any new ingredients not previously vetted.
5. Our Food Technology team will review the new products. If no new site inspection is required, an add-on approval certificate or updated schedule is issued quickly without full recertification fees!

*Status can be tracked live in your Add-on Applications tracker.*`
  },
  {
    topic: 'extension',
    keywords: ['extension', 'extend', 'new site', 'extra facility', 'warehouse', 'co-packer', 'new location'],
    title: 'Extension Applications (Adding Sites & Facilities)',
    answer: `**If your company is expanding manufacturing or storage to a new location:**

1. Navigate to **Extension Applications** in the portal sidebar.
2. Submit an extension request specifying the new site address, site type (Manufacturing, Storage, Packing, Co-packer), and operational scope.
3. Provide the site license, local health authority approvals, and site layout.
4. An extension audit will be coordinated for the new location.
5. Upon successful inspection, the new facility will be added as an approved certified site under your company's Halal umbrella.

*Extension requests can be monitored through your Extension Tracker.*`
  },
  {
    topic: 'renewals',
    keywords: ['renew', 'renewal', 'expire', 'expiry', 'validity', 'annual', 're-certify', 'recertification'],
    title: 'Certificate Renewals & Annual Surveillance',
    answer: `**Halal Certificates are issued with a 1-year standard validity period:**

1. **Automated Reminders:** Your portal will show an expiry warning starting 90 days before your certificate expires.
2. **Renewal Audit:** An annual surveillance / renewal audit is scheduled prior to expiry to ensure uninterrupted certification.
3. **Changes Declaration:** You will be prompted to confirm whether any raw materials, formulations, or suppliers changed during the certification year.
4. **Renewal Certificate:** Once the renewal audit report is approved and fees are cleared, your new 1-year certificate is issued seamlessly with updated dates.

*View your current certificate status anytime on the Certificates page.*`
  },
  {
    topic: 'certificates',
    keywords: ['certificate', 'certificates', 'download certificate', 'view cert', 'pdf', 'qr code', 'verify'],
    title: 'Viewing & Downloading Official Halal Certificates',
    answer: `**Accessing your official Halal Certificates:**

1. Navigate to the **Certificates** page from the sidebar menu.
2. All active, historical, and surveillance certificates are listed with certificate numbers, issue dates, and expiry dates.
3. Click **Download PDF** to obtain high-resolution printable certificates.
4. Each HFA certificate features a cryptographic QR code and unique verification code that clients, customs officials, and retail buyers can scan to instantly verify authenticity.

*If you need export batch certificates for specific freight shipments, head to the Export Certificates section.*`
  },
  {
    topic: 'export',
    keywords: ['export', 'consignment', 'batch', 'customs', 'shipping', 'container', 'air freight', 'sea freight'],
    title: 'Export / Consignment Certificates',
    answer: `**HFA provides shipment-specific Halal Export Certificates for individual consignments:**

1. Go to the **Export Certificates** section in the portal.
2. Click **Request Export Certificate**.
3. Select your certified application and provide consignment details (Invoice/PO number, importer details, destination port, bill of lading / airway bill, container numbers, and product batch breakdown).
4. Upload health certificate or shipping manifests.
5. The HFA Export Officer evaluates and stamps the consignment certificate for customs clearance in the destination country.

*Export requests are usually processed within 24 to 48 business hours.*`
  }
];

/**
 * Intelligent NLP Matcher & Response Generator
 * @param {string} userMessage - The question asked by the user
 * @param {Array} history - Previous messages array
 * @returns {object} { reply: string, suggestedDepartment?: string, needsHumanOffer: boolean }
 */
export function generateSupportAiResponse(userMessage = '', history = []) {
  const query = userMessage.trim().toLowerCase();

  // 1. Direct request to speak with a human
  const humanTriggers = [
    'human', 'real person', 'agent', 'someone', 'talk to person', 'representative',
    'speak to someone', 'call me', 'customer service', 'manager', 'support manager',
    'connect me', 'helpdesk', 'complain', 'complaint', 'stuck', 'urgent'
  ];
  if (humanTriggers.some(t => query.includes(t))) {
    return {
      reply: `I'd be glad to connect you with an HFA representative! 

You can click the **"Request Human Agent"** button at the top of this chatbox to choose your department (**Billing, Application, Certificate, Audit, Food Tech, or Other**) and type your issue description.

Our **Support Manager** will be immediately alerted to review your request and assign the right specialist to assist you right here in this chat!`,
      needsHumanOffer: true,
      suggestedDepartment: 'General'
    };
  }

  // 2. Greeting
  const greetings = ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'salam', 'assalamu alaikum', 'assalamualaikum', 'salams'];
  if (greetings.includes(query) || greetings.some(g => query.startsWith(`${g} `) || query.endsWith(` ${g}`))) {
    return {
      reply: `**Hello & Welcome to the HFA Portal Support Assistant!** 👋

I can help answer questions regarding:
• **Certification Schemes:** HFA UK/EU, GSO Non-Meat, GSO Meat, SMIIC, and Halal Cosmetics
• **Application Journey:** Stages, timeline, and required documentation
• **Add-Ons & Extensions:** Adding new products or expanding to new sites
• **Invoices & Billing:** Payment steps, fees, and bank verification
• **Audits & Preparation:** Site inspection checklists and NC resolution
• **Certificates:** Accessing, verifying, and renewing Halal certificates

*Feel free to ask your question below, or click **"Speak with an Agent"** at any time if you'd prefer to connect directly with a support specialist.*`,
      needsHumanOffer: false
    };
  }

  // 3. Thank you
  if (query.includes('thank') || query.includes('thanks') || query.includes('shukran') || query.includes('jazakallah')) {
    return {
      reply: `You're very welcome! If you have any further questions or need assistance with your Halal applications, audits, or certificates, don't hesitate to ask. Have a wonderful day! 😊`,
      needsHumanOffer: false
    };
  }

  // 4. Score all topics based on keyword presence
  let bestTopic = null;
  let highestScore = 0;

  for (const item of HFA_KNOWLEDGE) {
    let score = 0;
    for (const kw of item.keywords) {
      if (query.includes(kw)) {
        score += kw.length > 5 ? 3 : 2; // Weight specific multi-word/longer phrases higher
      }
    }
    if (score > highestScore) {
      highestScore = score;
      bestTopic = item;
    }
  }

  // If match found with decent confidence
  if (bestTopic && highestScore >= 2) {
    // Map topic to suggested department if user eventually needs human support
    const deptMap = {
      billing: 'Billing & Accounts',
      application_process: 'Application & Processing',
      documents: 'Application & Processing',
      schemes: 'Application & Processing',
      audit: 'Audits & Inspections',
      addon: 'Food Technology & Vetting',
      extension: 'Audits & Inspections',
      renewals: 'Certificate & Renewal',
      certificates: 'Certificate & Renewal',
      export: 'Certificate & Renewal'
    };

    return {
      reply: `${bestTopic.answer}\n\n---\n*Need specific account investigation or personalized assistance? Click **"Request Human Agent"** above to connect with the ${deptMap[bestTopic.topic] || 'Support'} team.*`,
      suggestedDepartment: deptMap[bestTopic.topic] || 'General',
      needsHumanOffer: true
    };
  }

  // 5. Fallback helpful response
  return {
    reply: `I want to make sure you receive the most accurate assistance regarding your inquiry.

Here are the most common areas I can assist with:
• **Application Steps & Documents:** What is required to apply for Halal certification.
• **Schemes:** HFA Standard, GSO Non-Meat, GSO Meat, SMIIC, or Cosmetics.
• **Billing & Invoices:** Questions about fees, invoices, and bank transfer receipts.
• **Audits & NCs:** Preparing for site inspections and closing audit findings.
• **Add-On & Extensions:** Adding new products or secondary production sites.

**Need direct assistance from an HFA team member?**
Click the **"Request Human Agent"** button at the top of this chatbox, select your department, and our **Support Manager** will assign a specialist to assist you right away.`,
    needsHumanOffer: true,
    suggestedDepartment: 'General'
  };
}
