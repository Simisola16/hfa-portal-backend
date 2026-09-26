import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import Certificate from '../models/Certificate.js';
import Application from '../models/Application.js';
import AddOnApplication from '../models/AddOnApplication.js';
import ApplicationLogsheet from '../models/ApplicationLogsheet.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import Site from '../models/Site.js';
import Invoice from '../models/Invoice.js';
import { uploadToS3 } from '../lib/s3.js';
import { authenticateToken, requireAdmin, requireSuperAdmin, requireDirectCertificatePermission, requireReviewCertificatePrivilege } from '../middleware/auth.js';
import { createNotification } from '../lib/notifications.js';
import { generateHfaId } from '../lib/idGenerator.js';
import { Resend } from 'resend';
import dotenv from 'dotenv';
import { generateCertificate } from '../services/certificateGenerator.js';
import { generateSurveillanceLetter } from '../services/surveillanceLetterGenerator.js';
import { getClientUrl } from '../lib/urls.js';
import { getSuperadminEmails } from '../lib/mailer.js';

dotenv.config();

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY || 're_dummy_key_for_init');
const emailFrom = process.env.EMAIL_FROM || 'HFA Portal <info@halalfoodfoundation.org.uk>';
const upload = multer({ storage: multer.memoryStorage() });

// Middleware: ensure final invoice is sent and paid before certificate issuance
async function requireFinalInvoicePaidForCertificate(req, res, next) {
  try {
    const application_id = req.body.application_id || req.body.applicationId;
    if (!application_id) return next();

    const app = await Application.findById(application_id);
    if (!app) {
      const addOn = await AddOnApplication.findById(application_id);
      if (addOn) {
        return next();
      }
      return res.status(404).json({ error: 'Application not found.' });
    }

    // Renewal & Surveillance applications require invoice payment before certificate / letter issuance
    const isRenewal = (
      String(app.application_type || '').toLowerCase().includes('renewal') ||
      String(app.type || '').toLowerCase().includes('renewal') ||
      Boolean(app.is_renewal) ||
      Boolean(app.renewed_certificate_id) ||
      String(app.application_number || '').includes('-RE-') ||
      String(app.category || '').toLowerCase().includes('renewal')
    );
    const isSurveillance = (
      String(app.application_type || '').toLowerCase().includes('surveillance') ||
      String(app.type || '').toLowerCase().includes('surveillance') ||
      Boolean(app.is_surveillance) ||
      String(app.application_number || '').includes('-SU-') ||
      String(app.category || '').toLowerCase().includes('surveillance')
    );

    if (isRenewal || isSurveillance) {
      const renewalInvoice = await Invoice.findOne({ application_id }).sort({ createdAt: -1 });
      if (renewalInvoice && !['paid', 'client_paid'].includes(renewalInvoice.status)) {
        return res.status(403).json({
          error: `The ${isSurveillance ? 'Surveillance' : 'Renewal'} Invoice must be paid before a ${isSurveillance ? 'Letter' : 'Certificate'} can be issued.`,
          code: 'RENEWAL_INVOICE_NOT_PAID',
          invoice_status: renewalInvoice.status
        });
      }
      if (!['ready_for_certificate', 'certificate_issued', 'application_successful', 'payment_received', 'final_invoice_paid'].includes(app.status)) {
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

    if (!['final_invoice_paid', 'ready_for_certificate', 'certificate_issued', 'application_successful'].includes(app.status)) {
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
    let data = await Certificate.findOne({ application_id: req.params.appId }).sort({ createdAt: -1 })
      .populate('site_id')
      .populate('application_id')
      .populate('created_by', 'full_name email role')
      .populate('reviewed_by', 'full_name email role');

    if (!data && mongoose.isValidObjectId(req.params.appId)) {
      const addOn = await AddOnApplication.findById(req.params.appId);
      if (addOn?.certificate_id) {
        data = await Certificate.findById(addOn.certificate_id)
          .populate('site_id')
          .populate('created_by', 'full_name email role')
          .populate('reviewed_by', 'full_name email role');
      }
    }

    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/certificates/direct-history (Superadmin & Authorized Staff - MUST be before /:id)
router.get('/direct-history', authenticateToken, requireDirectCertificatePermission, async (req, res) => {
  try {
    const certs = await Certificate.find({
      is_direct_issuance: true,
      certificate_type: { $ne: 'Extension' },
      is_extension: { $ne: true },
      notes: { $not: /Issued via Extension Application/i }
    })
      .populate('site_id')
      .populate('issued_by', 'full_name email username')
      .sort({ createdAt: -1 })
      .lean();

    const userIds = [...new Set(certs.map(c => c.client_id).filter(Boolean))];
    const validUserIds = userIds.filter(id => mongoose.Types.ObjectId.isValid(id));
    const users = await User.find({ _id: { $in: validUserIds } }, 'company_name full_name email phone address country').lean();
    const userMap = {};
    users.forEach(u => { userMap[u._id.toString()] = u; });

    const enriched = await Promise.all(certs.map(async (c) => {
      const client = userMap[c.client_id] || null;
      const products = await Product.find({
        $or: [
          { certificate_id: c._id.toString() },
          { certificate_id: c.certificate_number }
        ]
      }).lean();
      return {
        ...c,
        id: c._id.toString(),
        client,
        products
      };
    }));

    res.json({ data: enriched });
  } catch (err) {
    console.error('Direct history error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/certificates/preview-live (Generate on-the-fly certificate PDF for real-time review)
router.post('/preview-live', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      certificate_type,
      certificate_number,
      company_name,
      company_address,
      manufacturing_address,
      scope,
      product_category,
      issue_date,
      expiry_date,
      certification_start_date,
      current_cycle_start_date,
      original_cycle_start_date,
      products,
      product_details,
      products_covered
    } = req.body;

    let parsedProducts = [];
    if (Array.isArray(product_details) && product_details.length > 0) {
      parsedProducts = product_details;
    } else if (Array.isArray(products) && products.length > 0) {
      parsedProducts = products;
    } else if (typeof products === 'string') {
      try {
        parsedProducts = JSON.parse(products);
      } catch {
        parsedProducts = products.split(',').map(p => ({ name: p.trim() })).filter(p => p.name);
      }
    } else if (Array.isArray(products_covered) && products_covered.length > 0) {
      parsedProducts = products_covered.map((p, idx) => ({
        code: typeof p === 'object' && p.code ? p.code : `PRD-${String(idx + 1).padStart(2, '0')}`,
        name: typeof p === 'string' ? p : (p.name || `Product ${idx + 1}`),
        description: typeof p === 'object' ? (p.description || p.name) : p
      }));
    }

    const cleanProducts = parsedProducts.map((p, idx) => ({
      code: typeof p === 'object' && p.code ? p.code : `PRD-${String(idx + 1).padStart(2, '0')}`,
      name: typeof p === 'string' ? p.trim() : (p.name || '').trim(),
      description: typeof p === 'object' ? (p.description || p.name || '') : '',
      category: typeof p === 'object' ? (p.category || 'Halal Certified') : 'Halal Certified',
      barcode: typeof p === 'object' && p.barcode ? p.barcode : ''
    })).filter(p => p.name);

    if (cleanProducts.length === 0) {
      cleanProducts.push({ code: 'PRD-01', name: 'Certified Halal Products & Schedule', description: 'Certified Halal Products', category: 'Halal Certified' });
    }

    const certNo = (certificate_number && certificate_number.trim()) || 'HFA-PREVIEW-001';

    const isSurv = req.body.is_surveillance || String(certificate_type || '').toUpperCase() === 'SURVEILLANCE';
    if (isSurv) {
      const survPdfBuffer = await generateSurveillanceLetter({
        letter_number: certNo,
        issue_date: issue_date ? new Date(issue_date) : new Date(),
        recipient_name: company_name || 'Valued Halal Client',
        recipient_address: company_address || 'Registered Business Address',
        recipient_attention: req.body.recipient_attention || '',
        letter_subject: req.body.letter_subject || 'Re: Surveillance Audit Outcome',
        certificate_number: req.body.halal_certificate_number || '',
        standards: req.body.standards || 'UAE.S.2055-1:2015',
        letter_body: req.body.letter_body || ''
      });

      const filename = `${certNo}-surveillance-preview.pdf`;
      const previewUrl = await uploadToS3(survPdfBuffer, filename, 'application/pdf', 'surveillance');

      return res.json({
        success: true,
        previewUrl,
        certificateNumber: certNo
      });
    }

    const effectiveScope = product_category || scope || 'Halal Food and Consumer Products Certification';
    const rawTableCols = parseInt(req.body.product_table_columns || req.body.table_layout || req.body.productTableColumns || req.body.tableLayout, 10);
    const resolvedTableCols = (rawTableCols >= 1 && rawTableCols <= 3) ? rawTableCols : undefined;

    const pdfBuffer = await generateCertificate({
      certificateType: certificate_type || 'GSO MEAT',
      businessName: company_name || 'Valued Halal Client',
      businessAddress: company_address || 'Registered Business Address',
      manufacturerAddress: manufacturing_address || company_address || 'Manufacturing Facility Address',
      certificateNumber: certNo,
      scopeOfCertification: effectiveScope,
      productCategory: effectiveScope,
      productCategories: cleanProducts,
      products: cleanProducts,
      productTableColumns: resolvedTableCols,
      issueDate: issue_date ? new Date(issue_date) : new Date(),
      expiryDate: expiry_date ? new Date(expiry_date) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      certificationStartDate: certification_start_date ? new Date(certification_start_date) : (issue_date ? new Date(issue_date) : new Date()),
      currentCycleStartDate: current_cycle_start_date ? new Date(current_cycle_start_date) : (issue_date ? new Date(issue_date) : new Date()),
      originalCycleStartDate: original_cycle_start_date ? new Date(original_cycle_start_date) : (issue_date ? new Date(issue_date) : new Date()),
      verificationUrl: `${getClientUrl()}/verify/${certNo}`
    });

    const filename = `${certNo}-preview.pdf`;
    const previewUrl = await uploadToS3(pdfBuffer, filename, 'application/pdf', 'certificates');

    res.json({
      success: true,
      previewUrl,
      certificateNumber: certNo
    });
  } catch (err) {
    console.error('Preview live certificate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/certificates/:id/site-products (Get all products belonging to the client and site for certificate selection)
router.get('/:id/site-products', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const cert = await Certificate.findById(req.params.id)
      .populate('site_id')
      .populate('application_id');

    if (!cert) return res.status(404).json({ error: 'Certificate not found' });

    // 1. Resolve client ID and user
    let clientId = cert.client_id || cert.application_id?.client_id;
    let clientUser = null;
    if (clientId && mongoose.isValidObjectId(clientId.toString())) {
      clientUser = await User.findById(clientId).select('company_name full_name email phone address country').lean();
    }
    if (!clientUser && cert.application_id) {
      const addOn = await AddOnApplication.findById(cert.application_id).populate('client_id');
      if (addOn?.client_id) {
        clientUser = typeof addOn.client_id === 'object' ? addOn.client_id : await User.findById(addOn.client_id).select('company_name full_name email phone address country').lean();
        clientId = addOn.client_id._id || addOn.client_id;
      }
    }

    // 2. Resolve site ID and site document
    let siteId = cert.site_id?._id || cert.site_id || cert.application_id?.site_id;
    let siteDoc = (cert.site_id && cert.site_id.name) ? cert.site_id : null;

    if (!siteDoc && cert.application_id) {
      const addOn = await AddOnApplication.findById(cert.application_id);
      if (addOn?.site_id) {
        siteId = siteId || addOn.site_id;
        if (mongoose.isValidObjectId(addOn.site_id.toString())) {
          siteDoc = await Site.findById(addOn.site_id).lean();
        }
      }
    }

    if (!siteDoc && siteId && mongoose.isValidObjectId(siteId.toString())) {
      siteDoc = await Site.findById(siteId).lean();
    }

    // If siteId still not found, check ApplicationLogsheet for this application
    if (!siteId && cert.application_id) {
      const logsheet = await ApplicationLogsheet.findOne({
        application_id: cert.application_id?._id || cert.application_id
      }).select('site_id site_name manufacturing_address').lean();
      if (logsheet?.site_id) {
        siteId = logsheet.site_id;
        if (!siteDoc && mongoose.isValidObjectId(siteId.toString())) {
          siteDoc = await Site.findById(siteId).lean();
        }
      }
    }

    // If still no siteDoc, try to find site by client_id (Site.client_id is a String)
    if (!siteDoc && clientId) {
      siteDoc = await Site.findOne({ client_id: clientId.toString() }).lean();
      if (siteDoc && !siteId) {
        siteId = siteDoc._id;
      }
    }

    // 3. Resolve site_id and client_id representations for robust querying
    const siteIds = [];
    if (siteId) {
      const sStr = siteId.toString();
      siteIds.push(sStr);
      if (mongoose.isValidObjectId(sStr)) {
        siteIds.push(new mongoose.Types.ObjectId(sStr));
      }
    }
    if (siteDoc?._id) {
      const sDocStr = siteDoc._id.toString();
      if (!siteIds.includes(sDocStr)) siteIds.push(sDocStr);
      if (mongoose.isValidObjectId(sDocStr)) {
        const sDocObj = new mongoose.Types.ObjectId(sDocStr);
        if (!siteIds.some(i => i instanceof mongoose.Types.ObjectId && i.equals(sDocObj))) {
          siteIds.push(sDocObj);
        }
      }
    }

    const clientIds = [];
    if (clientId) {
      const cStr = clientId.toString();
      clientIds.push(cStr);
      if (mongoose.isValidObjectId(cStr)) {
        clientIds.push(new mongoose.Types.ObjectId(cStr));
      }
    }

    let dbProducts = [];
    const seenProductIds = new Set();

    // Strategy A: Query Product collection by site_id (matches both ObjectId and String)
    if (siteIds.length > 0) {
      const siteScopedProducts = await Product.find({
        $or: [
          { site_id: { $in: siteIds } },
          { 'site_id._id': { $in: siteIds } }
        ]
      })
        .populate('site_id', 'name est_name trading_name')
        .sort({ created_at: -1 })
        .lean();

      siteScopedProducts.forEach(p => {
        seenProductIds.add(p._id.toString());
        dbProducts.push(p);
      });
    }

    // Strategy B: Query Product collection by client_id (matches ObjectId, String, and object representations)
    if (clientIds.length > 0) {
      const clientScopedProducts = await Product.find({
        $or: [
          { client_id: { $in: clientIds } },
          { 'client_id._id': { $in: clientIds } }
        ]
      })
        .populate('site_id', 'name est_name trading_name')
        .sort({ created_at: -1 })
        .lean();

      clientScopedProducts.forEach(p => {
        if (!seenProductIds.has(p._id.toString())) {
          seenProductIds.add(p._id.toString());
          dbProducts.push(p);
        }
      });
    }

    // Strategy C: Products explicitly linked to this certificate
    const certOrClauses = [];
    if (cert._id) certOrClauses.push({ certificate_id: cert._id.toString() });
    if (cert.certificate_number) certOrClauses.push({ certificate_id: cert.certificate_number });
    if (certOrClauses.length > 0) {
      const certLinked = await Product.find({ $or: certOrClauses })
        .populate('site_id', 'name est_name trading_name')
        .sort({ created_at: -1 })
        .lean();
      certLinked.forEach(p => {
        if (!seenProductIds.has(p._id.toString())) {
          seenProductIds.add(p._id.toString());
          dbProducts.push(p);
        }
      });
    }

    // 4. Fetch products from Application(s)
    let appProducts = [];
    const appIdsToQuery = [];
    if (cert.application_id) {
      const appIdVal = cert.application_id?._id || cert.application_id;
      appIdsToQuery.push(appIdVal.toString());
      if (mongoose.isValidObjectId(appIdVal.toString())) {
        appIdsToQuery.push(new mongoose.Types.ObjectId(appIdVal.toString()));
      }
    }

    // Direct products on populated cert.application_id
    if (cert.application_id?.products && Array.isArray(cert.application_id.products)) {
      appProducts.push(...cert.application_id.products);
    }

    // Search applications by application_id, site_id, or client_id
    const appOrClauses = [];
    if (appIdsToQuery.length > 0) appOrClauses.push({ _id: { $in: appIdsToQuery } });
    if (siteIds.length > 0) appOrClauses.push({ site_id: { $in: siteIds.map(s => s.toString()) } });
    if (clientIds.length > 0) appOrClauses.push({ client_id: { $in: clientIds } });

    if (appOrClauses.length > 0) {
      const matchedApps = await Application.find({ $or: appOrClauses })
        .select('products site_id site_name establishment_name')
        .lean();
      matchedApps.forEach(a => {
        if (Array.isArray(a.products)) {
          appProducts.push(...a.products);
        }
      });
    }

    // 5. Fetch products from ApplicationLogsheet
    let logsheetProducts = [];
    const logsheetOrClauses = [];
    if (appIdsToQuery.length > 0) logsheetOrClauses.push({ application_id: { $in: appIdsToQuery } });
    if (siteIds.length > 0) logsheetOrClauses.push({ site_id: { $in: siteIds } });
    if (clientIds.length > 0) logsheetOrClauses.push({ client_id: { $in: clientIds } });

    if (logsheetOrClauses.length > 0) {
      const logsheets = await ApplicationLogsheet.find({ $or: logsheetOrClauses })
        .select('products_list product_name')
        .lean();
      logsheets.forEach(l => {
        if (Array.isArray(l.products_list)) {
          logsheetProducts.push(...l.products_list);
        }
        if (l.product_name) {
          logsheetProducts.push({ name: l.product_name });
        }
      });
    }

    // 6. Check AddOnApplication for products
    try {
      const AddOnApplication = mongoose.model('AddOnApplication');
      const addOnOr = [];
      if (clientIds.length > 0) addOnOr.push({ client_id: { $in: clientIds } });
      if (siteIds.length > 0) addOnOr.push({ site_id: { $in: siteIds } });
      if (addOnOr.length > 0) {
        const addOns = await AddOnApplication.find({ $or: addOnOr }).select('products').lean();
        addOns.forEach(ao => {
          if (Array.isArray(ao.products)) {
            logsheetProducts.push(...ao.products);
          }
        });
      }
    } catch (_) { }

    // 7. Check InitialProductApplication
    try {
      const InitialProductApplication = mongoose.model('InitialProductApplication');
      const ipOr = [];
      if (clientIds.length > 0) ipOr.push({ client_id: { $in: clientIds } });
      if (siteIds.length > 0) ipOr.push({ site_id: { $in: siteIds } });
      if (ipOr.length > 0) {
        const ips = await InitialProductApplication.find({ $or: ipOr }).select('product').lean();
        ips.forEach(ip => {
          if (ip.product?.name) {
            logsheetProducts.push(ip.product);
          }
        });
      }
    } catch (_) { }

    // 8. Build unified product catalog (deduplicated by normalized name)
    const productMap = new Map();

    const addProduct = (p, source = 'site_product') => {
      if (!p) return;
      const name = (p.name || p.title || p.product_name || '').trim();
      if (!name) return;
      const key = name.toLowerCase();

      if (!productMap.has(key)) {
        productMap.set(key, {
          id: p._id ? p._id.toString() : (p.id || `gen_${Math.random().toString(36).substr(2, 9)}`),
          name,
          code: p.code || p.barcode || '',
          category: p.category || 'Halal Certified',
          product_type: p.product_type || p.type || 'Processed',
          description: p.description || '',
          barcode: p.barcode || p.code || '',
          source,
          status: p.status || 'active',
          site_id: p.site_id || siteId || null
        });
      } else {
        const existing = productMap.get(key);
        if (!existing.code && (p.code || p.barcode)) existing.code = p.code || p.barcode;
        if (!existing.category && p.category) existing.category = p.category;
        if (!existing.description && p.description) existing.description = p.description;
        if (!existing.barcode && p.barcode) existing.barcode = p.barcode;
      }
    };

    // Add in priority order: Database products, Logsheet, Application, Certificate details
    dbProducts.forEach(p => addProduct(p, 'site_inventory'));
    logsheetProducts.forEach(p => addProduct(p, 'logsheet'));
    appProducts.forEach(p => addProduct(p, 'application'));

    if (Array.isArray(cert.product_details)) {
      cert.product_details.forEach(p => addProduct(p, 'certificate'));
    }
    if (Array.isArray(cert.products_covered)) {
      cert.products_covered.forEach(p => {
        if (typeof p === 'string') addProduct({ name: p }, 'certificate');
        else if (typeof p === 'object') addProduct(p, 'certificate');
      });
    }

    const allSiteProducts = Array.from(productMap.values());


    res.json({
      success: true,
      client: {
        id: clientId,
        company_name: cert.company_name || clientUser?.company_name || clientUser?.full_name || 'Client Company',
        full_name: clientUser?.full_name || '',
        email: clientUser?.email || '',
        phone: clientUser?.phone || '',
        address: cert.company_address || clientUser?.address || ''
      },
      site: siteDoc ? {
        id: siteDoc._id,
        name: siteDoc.name || siteDoc.trading_name || siteDoc.est_name || 'Manufacturing Site',
        address: siteDoc.address_1 || siteDoc.address || cert.manufacturing_address || ''
      } : (siteId ? { id: siteId, name: cert.application_id?.site_name || 'Manufacturing Site', address: cert.manufacturing_address || '' } : null),
      site_id: siteId,
      products: allSiteProducts,
      current_selected_details: cert.product_details || [],
      current_selected_names: cert.products_covered || []
    });
  } catch (err) {
    console.error('Error fetching certificate site products:', err);
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
      if (mongoose.isValidObjectId(data.client_id)) {
        clientUser = await User.findById(data.client_id).select('-password');
      } else {
        clientUser = await User.findOne({
          $or: [
            { _id: data.client_id },
            { email: data.client_id },
            { company_name: data.company_name }
          ]
        }).select('-password');
      }
    }

    let addOnDoc = null;
    if (!clientUser && data.application_id) {
      const appDoc = await Application.findById(data.application_id).populate('client_id');
      if (appDoc?.client_id && typeof appDoc.client_id === 'object') {
        clientUser = appDoc.client_id;
      } else {
        addOnDoc = await AddOnApplication.findById(data.application_id).populate('client_id');
        if (addOnDoc?.client_id && typeof addOnDoc.client_id === 'object') {
          clientUser = addOnDoc.client_id;
        }
      }
    }

    // Resolve site details if not populated directly on certificate
    let siteData = data.site_id;
    if (!siteData && data.application_id) {
      const sId = data.application_id.site_id;
      if (sId && mongoose.isValidObjectId(sId)) {
        siteData = await Site.findById(sId);
      } else {
        if (!addOnDoc) addOnDoc = await AddOnApplication.findById(data.application_id);
        if (addOnDoc?.site_id && mongoose.isValidObjectId(addOnDoc.site_id)) {
          siteData = await Site.findById(addOnDoc.site_id);
        }
      }
    }

    res.json({ data, client: clientUser, site: siteData });
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
      product_category,
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

    let resolvedSiteId = site_id || null;
    if (!resolvedSiteId && application_id) {
      const appForSite = await Application.findById(application_id).select('site_id');
      if (appForSite?.site_id) {
        resolvedSiteId = appForSite.site_id;
      } else {
        const addOnForSite = await AddOnApplication.findById(application_id).select('site_id certificate_id');
        if (addOnForSite?.site_id) {
          resolvedSiteId = addOnForSite.site_id;
        } else if (addOnForSite?.certificate_id) {
          const linkedCert = await Certificate.findById(addOnForSite.certificate_id).select('site_id');
          if (linkedCert?.site_id) resolvedSiteId = linkedCert.site_id;
        }
      }
    }
    if (!resolvedSiteId) {
      return res.status(400).json({ error: 'Site selection is compulsory. A certificate must be issued for a specific site.' });
    }

    let companyForId = company_name || 'HFA';
    let cUser = null;
    if (client_id) {
      cUser = await User.findById(client_id);
      if (cUser) {
        companyForId = company_name || cUser.company_name || cUser.full_name || 'HFA';
      }
    }

    let isAddOn = req.body.is_add_on === true || req.body.is_add_on === 'true' ||
      (certificate_type && (certificate_type.toLowerCase().includes('add') || certificate_type.toLowerCase().includes('addon')));

    if (!isAddOn && application_id) {
      try {
        const foundAddOn = await AddOnApplication.findById(application_id).select('_id application_number');
        if (foundAddOn) {
          isAddOn = true;
        } else {
          const foundApp = await Application.findById(application_id).select('application_number application_type is_add_on');
          if (foundApp && (foundApp.is_add_on || foundApp.application_type === 'addon' || foundApp.application_type === 'add-on' || foundApp.application_number?.includes('-AD-') || foundApp.application_number?.startsWith('ADD-'))) {
            isAddOn = true;
          }
        }
      } catch (_) { }
    }

    const certTypeCode = (certificate_type && certificate_type.toLowerCase().includes('surv'))
      ? 'SU'
      : (isAddOn
        ? 'AD'
        : ((certificate_type && certificate_type.toLowerCase().includes('renew'))
          ? 'RE'
          : ((certificate_type && certificate_type.toLowerCase().includes('ext')) ? 'EX' : 'NE')));
    let certNo = certificate_number || generateHfaId(companyForId, certTypeCode);
    if (isAddOn && certNo && certNo.includes('-NE-')) {
      certNo = certNo.replace('-NE-', '-AD-');
    }

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
    let addOnApp = null;
    if (application_id) {
      app = await Application.findById(application_id);
      if (!app) {
        addOnApp = await AddOnApplication.findById(application_id);
      }
    }

    let resolvedScheme = certificate_type;
    if (!resolvedScheme) {
      if (app?.category?.toLowerCase().includes('cosmetic')) resolvedScheme = 'Cosmetics';
      else if (app?.category?.toLowerCase().includes('meat') && !app?.category?.toLowerCase().includes('non')) resolvedScheme = 'HFA Scheme (meat)';
      else if (app?.category?.toLowerCase().includes('gso') || app?.category?.toLowerCase().includes('uae')) resolvedScheme = 'GSO non-meat';
      else resolvedScheme = 'HFA Scheme (meat)';
    }

    let resolvedCompanyName = company_name || cUser?.company_name || app?.establishment_name || addOnApp?.contact_name || 'Halal Certified Client';
    let resolvedCompanyAddress = company_address || cUser?.address || app?.establishment_address || '—';
    let resolvedManufacturingAddress = manufacturing_address || app?.manufacturer_address || resolvedCompanyAddress;
    let resolvedScope = scope || app?.scope || 'Halal Food & Products Certification';
    let resolvedProductCategory = req.body.product_category || product_category || resolvedScope;

    let certificate_url = null;
    if (req.file) {
      certificate_url = await uploadToS3(req.file.buffer, req.file.originalname, req.file.mimetype, 'certificates');
    } else {
      // Auto-generate initial PDF preview
      try {
        const productCategories = (parsedProductDetails.length > 0 ? parsedProductDetails : parsedProducts).map((p, idx) => ({
          code: typeof p === 'object' && p.code ? p.code : `PRD-${String(idx + 1).padStart(2, '0')}`,
          name: typeof p === 'string' ? p : (p.name || p.title || p.description),
          description: typeof p === 'object' ? (p.description || p.name) : p
        }));
        const rawTableCols = parseInt(req.body.product_table_columns || req.body.table_layout || req.body.productTableColumns || req.body.tableLayout, 10);
        const resolvedTableCols = (rawTableCols >= 1 && rawTableCols <= 3) ? rawTableCols : undefined;

        const pdfBuffer = await generateCertificate({
          certificateType: resolvedScheme,
          businessName: resolvedCompanyName,
          businessAddress: resolvedCompanyAddress,
          manufacturerAddress: resolvedManufacturingAddress,
          certificateNumber: certNo,
          scopeOfCertification: resolvedScope,
          productCategory: req.body.product_category || resolvedScope,
          productCategories,
          products: productCategories,
          productTableColumns: resolvedTableCols,
          issueDate: issue_date || new Date(),
          expiryDate: expiry_date || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          certificationStartDate: certification_start_date || issue_date || new Date(),
          currentCycleStartDate: current_cycle_start_date || issue_date || new Date(),
          originalCycleStartDate: original_cycle_start_date || issue_date || new Date(),
          verificationUrl: `${getClientUrl()}/verify/${certNo}`
        });
        const filename = `${certNo}.pdf`;
        certificate_url = await uploadToS3(pdfBuffer, filename, 'application/pdf', 'certificates');
      } catch (genErr) {
        console.warn('Initial PDF auto-generation in POST /certificates warning:', genErr.message);
      }
    }

    // Certificates must always go to Review Certification page first
    const initialStatus = 'under_review';
    const rawTableCols = parseInt(req.body.product_table_columns || req.body.table_layout || req.body.productTableColumns || req.body.tableLayout, 10);
    const resolvedTableCols = (rawTableCols >= 1 && rawTableCols <= 3) ? rawTableCols : undefined;

    let certificate = null;
    if (application_id) {
      certificate = await Certificate.findOne({ application_id, status: { $in: ['under_review', 'draft'] } });
    }

    // Ensure certNo is strictly unique across the database
    let finalCertNo = certNo;
    let existingWithNumber = await Certificate.findOne({ certificate_number: finalCertNo });
    if (existingWithNumber) {
      if (certificate && existingWithNumber._id.equals(certificate._id)) {
        // Same document, no collision
      } else if (!certificate && String(existingWithNumber.application_id) === String(application_id)) {
        // It's the existing certificate record for this application
        certificate = existingWithNumber;
      } else {
        // Collision with another certificate (e.g. from an old certificate during renewal)
        let attempts = 0;
        while (existingWithNumber && attempts < 15) {
          finalCertNo = generateHfaId(companyForId, certTypeCode);
          existingWithNumber = await Certificate.findOne({ certificate_number: finalCertNo });
          attempts++;
        }
      }
    }

    if (certificate) {
      certificate.certificate_number = finalCertNo;
      certificate.client_id = client_id || certificate.client_id;
      certificate.site_id = resolvedSiteId || certificate.site_id;
      certificate.certificate_type = resolvedScheme;
      certificate.company_name = resolvedCompanyName;
      certificate.company_address = resolvedCompanyAddress;
      certificate.manufacturing_address = resolvedManufacturingAddress;
      certificate.scope = resolvedScope;
      certificate.product_category = resolvedProductCategory;
      certificate.issue_date = issue_date || certificate.issue_date;
      certificate.expiry_date = expiry_date || certificate.expiry_date;
      certificate.certification_start_date = certification_start_date || certificate.certification_start_date;
      certificate.current_cycle_start_date = current_cycle_start_date || certificate.current_cycle_start_date;
      certificate.original_cycle_start_date = original_cycle_start_date || certificate.original_cycle_start_date;
      certificate.products_covered = parsedProducts;
      certificate.product_details = parsedProductDetails;
      if (resolvedTableCols) certificate.product_table_columns = resolvedTableCols;
      if (certificate_url) certificate.certificate_url = certificate_url;
      certificate.status = initialStatus;
      certificate.review_notes = review_notes || certificate.review_notes;
      certificate.is_add_on = isAddOn;
      certificate.updated_at = new Date();
    } else {
      certificate = new Certificate({
        certificate_number: finalCertNo,
        client_id,
        application_id,
        site_id: resolvedSiteId,
        certificate_type: resolvedScheme,
        company_name: resolvedCompanyName,
        company_address: resolvedCompanyAddress,
        manufacturing_address: resolvedManufacturingAddress,
        scope: resolvedScope,
        product_category: resolvedProductCategory,
        issue_date: issue_date || new Date(),
        expiry_date: expiry_date || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        certification_start_date: certification_start_date || issue_date || new Date(),
        current_cycle_start_date: current_cycle_start_date || issue_date || new Date(),
        original_cycle_start_date: original_cycle_start_date || issue_date || new Date(),
        products_covered: parsedProducts,
        product_details: parsedProductDetails,
        product_table_columns: resolvedTableCols || 2,
        certificate_url,
        status: initialStatus,
        is_add_on: isAddOn,
        created_by: req.user._id,
        review_notes: review_notes || ''
      });
    }

    let data;
    try {
      data = await certificate.save();
    } catch (saveErr) {
      if (saveErr.code === 11000 || (saveErr.message && saveErr.message.includes('E11000'))) {
        // Fallback: generate a completely fresh random ID if a race condition occurred
        certificate.certificate_number = generateHfaId(companyForId, certTypeCode);
        data = await certificate.save();
      } else {
        throw saveErr;
      }
    }

    if (addOnApp) {
      addOnApp.certificate_id = data._id;
      await addOnApp.save();
    }

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
  const isRen = app && (
    String(app.application_type || '').toLowerCase().includes('renewal') ||
    String(app.type || '').toLowerCase().includes('renewal') ||
    Boolean(app.is_renewal) ||
    Boolean(app.renewed_certificate_id) ||
    String(app.application_number || '').includes('-RE-') ||
    String(app.category || '').toLowerCase().includes('renewal')
  );
  if (app && (isRen || app.renewed_certificate_id)) {
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
    const standardApp = await Application.findById(application_id);
    if (standardApp) {
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
    } else {
      const addOnApp = await AddOnApplication.findById(application_id);
      if (addOnApp) {
        addOnApp.status = 'completed';
        addOnApp.certificate_id = certificate._id;
        addOnApp.statusHistory = addOnApp.statusHistory || [];
        addOnApp.statusHistory.push({
          status: 'completed',
          changedAt: new Date(),
          changedBy: user?._id || user,
          note: `Certificate issued and approved: ${certNo}`
        });
        await addOnApp.save();

        try {
          await ApplicationLogsheet.updateMany(
            {
              $or: [
                { addon_application_id: application_id },
                { application_id },
                { source_type: 'addon_application', addon_application_id: application_id }
              ]
            },
            { $set: { status: 'Completed', updated_at: new Date() } }
          );
        } catch (e) {
          console.error('Error updating add-on logsheets on certificate issuance:', e);
        }
      }
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
        const superadminBcc = await getSuperadminEmails();
        await resend.emails.send({
          from: emailFrom,
          to: client.email,
          ...(superadminBcc.length > 0 ? { bcc: superadminBcc } : {}),
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
router.put('/:id', authenticateToken, requireReviewCertificatePrivilege, upload.single('certificate_file'), async (req, res) => {
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
    if (req.body.is_add_on !== undefined) {
      cert.is_add_on = req.body.is_add_on === true || req.body.is_add_on === 'true';
    }
    if (req.body.product_table_columns !== undefined) {
      cert.product_table_columns = Number(req.body.product_table_columns);
    }

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
      const newUrl = await uploadToS3(req.file.buffer, req.file.originalname, req.file.mimetype, 'certificates');
      cert.certificate_url = newUrl;
    }

    cert.updated_at = new Date();
    await cert.save();

    res.json({ success: true, message: 'Certificate updated successfully', data: cert });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/certificates/:id/regenerate (Regenerate PDF with updated reviewer values)
router.post('/:id/regenerate', authenticateToken, requireReviewCertificatePrivilege, async (req, res) => {
  try {
    const cert = await Certificate.findById(req.params.id);
    if (!cert) return res.status(404).json({ error: 'Certificate not found' });

    const {
      company_name,
      company_address,
      manufacturing_address,
      scope,
      product_category,
      issue_date,
      expiry_date,
      certification_start_date,
      current_cycle_start_date,
      original_cycle_start_date,
      products_covered,
      product_details,
      certificate_type,
      certificate_number
    } = req.body;

    if (certificate_number) cert.certificate_number = certificate_number;
    if (certificate_type) cert.certificate_type = certificate_type;
    if (company_name) cert.company_name = company_name;
    if (company_address) cert.company_address = company_address;
    if (manufacturing_address) cert.manufacturing_address = manufacturing_address;
    if (product_category) {
      cert.product_category = product_category;
      cert.scope = product_category;
    } else if (scope) {
      cert.scope = scope;
    }
    if (issue_date) cert.issue_date = issue_date;
    if (expiry_date) cert.expiry_date = expiry_date;
    if (certification_start_date) cert.certification_start_date = certification_start_date;
    if (current_cycle_start_date) cert.current_cycle_start_date = current_cycle_start_date;
    if (original_cycle_start_date) cert.original_cycle_start_date = original_cycle_start_date;

    if (products_covered && Array.isArray(products_covered)) {
      cert.products_covered = products_covered;
    }
    if (product_details && Array.isArray(product_details)) {
      cert.product_details = product_details;
    }
    if (req.body.product_table_columns !== undefined) {
      cert.product_table_columns = Number(req.body.product_table_columns);
    }

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
      productCategory: cert.scope,
      productCategories: prods,
      products: prods,
      productTableColumns: cert.product_table_columns || 2,
      issueDate: cert.issue_date || new Date(),
      expiryDate: cert.expiry_date || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      certificationStartDate: cert.certification_start_date || cert.issue_date || new Date(),
      currentCycleStartDate: cert.current_cycle_start_date || cert.issue_date || new Date(),
      originalCycleStartDate: cert.original_cycle_start_date || cert.issue_date || new Date(),
      verificationUrl: `${getClientUrl()}/verify/${cert.certificate_number}`
    });

    const filename = `${cert.certificate_number}.pdf`;
    const newUrl = await uploadToS3(pdfBuffer, filename, 'application/pdf', 'certificates');
    cert.certificate_url = newUrl;
    cert.updated_at = new Date();
    await cert.save();

    res.json({
      success: true,
      message: 'Certificate PDF regenerated successfully',
      certificateUrl: newUrl,
      data: cert
    });
  } catch (err) {
    console.error('Regenerate PDF error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/certificates/:id/approve-and-send (Finalize review, set active, update application, and send to client)
// Requires: Review Certificate Privilege (can_review_certificate) OR Superadmin
router.post('/:id/approve-and-send', authenticateToken, requireReviewCertificatePrivilege, async (req, res) => {
  try {
    const cert = await Certificate.findById(req.params.id);
    if (!cert) return res.status(404).json({ error: 'Certificate not found' });

    const {
      company_name,
      company_address,
      manufacturing_address,
      scope,
      product_category,
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
    if (product_category) {
      cert.product_category = product_category;
      cert.scope = product_category;
    } else if (scope) {
      cert.scope = scope;
    }
    if (issue_date) cert.issue_date = issue_date;
    if (expiry_date) cert.expiry_date = expiry_date;
    if (certification_start_date) cert.certification_start_date = certification_start_date;
    if (current_cycle_start_date) cert.current_cycle_start_date = current_cycle_start_date;
    if (original_cycle_start_date) cert.original_cycle_start_date = original_cycle_start_date;
    if (review_notes !== undefined) cert.review_notes = review_notes;
    if (req.body.product_table_columns !== undefined) {
      cert.product_table_columns = Number(req.body.product_table_columns);
    }

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
        } catch (e) { }
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
        productCategory: cert.scope,
        productCategories: prods,
        products: prods,
        productTableColumns: cert.product_table_columns || 2,
        issueDate: cert.issue_date || new Date(),
        expiryDate: cert.expiry_date || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        certificationStartDate: cert.certification_start_date || cert.issue_date || new Date(),
        currentCycleStartDate: cert.current_cycle_start_date || cert.issue_date || new Date(),
        originalCycleStartDate: cert.original_cycle_start_date || cert.issue_date || new Date(),
        verificationUrl: `${getClientUrl()}/verify/${cert.certificate_number}`
      });
      const filename = `${cert.certificate_number}.pdf`;
      cert.certificate_url = await uploadToS3(pdfBuffer, filename, 'application/pdf', 'certificates');
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
  const isAddOn = Boolean(
    application?.is_add_on ||
    application?.application_type === 'addon' ||
    application?.application_type === 'add-on' ||
    application?.application_type === 'add_on' ||
    application?.application_number?.includes('-AD-') ||
    application?.application_number?.startsWith('ADD-')
  );
  const isRenApp = (
    String(application?.application_type || '').toLowerCase().includes('renewal') ||
    String(application?.type || '').toLowerCase().includes('renewal') ||
    Boolean(application?.is_renewal) ||
    Boolean(application?.renewed_certificate_id) ||
    String(application?.application_number || '').includes('-RE-') ||
    String(application?.category || '').toLowerCase().includes('renewal')
  );
  const isSurvApp = (
    String(application?.application_type || '').toLowerCase().includes('surveillance') ||
    String(application?.type || '').toLowerCase().includes('surveillance') ||
    Boolean(application?.is_surveillance) ||
    String(application?.application_number || '').includes('-SU-') ||
    String(application?.category || '').toLowerCase().includes('surveillance')
  );
  const certTypeCode = isAddOn ? 'AD' : (isRenApp ? 'RE' : (isSurvApp ? 'SU' : 'NE'));
  const certNumber = generateHfaId(companyForId, certTypeCode);

  let scheme = 'HFA Scheme (meat)';
  if (application?.category?.toLowerCase().includes('cosmetic')) scheme = 'Cosmetics';
  else if (application?.category?.toLowerCase().includes('meat') && !application?.category?.toLowerCase().includes('non')) scheme = 'HFA Scheme (meat)';
  else if (application?.category?.toLowerCase().includes('gso') || application?.category?.toLowerCase().includes('uae')) scheme = 'GSO non-meat';
  else if (application?.category?.toLowerCase().includes('non-meat') || application?.category?.toLowerCase().includes('non meat')) scheme = 'HFA Scheme (non-meat)';

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
    verificationUrl: `${getClientUrl()}/verify/${certNumber}`
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

    // Upload to S3
    const filename = `${certData.certificateNumber}.pdf`;
    const certificate_url = await uploadToS3(pdfBuffer, filename, 'application/pdf', 'certificates');

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
router.post('/:certificateId/regenerate', authenticateToken, requireReviewCertificatePrivilege, async (req, res) => {
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
    if (req.body.product_table_columns) certificate.product_table_columns = Number(req.body.product_table_columns);

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
        } catch (e) { }
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
      productTableColumns: certificate.product_table_columns || 2,
      issueDate: certificate.issue_date || new Date(),
      expiryDate: certificate.expiry_date || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      certificationStartDate: certificate.certification_start_date || certificate.issue_date || new Date(),
      currentCycleStartDate: certificate.current_cycle_start_date || certificate.issue_date || new Date(),
      originalCycleStartDate: certificate.original_cycle_start_date || certificate.issue_date || new Date(),
      verificationUrl: `${getClientUrl()}/verify/${certificate.certificate_number}`
    };

    const pdfBuffer = await generateCertificate(certData);

    // Upload to S3
    const filename = `${certificate.certificate_number}.pdf`;
    const certificate_url = await uploadToS3(pdfBuffer, filename, 'application/pdf', 'certificates');

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
      try {
        const productsList = Array.isArray(certificate.product_details) && certificate.product_details.length > 0
          ? certificate.product_details.map(p => ({ code: p.code || '', name: p.name || '' }))
          : (Array.isArray(certificate.products_covered) ? certificate.products_covered.map(p => ({ code: '', name: p })) : []);

        const pdfBuffer = await generateCertificate({
          businessName: certificate.company_name || 'Anike International',
          businessAddress: certificate.company_address || '28 Woods Road, Peckham',
          manufacturerAddress: certificate.manufacturing_address || '3 Watcombe Road',
          certificateNumber: certificate.certificate_number,
          scopeOfCertification: certificate.scope || 'Food and General processing',
          scheme: certificate.certificate_type || 'GSO non-meat',
          productCategories: productsList,
          issueDate: certificate.issue_date || new Date(),
          expiryDate: certificate.expiry_date || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          cycleStartDate: certificate.current_cycle_start_date || certificate.issue_date,
          verificationUrl: `${getClientUrl()}/verify/${encodeURIComponent(certificate.certificate_number)}`
        });

        const filename = `${certificate.certificate_number.replace(/[\/\\:]/g, '_')}.pdf`;
        const uploadedUrl = await uploadToS3(pdfBuffer, filename, 'application/pdf', 'certificates');
        certificate.certificate_url = uploadedUrl;
        await certificate.save();
      } catch (genErr) {
        console.error('On-demand PDF generation error:', genErr.message);
        return res.status(404).json({ error: 'Certificate file URL is not available and generation failed.' });
      }
    }

    // Redirect to the correct file endpoint — handles S3, legacy GridFS, and absolute URLs
    const host = process.env.API_URL || `${req.protocol}://${req.get('host')}`;
    const certUrl = certificate.certificate_url;

    if (certUrl.startsWith('http://') || certUrl.startsWith('https://')) {
      // Absolute URL (e.g. direct S3 or CDN link) — redirect directly
      res.redirect(certUrl);
    } else if (certUrl.startsWith('/api/files/s3/')) {
      // New S3-backed route — stream via the S3 file handler
      res.redirect(`${host}${certUrl}`);
    } else if (certUrl.startsWith('/api/files/')) {
      // Legacy GridFS path — serve via GridFS streaming handler
      res.redirect(`${host}${certUrl}`);
    } else if (certUrl.startsWith('/')) {
      res.redirect(`${host}${certUrl}`);
    } else {
      res.redirect(certUrl);
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
      company_name_override,
      product_category,
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
    let businessAddress = (site_address || '').trim();

    if (!businessAddress && targetSiteId) {
      const existingSite = await Site.findById(targetSiteId);
      if (existingSite) {
        const parts = [existingSite.address_1, existingSite.address_2, existingSite.city, existingSite.state, existingSite.postcode, existingSite.country].map(p => (p || '').trim()).filter(Boolean);
        businessAddress = parts.join(', ') || existingSite.address_1 || '';
      }
    }

    if (!businessAddress && targetClientId) {
      // Check client user address
      const userParts = [targetClient.address, targetClient.postcode, targetClient.country].map(p => (p || '').trim()).filter(Boolean);
      if (userParts.length > 0) {
        businessAddress = userParts.join(', ');
      } else {
        // Fallback: Check if client has a registered site in Site collection
        const clientFirstSite = await Site.findOne({ client_id: targetClientId });
        if (clientFirstSite) {
          const parts = [clientFirstSite.address_1, clientFirstSite.address_2, clientFirstSite.city, clientFirstSite.state, clientFirstSite.postcode, clientFirstSite.country].map(p => (p || '').trim()).filter(Boolean);
          businessAddress = parts.join(', ') || clientFirstSite.address_1 || '';
          if (!targetSiteId) targetSiteId = clientFirstSite._id;
        }
      }
    }

    if (!businessAddress) {
      businessAddress = 'N/A';
    }

    let manufacturerAddr = manufacturer_address || businessAddress || 'Same as above';

    if (!targetSiteId && site_name && site_address) {
      const newSite = new Site({
        client_id: targetClientId,
        name: site_name,
        email: targetClient.email,
        address_1: site_address,
        postcode: new_client_postcode || targetClient.postcode || 'N/A',
        state: 'N/A',
        country: new_client_country || targetClient.country || 'United Kingdom',
        contact_name: targetClient.full_name || targetClient.company_name,
        contact_phone_number: targetClient.phone || '0000000000'
      });
      const savedSite = await newSite.save();
      targetSiteId = savedSite._id;
    }

    if (!targetSiteId) {
      return res.status(400).json({ error: 'Site selection is compulsory. A certificate must be issued for a specific site.' });
    }

    // 3. Resolve Certificate Number
    const companyForId = targetClient?.company_name || targetClient?.full_name || new_client_company || 'HFA';
    const isAddOn = Boolean(
      req.body.is_add_on === true || req.body.is_add_on === 'true' ||
      (certificate_type && (certificate_type.toLowerCase().includes('add') || certificate_type.toLowerCase().includes('addon')))
    );
    const certTypeCode = (certificate_type && certificate_type.toLowerCase().includes('surv'))
      ? 'SU'
      : (isAddOn
        ? 'AD'
        : ((certificate_type && certificate_type.toLowerCase().includes('renew'))
          ? 'RE'
          : ((certificate_type && certificate_type.toLowerCase().includes('ext')) ? 'EX' : 'NE')));
    let certNumber = (certificate_number && certificate_number.trim())
      ? certificate_number.trim()
      : generateHfaId(companyForId, certTypeCode);
    if (isAddOn && certNumber && certNumber.includes('-NE-')) {
      certNumber = certNumber.replace('-NE-', '-AD-');
    }

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

    const cleanProducts = [];
    const seenProdNames = new Set();
    for (const p of parsedProducts) {
      const name = typeof p === 'string' ? p.trim() : (p.name || '').trim();
      if (!name) continue;
      const lowerName = name.toLowerCase();
      if (seenProdNames.has(lowerName)) continue;
      seenProdNames.add(lowerName);

      cleanProducts.push({
        _sourceId: typeof p === 'object' ? (p._sourceId || p._id || p.id || null) : null,
        name,
        code: typeof p === 'object' ? (p.code || p.barcode || `GEN-${String(cleanProducts.length + 1).padStart(2, '0')}`) : `GEN-${String(cleanProducts.length + 1).padStart(2, '0')}`,
        category: typeof p === 'object' ? (p.category || 'General Food') : 'General Food',
        product_type: typeof p === 'object' ? (p.product_type || 'Processed') : 'Processed',
        barcode: typeof p === 'object' ? (p.barcode || '') : '',
        description: typeof p === 'object' ? (p.description || '') : '',
        ingredients: typeof p === 'object' ? (Array.isArray(p.ingredients) ? p.ingredients : (p.ingredients ? [p.ingredients] : [])) : []
      });
    }

    const productsCoveredNames = cleanProducts.map(p => p.name);
    if (productsCoveredNames.length === 0) {
      productsCoveredNames.push('Certified Halal Food Products');
    }

    // 5. Handle Certificate File / Generation
    const parsedIssueDate = issue_date ? new Date(issue_date) : new Date();
    const parsedExpiryDate = expiry_date ? new Date(expiry_date) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const parsedCertStartDate = certification_start_date ? new Date(certification_start_date) : parsedIssueDate;
    const parsedCurrentCycle = current_cycle_start_date ? new Date(current_cycle_start_date) : parsedIssueDate;
    const parsedOrigCycle = original_cycle_start_date ? new Date(original_cycle_start_date) : parsedIssueDate;

    const effectiveBusinessName = company_name_override || targetClient.company_name || targetClient.full_name || 'Valued Client';
    const effectiveScope = product_category || scope_of_certification || 'Halal Food Certification';
    const rawTableCols = parseInt(req.body.product_table_columns || req.body.table_layout || req.body.productTableColumns || req.body.tableLayout, 10);
    const resolvedTableCols = (rawTableCols >= 1 && rawTableCols <= 3) ? rawTableCols : 2;

    let certificate_url = null;
    if (req.file) {
      certificate_url = await uploadToS3(req.file.buffer, req.file.originalname, req.file.mimetype, 'certificates');
    } else if (auto_generate_pdf === 'true' || auto_generate_pdf === true || !req.file) {
      const certData = {
        certificateType: certificate_type || 'GSO MEAT',
        businessName: effectiveBusinessName,
        businessAddress: businessAddress,
        manufacturerAddress: manufacturerAddr,
        certificateNumber: certNumber,
        scopeOfCertification: effectiveScope,
        productCategory: effectiveScope,
        productCategories: cleanProducts.length > 0
          ? cleanProducts.map(p => ({ code: p.code || 'PRD-01', name: p.name, description: p.description || p.name, category: p.category || 'Halal Certified' }))
          : [{ code: 'PRD-01', name: 'Certified Halal Food Products', description: 'Certified Halal Food Products', category: 'Halal Certified' }],
        products: cleanProducts.length > 0
          ? cleanProducts.map(p => ({ code: p.code || 'PRD-01', name: p.name, description: p.description || p.name, category: p.category || 'Halal Certified' }))
          : [{ code: 'PRD-01', name: 'Certified Halal Food Products', description: 'Certified Halal Food Products', category: 'Halal Certified' }],
        productTableColumns: resolvedTableCols,
        issueDate: parsedIssueDate,
        expiryDate: parsedExpiryDate,
        certificationStartDate: parsedCertStartDate,
        currentCycleStartDate: parsedCurrentCycle,
        originalCycleStartDate: parsedOrigCycle,
        verificationUrl: `${getClientUrl()}/verify/${certNumber}`
      };

      try {
        const pdfBuffer = await generateCertificate(certData);
        const filename = `${certNumber}.pdf`;
        certificate_url = await uploadToS3(pdfBuffer, filename, 'application/pdf', 'certificates');
      } catch (pdfErr) {
        console.warn('Auto PDF generation warning:', pdfErr.message);
      }
    }

    // 6. Save Certificate
    const certificate = new Certificate({
      certificate_number: certNumber,
      client_id: targetClientId,
      site_id: targetSiteId || undefined,
      certificate_type: certificate_type || 'GSO MEAT',
      company_name: effectiveBusinessName,
      company_address: businessAddress,
      manufacturing_address: manufacturerAddr,
      scope: effectiveScope,
      issue_date: parsedIssueDate,
      expiry_date: parsedExpiryDate,
      certification_start_date: parsedCertStartDate,
      current_cycle_start_date: parsedCurrentCycle,
      original_cycle_start_date: parsedOrigCycle,
      products_covered: productsCoveredNames,
      product_details: cleanProducts,
      product_table_columns: resolvedTableCols,
      certificate_url,
      status: status || 'active',
      is_direct_issuance: true,
      is_add_on: isAddOn,
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

    // 7. Save / Link Products in Product collection linked to certificate
    const createdProductDocs = [];
    for (const prod of cleanProducts) {
      let existingProd = null;
      const prodId = prod._sourceId;
      if (prodId && mongoose.isValidObjectId(prodId)) {
        existingProd = await Product.findOne({ _id: prodId, client_id: targetClientId });
      }
      if (!existingProd && prod.name) {
        existingProd = await Product.findOne({
          client_id: targetClientId,
          name: { $regex: new RegExp(`^${prod.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
        });
      }

      if (existingProd) {
        existingProd.certificate_id = savedCert._id.toString();
        if (targetSiteId) existingProd.site_id = targetSiteId;
        existingProd.status = 'active';
        existingProd.source = existingProd.source || 'admin';
        existingProd.application_type = existingProd.application_type || 'Direct';
        if (prod.code) existingProd.code = prod.code;
        if (prod.barcode) existingProd.barcode = prod.barcode;
        if (prod.category) existingProd.category = prod.category;
        if (prod.product_type) existingProd.product_type = prod.product_type;
        if (prod.description) existingProd.description = prod.description;
        if (prod.ingredients && prod.ingredients.length > 0) existingProd.ingredients = prod.ingredients;
        const updated = await existingProd.save();
        createdProductDocs.push(updated);
      } else {
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
          status: 'active',
          source: 'admin',
          application_type: 'Direct',
          created_by: req.user._id,
          created_by_name: req.user.full_name || req.user.company_name || req.user.email || 'Admin'
        });
        const savedProd = await newProd.save();
        createdProductDocs.push(savedProd);
      }
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
        const superadminBcc = await getSuperadminEmails();
        await resend.emails.send({
          from: emailFrom,
          to: targetClient.email,
          ...(superadminBcc.length > 0 ? { bcc: superadminBcc } : {}),
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
                  <p style="margin:4px 0;color:#166534;font-size:14px"><strong>Certificate Type:</strong> ${certificate_type || 'HFA SCHEME'}</p>
                  <p style="margin:4px 0;color:#166534;font-size:14px"><strong>Certified Products:</strong> ${createdProductDocs.length} product(s) registered</p>
                  <p style="margin:4px 0;color:#166534;font-size:14px"><strong>Expiry Date:</strong> ${parsedExpiryDate.toLocaleDateString('en-GB')}</p>
                </div>
                <a href="${getClientUrl()}/certificates" style="display:inline-block;background:linear-gradient(135deg,#15803d,#166534);color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:16px">View & Download Certificate</a>
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
