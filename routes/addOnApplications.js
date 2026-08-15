import express from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import AddOnApplication from '../models/AddOnApplication.js';
import Certificate from '../models/Certificate.js';
import User from '../models/User.js';
import ApplicationLogsheet from '../models/ApplicationLogsheet.js';
import Product from '../models/Product.js';
import { authenticateToken, requireAdmin, requireFoodTechManagerOrAdmin, requireStaff } from '../middleware/auth.js';
import { createNotification } from '../lib/notifications.js';
import { emitAddOnUpdate } from '../lib/socket.js';
import { Resend } from 'resend';
import { generateCertificate } from '../services/certificateGenerator.js';
import { uploadToGridFS } from '../lib/gridfs.js';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);
const emailFrom = process.env.EMAIL_FROM || 'HFA Portal <info@halalfoodfoundation.org.uk>';

// File upload middleware (for enabling form / client form response)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Only PDF and image files are allowed'));
  },
});

// ─── Email helpers ────────────────────────────────────────────────────────────

/**
 * Send a stage-transition email to the Contact Person email on the application.
 * Failures are swallowed (logged only) so they never block the status update.
 */
async function sendContactEmail({ contactEmail, contactName, subject, bodyHtml }) {
  if (!contactEmail) return;
  try {
    await resend.emails.send({
      from: emailFrom,
      to: contactEmail,
      subject,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#f9fafb;border-radius:12px">
          <div style="background:linear-gradient(135deg,#0e7490,#0891b2);border-radius:8px 8px 0 0;padding:20px 24px;color:white">
            <h2 style="margin:0;font-size:20px;font-weight:800">Halal Food Authority</h2>
            <p style="margin:4px 0 0;font-size:13px;opacity:0.9">Add-on Product Application Update</p>
          </div>
          <div style="padding:24px;background:white;border-radius:0 0 8px 8px">
            <p style="margin-top:0;font-size:14px;color:#334155">Dear ${contactName || 'Applicant'},</p>
            ${bodyHtml}
            <p style="margin-top:24px;font-size:12px;color:#94a3b8">Please log in to the HFA Client Portal to view your application and take any required action.</p>
            <p style="font-size:12px;color:#64748b">— Halal Food Authority</p>
          </div>
        </div>
      `
    });
  } catch (err) {
    console.error(`[AddOn] Failed to send email to ${contactEmail}:`, err.message);
  }
}

/**
 * Push a status history entry and notify admin users.
 */
async function pushHistory(app, status, note, changedBy) {
  if (!Array.isArray(app.statusHistory)) {
    app.statusHistory = [];
  }
  app.statusHistory.push({ status, changedAt: new Date(), changedBy, note });
}

async function notifyAdmins(title, body) {
  try {
    const admins = await User.find({ role: { $in: ['admin', 'food_tech_manager'] } }).lean();
    for (const a of admins) {
      await createNotification(a._id, title, body, 'info', '/addon-applications');
    }
  } catch (err) {
    console.error('[AddOn] Failed to notify admins:', err.message);
  }
}

// ─── Regenerate Certificate PDF helper ────────────────────────────────────────

async function regenerateCertPdf(certificate) {
  try {
    const { default: Application } = await import('../models/Application.js');
    const application = await Application.findById(certificate.application_id);
    const client = await User.findById(certificate.client_id);

    const productCategories = (certificate.products_covered || []).map((p, idx) => ({
      code: `GEN-${String(idx + 1).padStart(2, '0')}`,
      name: p
    }));

    const certData = {
      businessName: client ? (client.company_name || client.full_name) : (application?.establishment_name || 'HFA Client'),
      businessAddress: application?.establishment_address || '—',
      manufacturerAddress: application?.manufacturer_address || 'Same as above',
      certificateNumber: certificate.certificate_number,
      scopeOfCertification: application?.scope || 'Halal Food Certification',
      productCategories,
      issueDate: certificate.issue_date || new Date(),
      expiryDate: certificate.expiry_date || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      verificationUrl: `${process.env.FRONTEND_CLIENT_URL || 'https://hfa-portal.vercel.app'}/verify/${certificate.certificate_number}`
    };

    const pdfBuffer = await generateCertificate(certData);
    const filename = `${certificate.certificate_number}.pdf`;
    const certificate_url = await uploadToGridFS(pdfBuffer, filename, 'application/pdf');
    certificate.certificate_url = certificate_url;
    await certificate.save();
    console.log(`[AddOn] Regenerated certificate PDF: ${certificate.certificate_number}`);
  } catch (err) {
    console.error('[AddOn] Failed to regenerate certificate PDF:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// ─── POST /api/add-on-applications ───────────────────────────────────────────
// Client submits a new multi-product add-on application
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { certificate_id, application_id, site_id, contact_name, contact_email, contact_phone, message, products } = req.body;

    let targetCertId = certificate_id;
    if (certificate_id) {
      const activeCerts = await Certificate.find({
        client_id: req.user._id.toString(),
        status: 'active',
        expiry_date: { $gte: new Date() }
      });
      const cert = activeCerts.find(c => c._id.toString() === certificate_id);
      if (!cert) {
        // Warning only if certificate explicitly provided
        console.warn(`[AddOn] Certificate ${certificate_id} not found among active certs for user ${req.user._id}`);
      }
    }

    // Validate required fields
    if (!contact_name?.trim()) return res.status(400).json({ error: 'Contact Person Name is required.' });
    if (!contact_email?.trim()) return res.status(400).json({ error: 'Contact Person Email is required.' });
    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: 'At least one product entry is required.' });
    }
    for (const p of products) {
      if (!p.name?.trim()) return res.status(400).json({ error: 'Each product must have a name.' });
      if (!p.type) return res.status(400).json({ error: 'Each product must have a type selected.' });
    }

    const newApp = new AddOnApplication({
      client_id: req.user._id,
      certificate_id: targetCertId || undefined,
      application_id: application_id || undefined,
      site_id: site_id || undefined,
      contact_name,
      contact_email,
      contact_phone,
      message,
      products,
      status: 'submitted',
      statusHistory: [{
        status: 'submitted',
        changedAt: new Date(),
        changedBy: req.user._id,
        note: `Add-on product application submitted with ${products.length} product(s).`
      }]
    });

    const data = await newApp.save();
    emitAddOnUpdate(data, 'created');

    // Notify admins
    await notifyAdmins(
      'New Add-on Application 📄',
      `${req.user.company_name || req.user.full_name} submitted a new add-on application with ${products.length} product(s).`
    );

    // Email Contact Person
    await sendContactEmail({
      contactEmail: contact_email,
      contactName: contact_name,
      subject: '✅ HFA Add-on Application Submitted',
      bodyHtml: `
        <p style="font-size:14px;color:#334155;line-height:1.6">
          Your add-on product application has been successfully submitted and is now <strong>under review</strong> by the HFA team.
        </p>
        <p style="font-size:14px;color:#334155;line-height:1.6">
          <strong>Products submitted: ${products.length}</strong>
        </p>
        <p style="font-size:14px;color:#334155;line-height:1.6">We will notify you at this email address at every stage of the process.</p>
      `
    });

    res.status(201).json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/add-on-applications ────────────────────────────────────────────
router.get('/', authenticateToken, async (req, res) => {
  try {
    let query = {};
    if (req.user.role === 'client') {
      query.client_id = req.user._id;
    } else if (req.user.role === 'food_tech') {
      query.assigned_food_techs = req.user._id;
    }

    const data = await AddOnApplication.find(query)
      .populate('client_id', 'company_name full_name email phone')
      .populate('certificate_id', 'certificate_number products_covered')
      .populate('application_id', 'application_number establishment_name site_name scope status')
      .populate('site_id', 'name address city')
      .populate('assigned_food_tech', 'full_name email phone')
      .populate('assigned_food_techs', 'full_name email phone')
      .sort({ createdAt: -1 });

    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/add-on-applications/:id ────────────────────────────────────────
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ error: 'Add-on application not found' });
    }
    const app = await AddOnApplication.findById(req.params.id)
      .populate('client_id', 'company_name full_name email phone address')
      .populate('certificate_id', 'certificate_number products_covered')
      .populate('application_id', 'application_number establishment_name site_name scope status manufacturer_name manufacturer_address')
      .populate('site_id', 'name address city postal_code country')
      .populate('assigned_food_tech', 'full_name email phone')
      .populate('assigned_food_techs', 'full_name email phone')
      .populate('logsheet_id');

    if (!app) return res.status(404).json({ error: 'Add-on application not found' });

    if (req.user.role === 'client' && app.client_id._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (req.user.role === 'food_tech' && !app.assigned_food_techs?.some(ft => ft._id.toString() === req.user._id.toString())) {
      return res.status(403).json({ error: 'Access denied. You are not assigned to this application.' });
    }

    res.json({ data: app });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/add-on-applications/:id/review ─────────────────────────────────
// Admin: Accept Or Reject
router.put('/:id/review', authenticateToken, requireFoodTechManagerOrAdmin, async (req, res) => {
  try {
    const { decision, rejection_reason, notes } = req.body;
    if (!['accepted', 'rejected', 'on_hold'].includes(decision)) {
      return res.status(400).json({ error: 'Decision must be "accepted", "rejected", or "on_hold".' });
    }
    if (decision === 'rejected' && !rejection_reason?.trim()) {
      return res.status(400).json({ error: 'Rejection reason is required.' });
    }

    const app = await AddOnApplication.findById(req.params.id);
    if (!app) return res.status(404).json({ error: 'Add-on application not found' });
    if (!['submitted', 'on_hold'].includes(app.status)) {
      return res.status(400).json({ error: 'This application has already been reviewed or accepted.' });
    }

    app.status = decision;
    if (rejection_reason) app.rejection_reason = rejection_reason;
    if (notes) app.notes = notes;
    const historyNote = decision === 'rejected' 
      ? `Rejected: ${rejection_reason}` 
      : decision === 'on_hold' 
      ? `Application placed on hold: ${notes || 'Under review'}` 
      : 'Application accepted by admin.';
    await pushHistory(app, decision, historyNote, req.user._id);

    const data = await app.save();
    emitAddOnUpdate(data, 'reviewed');

    const isAccepted = decision === 'accepted';
    const isOnHold = decision === 'on_hold';

    // Notify client
    const client = await User.findById(app.client_id);
    if (client) {
      await createNotification(
        client._id,
        isAccepted ? 'Add-on Application Accepted 👍' : isOnHold ? 'Add-on Application On Hold ⏸️' : 'Add-on Application Rejected ❌',
        isAccepted ? 'Your add-on application has been accepted.' : isOnHold ? `Your add-on application has been placed on hold. Note: ${notes || 'Further review needed.'}` : `Your add-on application was rejected. Reason: ${rejection_reason}`,
        isAccepted ? 'success' : isOnHold ? 'warning' : 'error',
        '/addon-applications'
      );
    }

    await sendContactEmail({
      contactEmail: app.contact_email,
      contactName: app.contact_name,
      subject: isAccepted ? '✅ HFA Add-on Application Accepted' : isOnHold ? '⏸️ HFA Add-on Application On Hold' : '❌ HFA Add-on Application Rejected',
      bodyHtml: isAccepted
        ? `<p style="font-size:14px;color:#334155;line-height:1.6">Your add-on product application has been <strong>accepted</strong>. HFA will now assign a Food Technologies staff member to your application.</p>`
        : isOnHold
        ? `<p style="font-size:14px;color:#334155;line-height:1.6">Your add-on product application has been placed <strong>on hold</strong> for further review.</p>
           ${notes ? `<p style="font-size:14px;color:#475569;line-height:1.6"><strong>Note:</strong> ${notes}</p>` : ''}`
        : `<p style="font-size:14px;color:#334155;line-height:1.6">Your add-on product application has been <strong>rejected</strong>.</p>
           <p style="font-size:14px;color:#dc2626;line-height:1.6"><strong>Reason:</strong> ${rejection_reason}</p>
           <p style="font-size:14px;color:#334155;line-height:1.6">Please contact HFA if you have any questions.</p>`
    });

    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/add-on-applications/:id/assign-ft ──────────────────────────────
// Admin: Assign one or more FT staff (appends to assigned_food_techs array)
router.put('/:id/assign-ft', authenticateToken, requireFoodTechManagerOrAdmin, async (req, res) => {
  try {
    // Accept single ID string OR array of IDs
    const rawIds = req.body.assigned_food_techs || req.body.assigned_food_tech;
    const ftIds = Array.isArray(rawIds) ? rawIds : [rawIds].filter(Boolean);
    if (ftIds.length === 0) return res.status(400).json({ error: 'At least one Food Technologies staff member is required.' });

    // Validate all IDs are food_tech users
    const ftUsers = await User.find({ _id: { $in: ftIds }, role: 'food_tech' });
    if (ftUsers.length !== ftIds.length) {
      return res.status(400).json({ error: 'One or more selected users are not Food Technologies staff members.' });
    }

    const app = await AddOnApplication.findById(req.params.id);
    if (!app) return res.status(404).json({ error: 'Add-on application not found' });
    if (!['accepted', 'ft_assigned'].includes(app.status)) {
      return res.status(400).json({ error: 'Application must be in accepted or ft_assigned status to (re-)assign FT.' });
    }

    // Set the new list (replace, not append) — admin manages the full list
    app.assigned_food_techs = ftIds;
    // Keep legacy field for backward compat (first FT)
    app.assigned_food_tech = ftIds[0];
    app.status = 'ft_assigned';
    await pushHistory(app, 'ft_assigned', `FT assigned: ${ftUsers.map(u => u.full_name).join(', ')}`, req.user._id);

    const data = await app.save();
    emitAddOnUpdate(data, 'ft_assigned');

    // Notify each newly assigned FT
    for (const ft of ftUsers) {
      await sendContactEmail({
        contactEmail: ft.email,
        contactName: ft.full_name,
        subject: '🔍 New Add-on Application FT Assignment',
        bodyHtml: `<p style="font-size:14px;color:#334155;line-height:1.6">You have been assigned as a Food Technologies staff member for a new Add-on Product Application. Please log in to the HFA Admin Portal to proceed.</p>`
      });
    }

    // Notify contact person
    await sendContactEmail({
      contactEmail: app.contact_email,
      contactName: app.contact_name,
      subject: '👷 HFA: Food Technologies Staff Assigned',
      bodyHtml: `<p style="font-size:14px;color:#334155;line-height:1.6">Food Technologies staff (${ftUsers.map(u => u.full_name).join(', ')}) have been assigned to your add-on application. The team is now reviewing your product request. You will be notified when the Product Approval Form is ready.</p>`
    });

    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/add-on-applications/:id/enable-form ────────────────────────────
// Admin: Enable or Save Draft Product Approval Form (upload PDF or write text)
router.put('/:id/enable-form', authenticateToken, requireStaff, upload.single('form_file'), async (req, res) => {
  try {
    const app = await AddOnApplication.findById(req.params.id);
    if (!app) return res.status(404).json({ error: 'Add-on application not found' });
    if (!['ft_assigned', 'product_approval_form_enabled', 'all_forms_received', 'logsheet_created', 'waiting_sharia_signature'].includes(app.status)) {
      return res.status(400).json({ error: 'Cannot edit or enable Product Approval Form in current status.' });
    }

    const { form_text, is_draft } = req.body;
    const isDraftBool = is_draft === 'true' || is_draft === true;
    let form_file_url = app.product_approval_form?.form_file_url || null;

    if (req.file) {
      form_file_url = await uploadToGridFS(req.file.buffer, req.file.originalname, req.file.mimetype);
    }

    let form_text_val = form_text !== undefined ? form_text.trim() : (app.product_approval_form?.form_text || '');
    if (!form_text_val && !form_file_url && !isDraftBool) {
      form_text_val = 'Please complete and submit the Product Approval Form for each product.';
    }

    app.product_approval_form = {
      ...app.product_approval_form,
      form_file_url: form_file_url || app.product_approval_form?.form_file_url,
      form_text: form_text_val,
      is_draft: isDraftBool
    };

    if (isDraftBool) {
      const data = await app.save();
      return res.json({ data, message: 'Draft saved successfully.' });
    }

    app.product_approval_form.sent_at = new Date();
    app.status = 'product_approval_form_enabled';
    await pushHistory(app, 'product_approval_form_enabled', 'Request for Product Approval Form sent to client.', req.user._id);

    const data = await app.save();
    emitAddOnUpdate(data, 'form_enabled');

    // Notify client
    const client = await User.findById(app.client_id);
    if (client) {
      await createNotification(
        client._id,
        'Request for Product Approval Form 📋',
        'Your Product Approval Forms are ready. Please log in to review and submit your responses.',
        'info',
        `/addon-applications/${app._id}/approval-form`
      );
    }

    await sendContactEmail({
      contactEmail: app.contact_email,
      contactName: app.contact_name,
      subject: '📋 HFA: Product Approval Form Enabled — Action Required',
      bodyHtml: `
        <p style="font-size:14px;color:#334155;line-height:1.6">
          Your <strong>Product Approval Form</strong> has been prepared and is now available for you to review and complete.
        </p>
        <p style="font-size:14px;color:#334155;line-height:1.6">
          Please log in to the HFA Client Portal, open your add-on application, and submit your responses for each product.
        </p>
        <p style="font-size:14px;color:#dc2626;font-weight:700;line-height:1.6">
          ⚠️ Action Required: Your application cannot progress until you submit responses for all products.
        </p>
      `
    });

    res.json({ data, message: 'Product Approval Form enabled and sent to client.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/add-on-applications/:id/save-product-response/:productIdx ──────
// Client: Save per-product response draft (file and/or text)
router.put('/:id/save-product-response/:productIdx', authenticateToken, upload.single('response_file'), async (req, res) => {
  try {
    const app = await AddOnApplication.findById(req.params.id);
    if (!app) return res.status(404).json({ error: 'Add-on application not found' });

    if (req.user.role === 'client' && app.client_id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    if (app.status !== 'product_approval_form_enabled') {
      return res.status(400).json({ error: 'The Product Approval Form is not currently editable.' });
    }

    const idx = parseInt(req.params.productIdx, 10);
    if (isNaN(idx) || idx < 0 || idx >= (app.products?.length || 0)) {
      return res.status(400).json({ error: 'Invalid product index.' });
    }

    const { response_text, form_data } = req.body;
    let parsedFormData = {};
    if (form_data) {
      try {
        parsedFormData = typeof form_data === 'string' ? JSON.parse(form_data) : form_data;
      } catch (e) {
        console.warn('Could not parse form_data JSON:', e.message);
      }
    }
    let response_url = null;

    if (req.file) {
      response_url = await uploadToGridFS(req.file.buffer, req.file.originalname, req.file.mimetype);
    }

    if (!app.product_approval_form) {
      app.product_approval_form = { product_responses: [] };
    }
    if (!Array.isArray(app.product_approval_form.product_responses)) {
      app.product_approval_form.product_responses = [];
    }

    const product = app.products[idx];
    let respItem = app.product_approval_form.product_responses.find(r => r.product_index === idx);

    if (!respItem) {
      respItem = {
        product_index: idx,
        product_name: product.name,
        response_text: response_text?.trim() || '',
        response_url: response_url || '',
        form_data: parsedFormData,
        is_saved: true,
        saved_at: new Date()
      };
      app.product_approval_form.product_responses.push(respItem);
    } else {
      respItem.product_name = product.name;
      if (response_text !== undefined) respItem.response_text = response_text.trim();
      if (response_url) respItem.response_url = response_url;
      if (Object.keys(parsedFormData).length > 0) respItem.form_data = parsedFormData;
      respItem.is_saved = true;
      respItem.saved_at = new Date();
    }

    const data = await app.save();
    res.json({ data, message: `Response saved for product ${idx + 1}.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/add-on-applications/:id/request-more-info ──────────────────────
// Admin: Request additional information / documents from the client for their product approval form
router.put('/:id/request-more-info', authenticateToken, requireStaff, upload.single('info_file'), async (req, res) => {
  try {
    const app = await AddOnApplication.findById(req.params.id);
    if (!app) return res.status(404).json({ error: 'Add-on application not found' });

    const { message } = req.body;
    if (!message?.trim()) {
      return res.status(400).json({ error: 'Message detailing the requested information is required.' });
    }

    let file_url = null;
    if (req.file) {
      file_url = await uploadToGridFS(req.file.buffer, req.file.originalname, req.file.mimetype);
    }

    app.status = 'product_approval_form_enabled';
    if (!app.product_approval_form) app.product_approval_form = {};
    app.product_approval_form.submitted_at = null; // Re-open submission for client
    app.product_approval_form.form_text = message.trim();
    if (file_url) {
      app.product_approval_form.form_file_url = file_url;
    }

    await pushHistory(app, 'product_approval_form_enabled', `More information requested: ${message.trim()}`, req.user._id);

    const data = await app.save();

    try {
      emitAddOnUpdate(data, 'more_info_requested');
    } catch (e) {
      console.warn('[AddOn] Failed to emit socket update:', e.message);
    }

    // Notify client
    try {
      const client = await User.findById(app.client_id);
      if (client) {
        await createNotification(
          client._id,
          'Action Required: More Information Requested 📝',
          `HFA team requested additional details on your Product Approval Form: "${message.trim().slice(0, 100)}..."`,
          'warning',
          `/addon-applications/${app._id}/approval-form`
        );
      }
    } catch (e) {
      console.warn('[AddOn] Failed to create notification:', e.message);
    }

    try {
      await sendContactEmail({
        contactEmail: app.contact_email,
        contactName: app.contact_name,
        subject: '⚠️ HFA: More Information Requested for Product Approval Form',
        bodyHtml: `
          <div style="font-family: Arial, sans-serif; color: #1e293b; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #ea580c; margin-bottom: 12px;">More Information Required</h2>
            <p style="font-size:14px;color:#334155;line-height:1.6">
              The HFA Technical team reviewed your submitted Product Approval Form and has requested additional information before proceeding with certification:
            </p>
            <div style="background-color: #fff7ed; border-left: 4px solid #ea580c; padding: 14px 16px; margin: 16px 0; border-radius: 4px;">
              <p style="margin: 0; font-size: 14px; color: #9a3412; font-weight: 600; white-space: pre-wrap;">${message.trim()}</p>
            </div>
            <p style="font-size:14px;color:#334155;line-height:1.6">
              Please log in to your portal and update your product responses accordingly.
            </p>
            <div style="margin-top: 24px;">
              <a href="${process.env.CLIENT_URL || 'http://localhost:5173'}/addon-applications/${app._id}/approval-form" style="display: inline-block; padding: 12px 24px; background-color: #ea580c; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 700;">
                Open Product Approval Form
              </a>
            </div>
          </div>
        `
      });
    } catch (e) {
      console.warn('[AddOn] Failed to send email:', e.message);
    }

    res.json({ data, message: 'Request for more information sent to client successfully.' });
  } catch (err) {
    console.error('[AddOn] request-more-info error:', err);
    res.status(500).json({ error: err.message || 'Server error processing request' });
  }
});

// ─── PUT /api/add-on-applications/:id/submit-all-responses ───────────────────
// Client: Final submit when responses for ALL products have been saved
router.put('/:id/submit-all-responses', authenticateToken, async (req, res) => {
  try {
    const app = await AddOnApplication.findById(req.params.id);
    if (!app) return res.status(404).json({ error: 'Add-on application not found' });

    if (req.user.role === 'client' && app.client_id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    if (app.status !== 'product_approval_form_enabled') {
      return res.status(400).json({ error: 'The Product Approval Form is not currently awaiting submission.' });
    }

    const productCount = app.products?.length || 0;
    const responses = app.product_approval_form?.product_responses || [];

    // Check if every product has a saved response
    for (let i = 0; i < productCount; i++) {
      const resp = responses.find(r => r.product_index === i && r.is_saved);
      if (!resp) {
        return res.status(400).json({ error: `Please save a response for product #${i + 1} (${app.products[i].name}) before submitting.` });
      }
    }

    app.product_approval_form.submitted_at = new Date();
    app.status = 'all_forms_received';
    await pushHistory(app, 'all_forms_received', 'Client submitted Product Approval Form responses for all products.', req.user._id);

    const data = await app.save();
    emitAddOnUpdate(data, 'form_submitted');

    // Notify admins
    await notifyAdmins(
      'Product Approval Form Received 📋',
      `Client has submitted Product Approval Form responses for all ${productCount} product(s).`
    );

    // Confirm to contact person
    await sendContactEmail({
      contactEmail: app.contact_email,
      contactName: app.contact_name,
      subject: '✅ HFA: Product Approval Form Responses Received',
      bodyHtml: `
        <p style="font-size:14px;color:#334155;line-height:1.6">
          Your Product Approval Form responses for all <strong>${productCount} product(s)</strong> have been successfully received by HFA. Our team will review your submission and proceed to the next stage.
        </p>
        <p style="font-size:14px;color:#334155;line-height:1.6">You will be notified when your application progresses.</p>
      `
    });

    res.json({ data, message: 'All product responses submitted successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/add-on-applications/:id/create-logsheet ───────────────────────
// Admin: Create Logsheet (reuses ApplicationLogsheet infrastructure with source_type=addon_application)
router.post('/:id/create-logsheet', authenticateToken, requireFoodTechManagerOrAdmin, async (req, res) => {
  try {
    const app = await AddOnApplication.findById(req.params.id)
      .populate('client_id', 'company_name full_name email')
      .populate('certificate_id', 'certificate_number issue_date expiry_date');
    if (!app) return res.status(404).json({ error: 'Add-on application not found' });
    if (app.status !== 'all_forms_received') {
      return res.status(400).json({ error: 'All Product Approval Forms must be received before creating a logsheet.' });
    }

    // Check if logsheet already exists
    const existing = await ApplicationLogsheet.findOne({ addon_application_id: app._id });
    if (existing) {
      return res.status(409).json({ error: 'A logsheet already exists for this add-on application.', data: existing });
    }

    const { ...logsheetData } = req.body;

    const logsheet = new ApplicationLogsheet({
      source_type: 'addon_application',
      addon_application_id: app._id,
      client_id: app.client_id._id,
      company_name: logsheetData.company_name || app.client_id?.company_name || app.client_id?.full_name,
      contact_person: logsheetData.contact_person || app.contact_name,
      contact_email: logsheetData.contact_email || app.contact_email,
      ...logsheetData,
      status: 'Waiting for Signature'
    });

    await logsheet.save();

    app.logsheet_id = logsheet._id;
    app.status = 'logsheet_created';
    await pushHistory(app, 'logsheet_created', 'Logsheet created. Awaiting Shari\'a Board signatures.', req.user._id);

    const data = await app.save();
    emitAddOnUpdate(data, 'logsheet_created');

    // Send signatory email notifications (reuse LOGSHEET_SIGNATORY_EMAILS pattern)
    const addresses = (process.env.LOGSHEET_SIGNATORY_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
    const loginUrl = `${process.env.ADMIN_URL || 'http://localhost:5175'}/login`;
    if (addresses.length > 0) {
      for (const addr of addresses) {
        try {
          await resend.emails.send({
            from: emailFrom,
            to: addr,
            subject: `LogSheet Signature Required — Add-on Application (${app.client_id?.company_name || app.client_id?.full_name})`,
            html: `
              <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px">
                <div style="background:linear-gradient(135deg,#0e7490,#0891b2);border-radius:8px 8px 0 0;padding:24px;text-align:center;color:white">
                  <h2 style="margin:0;font-size:22px;font-weight:800">Halal Food Authority</h2>
                  <p style="margin:4px 0 0;font-size:14px;opacity:0.9">Add-on Application LogSheet Signature Request</p>
                </div>
                <div style="padding:24px;background:white;border-radius:0 0 8px 8px">
                  <h3 style="color:#1e293b;margin-top:0">Your Signature is Required</h3>
                  <p style="font-size:14px;color:#475569;line-height:1.6">
                    A Logsheet has been created for an <strong>Add-on Product Application</strong> and requires Shari'a Board signatures before proceeding.
                  </p>
                  <div style="background:#f1f5f9;padding:16px;border-radius:8px;margin:20px 0">
                    <strong style="font-size:13px">Company:</strong> ${app.client_id?.company_name || app.client_id?.full_name}<br/>
                    <strong style="font-size:13px">Products:</strong> ${app.products?.length} product(s)
                  </div>
                  <div style="text-align:center;margin-top:24px">
                    <a href="${loginUrl}" style="display:inline-block;padding:12px 28px;background:#0e7490;color:white;text-decoration:none;border-radius:6px;font-weight:700;font-size:14px">Log In to Sign LogSheet</a>
                  </div>
                </div>
              </div>
            `
          });
        } catch (e) {
          console.error(`[AddOn] Failed to send signatory email to ${addr}:`, e.message);
        }
      }
    }

    // Notify contact person
    await sendContactEmail({
      contactEmail: app.contact_email,
      contactName: app.contact_name,
      subject: '📋 HFA: Logsheet Created — Awaiting Shari\'a Board Signature',
      bodyHtml: `<p style="font-size:14px;color:#334155;line-height:1.6">Your add-on application is progressing. A Logsheet has been created and is now awaiting the Shari'a Board signature. You will be notified once the approval is complete.</p>`
    });

    res.status(201).json({ data: logsheet, addon: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/add-on-applications/:id/logsheet ───────────────────────────────
// Get the logsheet associated with this add-on application
router.get('/:id/logsheet', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'client') return res.status(403).json({ error: 'Access denied' });

    const logsheet = await ApplicationLogsheet.findOne({ addon_application_id: req.params.id });
    if (!logsheet) return res.status(404).json({ error: 'No logsheet found for this application' });
    res.json({ data: logsheet });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/add-on-applications/:id/sharia-signed ──────────────────────────
// Called internally (or by logsheet sign-off) when logsheet reaches 3/4 signatures
// This transitions add-on status to waiting_sharia_signature → product_form_approved
router.put('/:id/sharia-signed', authenticateToken, requireFoodTechManagerOrAdmin, async (req, res) => {
  try {
    const app = await AddOnApplication.findById(req.params.id);
    if (!app) return res.status(404).json({ error: 'Add-on application not found' });

    if (!['logsheet_created', 'waiting_sharia_signature'].includes(app.status)) {
      return res.status(400).json({ error: 'Application must be in logsheet_created or waiting_sharia_signature status.' });
    }

    app.status = 'product_form_approved';
    await pushHistory(app, 'product_form_approved', 'Shari\'a Board signature complete. Product Form Approved.', req.user._id);

    const data = await app.save();
    emitAddOnUpdate(data, 'product_form_approved');

    await sendContactEmail({
      contactEmail: app.contact_email,
      contactName: app.contact_name,
      subject: '✅ HFA: Product Form Approved',
      bodyHtml: `<p style="font-size:14px;color:#334155;line-height:1.6">Great news! Your Product Form has been approved by the Shari'a Board. Your application is now ready for the final certificate update.</p>`
    });

    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/add-on-applications/:id/approve-form ───────────────────────────
// Admin: Approve Product Form (manual approval action after logsheet sign-off)
router.put('/:id/approve-form', authenticateToken, requireFoodTechManagerOrAdmin, async (req, res) => {
  try {
    const app = await AddOnApplication.findById(req.params.id);
    if (!app) return res.status(404).json({ error: 'Add-on application not found' });

    if (!['logsheet_created', 'waiting_sharia_signature', 'all_forms_received'].includes(app.status)) {
      return res.status(400).json({ error: 'Logsheet must exist before approving the product form.' });
    }

    app.status = 'product_form_approved';
    await pushHistory(app, 'product_form_approved', 'Product Form approved by admin.', req.user._id);
    const data = await app.save();
    emitAddOnUpdate(data, 'product_form_approved');

    // Also advance to ready_for_certificate immediately
    app.status = 'ready_for_certificate';
    await pushHistory(app, 'ready_for_certificate', 'Application ready for final certificate update.', req.user._id);
    const finalData = await app.save();
    emitAddOnUpdate(finalData, 'ready_for_certificate');

    await sendContactEmail({
      contactEmail: app.contact_email,
      contactName: app.contact_name,
      subject: '🎉 HFA: Product Form Approved — Ready for Certificate',
      bodyHtml: `<p style="font-size:14px;color:#334155;line-height:1.6">Your Product Form has been approved. Your application is now <strong>Ready for Certificate</strong> — the HFA team will complete the final update to your certificate shortly.</p>`
    });

    res.json({ data: finalData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/add-on-applications/:id/complete ───────────────────────────────
// Admin: Issue Certificate — applies all product changes to Certificate.products_covered and regenerates PDF
router.put('/:id/complete', authenticateToken, requireFoodTechManagerOrAdmin, async (req, res) => {
  try {
    const app = await AddOnApplication.findById(req.params.id);
    if (!app) return res.status(404).json({ error: 'Add-on application not found' });
    if (app.status !== 'ready_for_certificate') {
      return res.status(400).json({ error: 'Application must be in "Ready for Certificate" status before completing.' });
    }

    let cert = null;
    const targetCertId = req.body?.certificate_id || app.certificate_id;
    if (targetCertId) {
      cert = await Certificate.findById(targetCertId);
    }

    // Robust fallbacks if certificate is not explicitly linked
    if (!cert && app.application_id) {
      cert = await Certificate.findOne({ application_id: app.application_id });
    }
    if (!cert && app.site_id) {
      cert = await Certificate.findOne({ site_id: app.site_id, client_id: app.client_id });
    }
    if (!cert && app.client_id) {
      cert = await Certificate.findOne({ client_id: app.client_id, status: 'active' });
    }
    if (!cert && app.client_id) {
      cert = await Certificate.findOne({ client_id: app.client_id }).sort({ createdAt: -1 });
    }

    if (!cert) {
      return res.status(404).json({ error: 'Linked certificate not found. Please ensure the client has an active certificate in the system.' });
    }

    // Ensure app is linked to the resolved certificate
    if (!app.certificate_id || app.certificate_id.toString() !== cert._id.toString()) {
      app.certificate_id = cert._id;
    }

    let products = Array.isArray(cert.products_covered) ? [...cert.products_covered] : [];

    // Apply each product entry's action to the certificate's products_covered array and Product collection
    for (const p of app.products) {
      if (p.type === 'Add product') {
        const prodName = p.new_name || p.name;
        if (prodName) {
          if (!products.includes(prodName)) {
            products.push(prodName);
          }
          // Add or activate in Product collection
          await Product.findOneAndUpdate(
            { client_id: app.client_id, name: prodName },
            { 
              client_id: app.client_id, 
              name: prodName, 
              barcode: p.new_code || p.code || '', 
              category: cert.scope || 'Halal Certified Product',
              status: 'active',
              certificate_id: cert._id.toString()
            },
            { upsert: true, new: true }
          );
        }
      } else if (p.type === 'Remove product') {
        const targetName = p.original_name || p.name;
        products = products.filter(pr => pr !== targetName);
        // Remove from Product collection so only approved products show
        await Product.deleteMany({ client_id: app.client_id, name: targetName });
      } else if (p.type === 'Change name/code') {
        const oldName = p.original_name || p.name;
        const newName = p.new_name || p.name;
        const newCode = p.new_code || p.code || '';
        
        products = products.map(pr => pr === oldName ? (newCode ? `${newCode} - ${newName}` : newName) : pr);
        
        // Update product in Product collection
        await Product.findOneAndUpdate(
          { client_id: app.client_id, name: oldName },
          { 
            name: newName, 
            barcode: newCode, 
            status: 'active',
            certificate_id: cert._id.toString()
          }
        );
      }
    }

    cert.products_covered = products;
    cert.updated_at = new Date();
    await cert.save();

    app.status = 'completed';
    await pushHistory(app, 'completed', `Completed. Certificate ${cert.certificate_number} product list updated.`, req.user._id);
    const data = await app.save();
    emitAddOnUpdate(data, 'completed');

    // Regenerate PDF async
    regenerateCertPdf(cert);

    // Notify client
    const client = await User.findById(app.client_id);
    if (client) {
      await createNotification(
        client._id,
        'Add-on Application Completed! 🎉',
        `Your add-on application is complete. Certificate ${cert.certificate_number} has been updated.`,
        'success',
        '/certificates'
      );
    }

    await sendContactEmail({
      contactEmail: app.contact_email,
      contactName: app.contact_name,
      subject: '🎉 HFA: Certificate Updated — Add-on Application Complete',
      bodyHtml: `
        <p style="font-size:14px;color:#334155;line-height:1.6">
          Your add-on product application has been <strong>completed</strong>.
        </p>
        <p style="font-size:14px;color:#334155;line-height:1.6">
          Your certificate (<strong>${cert.certificate_number}</strong>) has been updated with the requested product changes. An updated certificate document will be available shortly in your portal.
        </p>
      `
    });

    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
