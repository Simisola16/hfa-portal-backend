import express from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import InitialProductApplication from '../models/InitialProductApplication.js';
import Application from '../models/Application.js';
import Invoice from '../models/Invoice.js';
import User from '../models/User.js';
import ApplicationLogsheet from '../models/ApplicationLogsheet.js';
import Product from '../models/Product.js';
import { authenticateToken, requireAdmin, requireFoodTechManagerOrAdmin, requireStaff } from '../middleware/auth.js';
import { createNotification } from '../lib/notifications.js';
import { getIO } from '../lib/socket.js';
import { Resend } from 'resend';
import { uploadToGridFS } from '../lib/gridfs.js';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);
const emailFrom = process.env.EMAIL_FROM || 'HFA Portal <info@halalfoodfoundation.org.uk>';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

// ─── Socket & Email Helpers ──────────────────────────────────────────────────

function emitInitialProductUpdate(data, action) {
  try {
    const io = getIO();
    if (io) {
      io.emit('initial_product_updated', {
        id: data._id || data.id,
        status: data.status,
        action,
        client_id: data.client_id?._id || data.client_id
      });
      io.emit('product_updated', {
        client_id: data.client_id?._id || data.client_id
      });
    }
  } catch (e) {
    console.error('[InitialProduct] Socket emit error:', e.message);
  }
}

async function sendContactEmail({ contactEmail, contactName, subject, bodyHtml }) {
  if (!contactEmail) return;
  try {
    await resend.emails.send({
      from: emailFrom,
      to: contactEmail,
      subject,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#f9fafb;border-radius:12px">
          <div style="background:linear-gradient(135deg,#059669,#047857);border-radius:8px 8px 0 0;padding:20px 24px;color:white">
            <h2 style="margin:0;font-size:20px;font-weight:800">Halal Food Authority</h2>
            <p style="margin:4px 0 0;font-size:13px;opacity:0.9">Initial Product Application Update</p>
          </div>
          <div style="padding:24px;background:white;border-radius:0 0 8px 8px">
            <p style="margin-top:0;font-size:14px;color:#334155">Dear ${contactName || 'Applicant'},</p>
            ${bodyHtml}
            <p style="margin-top:24px;font-size:12px;color:#94a3b8">Please log in to the HFA Client Portal to view your application details.</p>
            <p style="font-size:12px;color:#64748b">— Halal Food Authority</p>
          </div>
        </div>
      `
    });
  } catch (err) {
    console.error(`[InitialProduct] Failed to send email to ${contactEmail}:`, err.message);
  }
}

async function pushHistory(app, status, note, changedBy) {
  if (!Array.isArray(app.statusHistory)) {
    app.statusHistory = [];
  }
  app.statusHistory.push({ status, changedAt: new Date(), changedBy, note });
}

async function notifyAdmins(title, body) {
  try {
    const admins = await User.find({ role: { $in: ['admin', 'superadmin', 'food_tech_manager'] } }).lean();
    for (const a of admins) {
      await createNotification(a._id, title, body, 'info', '/admin/initial-products');
    }
  } catch (err) {
    console.error('[InitialProduct] Failed to notify admins:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// ─── POST /api/initial-products ──────────────────────────────────────────────
// Client submits the 1 Initial Product (Gated to application with confirmed initial invoice)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { application_id, site_id, contact_name, contact_email, contact_phone, message, product } = req.body;

    if (!application_id) {
      return res.status(400).json({ error: 'Application selection is required.' });
    }
    if (!contact_name?.trim()) {
      return res.status(400).json({ error: 'Contact Person Name is required.' });
    }
    if (!contact_email?.trim()) {
      return res.status(400).json({ error: 'Contact Person Email is required.' });
    }
    if (!product || typeof product !== 'object' || !product.name?.trim()) {
      return res.status(400).json({ error: 'Initial product name is required (strictly 1 product allowed).' });
    }

    // Verify application exists and belongs to client (or admin override)
    const app = await Application.findById(application_id);
    if (!app) {
      return res.status(404).json({ error: 'Certification application not found.' });
    }
    if (req.user.role === 'client' && app.client_id?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied to this application.' });
    }

    // GATING CHECK: Verify Initial Certification Invoice is confirmed
    // Invoice confirmation means app status is payment_received or later, or an invoice is paid
    const isAppStatusValid = [
      'payment_received',
      'initial_payment_received',
      'dates_proposed',
      'dates_rejected',
      'dates_accepted',
      'date_finalized',
      'audit_assigned',
      'audit_scheduled',
      'auditor_assigned',
      'audit_in_progress',
      'audit_successful',
      'audit_completed',
      'audit_report_submitted',
      'nc_raised',
      'nc_closed',
      'final_invoice_sent',
      'final_invoice_paid',
      'logsheet_created',
      'logsheet_signed',
      'application_successful',
      'agreement_sent',
      'agreement_signed',
      'agreement_finalised',
      'ready_for_certificate',
      'certificate_issued',
      'approved'
    ].includes(app.status?.toLowerCase());

    const paidInvoice = await Invoice.findOne({
      $or: [
        { application_id: app._id },
        { application_id: String(app._id) },
        { client_id: String(req.user._id) }
      ],
      status: { $in: ['paid', 'client_paid', 'settled'] }
    });

    if (!isAppStatusValid && !paidInvoice) {
      return res.status(400).json({
        error: 'Initial Product can only be submitted after your Initial Certification Invoice has been confirmed by HFA.'
      });
    }

    // Check if an Initial Product has already been submitted for this application
    const existing = await InitialProductApplication.findOne({
      $or: [
        { application_id: app._id },
        { application_id: String(app._id) }
      ]
    });
    if (existing) {
      return res.status(400).json({
        error: 'An Initial Product has already been registered for this certification application.'
      });
    }

    const resolvedSiteId = site_id || (typeof app.site_id === 'object' ? app.site_id?._id : app.site_id);

    const newInitialProduct = new InitialProductApplication({
      client_id: req.user._id,
      application_id: app._id,
      site_id: resolvedSiteId,
      contact_name: contact_name.trim(),
      contact_email: contact_email.trim(),
      contact_phone: (contact_phone || '').trim(),
      message: (message || '').trim(),
      product: {
        name: product.name.trim(),
        code: (product.code || '').trim(),
        category: (product.category || app.category || '').trim(),
        ingredients: (product.ingredients || '').trim(),
        description: (product.description || '').trim()
      },
      status: 'submitted',
      statusHistory: [{
        status: 'submitted',
        changedAt: new Date(),
        changedBy: req.user._id,
        note: `Initial Product submitted: "${product.name.trim()}". Awaiting FT assignment.`
      }]
    });

    const data = await newInitialProduct.save();
    emitInitialProductUpdate(data, 'created');

    // Notify admins & FT managers
    await notifyAdmins(
      'New Initial Product Submitted 📦',
      `${req.user.company_name || req.user.full_name} submitted Initial Product "${product.name.trim()}" for application #${app.application_number}.`
    );

    // Email contact person
    await sendContactEmail({
      contactEmail: contact_email,
      contactName: contact_name,
      subject: '✅ HFA: Initial Product Application Submitted',
      bodyHtml: `
        <p style="font-size:14px;color:#334155;line-height:1.6">
          Your <strong>Initial Product</strong> (<strong>${product.name.trim()}</strong>) for certification application <strong>#${app.application_number}</strong> has been successfully submitted to HFA.
        </p>
        <p style="font-size:14px;color:#334155;line-height:1.6">
          Our Food Technologies department will be assigned directly to review your product specifications. You will receive an update once the Product Approval Form is enabled.
        </p>
      `
    });

    res.status(201).json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/initial-products/by-application/:appId ─────────────────────────
router.get('/by-application/:appId', authenticateToken, async (req, res) => {
  try {
    const isObjId = mongoose.Types.ObjectId.isValid(req.params.appId);
    const Application = (await import('../models/Application.js')).default;
    const targetApp = isObjId
      ? await Application.findById(req.params.appId)
      : await Application.findOne({ application_number: req.params.appId });

    let item = null;

    if (targetApp) {
      item = await InitialProductApplication.findOne({
        application_id: targetApp._id
      })
        .sort({ updatedAt: -1, createdAt: -1 })
        .populate('client_id', 'company_name full_name email phone address')
        .populate('application_id', 'application_number establishment_name site_name scope status category manufacturer_name manufacturer_address')
        .populate('site_id', 'name address city postal_code country')
        .populate('assigned_food_tech', 'full_name email phone')
        .populate('assigned_food_techs', 'full_name email phone')
        .populate('logsheet_id');
    } else if (isObjId) {
      item = await InitialProductApplication.findOne({ application_id: req.params.appId })
        .sort({ updatedAt: -1, createdAt: -1 })
        .populate('client_id', 'company_name full_name email phone address')
        .populate('application_id', 'application_number establishment_name site_name scope status category manufacturer_name manufacturer_address')
        .populate('site_id', 'name address city postal_code country')
        .populate('assigned_food_tech', 'full_name email phone')
        .populate('assigned_food_techs', 'full_name email phone')
        .populate('logsheet_id');
    }

    res.json({ data: item || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/initial-products ───────────────────────────────────────────────
// Fetch list of initial products (scoped to role)
router.get('/', authenticateToken, async (req, res) => {
  try {
    let query = {};
    if (req.user.role === 'client') {
      query.client_id = req.user._id;
    } else if (req.user.role === 'food_tech') {
      query.$or = [
        { assigned_food_techs: req.user._id },
        { assigned_food_tech: req.user._id }
      ];
    }

    if (req.query.application_id) {
      const isObjId = mongoose.Types.ObjectId.isValid(req.query.application_id);
      query.application_id = isObjId
        ? { $in: [req.query.application_id, new mongoose.Types.ObjectId(req.query.application_id)] }
        : req.query.application_id;
    }
    if (req.query.client_id) {
      query.client_id = req.query.client_id;
    }

    const data = await InitialProductApplication.find(query)
      .populate('client_id', 'company_name full_name email phone address')
      .populate('application_id', 'application_number establishment_name site_name scope status category manufacturer_name manufacturer_address')
      .populate('site_id', 'name address city postal_code country')
      .populate('assigned_food_tech', 'full_name email phone')
      .populate('assigned_food_techs', 'full_name email phone')
      .populate('logsheet_id')
      .sort({ createdAt: -1 });

    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/initial-products/eligible-applications ─────────────────────────
// Get client's certification applications that are eligible to add an Initial Product
router.get('/eligible-applications', authenticateToken, async (req, res) => {
  try {
    const clientId = req.user.role === 'client' ? req.user._id : req.query.client_id;
    if (!clientId) {
      return res.status(400).json({ error: 'Client ID required' });
    }

    const clientQuery = mongoose.Types.ObjectId.isValid(clientId)
      ? { $in: [new mongoose.Types.ObjectId(clientId), String(clientId)] }
      : String(clientId);

    const apps = await Application.find({
      client_id: clientQuery,
      status: { $nin: ['rejected', 'on_hold'] }
    }).populate('site_id', 'name address city').lean();

    // Check which apps have confirmed initial invoices
    const appIds = apps.map(a => a._id);
    const appIdsStrings = appIds.map(a => String(a));

    const paidInvoices = await Invoice.find({
      application_id: { $in: [...appIds, ...appIdsStrings] },
      status: { $in: ['paid', 'client_paid', 'settled'] }
    }).lean();

    const paidAppIds = new Set(paidInvoices.map(inv => String(inv.application_id?._id || inv.application_id)).filter(Boolean));

    // Check which apps already have an InitialProductApplication
    const existingInitialProducts = await InitialProductApplication.find({
      application_id: { $in: [...appIds, ...appIdsStrings] }
    }).lean();
    const existingAppIds = new Set(existingInitialProducts.map(ip => String(ip.application_id?._id || ip.application_id)).filter(Boolean));

    const VALID_PAID_STATUSES = [
      'payment_received', 'initial_payment_received',
      'dates_proposed', 'dates_rejected', 'dates_accepted', 'date_finalized',
      'audit_assigned', 'audit_scheduled', 'auditor_assigned', 'audit_in_progress',
      'audit_successful', 'audit_completed', 'audit_report_submitted',
      'nc_raised', 'nc_closed', 'final_invoice_sent', 'final_invoice_paid',
      'logsheet_created', 'logsheet_signed', 'application_successful',
      'agreement_sent', 'agreement_signed', 'agreement_finalised',
      'ready_for_certificate', 'certificate_issued', 'approved'
    ];

    const result = apps.map(app => {
      const isStatusPaid = VALID_PAID_STATUSES.includes(app.status?.toLowerCase());
      const isInvoiceConfirmed = isStatusPaid || paidAppIds.has(String(app._id));
      const hasInitialProduct = existingAppIds.has(String(app._id));

      return {
        ...app,
        isInvoiceConfirmed,
        hasInitialProduct,
        isEligible: isInvoiceConfirmed && !hasInitialProduct
      };
    });

    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/initial-products/:id ───────────────────────────────────────────
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ error: 'Initial product application not found' });
    }

    const item = await InitialProductApplication.findById(req.params.id)
      .populate('client_id', 'company_name full_name email phone address')
      .populate('application_id', 'application_number establishment_name site_name scope status category manufacturer_name manufacturer_address')
      .populate('site_id', 'name address city postal_code country')
      .populate('assigned_food_tech', 'full_name email phone')
      .populate('assigned_food_techs', 'full_name email phone')
      .populate('logsheet_id');

    if (!item) return res.status(404).json({ error: 'Initial product application not found' });

    if (req.user.role === 'client' && item.client_id._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (req.user.role === 'food_tech' && !item.assigned_food_techs?.some(ft => ft._id.toString() === req.user._id.toString())) {
      return res.status(403).json({ error: 'Access denied. You are not assigned to this application.' });
    }

    res.json({ data: item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/initial-products/:id/assign-ft ─────────────────────────────────
// Admin / FT Manager: Directly assign FT (NO accept/reject step required!)
router.put('/:id/assign-ft', authenticateToken, requireFoodTechManagerOrAdmin, async (req, res) => {
  try {
    const rawIds = req.body.assigned_food_techs || req.body.assigned_food_tech;
    const ftIds = (Array.isArray(rawIds) ? rawIds : [rawIds].filter(Boolean)).filter(id => id && mongoose.Types.ObjectId.isValid(id));
    const customFtName = (req.body.custom_ft_name || '').trim();
    const customFtEmail = (req.body.custom_ft_email || '').trim();
    const customFtNotes = (req.body.custom_ft_notes || '').trim();
    const customFtDetails = (req.body.assigned_ft_details || customFtName || '').trim();

    if (ftIds.length === 0 && !customFtName && !customFtDetails) {
      return res.status(400).json({ error: 'Please select at least one FT staff member or enter FT staff details.' });
    }

    let ftUsers = [];
    if (ftIds.length > 0) {
      ftUsers = await User.find({ _id: { $in: ftIds } });
    }

    const app = await InitialProductApplication.findById(req.params.id);
    if (!app) return res.status(404).json({ error: 'Initial product application not found' });

    app.assigned_food_techs = ftIds;
    app.assigned_food_tech = ftIds[0] || null;

    if (customFtName || customFtDetails) {
      app.assigned_ft_details = customFtDetails || customFtName;
      app.assigned_ft_custom = {
        name: customFtName,
        email: customFtEmail,
        notes: customFtNotes
      };
    } else {
      app.assigned_ft_details = undefined;
      app.assigned_ft_custom = undefined;
    }

    app.status = 'ft_assigned';

    const ftLabels = [
      ...ftUsers.map(u => u.full_name || u.email),
      customFtName ? `${customFtName}${customFtEmail ? ` (${customFtEmail})` : ''}` : null
    ].filter(Boolean);

    await pushHistory(app, 'ft_assigned', `FT assigned: ${ftLabels.join(', ') || 'FT Staff'}`, req.user._id);

    const data = await app.save();
    emitInitialProductUpdate(data, 'ft_assigned');

    // Notify assigned FT users
    for (const ft of ftUsers) {
      if (ft.email) {
        await sendContactEmail({
          contactEmail: ft.email,
          contactName: ft.full_name,
          subject: '🔍 New Initial Product FT Assignment',
          bodyHtml: `<p style="font-size:14px;color:#334155;line-height:1.6">You have been assigned as a Food Technologies staff member for Initial Product "${app.product?.name}" (${app.contact_name || 'Client'}). Please log in to proceed.</p>`
        });
      }
    }

    // Notify client contact person
    await sendContactEmail({
      contactEmail: app.contact_email,
      contactName: app.contact_name,
      subject: '👷 HFA: Food Technologies Staff Assigned for Initial Product',
      bodyHtml: `<p style="font-size:14px;color:#334155;line-height:1.6">Food Technologies staff (${ftLabels.join(', ')}) have been assigned directly to your Initial Product (<strong>${app.product?.name}</strong>). The team is now preparing the Product Approval Form.</p>`
    });

    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/initial-products/:id/enable-form ───────────────────────────────
// Admin / FT: Enable or update Product Approval Form for the Initial Product
router.put('/:id/enable-form', authenticateToken, requireStaff, upload.any(), async (req, res) => {
  try {
    const app = await InitialProductApplication.findById(req.params.id);
    if (!app) return res.status(404).json({ error: 'Initial product application not found' });

    // GATING: Ensure FT is assigned before enabling form
    const hasFt = Boolean(
      (Array.isArray(app.assigned_food_techs) && app.assigned_food_techs.length > 0) ||
      app.assigned_food_tech ||
      app.assigned_ft_custom?.name ||
      app.assigned_ft_details ||
      app.status !== 'submitted'
    );
    if (!hasFt) {
      return res.status(400).json({
        error: 'A Food Technologist (FT) must be assigned before enabling the Product Approval Form.'
      });
    }

    const { form_text, is_draft } = req.body;
    const isDraftBool = is_draft === 'true' || is_draft === true;
    let form_file_url = app.product_approval_form?.form_file_url || null;

    const uploadedFile = req.file || (req.files && req.files.length > 0 ? req.files[0] : null);
    if (uploadedFile) {
      form_file_url = await uploadToGridFS(uploadedFile.buffer, uploadedFile.originalname, uploadedFile.mimetype);
    }

    let form_text_val = form_text !== undefined ? form_text.trim() : (app.product_approval_form?.form_text || '');
    if (!form_text_val && !form_file_url && !isDraftBool) {
      form_text_val = 'Please complete and submit the Product Approval Form for your Initial Product.';
    }

    app.product_approval_form = {
      ...app.product_approval_form,
      form_file_url: form_file_url || app.product_approval_form?.form_file_url,
      form_text: form_text_val,
      is_draft: isDraftBool
    };

    if (!isDraftBool) {
      app.status = 'product_approval_form_enabled';
      app.product_approval_form.sent_at = new Date();
      await pushHistory(app, 'product_approval_form_enabled', 'Request for Product Approval Form sent to client.', req.user._id);
    } else {
      await pushHistory(app, app.status, 'Product Approval Form draft saved by FT/Admin.', req.user._id);
    }

    const data = await app.save();
    emitInitialProductUpdate(data, isDraftBool ? 'form_draft_saved' : 'form_enabled');

    if (!isDraftBool) {
      const client = await User.findById(app.client_id);
      if (client) {
        await createNotification(
          client._id,
          'Product Approval Form Ready 📋',
          `The Product Approval Form for your Initial Product "${app.product?.name}" is now ready for completion.`,
          'info',
          `/initial-products/${app._id}/track`
        );
      }

      await sendContactEmail({
        contactEmail: app.contact_email,
        contactName: app.contact_name,
        subject: '📋 HFA: Product Approval Form Ready for Initial Product',
        bodyHtml: `
          <p style="font-size:14px;color:#334155;line-height:1.6">
            The Halal Product Approval Form for your Initial Product (<strong>${app.product?.name}</strong>) is now enabled.
          </p>
          <p style="font-size:14px;color:#334155;line-height:1.6">
            Please log in to your HFA Portal to complete the form and submit your detailed ingredients and formulation specs.
          </p>
        `
      });
    }

    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/initial-products/:id/save-response ─────────────────────────────
// Client: Save or update product approval form response for Initial Product
router.put('/:id/save-response', authenticateToken, upload.any(), async (req, res) => {
  try {
    const app = await InitialProductApplication.findById(req.params.id);
    if (!app) return res.status(404).json({ error: 'Initial product application not found' });

    if (req.user.role === 'client' && app.client_id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const { response_text, form_data } = req.body;
    let response_url = app.product_approval_form?.product_response?.response_url || '';

    const uploadedFile = req.file || (req.files && req.files.length > 0 ? req.files[0] : null);
    if (uploadedFile) {
      response_url = await uploadToGridFS(uploadedFile.buffer, uploadedFile.originalname, uploadedFile.mimetype);
    }

    let parsedFormData = {};
    if (form_data) {
      try {
        parsedFormData = typeof form_data === 'string' ? JSON.parse(form_data) : form_data;
      } catch (e) {
        parsedFormData = form_data;
      }
    }

    app.product_approval_form.product_response = {
      response_text: response_text !== undefined ? response_text : (app.product_approval_form?.product_response?.response_text || ''),
      response_url,
      form_data: parsedFormData,
      is_saved: true,
      saved_at: new Date()
    };

    const data = await app.save();
    emitInitialProductUpdate(data, 'response_saved');

    res.json({ data, message: 'Response saved successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/initial-products/:id/submit-response ───────────────────────────
// Client: Submit completed Product Approval Form
router.put('/:id/submit-response', authenticateToken, async (req, res) => {
  try {
    const app = await InitialProductApplication.findById(req.params.id);
    if (!app) return res.status(404).json({ error: 'Initial product application not found' });

    if (req.user.role === 'client' && app.client_id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const hasResponse = Boolean(app.product_approval_form?.product_response?.is_saved) ||
      Boolean(app.product_approval_form?.product_response?.response_url) ||
      (app.product_approval_form?.product_response?.form_data && Object.keys(app.product_approval_form?.product_response?.form_data).length > 0);

    if (!hasResponse) {
      return res.status(400).json({ error: 'Please save your Product Approval Form details before submitting.' });
    }

    if (!app.product_approval_form) app.product_approval_form = {};
    app.product_approval_form.submitted_at = new Date();
    if (app.product_approval_form.product_response) {
      app.product_approval_form.product_response.is_saved = true;
    }
    await pushHistory(app, app.status, 'Client submitted Product Approval Form responses. Awaiting HFA admin review and receipt confirmation.', req.user._id);

    const data = await app.save();
    emitInitialProductUpdate(data, 'form_submitted');

    // Notify admins
    await notifyAdmins(
      'Initial Product Form Submitted 📋',
      `Product Approval Form submitted by client for Initial Product "${app.product?.name}" (${app.contact_name}). Awaiting receipt confirmation.`
    );

    // Confirm to contact person
    await sendContactEmail({
      contactEmail: app.contact_email,
      contactName: app.contact_name,
      subject: '✅ HFA: Initial Product Approval Form Submitted',
      bodyHtml: `
        <p style="font-size:14px;color:#334155;line-height:1.6">
          Your Product Approval Form for Initial Product (<strong>${app.product?.name}</strong>) has been successfully submitted to HFA.
        </p>
        <p style="font-size:14px;color:#334155;line-height:1.6">Our technical team will review your submission and confirm receipt shortly.</p>
      `
    });

    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/initial-products/:id/mark-form-received ────────────────────────
// Admin / FT: Confirm / Mark Product Approval Form as Received
router.put('/:id/mark-form-received', authenticateToken, requireStaff, async (req, res) => {
  try {
    const app = await InitialProductApplication.findById(req.params.id);
    if (!app) return res.status(404).json({ error: 'Initial product application not found' });

    const hasResponse = Boolean(app.product_approval_form?.submitted_at) ||
      Boolean(app.product_approval_form?.product_response?.is_saved) ||
      Boolean(app.product_approval_form?.product_response?.response_url) ||
      (app.product_approval_form?.product_response?.form_data && Object.keys(app.product_approval_form?.product_response?.form_data).length > 0);

    if (!hasResponse) {
      return res.status(400).json({ error: 'Cannot mark form as received: Client has not submitted the Product Approval Form yet.' });
    }

    app.status = 'all_forms_received';
    if (!app.product_approval_form) app.product_approval_form = {};
    if (!app.product_approval_form.submitted_at) {
      app.product_approval_form.submitted_at = new Date();
    }
    if (app.product_approval_form.product_response) {
      app.product_approval_form.product_response.is_saved = true;
    }
    await pushHistory(app, 'all_forms_received', 'Product Approval Form responses confirmed and marked as received by HFA admin.', req.user._id);

    const data = await app.save();
    emitInitialProductUpdate(data, 'form_received');

    res.json({ data, message: 'Product Approval Form marked as received successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/initial-products/:id/request-info ──────────────────────────────
router.put('/:id/request-info', authenticateToken, requireStaff, upload.any(), async (req, res) => {
  try {
    const app = await InitialProductApplication.findById(req.params.id);
    if (!app) return res.status(404).json({ error: 'Initial product application not found' });

    const { message } = req.body;
    let more_info_file_url = '';
    const uploadedFile = req.file || (req.files && req.files.length > 0 ? req.files[0] : null);
    if (uploadedFile) {
      more_info_file_url = await uploadToGridFS(uploadedFile.buffer, uploadedFile.originalname, uploadedFile.mimetype);
    }

    app.product_approval_form.more_info_requested = true;
    app.product_approval_form.more_info_message = message || 'Further information requested.';
    app.product_approval_form.more_info_file_url = more_info_file_url;
    app.product_approval_form.more_info_requested_at = new Date();

    await pushHistory(app, app.status, `More information requested: ${message}`, req.user._id);
    const data = await app.save();
    emitInitialProductUpdate(data, 'more_info_requested');

    await sendContactEmail({
      contactEmail: app.contact_email,
      contactName: app.contact_name,
      subject: '⚠️ HFA: More Information Requested on Initial Product',
      bodyHtml: `
        <p style="font-size:14px;color:#334155;line-height:1.6">HFA has requested additional details regarding your Initial Product:</p>
        <blockquote style="background:#f1f5f9;padding:12px 16px;border-left:4px solid #059669;margin:12px 0;font-size:13px;color:#334155">${message}</blockquote>
        <p style="font-size:14px;color:#334155;line-height:1.6">Please log in to your portal to reply.</p>
      `
    });

    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/initial-products/:id/client-reply ──────────────────────────────
router.put('/:id/client-reply', authenticateToken, upload.any(), async (req, res) => {
  try {
    const app = await InitialProductApplication.findById(req.params.id);
    if (!app) return res.status(404).json({ error: 'Initial product application not found' });

    const { reply_text } = req.body;
    let client_reply_file_url = '';
    const uploadedFile = req.file || (req.files && req.files.length > 0 ? req.files[0] : null);
    if (uploadedFile) {
      client_reply_file_url = await uploadToGridFS(uploadedFile.buffer, uploadedFile.originalname, uploadedFile.mimetype);
    }

    app.product_approval_form.more_info_requested = false;
    app.product_approval_form.client_reply_text = reply_text || '';
    app.product_approval_form.client_reply_file_url = client_reply_file_url;
    app.product_approval_form.client_replied_at = new Date();

    await pushHistory(app, app.status, `Client replied to info request: ${reply_text}`, req.user._id);
    const data = await app.save();
    emitInitialProductUpdate(data, 'client_replied');

    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/initial-products/:id/logsheet ─────────────────────────────────
router.get('/:id/logsheet', authenticateToken, async (req, res) => {
  try {
    const id = req.params.id;
    let query = { initial_product_application_id: id };
    if (mongoose.Types.ObjectId.isValid(id)) {
      query = {
        $or: [
          { initial_product_application_id: id },
          { _id: id }
        ]
      };
    }

    const logsheet = await ApplicationLogsheet.findOne(query)
      .populate('client_id', 'full_name company_name email')
      .populate('site_id', 'name address');
    res.json({ data: logsheet || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/initial-products/:id/product-info ──────────────────────────────
// Admin / Staff: Directly edit Initial Product details (Name and Code)
router.put('/:id/product-info', authenticateToken, requireStaff, async (req, res) => {
  try {
    const app = await InitialProductApplication.findById(req.params.id);
    if (!app) return res.status(404).json({ error: 'Initial product application not found' });

    const { name, code, category, ingredients, description } = req.body;
    if (name !== undefined && !name.trim()) {
      return res.status(400).json({ error: 'Product Name is required.' });
    }

    if (!app.product) app.product = {};
    const oldName = app.product.name;
    const oldCode = app.product.code;

    if (name !== undefined) app.product.name = name.trim();
    if (code !== undefined) app.product.code = code.trim();
    if (category !== undefined) app.product.category = category.trim();
    if (ingredients !== undefined) app.product.ingredients = ingredients.trim();
    if (description !== undefined) app.product.description = description.trim();

    await pushHistory(app, app.status, `Initial Product details updated: "${oldName}" (${oldCode || 'No Code'}) → "${app.product.name}" (${app.product.code || 'No Code'})`, req.user._id);

    const data = await app.save();

    // If logsheet already exists, keep logsheet synchronized too
    if (app.logsheet_id) {
      await ApplicationLogsheet.findByIdAndUpdate(app.logsheet_id, {
        product_name: app.product.name,
        product_code: app.product.code
      });
    }

    emitInitialProductUpdate(data, 'product_info_updated');
    res.json({ data, message: 'Initial Product details updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/initial-products/:id/create-logsheet ──────────────────────────
// Admin / FT Manager: Create or Update Logsheet for Initial Product
router.post('/:id/create-logsheet', authenticateToken, requireFoodTechManagerOrAdmin, async (req, res) => {
  try {
    const app = await InitialProductApplication.findById(req.params.id)
      .populate('client_id', 'company_name full_name email')
      .populate('application_id', 'application_number establishment_name site_name scope status');
    if (!app) return res.status(404).json({ error: 'Initial product application not found' });

    let logsheet = await ApplicationLogsheet.findOne({ initial_product_application_id: app._id });
    const { product_name, product_code, product: incomingProduct, ...logsheetData } = req.body;

    // Update product name and code on InitialProductApplication if edited during logsheet creation
    const newName = (product_name !== undefined ? product_name : incomingProduct?.name)?.trim();
    const newCode = (product_code !== undefined ? product_code : incomingProduct?.code)?.trim();
    if (newName) {
      if (!app.product) app.product = {};
      app.product.name = newName;
    }
    if (newCode !== undefined) {
      if (!app.product) app.product = {};
      app.product.code = newCode;
    }

    if (logsheet) {
      Object.assign(logsheet, logsheetData);
      if (newName) logsheet.product_name = newName;
      if (newCode !== undefined) logsheet.product_code = newCode;
      if (!logsheet.status) logsheet.status = 'Waiting for Signature';
    } else {
      logsheet = new ApplicationLogsheet({
        source_type: 'initial_product_application',
        initial_product_application_id: app._id,
        application_id: app.application_id?._id || app.application_id,
        client_id: app.client_id?._id || app.client_id,
        site_id: app.site_id,
        company_name: logsheetData.company_name || app.client_id?.company_name || app.client_id?.full_name,
        contact_person: logsheetData.contact_person || app.contact_name,
        contact_email: logsheetData.contact_email || app.contact_email,
        product_name: newName || app.product?.name,
        product_code: newCode !== undefined ? newCode : app.product?.code,
        ...logsheetData,
        status: 'Waiting for Signature'
      });
    }

    await logsheet.save();

    app.logsheet_id = logsheet._id;
    app.status = 'logsheet_created';
    await pushHistory(app, 'logsheet_created', 'Logsheet created. Awaiting Shari\'a Board signatures.', req.user._id);

    const data = await app.save();
    emitInitialProductUpdate(data, 'logsheet_created');

    // Notify signatories
    const addresses = (process.env.LOGSHEET_SIGNATORY_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
    const loginUrl = `${process.env.ADMIN_URL || 'http://localhost:5175'}/login`;
    if (addresses.length > 0) {
      for (const addr of addresses) {
        try {
          await resend.emails.send({
            from: emailFrom,
            to: addr,
            subject: `LogSheet Signature Required — Initial Product (${app.product?.name})`,
            html: `
              <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px">
                <div style="background:linear-gradient(135deg,#059669,#047857);border-radius:8px 8px 0 0;padding:24px;text-align:center;color:white">
                  <h2 style="margin:0;font-size:22px;font-weight:800">Halal Food Authority</h2>
                  <p style="margin:4px 0 0;font-size:14px;opacity:0.9">Initial Product LogSheet Signature Request</p>
                </div>
                <div style="padding:24px;background:white;border-radius:0 0 8px 8px">
                  <h3 style="color:#1e293b;margin-top:0">Your Signature is Required</h3>
                  <p style="font-size:14px;color:#475569;line-height:1.6">
                    A Logsheet has been created for an <strong>Initial Product</strong> and requires Shari'a Board signatures.
                  </p>
                  <div style="background:#f1f5f9;padding:16px;border-radius:8px;margin:20px 0">
                    <strong style="font-size:13px">Company:</strong> ${app.client_id?.company_name || app.client_id?.full_name}<br/>
                    <strong style="font-size:13px">Initial Product:</strong> ${app.product?.name}
                  </div>
                  <div style="text-align:center;margin-top:24px">
                    <a href="${loginUrl}" style="display:inline-block;padding:12px 28px;background:#059669;color:white;text-decoration:none;border-radius:6px;font-weight:700;font-size:14px">Log In to Sign LogSheet</a>
                  </div>
                </div>
              </div>
            `
          });
        } catch (e) {
          console.error(`[InitialProduct] Failed to send signatory email to ${addr}:`, e.message);
        }
      }
    }

    res.status(201).json({ data: logsheet, initialProduct: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/initial-products/:id/approve-form ──────────────────────────────
// Admin / FT Manager: Approve Initial Product (TERMINAL STATUS: Initial Product Approved)
// It does NOT get certified separately — it activates in the Product collection and concludes cleanly!
router.put('/:id/approve-form', authenticateToken, requireFoodTechManagerOrAdmin, async (req, res) => {
  try {
    const app = await InitialProductApplication.findById(req.params.id);
    if (!app) return res.status(404).json({ error: 'Initial product application not found' });

    app.status = 'initial_product_approved';
    await pushHistory(app, 'initial_product_approved', 'Committee signatures verified (4/4). 1 product(s) approved.', req.user._id);

    const data = await app.save();

    // Activate/Sync Initial Product to Product collection
    const clientId = app.client_id?._id || app.client_id;
    const siteId = app.site_id?._id || app.site_id;
    const prodName = app.product?.name;

    if (prodName) {
      await Product.findOneAndUpdate(
        { client_id: clientId, name: prodName },
        {
          client_id: clientId,
          name: prodName,
          code: app.product?.code || '',
          barcode: app.product?.code || '',
          category: app.product?.category || 'Initial Product',
          description: app.product?.description || '',
          ingredients: app.product?.ingredients || '',
          site_id: siteId,
          status: 'approved',
          product_type: 'Initial Product',
          is_initial: true,
          updated_at: new Date()
        },
        { upsert: true, new: true }
      );
    }

    emitInitialProductUpdate(data, 'initial_product_approved');

    // Unlock main application audit stage
    if (app.application_id) {
      try {
        const { default: Application } = await import('../models/Application.js');
        const parentAppId = app.application_id._id || app.application_id;
        const parentApp = await Application.findById(parentAppId);
        if (parentApp) {
          const auditEligibleStatuses = ['payment_received', 'dates_proposed', 'dates_rejected', 'dates_accepted', 'date_finalized', 'audit_assigned', 'audit_successful', 'audit_completed'];
          if (!auditEligibleStatuses.includes(parentApp.status)) {
            parentApp.status = 'payment_received';
          }
          parentApp.statusHistory.push({
            status: parentApp.status,
            changedAt: new Date(),
            changedBy: req.user._id,
            note: `Initial Product "${prodName || 'Product'}" approved by Committee. Facility audit scheduling unlocked.`
          });
          await parentApp.save();
          emitApplicationUpdate(parentApp, parentApp.status);
        }
      } catch (parentErr) {
        console.error('[InitialProduct] Error updating parent application:', parentErr.message);
      }
    }

    // Notify client
    const client = await User.findById(clientId);
    if (client) {
      await createNotification(
        client._id,
        'Initial Product Approved! 🎉',
        `Congratulations! Your Initial Product "${prodName}" has been approved by the Halal Food Authority.`,
        'success',
        '/products'
      );
    }

    await sendContactEmail({
      contactEmail: app.contact_email,
      contactName: app.contact_name,
      subject: '🎉 HFA: Initial Product Approved!',
      bodyHtml: `
        <p style="font-size:14px;color:#334155;line-height:1.6">
          Congratulations! Your Initial Product (<strong>${prodName}</strong>) has been officially <strong>Approved</strong> by the Halal Food Authority.
        </p>
        <p style="font-size:14px;color:#334155;line-height:1.6">
          The product is now verified and active in your Product Management list under your facility.
        </p>
      `
    });

    res.json({ data, message: 'Initial Product Approved successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
