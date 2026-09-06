import express from 'express';
import multer from 'multer';
import Certificate from '../models/Certificate.js';
import Application from '../models/Application.js';
import ApplicationLogsheet from '../models/ApplicationLogsheet.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import Site from '../models/Site.js';
import Invoice from '../models/Invoice.js';
import { uploadToGridFS } from '../lib/gridfs.js';
import { authenticateToken, requireAdmin, requireSuperAdmin, requireDirectCertificatePermission } from '../middleware/auth.js';
import { createNotification } from '../lib/notifications.js';
import { generateHfaId } from '../lib/idGenerator.js';
import { Resend } from 'resend';
import dotenv from 'dotenv';
import { generateCertificate } from '../services/certificateGenerator.js';

dotenv.config();

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);
const emailFrom = process.env.EMAIL_FROM || 'HFA Portal <info@halalfoodfoundation.org.uk>';
const upload = multer({ storage: multer.memoryStorage() });

// Middleware: ensure final invoice is sent and paid before certificate issuance
async function requireFinalInvoicePaidForCertificate(req, res, next) {
  try {
    const application_id = req.body.application_id || req.body.applicationId;
    if (!application_id) return next();

    const app = await Application.findById(application_id);
    if (!app) {
      return res.status(404).json({ error: 'Application not found.' });
    }

    // Renewal applications require Renewal Invoice payment before certificate issuance
    if (app.application_type === 'renewal') {
      const renewalInvoice = await Invoice.findOne({ application_id });
      if (renewalInvoice && !['paid', 'client_paid'].includes(renewalInvoice.status)) {
        return res.status(403).json({
          error: 'The Renewal Invoice must be paid before a Certificate can be issued.',
          code: 'RENEWAL_INVOICE_NOT_PAID',
          invoice_status: renewalInvoice.status
        });
      }
      if (!['ready_for_certificate', 'certificate_issued', 'payment_received', 'application_successful'].includes(app.status)) {
        return res.status(403).json({
          error: 'Application must be marked "Application Successful" or "Ready for Certificate" before issuing a certificate.',
          code: 'READY_FOR_CERTIFICATE_REQUIRED',
          application_status: app.status
        });
      }
      return next();
    }

    const invoices = await Invoice.find({ application_id });
    const finalInvoice = invoices.find(inv => inv.invoice_type === 'final') || (invoices.length > 0 ? invoices[invoices.length - 1] : null);

    if (finalInvoice && !['paid', 'client_paid'].includes(finalInvoice.status)) {
      return res.status(403).json({
        error: 'The Invoice must be paid before a Certificate can be issued.',
        code: 'FINAL_INVOICE_NOT_PAID',
        invoice_status: finalInvoice.status
      });
    }

    if (!['ready_for_certificate', 'certificate_issued', 'application_successful', 'payment_received', 'initial_product_approved'].includes(app.status)) {
      return res.status(403).json({
        error: 'Application must be marked "Ready for Certificate" or "Application Successful" before issuing a certificate.',
        code: 'READY_FOR_CERTIFICATE_REQUIRED',
        application_status: app.status
      });
    }

    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET all certificates (admin: all, client: own)
router.get('/', authenticateToken, async (req, res) => {
  try {
    let query = {};
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      query.client_id = req.user._id.toString();
      // Clients only see active, expired, renewed, outdated, or superseded certificates (NOT drafts or under_review)
      query.status = { $in: ['active', 'expired', 'renewed', 'outdated', 'superseded'] };
    }
    const data = await Certificate.find(query)
      .populate('site_id')
      .populate('application_id', 'establishment_name site_name scope status application_type category')
      .populate('created_by', 'full_name email role')
      .populate('reviewed_by', 'full_name email role')
      .sort({ createdAt: -1 });

    // Auto-expire: mark any active certificate whose expiry_date is in the past and not renewed
    const now = new Date();
    const expiredIds = data
      .filter(c => c.status === 'active' && !c.is_renewed && c.expiry_date && new Date(c.expiry_date) < now)
      .map(c => c._id);

    if (expiredIds.length > 0) {
      await Certificate.updateMany(
        { _id: { $in: expiredIds } },
        { $set: { status: 'expired', updated_at: now } }
      );
      data.forEach(c => {
        if (expiredIds.some(id => id.equals(c._id))) {
          c.status = 'expired';
        }
      });
    }

    // Attach has_ongoing_renewal flag to each certificate
    let finalData = data;
    try {
      const clientIds = [...new Set(data.map(c => c.client_id ? String(c.client_id._id || c.client_id) : null).filter(Boolean))];
      if (clientIds.length > 0) {
        const ongoingRenewals = await Application.find({
          client_id: { $in: clientIds },
          application_type: 'renewal',
          status: { $nin: ['rejected', 'certificate_issued'] }
        }).select('_id application_number site_id renewed_certificate_id status');

        finalData = data.map(c => {
          const cObj = c.toObject ? c.toObject() : { ...c };
          const cIdStr = String(c._id);
          const cSiteStr = c.site_id ? String(c.site_id._id || c.site_id) : '';

          const matchingApp = ongoingRenewals.find(app => {
            const renCertStr = app.renewed_certificate_id ? String(app.renewed_certificate_id) : '';
            if (renCertStr && renCertStr === cIdStr) return true;
            const appSiteStr = app.site_id ? String(app.site_id) : '';
            if (appSiteStr && cSiteStr && appSiteStr === cSiteStr) return true;
            return false;
          });

          if (matchingApp) {
            cObj.has_ongoing_renewal = true;
            cObj.ongoing_renewal_id = matchingApp._id;
            cObj.ongoing_renewal_number = matchingApp.application_number;
            cObj.ongoing_renewal_status = matchingApp.status;
          } else {
            cObj.has_ongoing_renewal = false;
          }
          return cObj;
        });
      }
    } catch (renewalErr) {
      console.warn('Error attaching ongoing renewal data to certificates:', renewalErr.message);
    }

    res.json({ data: finalData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET certificate by application ID
router.get('/application/:appId', authenticateToken, async (req, res) => {
  try {
    const data = await Certificate.findOne({ application_id: req.params.appId }).sort({ createdAt: -1 })
      .populate('site_id')
      .populate('application_id')
      .populate('created_by', 'full_name email role')
      .populate('reviewed_by', 'full_name email role');
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single certificate
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const data = await Certificate.findById(req.params.id)
      .populate('site_id')
      .populate('application_id')
      .populate('created_by', 'full_name email role')
      .populate('reviewed_by', 'full_name email role')
      .populate('issued_by', 'full_name email role');

    if (!data) return res.status(404).json({ error: 'Certificate not found' });

    // Client authorization check
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      if (data.client_id !== req.user._id.toString() || data.status === 'under_review' || data.status === 'draft') {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Resolve client user details
    let clientUser = null;
    if (data.client_id) {
      clientUser = await User.findById(data.client_id).select('-password');
    }

    res.json({ data, client: clientUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create certificate (defaults to under_review for QA and correction)
router.post('/', authenticateToken, requireAdmin, requireFinalInvoicePaidForCertificate, upload.single('certificate_file'), async (req, res) => {
  try {
    const { 
      client_id, 
      application_id, 
      site_id, 
      certificate_type, 
      company_name,
      company_address,
      manufacturing_address,
      scope,
      issue_date, 
      expiry_date,
      certification_start_date,
      current_cycle_start_date,
      original_cycle_start_date, 
      products_covered, 
      product_details,
      certificate_number,
      status: reqStatus,
      review_notes
    } = req.body;

    let companyForId = company_name || 'HFA';
    let cUser = null;
    if (client_id) {
      cUser = await User.findById(client_id);
      if (cUser) {
        companyForId = company_name || cUser.company_name || cUser.full_name || 'HFA';
      }
    }

    const certNo = certificate_number || generateHfaId(companyForId);

    let parsedProducts = [];
    if (Array.isArray(products_covered)) {
      parsedProducts = products_covered;
    } else if (typeof products_covered === 'string') {
      try {
        const jsonParsed = JSON.parse(products_covered);
        parsedProducts = Array.isArray(jsonParsed) ? jsonParsed : products_covered.split(',').map(p => p.trim()).filter(Boolean);
      } catch (e) {
        parsedProducts = products_covered.split(',').map(p => p.trim()).filter(Boolean);
      }
    }

    let parsedProductDetails = [];
    if (Array.isArray(product_details)) {
      parsedProductDetails = product_details;
    } else if (typeof product_details === 'string') {
      try {
        parsedProductDetails = JSON.parse(product_details);
      } catch (e) {
        parsedProductDetails = parsedProducts.map((p, idx) => ({
          name: typeof p === 'string' ? p : (p.name || p.title),
          code: typeof p === 'object' && p.code ? p.code : `PRD-${String(idx + 1).padStart(2, '0')}`,
          description: typeof p === 'object' && p.description ? p.description : '',
          category: 'Halal Certified',
          barcode: ''
        }));
      }
    }

    let app = null;
    if (application_id) {
      app = await Application.findById(application_id);
    }

    let resolvedScheme = certificate_type;
    if (!resolvedScheme) {
      if (app?.category?.toLowerCase().includes('cosmetic')) resolvedScheme = 'Cosmetics';
      else if (app?.category?.toLowerCase().includes('meat') && !app?.category?.toLowerCase().includes('non')) resolvedScheme = 'GSO meat';
      else if (app?.category?.toLowerCase().includes('gso') || app?.category?.toLowerCase().includes('uae')) resolvedScheme = 'GSO non-meat';
      else resolvedScheme = 'HFA Scheme';
    }

    let resolvedCompanyName = company_name || cUser?.company_name || app?.establishment_name || 'Halal Certified Client';
    let resolvedCompanyAddress = company_address || cUser?.address || app?.establishment_address || '—';
    let resolvedManufacturingAddress = manufacturing_address || app?.manufacturer_address || resolvedCompanyAddress;
    let resolvedScope = scope || app?.scope || 'Halal Food & Products Certification';

    let certificate_url = null;
    if (req.file) {
      certificate_url = await uploadToGridFS(req.file.buffer, req.file.originalname, req.file.mimetype);
    } else {
      // Auto-generate initial PDF preview
      try {
        const productCategories = (parsedProductDetails.length > 0 ? parsedProductDetails : parsedProducts).map((p, idx) => ({
          code: typeof p === 'object' && p.code ? p.code : `PRD-${String(idx + 1).padStart(2, '0')}`,
          name: typeof p === 'string' ? p : (p.name || p.title || p.description),
          description: typeof p === 'object' ? (p.description || p.name) : p
        }));
        const pdfBuffer = await generateCertificate({
          certificateType: resolvedScheme,
          businessName: resolvedCompanyName,
          businessAddress: resolvedCompanyAddress,
          manufacturerAddress: resolvedManufacturingAddress,
          certificateNumber: certNo,
          scopeOfCertification: resolvedScope,
          productCategories,
          products: productCategories,
          issueDate: issue_date || new Date(),
          expiryDate: expiry_date || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          certificationStartDate: certification_start_date || issue_date || new Date(),
          currentCycleStartDate: current_cycle_start_date || issue_date || new Date(),
          originalCycleStartDate: original_cycle_start_date || issue_date || new Date(),
          verificationUrl: `${process.env.FRONTEND_CLIENT_URL || 'https://hfaportal.company'}/verify/${certNo}`
        });
        const filename = `${certNo}.pdf`;
        certificate_url = await uploadToGridFS(pdfBuffer, filename, 'application/pdf');
      } catch (genErr) {
        console.warn('Initial PDF auto-generation in POST /certificates warning:', genErr.message);
      }
    }

    // Certificates must always go to Review Certification page first
    const initialStatus = 'under_review';

    const certificate = new Certificate({
      certificate_number: certNo,
      client_id,
      application_id,
      site_id,
      certificate_type: resolvedScheme,
      company_name: resolvedCompanyName,
      company_address: resolvedCompanyAddress,
      manufacturing_address: resolvedManufacturingAddress,
      scope: resolvedScope,
      issue_date: issue_date || new Date(),
      expiry_date: expiry_date || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      certification_start_date: certification_start_date || issue_date || new Date(),
      current_cycle_start_date: current_cycle_start_date || issue_date || new Date(),
      original_cycle_start_date: original_cycle_start_date || issue_date || new Date(),
      products_covered: parsedProducts,
      product_details: parsedProductDetails,
      certificate_url,
      status: initialStatus,
      created_by: req.user._id,
      review_notes: review_notes || ''
    });

    const data = await certificate.save();

    res.status(201).json({ 
      success: true, 
      message: 'Certificate created and ready for review',
      data 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper function to perform issuance actions (email, notifications, status updates, superseding)
async function performCertificateIssuance({ certificate, application_id, client_id, site_id, certNo, user }) {
  // If this is a renewal application, mark the old certificate as renewed
  const app = await Application.findById(application_id);
  if (app && (app.application_type === 'renewal' || app.renewed_certificate_id)) {
    const oldCertId = app.renewed_certificate_id || (await Certificate.findOne({
      site_id: app.site_id,
      client_id,
      _id: { $ne: certificate._id },
      status: { $in: ['active', 'expired'] }
    }).sort({ expiry_date: -1 }))?._id;

    if (oldCertId) {
      await Certificate.findByIdAndUpdate(oldCertId, {
        status: 'renewed',
        is_renewed: true,
        renewed_by: certificate._id,
        updated_at: new Date()
      });
    }
  }

  // Mark previous active certificates for this site / application as outdated/superseded
  const prevQuery = [];
  if (site_id) prevQuery.push({ site_id });
  if (application_id) prevQuery.push({ application_id });
  if (client_id && prevQuery.length === 0) prevQuery.push({ client_id });

  if (prevQuery.length > 0) {
    await Certificate.updateMany(
      {
        _id: { $ne: certificate._id },
        client_id,
        $or: prevQuery,
        status: 'active'
      },
      {
        $set: {
          status: 'outdated',
          superseded_by: certificate._id,
          updated_at: new Date()
        }
      }
    );
  }

  // Update application status to certificate_issued with statusHistory entry
  if (application_id) {
    await Application.findByIdAndUpdate(application_id, {
      status: 'certificate_issued',
      updated_at: new Date(),
      $push: {
        statusHistory: {
          status: 'certificate_issued',
          changedAt: new Date(),
          changedBy: user?._id || user,
          note: `Certificate issued and approved: ${certNo}`,
        }
      }
    });

    // Mark associated application logsheets as Completed so they leave Waiting for Certificate
    try {
      await ApplicationLogsheet.updateMany(
        { application_id },
        { $set: { status: 'Completed', updated_at: new Date() } }
      );
    } catch (e) {
      console.error('Error updating logsheets to Completed on certificate issuance:', e);
    }
  }

  // Sync products covered to Product collection
  try {
    const prodsToSync = (certificate.product_details && certificate.product_details.length > 0)
      ? certificate.product_details
      : (certificate.products_covered || []).map(p => (typeof p === 'string' ? { name: p } : p));

    for (const prod of prodsToSync) {
      const prodName = typeof prod === 'string' ? prod.trim() : (prod.name || prod.product_name || prod.title || '').trim();
      if (!prodName) continue;
      const prodCode = typeof prod === 'object' ? (prod.code || prod.barcode || '') : '';
      const prodDesc = typeof prod === 'object' ? (prod.description || '') : '';
      const prodCategory = typeof prod === 'object' ? (prod.category || 'Halal Certified') : 'Halal Certified';
      const prodType = typeof prod === 'object' ? (prod.product_type || 'Processed') : 'Processed';

      await Product.findOneAndUpdate(
        { client_id, name: prodName },
        {
          $set: {
            client_id,
            site_id: site_id || undefined,
            certificate_id: certificate._id.toString(),
            name: prodName,
            code: prodCode,
            category: prodCategory,
            product_type: prodType,
            description: prodDesc,
            status: 'active',
            updated_at: new Date()
          }
        },
        { upsert: true, new: true }
      );
    }
  } catch (syncErr) {
    console.warn('[Certificate] Product sync warning during issuance:', syncErr.message);
  }

  // Notify client
  if (client_id) {
    await createNotification(
      client_id,
      '🏅 Certificate Issued',
      `Your Halal Certification certificate (${certNo}) has been issued. Please log in to download it.`,
      'success',
      '/certificates'
    );

    // Send email
    const client = await User.findById(client_id);
    if (client && client.email) {
      try {
        await resend.emails.send({
          from: emailFrom,
          to: client.email,
          subject: `🏅 Your Halal Certificate is Ready – ${certNo}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#f9fafb">
              <div style="background:linear-gradient(135deg,#15803d,#166534);border-radius:12px;padding:32px;text-align:center;margin-bottom:24px">
                <h1 style="color:white;margin:0">🏅 Certificate Issued</h1>
                <p style="color:#bbf7d0;margin:8px 0 0">Halal Food Authority</p>
              </div>
              <div style="background:white;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
                <h2 style="color:#1e293b;margin-top:0">Congratulations, ${client.company_name || client.full_name}!</h2>
                <p style="color:#475569;line-height:1.6">Your official Halal Certificate has been approved and issued by the Halal Food Authority.</p>
                <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:24px 0">
                  <p style="margin:0;color:#15803d;font-weight:bold">Certificate Number: ${certNo}</p>
                </div>
                <p style="color:#475569;line-height:1.6">You can view and download your official certificate PDF anytime from your client portal under <strong>Certificates</strong>.</p>
              </div>
            </div>
          `
        });
      } catch (emailErr) {
        console.error('Failed to send certificate email:', emailErr);
      }
    }
  }
}

// PUT /api/certificates/:id (Update certificate details during review)
router.put('/:id', authenticateToken, requireAdmin, upload.single('certificate_file'), async (req, res) => {
  try {
    const cert = await Certificate.findById(req.params.id);
    if (!cert) return res.status(404).json({ error: 'Certificate not found' });

    const {
      certificate_number,
      certificate_type,
      company_name,
      company_address,
      manufacturing_address,
      scope,
      issue_date,
      expiry_date,
      certification_start_date,
      current_cycle_start_date,
      original_cycle_start_date,
      products_covered,
      product_details,
      review_notes,
      status
    } = req.body;

    if (certificate_number) cert.certificate_number = certificate_number;
    if (certificate_type) cert.certificate_type = certificate_type;
    if (company_name) cert.company_name = company_name;
    if (company_address) cert.company_address = company_address;
    if (manufacturing_address) cert.manufacturing_address = manufacturing_address;
    if (scope) cert.scope = scope;
    if (issue_date) cert.issue_date = issue_date;
    if (expiry_date) cert.expiry_date = expiry_date;
    if (certification_start_date) cert.certification_start_date = certification_start_date;
    if (current_cycle_start_date) cert.current_cycle_start_date = current_cycle_start_date;
    if (original_cycle_start_date) cert.original_cycle_start_date = original_cycle_start_date;
    if (review_notes !== undefined) cert.review_notes = review_notes;
    if (status) cert.status = status;

    if (products_covered) {
      if (Array.isArray(products_covered)) {
        cert.products_covered = products_covered;
      } else if (typeof products_covered === 'string') {
        try {
          const parsed = JSON.parse(products_covered);
          cert.products_covered = Array.isArray(parsed) ? parsed : products_covered.split(',').map(p => p.trim()).filter(Boolean);
        } catch (e) {
          cert.products_covered = products_covered.split(',').map(p => p.trim()).filter(Boolean);
        }
      }
    }

    if (product_details) {
      if (Array.isArray(product_details)) {
        cert.product_details = product_details;
      } else if (typeof product_details === 'string') {
        try {
          cert.product_details = JSON.parse(product_details);
        } catch (e) {
          // keep existing
        }
      }
    }

    if (req.file) {
      const newUrl = await uploadToGridFS(req.file.buffer, req.file.originalname, req.file.mimetype);
      cert.certificate_url = newUrl;
    }

    cert.updated_at = new Date();
    await cert.save();

    res.json({ success: true, message: 'Certificate updated successfully', data: cert });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/certificates/:id/approve-and-send (Finalize review, set active, update application, and send to client)
router.post('/:id/approve-and-send', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const cert = await Certificate.findById(req.params.id);
    if (!cert) return res.status(404).json({ error: 'Certificate not found' });

    const {
      company_name,
      company_address,
      manufacturing_address,
      scope,
      issue_date,
      expiry_date,
      certification_start_date,
      current_cycle_start_date,
      original_cycle_start_date,
      products_covered,
      product_details,
      certificate_type,
      certificate_number,
      review_notes
    } = req.body;

    // Apply any final review edits
    if (certificate_number) cert.certificate_number = certificate_number;
    if (certificate_type) cert.certificate_type = certificate_type;
    if (company_name) cert.company_name = company_name;
    if (company_address) cert.company_address = company_address;
    if (manufacturing_address) cert.manufacturing_address = manufacturing_address;
    if (scope) cert.scope = scope;
    if (issue_date) cert.issue_date = issue_date;
    if (expiry_date) cert.expiry_date = expiry_date;
    if (certification_start_date) cert.certification_start_date = certification_start_date;
    if (current_cycle_start_date) cert.current_cycle_start_date = current_cycle_start_date;
    if (original_cycle_start_date) cert.original_cycle_start_date = original_cycle_start_date;
    if (review_notes !== undefined) cert.review_notes = review_notes;

    if (products_covered) {
      if (Array.isArray(products_covered)) {
        cert.products_covered = products_covered;
      } else if (typeof products_covered === 'string') {
        try {
          const parsed = JSON.parse(products_covered);
          cert.products_covered = Array.isArray(parsed) ? parsed : products_covered.split(',').map(p => p.trim()).filter(Boolean);
        } catch (e) {
          cert.products_covered = products_covered.split(',').map(p => p.trim()).filter(Boolean);
        }
      }
    }

    if (product_details) {
      if (Array.isArray(product_details)) {
        cert.product_details = product_details;
      } else if (typeof product_details === 'string') {
        try {
          cert.product_details = JSON.parse(product_details);
        } catch (e) {}
      }
    }

    // Regenerate final PDF to ensure it is 100% up-to-date with reviewer edits
    try {
      const prods = (cert.product_details && cert.product_details.length > 0)
        ? cert.product_details
        : (cert.products_covered || []).map((p, idx) => ({
            code: typeof p === 'object' && p.code ? p.code : `PRD-${String(idx + 1).padStart(2, '0')}`,
            name: typeof p === 'string' ? p : (p.name || p.title || p.description),
            description: typeof p === 'object' ? (p.description || p.name) : p
          }));

      const pdfBuffer = await generateCertificate({
        certificateType: cert.certificate_type || 'HFA Scheme',
        businessName: cert.company_name || 'Halal Certified Client',
        businessAddress: cert.company_address || '—',
        manufacturerAddress: cert.manufacturing_address || 'Same as above',
        certificateNumber: cert.certificate_number,
        scopeOfCertification: cert.scope || 'Halal Food Certification',
        productCategories: prods,
        products: prods,
        issueDate: cert.issue_date || new Date(),
        expiryDate: cert.expiry_date || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        certificationStartDate: cert.certification_start_date || cert.issue_date || new Date(),
        currentCycleStartDate: cert.current_cycle_start_date || cert.issue_date || new Date(),
        originalCycleStartDate: cert.original_cycle_start_date || cert.issue_date || new Date(),
        verificationUrl: `${process.env.FRONTEND_CLIENT_URL || 'https://hfaportal.company'}/verify/${cert.certificate_number}`
      });
      const filename = `${cert.certificate_number}.pdf`;
      cert.certificate_url = await uploadToGridFS(pdfBuffer, filename, 'application/pdf');
    } catch (genErr) {
      console.warn('PDF re-render during approve-and-send warning:', genErr.message);
    }

    cert.status = 'active';
    cert.reviewed_by = req.user._id;
    cert.reviewed_at = new Date();
    cert.updated_at = new Date();

    const savedCert = await cert.save();

    // Execute issuance actions (application status update, email, client notification, superseding)
    await performCertificateIssuance({
      certificate: savedCert,
      application_id: savedCert.application_id,
      client_id: savedCert.client_id,
      site_id: savedCert.site_id,
      certNo: savedCert.certificate_number,
      user: req.user
    });

    res.json({
      success: true,
      message: 'Certificate approved and issued to client successfully!',
      data: savedCert
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper function to build cert data from Application
async function buildCertDataFromApplication(application) {
  const User = (await import('../models/User.js')).default;
  const client = await User.findById(application.client_id);
  const companyForId = client ? (client.company_name || client.full_name) : application.establishment_name;
  const certNumber = generateHfaId(companyForId);
  
  let scheme = 'HFA Scheme';
  if (application?.category?.toLowerCase().includes('cosmetic')) scheme = 'Cosmetics';
  else if (application?.category?.toLowerCase().includes('meat') && !application?.category?.toLowerCase().includes('non')) scheme = 'GSO meat';
  else if (application?.category?.toLowerCase().includes('gso') || application?.category?.toLowerCase().includes('uae')) scheme = 'GSO non-meat';

  const productCategories = (application.products || []).map((p, idx) => ({
    code: p.brand || p.code || `PRD-${String(idx + 1).padStart(2, '0')}`,
    name: p.name,
    description: p.description || p.name
  }));

  const issueDate = new Date();
  const expiryDate = (scheme === 'GSO meat' || scheme === 'GSO non-meat')
    ? new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000)
    : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  return {
    certificateType: scheme,
    businessName: client ? (client.company_name || client.full_name) : application.establishment_name,
    businessAddress: application.establishment_address || '—',
    manufacturerAddress: application.manufacturer_address || 'Same as above',
    certificateNumber: certNumber,
    scopeOfCertification: application.scope || 'Halal Food Certification',
    productCategories,
    products: productCategories,
    issueDate,
    expiryDate,
    certificationStartDate: issueDate,
    currentCycleStartDate: issueDate,
    originalCycleStartDate: issueDate,
    verificationUrl: `${process.env.FRONTEND_CLIENT_URL || 'https://hfaportal.company'}/verify/${certNumber}`
  };
}

// POST /api/certificates/generate
router.post('/generate', authenticateToken, requireAdmin, requireFinalInvoicePaidForCertificate, async (req, res) => {
  try {
    const { applicationId } = req.body;
    if (!applicationId) {
      return res.status(400).json({ error: 'applicationId is required' });
    }

    const application = await Application.findById(applicationId);
    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    // Check if an active or pending review certificate already exists for this application
    let existingCert = await Certificate.findOne({ application_id: applicationId, status: { $in: ['active', 'under_review'] } });
    if (existingCert) {
      return res.status(400).json({ 
        error: existingCert.status === 'under_review'
          ? 'A certificate draft for this application is already in Pending Review. Please inspect and approve it on the review page.'
          : 'An active certificate already exists for this application. Use the regenerate endpoint to recreate it.',
        certificateNumber: existingCert.certificate_number,
        certificateUrl: existingCert.certificate_url,
        reviewUrl: `/certificates/${existingCert._id}/review`
      });
    }

    const certData = await buildCertDataFromApplication(application);
    const pdfBuffer = await generateCertificate(certData);

    // Upload to GridFS
    const filename = `${certData.certificateNumber}.pdf`;
    const certificate_url = await uploadToGridFS(pdfBuffer, filename, 'application/pdf');

    // Save certificate record strictly in under_review (Pending Review)
    const certificate = new Certificate({
      certificate_number: certData.certificateNumber,
      client_id: application.client_id.toString(),
      application_id: application._id,
      site_id: application.site_id,
      certificate_type: application.application_type || 'Halal Certificate',
      issue_date: certData.issueDate,
      expiry_date: certData.expiryDate,
      products_covered: (certData.productCategories || []).map(p => typeof p === 'string' ? p : (p?.name || '')).filter(Boolean).length > 0
        ? (certData.productCategories || []).map(p => typeof p === 'string' ? p : (p?.name || '')).filter(Boolean)
        : ['Certified Halal Food Products'],
      certificate_url,
      status: 'under_review'
    });

    const data = await certificate.save();

    // Ensure application status is set to ready_for_certificate awaiting QA review
    await Application.findByIdAndUpdate(applicationId, {
      status: 'ready_for_certificate',
      updated_at: new Date()
    });

    res.status(201).json({ 
      success: true, 
      message: 'Certificate created and sent to Pending Review for QA inspection.',
      certificateUrl: certificate_url, 
      certificateNumber: certData.certificateNumber,
      reviewUrl: `/certificates/${data._id}/review`,
      data 
    });
  } catch (err) {
    console.error('Certificate generation endpoint failed:', err);
    res.status(500).json({ error: 'Certificate generation failed: ' + err.message });
  }
});

// POST /api/certificates/:certificateId/regenerate
router.post('/:certificateId/regenerate', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const certificate = await Certificate.findById(req.params.certificateId);
    if (!certificate) {
      return res.status(404).json({ error: 'Certificate not found' });
    }

    const application = await Application.findById(certificate.application_id);
    const client = await User.findById(certificate.client_id || application?.client_id);

    // Allow body overrides if passed during review
    const {
      company_name,
      company_address,
      manufacturing_address,
      scope,
      issue_date,
      expiry_date,
      certification_start_date,
      current_cycle_start_date,
      original_cycle_start_date,
      certificate_type,
      products_covered,
      product_details
    } = req.body || {};

    if (certificate_type) certificate.certificate_type = certificate_type;
    if (company_name) certificate.company_name = company_name;
    if (company_address) certificate.company_address = company_address;
    if (manufacturing_address) certificate.manufacturing_address = manufacturing_address;
    if (scope) certificate.scope = scope;
    if (issue_date) certificate.issue_date = issue_date;
    if (expiry_date) certificate.expiry_date = expiry_date;
    if (certification_start_date) certificate.certification_start_date = certification_start_date;
    if (current_cycle_start_date) certificate.current_cycle_start_date = current_cycle_start_date;
    if (original_cycle_start_date) certificate.original_cycle_start_date = original_cycle_start_date;

    let parsedProducts = certificate.products_covered || [];
    if (products_covered) {
      if (Array.isArray(products_covered)) {
        parsedProducts = products_covered;
        certificate.products_covered = products_covered;
      } else if (typeof products_covered === 'string') {
        try {
          parsedProducts = JSON.parse(products_covered);
          certificate.products_covered = parsedProducts;
        } catch (e) {
          parsedProducts = products_covered.split(',').map(p => p.trim()).filter(Boolean);
          certificate.products_covered = parsedProducts;
        }
      }
    }

    if (product_details) {
      if (Array.isArray(product_details)) {
        certificate.product_details = product_details;
      } else if (typeof product_details === 'string') {
        try {
          certificate.product_details = JSON.parse(product_details);
        } catch (e) {}
      }
    }

    const resolvedBusinessName = certificate.company_name || client?.company_name || client?.full_name || application?.establishment_name || 'Halal Certified Client';
    const resolvedBusinessAddress = certificate.company_address || application?.establishment_address || client?.address || '—';
    const resolvedManufacturerAddress = certificate.manufacturing_address || application?.manufacturer_address || resolvedBusinessAddress;
    const resolvedScope = certificate.scope || application?.scope || 'Halal Food Certification';

    const prods = (certificate.product_details && certificate.product_details.length > 0)
      ? certificate.product_details
      : (Array.isArray(parsedProducts) && parsedProducts.length > 0 ? parsedProducts : ['Certified Halal Products'])
          .map((p, idx) => ({
            code: typeof p === 'object' && p.code ? p.code : `PRD-${String(idx + 1).padStart(2, '0')}`,
            name: typeof p === 'string' ? p : (p?.name || p?.title || p?.description || String(p)),
            description: typeof p === 'object' ? (p?.description || p?.name) : p
          }));

    const certData = {
      certificateType: certificate.certificate_type || 'HFA Scheme',
      businessName: resolvedBusinessName,
      businessAddress: resolvedBusinessAddress,
      manufacturerAddress: resolvedManufacturerAddress,
      certificateNumber: certificate.certificate_number,
      scopeOfCertification: resolvedScope,
      productCategories: prods,
      products: prods,
      issueDate: certificate.issue_date || new Date(),
      expiryDate: certificate.expiry_date || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      certificationStartDate: certificate.certification_start_date || certificate.issue_date || new Date(),
      currentCycleStartDate: certificate.current_cycle_start_date || certificate.issue_date || new Date(),
      originalCycleStartDate: certificate.original_cycle_start_date || certificate.issue_date || new Date(),
      verificationUrl: `${process.env.FRONTEND_CLIENT_URL || 'https://hfaportal.company'}/verify/${certificate.certificate_number}`
    };

    const pdfBuffer = await generateCertificate(certData);

    // Upload to GridFS
    const filename = `${certificate.certificate_number}.pdf`;
    const certificate_url = await uploadToGridFS(pdfBuffer, filename, 'application/pdf');

    // Update certificate URL
    certificate.certificate_url = certificate_url;
    certificate.updated_at = new Date();
    await certificate.save();

    res.json({ 
      success: true, 
      certificateUrl: certificate_url, 
      certificateNumber: certificate.certificate_number,
      data: certificate
    });
  } catch (err) {
    console.error('Certificate regeneration endpoint failed:', err);
    res.status(500).json({ error: 'Certificate regeneration failed: ' + err.message });
  }
});

// GET /api/certificates/:id/download
router.get('/:id/download', authenticateToken, async (req, res) => {
  try {
    const certificate = await Certificate.findById(req.params.id);
    if (!certificate) return res.status(404).json({ error: 'Certificate not found' });

    // Client can only download their own certificate
    if (!['admin', 'superadmin'].includes(req.user.role) && certificate.client_id !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!certificate.certificate_url) {
      return res.status(404).json({ error: 'Certificate file URL is not available' });
    }

    // Redirect to the internal GridFS file endpoint or direct link
    const host = process.env.API_URL || `${req.protocol}://${req.get('host')}`;
    if (certificate.certificate_url.startsWith('/api/files/')) {
      const fileId = certificate.certificate_url.replace('/api/files/', '');
      res.redirect(`${host}/api/files/${fileId}`);
    } else if (certificate.certificate_url.startsWith('/')) {
      res.redirect(`${host}${certificate.certificate_url}`);
    } else {
      res.redirect(certificate.certificate_url);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/certificates/direct-issue (Superadmin & Authorized Staff: direct certificate and product issuance without application)
router.post('/direct-issue', authenticateToken, requireDirectCertificatePermission, upload.single('certificate_file'), async (req, res) => {
  try {
    const {
      client_id,
      new_client_name,
      new_client_company,
      new_client_email,
      new_client_phone,
      new_client_address,
      new_client_postcode,
      new_client_country,
      
      site_id,
      site_name,
      site_address,
      manufacturer_address,
      
      certificate_number,
      certificate_type,
      scope_of_certification,
      issue_date,
      expiry_date,
      certification_start_date,
      current_cycle_start_date,
      original_cycle_start_date,
      status,
      notes,
      
      products,
      
      auto_generate_pdf,
      send_email,
      send_notification
    } = req.body;

    let targetClientId = client_id;
    let targetClient = null;

    // 1. Resolve or create client
    if (!targetClientId && new_client_email) {
      let existingUser = await User.findOne({ email: new_client_email.toLowerCase().trim() });
      if (existingUser) {
        targetClientId = existingUser._id.toString();
        targetClient = existingUser;
      } else {
        const randomPassword = Math.random().toString(36).slice(-10) + '!A1';
        const newUser = new User({
          email: new_client_email.toLowerCase().trim(),
          password: randomPassword,
          full_name: new_client_name || new_client_company,
          company_name: new_client_company || new_client_name,
          phone: new_client_phone || '',
          address: new_client_address || '',
          postcode: new_client_postcode || '',
          country: new_client_country || 'United Kingdom',
          role: 'client',
          is_verified: true,
          is_active: true
        });
        targetClient = await newUser.save();
        targetClientId = targetClient._id.toString();
      }
    } else if (targetClientId) {
      targetClient = await User.findById(targetClientId);
      if (!targetClient) {
        return res.status(404).json({ error: 'Client account not found.' });
      }
    } else {
      return res.status(400).json({ error: 'Client ID or new client details are required.' });
    }

    // 2. Resolve or create Site if needed
    let targetSiteId = site_id || null;
    let businessAddress = site_address || targetClient.address || '—';
    let manufacturerAddr = manufacturer_address || businessAddress || 'Same as above';

    if (!targetSiteId && site_name && site_address) {
      const newSite = new Site({
        client_id: targetClientId,
        name: site_name,
        email: targetClient.email,
        address_1: site_address,
        postcode: new_client_postcode || targetClient.postcode || '—',
        state: 'N/A',
        country: new_client_country || targetClient.country || 'United Kingdom',
        contact_name: targetClient.full_name || targetClient.company_name,
        contact_phone_number: targetClient.phone || '0000000000'
      });
      const savedSite = await newSite.save();
      targetSiteId = savedSite._id;
    } else if (targetSiteId) {
      const existingSite = await Site.findById(targetSiteId);
      if (existingSite) {
        businessAddress = existingSite.address_1 || businessAddress;
      }
    }

    // 3. Resolve Certificate Number
    const companyForId = targetClient?.company_name || targetClient?.full_name || new_client_company || 'HFA';
    const certNumber = (certificate_number && certificate_number.trim())
      ? certificate_number.trim()
      : generateHfaId(companyForId);

    const existingCertWithNo = await Certificate.findOne({ certificate_number: certNumber });
    if (existingCertWithNo) {
      return res.status(400).json({ error: `Certificate number "${certNumber}" is already in use. Please choose a different number.` });
    }

    // 4. Parse Products
    let parsedProducts = [];
    if (typeof products === 'string') {
      try {
        parsedProducts = JSON.parse(products);
      } catch {
        parsedProducts = products.split(',').map(p => ({ name: p.trim() })).filter(p => p.name);
      }
    } else if (Array.isArray(products)) {
      parsedProducts = products;
    }

    const cleanProducts = parsedProducts.map((p, idx) => ({
      name: typeof p === 'string' ? p.trim() : (p.name || '').trim(),
      code: typeof p === 'object' ? (p.code || p.barcode || `GEN-${String(idx + 1).padStart(2, '0')}`) : `GEN-${String(idx + 1).padStart(2, '0')}`,
      category: typeof p === 'object' ? (p.category || 'General Food') : 'General Food',
      product_type: typeof p === 'object' ? (p.product_type || 'Processed') : 'Processed',
      barcode: typeof p === 'object' ? (p.barcode || '') : '',
      description: typeof p === 'object' ? (p.description || '') : '',
      ingredients: typeof p === 'object' ? (Array.isArray(p.ingredients) ? p.ingredients : (p.ingredients ? [p.ingredients] : [])) : []
    })).filter(p => p.name);

    const productsCoveredNames = cleanProducts.map(p => p.name);
    if (productsCoveredNames.length === 0) {
      productsCoveredNames.push('Certified Halal Food Products');
    }

    // 5. Handle Certificate File / Generation
    let certificate_url = null;
    if (req.file) {
      certificate_url = await uploadToGridFS(req.file.buffer, req.file.originalname, req.file.mimetype);
    } else if (auto_generate_pdf === 'true' || auto_generate_pdf === true || !req.file) {
      const parsedIssueDate = issue_date ? new Date(issue_date) : new Date();
      const parsedExpiryDate = expiry_date ? new Date(expiry_date) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      const parsedCertStartDate = certification_start_date ? new Date(certification_start_date) : parsedIssueDate;
      const parsedCurrentCycle = current_cycle_start_date ? new Date(current_cycle_start_date) : parsedIssueDate;
      const parsedOrigCycle = original_cycle_start_date ? new Date(original_cycle_start_date) : parsedIssueDate;

      const certData = {
        certificateType: certificate_type || 'HFA Scheme',
        businessName: targetClient.company_name || targetClient.full_name || 'Valued Client',
        businessAddress: businessAddress,
        manufacturerAddress: manufacturerAddr,
        certificateNumber: certNumber,
        scopeOfCertification: scope_of_certification || 'Halal Food Certification',
        productCategories: cleanProducts.length > 0
          ? cleanProducts.map(p => ({ code: p.code || 'PRD-01', name: p.name, description: p.description || p.name }))
          : [{ code: 'PRD-01', name: 'Certified Halal Food Products', description: 'Certified Halal Food Products' }],
        products: cleanProducts.length > 0
          ? cleanProducts.map(p => ({ code: p.code || 'PRD-01', name: p.name, description: p.description || p.name }))
          : [{ code: 'PRD-01', name: 'Certified Halal Food Products', description: 'Certified Halal Food Products' }],
        issueDate: parsedIssueDate,
        expiryDate: parsedExpiryDate,
        certificationStartDate: parsedCertStartDate,
        currentCycleStartDate: parsedCurrentCycle,
        originalCycleStartDate: parsedOrigCycle,
        verificationUrl: `${process.env.FRONTEND_CLIENT_URL || 'https://hfaportal.company'}/verify/${certNumber}`
      };

      try {
        const pdfBuffer = await generateCertificate(certData);
        const filename = `${certNumber}.pdf`;
        certificate_url = await uploadToGridFS(pdfBuffer, filename, 'application/pdf');
      } catch (pdfErr) {
        console.warn('Auto PDF generation warning:', pdfErr.message);
      }
    }

    // 6. Save Certificate
    const parsedIssueDate = issue_date ? new Date(issue_date) : new Date();
    const parsedExpiryDate = expiry_date ? new Date(expiry_date) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const parsedCertStartDate = certification_start_date ? new Date(certification_start_date) : parsedIssueDate;
    const parsedCurrentCycle = current_cycle_start_date ? new Date(current_cycle_start_date) : parsedIssueDate;
    const parsedOrigCycle = original_cycle_start_date ? new Date(original_cycle_start_date) : parsedIssueDate;

    const certificate = new Certificate({
      certificate_number: certNumber,
      client_id: targetClientId,
      site_id: targetSiteId || undefined,
      certificate_type: certificate_type || 'HFA Scheme',
      issue_date: parsedIssueDate,
      expiry_date: parsedExpiryDate,
      certification_start_date: parsedCertStartDate,
      current_cycle_start_date: parsedCurrentCycle,
      original_cycle_start_date: parsedOrigCycle,
      products_covered: productsCoveredNames,
      product_details: cleanProducts,
      certificate_url,
      status: status || 'active',
      is_direct_issuance: true,
      issued_by: req.user._id,
      notes: notes || 'Directly issued by Superadmin'
    });

    const savedCert = await certificate.save();

    // Mark previous active certificates for this site / client as outdated
    const prevSiteFilter = targetSiteId ? { site_id: targetSiteId } : { client_id: targetClientId };
    await Certificate.updateMany(
      {
        _id: { $ne: savedCert._id },
        client_id: targetClientId,
        ...prevSiteFilter,
        status: 'active'
      },
      {
        $set: {
          status: 'outdated',
          superseded_by: savedCert._id,
          updated_at: new Date()
        }
      }
    );

    // 7. Save Created Products to Product collection linked to certificate
    const createdProductDocs = [];
    for (const prod of cleanProducts) {
      const newProd = new Product({
        client_id: targetClientId,
        site_id: targetSiteId || undefined,
        certificate_id: savedCert._id.toString(),
        name: prod.name,
        code: prod.code || '',
        barcode: prod.barcode || '',
        category: prod.category || '',
        product_type: prod.product_type || '',
        description: prod.description || '',
        ingredients: prod.ingredients || [],
        status: 'active'
      });
      const savedProd = await newProd.save();
      createdProductDocs.push(savedProd);
    }

    // 8. Send In-App Notification and Email
    if (send_notification !== 'false' && send_notification !== false) {
      await createNotification(
        targetClientId,
        '🏅 Certificate & Products Issued',
        `Your Halal Certificate (${certNumber}) and ${createdProductDocs.length} certified product(s) have been issued directly by HFA.`,
        'success',
        '/certificates'
      );
    }

    if (send_email !== 'false' && send_email !== false && targetClient.email) {
      try {
        await resend.emails.send({
          from: emailFrom,
          to: targetClient.email,
          subject: `🏅 Official Halal Certificate Issued – ${certNumber}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#f9fafb">
              <div style="background:linear-gradient(135deg,#15803d,#166534);border-radius:12px;padding:32px;text-align:center;margin-bottom:24px">
                <h1 style="color:white;margin:0">🏅 Halal Certificate Issued</h1>
                <p style="color:#bbf7d0;margin:8px 0 0">Halal Food Authority</p>
              </div>
              <div style="background:white;border-radius:12px;padding:32px">
                <h2 style="color:#166534;margin:0 0 16px">Dear ${targetClient.full_name || targetClient.company_name},</h2>
                <p style="color:#374151">Your official Halal Certificate has been issued for <strong>${targetClient.company_name || targetClient.full_name}</strong>.</p>
                <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:20px 0">
                  <p style="margin:4px 0;color:#166534;font-size:14px"><strong>Certificate Number:</strong> ${certNumber}</p>
                  <p style="margin:4px 0;color:#166534;font-size:14px"><strong>Certificate Type:</strong> ${certificate_type || 'Annual Halal Certificate'}</p>
                  <p style="margin:4px 0;color:#166534;font-size:14px"><strong>Certified Products:</strong> ${createdProductDocs.length} product(s) registered</p>
                  <p style="margin:4px 0;color:#166534;font-size:14px"><strong>Expiry Date:</strong> ${parsedExpiryDate.toLocaleDateString('en-GB')}</p>
                </div>
                <a href="${process.env.FRONTEND_CLIENT_URL || 'http://localhost:5173'}/certificates" style="display:inline-block;background:linear-gradient(135deg,#15803d,#166534);color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:16px">View & Download Certificate</a>
              </div>
            </div>
          `,
        });
      } catch (emailErr) {
        console.error('[Resend] Direct issue certificate email failed:', emailErr.message);
      }
    }

    res.status(201).json({
      success: true,
      message: 'Certificate and products issued successfully!',
      certificate: savedCert,
      products: createdProductDocs,
      certificateUrl: certificate_url,
      certificateNumber: certNumber
    });
  } catch (err) {
    console.error('Direct issue certificate failed:', err);
    res.status(500).json({ error: 'Direct certificate issuance failed: ' + err.message });
  }
});

// GET /api/certificates/direct-history (Superadmin & Authorized Staff)
router.get('/direct-history', authenticateToken, requireDirectCertificatePermission, async (req, res) => {
  try {
    const certs = await Certificate.find({ is_direct_issuance: true })
      .populate('site_id')
      .populate('issued_by', 'full_name email username')
      .sort({ createdAt: -1 })
      .lean();

    const userIds = [...new Set(certs.map(c => c.client_id).filter(Boolean))];
    const users = await User.find({ _id: { $in: userIds } }, 'company_name full_name email phone address country').lean();
    const userMap = {};
    users.forEach(u => { userMap[u._id.toString()] = u; });

    const enriched = await Promise.all(certs.map(async (c) => {
      const client = userMap[c.client_id] || null;
      const products = await Product.find({ certificate_id: c._id.toString() }).lean();
      return {
        ...c,
        id: c._id.toString(),
        client,
        products
      };
    }));

    res.json({ data: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT revoke
router.put('/:id/revoke', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    const data = await Certificate.findByIdAndUpdate(req.params.id, { status: 'revoked', revocation_reason: reason }, { new: true });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
