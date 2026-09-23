import express from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import ExtensionApplication from '../models/ExtensionApplication.js';
import ExtensionLogsheet from '../models/ExtensionLogsheet.js';
import Certificate from '../models/Certificate.js';
import User from '../models/User.js';
import Site from '../models/Site.js';
import { generateHfaId } from '../lib/idGenerator.js';
import { authenticateToken, requireAdmin, requireStaff } from '../middleware/auth.js';
import { createNotification } from '../lib/notifications.js';
import { getIO } from '../lib/socket.js';
import { Resend } from 'resend';
import { getSuperadminEmails } from '../lib/mailer.js';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);
const emailFrom = process.env.EMAIL_FROM || 'HFA Portal <info@halalfoodfoundation.org.uk>';

// ─── Socket & Email Helpers ──────────────────────────────────────────────────

function emitExtensionUpdate(data, action) {
  try {
    const io = getIO();
    if (io) {
      io.emit('extension_updated', {
        id: data._id || data.id,
        status: data.status,
        action,
        client_id: data.client_id?._id || data.client_id
      });
      io.emit('application_updated', {
        id: data._id || data.id,
        client_id: data.client_id?._id || data.client_id
      });
    }
  } catch (e) {
    console.error('[Extension] Socket emit error:', e.message);
  }
}

async function sendContactEmail({ contactEmail, contactName, subject, bodyHtml }) {
  if (!contactEmail) return;
  try {
    const superadminBcc = await getSuperadminEmails();
    await resend.emails.send({
      from: emailFrom,
      to: contactEmail,
      ...(superadminBcc.length > 0 ? { bcc: superadminBcc } : {}),
      subject,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#f9fafb;border-radius:12px">
          <div style="background:linear-gradient(135deg,#059669,#047857);border-radius:8px 8px 0 0;padding:20px 24px;color:white">
            <h2 style="margin:0;font-size:20px;font-weight:800">Halal Food Authority</h2>
            <p style="margin:4px 0 0;font-size:13px;opacity:0.9">Extension Application Update</p>
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
    console.error(`[Extension] Failed to send email to ${contactEmail}:`, err.message);
  }
}

async function notifyAdmins(title, body) {
  try {
    const admins = await User.find({ role: { $in: ['admin', 'superadmin', 'manager'] } }).lean();
    for (const a of admins) {
      await createNotification(a._id, title, body, 'info', '/extension-applications');
    }
  } catch (err) {
    console.error('[Extension] Failed to notify admins:', err.message);
  }
}

async function resolveFacilityAddress(siteId, siteName, userId) {
  let addressParts = [];
  if (siteId) {
    try {
      const site = await Site.findById(siteId);
      if (site) {
        addressParts = [site.address_1, site.address_2, site.city, site.state, site.postcode, site.country].filter(Boolean);
        if (addressParts.length > 0) return addressParts.join(', ');
        if (site.head_office_address) return site.head_office_address;
      }
    } catch (_) {}
  }

  if (siteName) {
    try {
      const site = await Site.findOne({
        $or: [
          { name: new RegExp(`^${siteName.trim()}$`, 'i') },
          { name: siteName }
        ]
      });
      if (site) {
        addressParts = [site.address_1, site.address_2, site.city, site.state, site.postcode, site.country].filter(Boolean);
        if (addressParts.length > 0) return addressParts.join(', ');
        if (site.head_office_address) return site.head_office_address;
      }
    } catch (_) {}
  }

  if (userId) {
    try {
      const user = await User.findById(userId);
      if (user?.address) return user.address;
      if (user?.company_address) return user.company_address;
    } catch (_) {}
  }

  return '';
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// ─── POST /api/extension-applications (Client submits Extension Form) ───────────
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { site_name, contact_person, contact_email, contact_phone, description, site_id } = req.body;

    if (!site_name || !contact_person || !contact_email || !contact_phone || !description) {
      return res.status(400).json({ error: 'All fields (Site Name, Contact Person, Contact Email, Contact Number, Description) are required.' });
    }

    // Get user details to populate company_name
    const user = await User.findById(req.user.id);
    const companyName = user?.company_name || user?.business_name || user?.full_name || 'Client Company';

    // Auto-resolve facility address from site / user
    const facilityAddress = await resolveFacilityAddress(site_id, site_name, req.user.id);

    const newApp = new ExtensionApplication({
      client_id: req.user.id,
      site_id: site_id || undefined,
      site_name: site_name.trim(),
      company_name: companyName,
      contact_person: contact_person.trim(),
      contact_email: contact_email.trim(),
      contact_phone: contact_phone.trim(),
      description: description.trim(),
      status: 'submitted',
      statusHistory: [{
        status: 'submitted',
        changedAt: new Date(),
        changedBy: req.user.id,
        note: 'Extension application submitted by client'
      }]
    });

    await newApp.save();

    // Auto-create initial draft ExtensionLogsheet with populated facility address
    const initialLogsheet = new ExtensionLogsheet({
      extension_application_id: newApp._id,
      client_id: req.user.id,
      site_id: site_id || undefined,
      company_name: companyName,
      facility_address: facilityAddress,
      contact_person: contact_person.trim(),
      justification: description.trim(),
      scheme: 'HFA',
      extension_duration_type: '30_days',
      extension_days: 30,
      signatures_required: 1,
      status: 'Draft'
    });
    await initialLogsheet.save();

    newApp.logsheet_id = initialLogsheet._id;
    await newApp.save();

    // Notify admins
    await notifyAdmins(
      'New Extension Application Received',
      `A new extension request for ${site_name} has been submitted by ${companyName}.`
    );

    // Confirmation email to client
    await sendContactEmail({
      contactEmail: contact_email,
      contactName: contact_person,
      subject: `Extension Application Received - ${newApp.application_number}`,
      bodyHtml: `
        <p>Thank you for submitting your Halal Certificate Extension request for <strong>${site_name}</strong>.</p>
        <p><strong>Application Number:</strong> ${newApp.application_number}</p>
        <p><strong>Status:</strong> Under Review</p>
        <p>Our certification team has received your request and will review your justification shortly.</p>
      `
    });

    emitExtensionUpdate(newApp, 'submitted');

    res.status(201).json({
      success: true,
      message: 'Extension application submitted successfully.',
      data: newApp
    });
  } catch (err) {
    console.error('Error creating extension application:', err);
    res.status(500).json({ error: err.message || 'Failed to submit extension application.' });
  }
});

// ─── GET /api/extension-applications (List Applications) ───────────────────────
router.get('/', authenticateToken, async (req, res) => {
  try {
    const isStaff = ['admin', 'superadmin', 'manager', 'food_tech_manager', 'mufti'].includes(req.user.role);
    let query = {};

    if (!isStaff) {
      // Client only sees their own applications
      query.client_id = req.user.id;
    }

    if (req.query.status && req.query.status !== 'all') {
      query.status = req.query.status;
    }

    if (req.query.search) {
      const s = req.query.search.trim();
      query.$or = [
        { application_number: { $regex: s, $options: 'i' } },
        { site_name: { $regex: s, $options: 'i' } },
        { company_name: { $regex: s, $options: 'i' } },
        { contact_person: { $regex: s, $options: 'i' } },
        { contact_email: { $regex: s, $options: 'i' } },
      ];
    }

    const applications = await ExtensionApplication.find(query)
      .populate('client_id', 'full_name email company_name business_name phone address')
      .populate('site_id', 'name address_1 address_2 city country')
      .populate('statusHistory.changedBy', 'full_name username email role')
      .populate('logsheet_id')
      .populate('certificate_id')
      .sort({ created_at: -1 });

    res.json({ success: true, count: applications.length, data: applications });
  } catch (err) {
    console.error('Error fetching extension applications:', err);
    res.status(500).json({ error: 'Failed to retrieve extension applications.' });
  }
});

// ─── GET /api/extension-applications/:id (Get Single Application) ──────────────
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const isStaff = ['admin', 'superadmin', 'manager', 'food_tech_manager', 'mufti'].includes(req.user.role);
    const app = await ExtensionApplication.findById(req.params.id)
      .populate('client_id', 'full_name email company_name business_name phone address')
      .populate('site_id')
      .populate('statusHistory.changedBy', 'full_name username email role')
      .populate('logsheet_id')
      .populate('certificate_id');

    if (!app) {
      return res.status(404).json({ error: 'Extension application not found.' });
    }

    if (!isStaff && String(app.client_id?._id || app.client_id) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Unauthorized access to this application.' });
    }

    res.json({ success: true, data: app });
  } catch (err) {
    console.error('Error fetching extension application details:', err);
    res.status(500).json({ error: 'Failed to load extension application.' });
  }
});

// ─── POST /api/extension-applications/:id/approve-request (Admin approves initial request) ──
router.post('/:id/approve-request', authenticateToken, requireStaff, async (req, res) => {
  try {
    const app = await ExtensionApplication.findById(req.params.id);
    if (!app) return res.status(404).json({ error: 'Extension application not found.' });

    if (app.status !== 'submitted') {
      return res.status(400).json({ error: `Request already processed (current status: ${app.status}).` });
    }

    app.status = 'under_review';
    app.statusHistory.push({
      status: 'under_review',
      changedAt: new Date(),
      changedBy: req.user.id,
      note: 'Extension request approved by admin. Ready for logsheet creation.'
    });

    await app.save();

    await createNotification(
      app.client_id,
      `Extension Request Approved - ${app.application_number}`,
      `Your extension request for ${app.site_name} has been approved by admin. Logsheet is now being prepared.`,
      'info',
      `/extension-applications/${app._id}/track`
    );

    emitExtensionUpdate(app, 'request_approved');

    res.json({
      success: true,
      message: 'Extension request approved. You may now configure the extension logsheet.',
      data: app
    });
  } catch (err) {
    console.error('Error approving extension request:', err);
    res.status(500).json({ error: 'Failed to approve extension request.' });
  }
});

// ─── PUT /api/extension-applications/:id/status (Admin updates status/decision) ─
router.put('/:id/status', authenticateToken, requireStaff, async (req, res) => {
  try {
    const { status, rejection_reason, notes } = req.body;
    const app = await ExtensionApplication.findById(req.params.id);

    if (!app) {
      return res.status(404).json({ error: 'Extension application not found.' });
    }

    if (status) app.status = status;
    if (rejection_reason !== undefined) app.rejection_reason = rejection_reason;
    if (notes !== undefined) app.notes = notes;

    app.statusHistory.push({
      status: status || app.status,
      changedAt: new Date(),
      changedBy: req.user.id,
      note: notes || `Status updated to ${status}`
    });

    await app.save();

    // Notify client of status change
    await createNotification(
      app.client_id,
      `Extension Application Update - ${app.application_number}`,
      `Your extension application status has been updated to: ${status.replace(/_/g, ' ').toUpperCase()}`,
      'info',
      `/extension-applications/${app._id}/track`
    );

    emitExtensionUpdate(app, 'status_updated');

    res.json({ success: true, message: 'Status updated successfully.', data: app });
  } catch (err) {
    console.error('Error updating status:', err);
    res.status(500).json({ error: 'Failed to update application status.' });
  }
});

// ─── GET /api/extension-applications/:id/logsheet ──────────────────────────────
router.get('/:id/logsheet', authenticateToken, async (req, res) => {
  try {
    let logsheet = await ExtensionLogsheet.findOne({ extension_application_id: req.params.id });
    const app = await ExtensionApplication.findById(req.params.id).populate('client_id');
    if (!app) return res.status(404).json({ error: 'Extension application not found.' });

    // Auto-resolve facility address from site / user if not present
    const resolvedAddress = await resolveFacilityAddress(app.site_id, app.site_name, app.client_id?._id || app.client_id);

    if (!logsheet) {
      logsheet = new ExtensionLogsheet({
        extension_application_id: app._id,
        client_id: app.client_id?._id || app.client_id,
        site_id: app.site_id,
        company_name: app.company_name || app.client_id?.company_name || '',
        facility_address: resolvedAddress,
        contact_person: app.contact_person,
        justification: app.description,
        scheme: 'HFA',
        extension_duration_type: '30_days',
        extension_days: 30,
        signatures_required: 1,
        status: 'Draft'
      });
      await logsheet.save();
      app.logsheet_id = logsheet._id;
      await app.save();
    } else if (!logsheet.facility_address && resolvedAddress) {
      logsheet.facility_address = resolvedAddress;
      await logsheet.save();
    }

    res.json({ success: true, data: logsheet });
  } catch (err) {
    console.error('Error fetching logsheet:', err);
    res.status(500).json({ error: 'Failed to load extension logsheet.' });
  }
});

// ─── POST /api/extension-applications/:id/logsheet (Save / Update Logsheet) ────
router.post('/:id/logsheet', authenticateToken, requireStaff, async (req, res) => {
  try {
    const {
      company_name,
      facility_address,
      contact_person,
      product_category,
      scheme,
      certificate_expiry_date,
      justification,
      extension_duration_type,
      extension_days,
      comments,
      submit_for_signature
    } = req.body;

    let logsheet = await ExtensionLogsheet.findOne({ extension_application_id: req.params.id });
    const app = await ExtensionApplication.findById(req.params.id);

    if (!app) return res.status(404).json({ error: 'Extension application not found.' });

    const durationType = extension_duration_type || '30_days';
    const parsedDays = Number(extension_days) || (durationType === '30_days' ? 30 : 60);
    const sigsRequired = durationType === '30_days' || parsedDays <= 30 ? 1 : 4;

    if (!logsheet) {
      logsheet = new ExtensionLogsheet({
        extension_application_id: app._id,
        client_id: app.client_id,
        site_id: app.site_id
      });
    }

    logsheet.company_name = company_name || app.company_name;
    logsheet.facility_address = facility_address || '';
    logsheet.contact_person = contact_person || app.contact_person;
    logsheet.product_category = product_category || '';
    logsheet.scheme = scheme || 'HFA';
    if (certificate_expiry_date) {
      logsheet.certificate_expiry_date = new Date(certificate_expiry_date);
    }
    logsheet.justification = justification || app.description;
    logsheet.extension_duration_type = durationType;
    logsheet.extension_days = parsedDays;
    logsheet.signatures_required = sigsRequired;
    if (comments !== undefined) logsheet.comments = comments;

    if (submit_for_signature) {
      logsheet.status = 'Waiting for Signature';
      app.status = 'waiting_signature';
      app.statusHistory.push({
        status: 'waiting_signature',
        changedAt: new Date(),
        changedBy: req.user.id,
        note: `Logsheet created (${parsedDays} days extension, ${sigsRequired} signature${sigsRequired > 1 ? 's' : ''} required)`
      });
      await app.save();
    } else if (logsheet.status === 'Draft') {
      app.status = 'logsheet_created';
      await app.save();
    }

    await logsheet.save();
    app.logsheet_id = logsheet._id;
    await app.save();

    emitExtensionUpdate(app, 'logsheet_saved');

    res.json({
      success: true,
      message: submit_for_signature ? 'Logsheet saved and sent for signature.' : 'Logsheet draft saved.',
      data: logsheet
    });
  } catch (err) {
    console.error('Error saving logsheet:', err);
    res.status(500).json({ error: err.message || 'Failed to save extension logsheet.' });
  }
});

// ─── PUT /api/extension-applications/:id/logsheet/sign (Sign Logsheet) ─────────
router.put('/:id/logsheet/sign', authenticateToken, requireStaff, async (req, res) => {
  try {
    const { signature_role, signature_data, signer_name, comment } = req.body;
    const logsheet = await ExtensionLogsheet.findOne({ extension_application_id: req.params.id });
    const app = await ExtensionApplication.findById(req.params.id);

    if (!logsheet || !app) {
      return res.status(404).json({ error: 'Logsheet or application not found.' });
    }

    const signName = signer_name || req.user.full_name || req.user.name || req.user.email;
    const now = new Date();

    if (logsheet.signatures_required === 1 || logsheet.extension_duration_type === '30_days') {
      // Single signature
      logsheet.single_signature = signature_data;
      logsheet.single_sign_name = signName;
      logsheet.single_sign_role = signature_role || 'Authorized Signatory / CEO';
      logsheet.single_sign_date = now;
      logsheet.status = 'Signed';
    } else {
      // 4 Signatures
      const role = (signature_role || '').toLowerCase();
      if (role.includes('ceo') || role.includes('director')) {
        logsheet.ceo_signature = signature_data;
        logsheet.ceo_sign_name = signName;
        logsheet.ceo_sign_date = now;
      } else if (role.includes('manager')) {
        logsheet.manager_signature = signature_data;
        logsheet.manager_sign_name = signName;
        logsheet.manager_sign_date = now;
      } else if (role.includes('mufti2') || role.includes('shariah 2') || role.includes('second')) {
        logsheet.mufti2_signature = signature_data;
        logsheet.mufti2_sign_name = signName;
        logsheet.mufti2_sign_date = now;
      } else {
        // default to mufti 1
        logsheet.mufti_signature = signature_data;
        logsheet.mufti_sign_name = signName;
        logsheet.mufti_sign_date = now;
      }

      // Check if all 4 signed
      const isComplete = logsheet.mufti_signature && logsheet.ceo_signature && logsheet.manager_signature && logsheet.mufti2_signature;
      if (isComplete) {
        logsheet.status = 'Signed';
      }
    }

    if (comment && comment.trim()) {
      const commentEntry = `[${signName}]: ${comment.trim()}`;
      logsheet.comments = logsheet.comments ? `${logsheet.comments}\n${commentEntry}` : commentEntry;
    }

    await logsheet.save();
    emitExtensionUpdate(app, 'logsheet_signed');

    res.json({
      success: true,
      message: 'Signature applied successfully.',
      data: logsheet
    });
  } catch (err) {
    console.error('Error signing logsheet:', err);
    res.status(500).json({ error: 'Failed to apply signature.' });
  }
});

// ─── POST /api/extension-applications/:id/issue-certificate (Approve Extension & Issue Cert) ─
router.post('/:id/issue-certificate', authenticateToken, requireStaff, async (req, res) => {
  try {
    const { extended_until, certificate_number, notes } = req.body;
    const app = await ExtensionApplication.findById(req.params.id)
      .populate('client_id')
      .populate('logsheet_id');

    const logsheet = app.logsheet_id;
    if (!logsheet) {
      return res.status(400).json({ error: 'Cannot issue certificate: No extension logsheet found for this application.' });
    }

    const is30Days = logsheet.extension_duration_type === '30_days' || (logsheet.extension_days && logsheet.extension_days <= 30);
    const isComplete = is30Days
      ? !!logsheet.single_signature
      : (logsheet.mufti_signature && logsheet.ceo_signature && logsheet.manager_signature && logsheet.mufti2_signature);

    if (!isComplete && logsheet.status !== 'Signed') {
      return res.status(400).json({
        error: 'Cannot issue certificate: Extension logsheet must be fully signed by all required signatories first.'
      });
    }

    const extensionDays = logsheet?.extension_days || 30;

    // Calculate extended date
    let newExpiryDate;
    if (extended_until) {
      newExpiryDate = new Date(extended_until);
    } else if (logsheet?.certificate_expiry_date) {
      newExpiryDate = new Date(new Date(logsheet.certificate_expiry_date).getTime() + extensionDays * 24 * 60 * 60 * 1000);
    } else {
      newExpiryDate = new Date(Date.now() + extensionDays * 24 * 60 * 60 * 1000);
    }

    const companyForId = app.company_name || app.client_id?.company_name || app.client_id?.full_name || 'HFA';
    let certNumber = certificate_number || generateHfaId(companyForId, 'EX');

    let existingCertWithNum = await Certificate.findOne({ certificate_number: certNumber });
    let attempts = 0;
    while (existingCertWithNum && attempts < 15) {
      certNumber = generateHfaId(companyForId, 'EX');
      existingCertWithNum = await Certificate.findOne({ certificate_number: certNumber });
      attempts++;
    }

    // Create or update Certificate in Certificate collection
    let cert = null;
    if (app.certificate_id) {
      cert = await Certificate.findById(app.certificate_id);
    }

    if (cert) {
      cert.certificate_number = certNumber;
      cert.client_id = String(app.client_id?._id || app.client_id);
      cert.site_id = app.site_id;
      cert.company_name = app.company_name || app.client_id?.company_name || 'Client';
      cert.company_address = logsheet?.facility_address || app.client_id?.address || '';
      cert.scope = `Halal Extension Certificate (${extensionDays} Days)`;
      cert.issue_date = new Date();
      cert.expiry_date = newExpiryDate;
      cert.status = 'active';
      cert.notes = notes || `Issued via Extension Application ${app.application_number} for ${extensionDays} days.`;
      await cert.save();
    } else {
      cert = new Certificate({
        certificate_number: certNumber,
        client_id: String(app.client_id?._id || app.client_id),
        site_id: app.site_id,
        certificate_type: 'Extension',
        company_name: app.company_name || app.client_id?.company_name || 'Client',
        company_address: logsheet?.facility_address || app.client_id?.address || '',
        scope: `Halal Extension Certificate (${extensionDays} Days)`,
        issue_date: new Date(),
        expiry_date: newExpiryDate,
        status: 'active',
        is_direct_issuance: true,
        issued_by: req.user.id,
        notes: notes || `Issued via Extension Application ${app.application_number} for ${extensionDays} days.`
      });

      try {
        await cert.save();
      } catch (saveErr) {
        if (saveErr.code === 11000 || (saveErr.message && saveErr.message.includes('E11000'))) {
          cert.certificate_number = generateHfaId(companyForId, 'EX');
          await cert.save();
          certNumber = cert.certificate_number;
        } else {
          throw saveErr;
        }
      }
    }

    // Update ExtensionApplication status to extension_approved
    app.status = 'extension_approved';
    app.certificate_id = cert._id;
    app.certificate_number = certNumber;
    app.extended_until = newExpiryDate;
    app.expiry_date = newExpiryDate;
    app.notes = notes || app.notes;

    app.statusHistory.push({
      status: 'extension_approved',
      changedAt: new Date(),
      changedBy: req.user.id,
      note: `Extension Certificate Approved & Issued: ${certNumber} valid until ${newExpiryDate.toLocaleDateString()}`
    });

    await app.save();

    if (logsheet) {
      logsheet.status = 'Approved';
      await logsheet.save();
    }

    // Notify client
    await createNotification(
      app.client_id,
      `Extension Certificate Approved - ${app.application_number}`,
      `Your Halal Certificate Extension request for ${app.site_name} has been approved. Certificate Number: ${certNumber}.`,
      'success',
      `/extension-applications/${app._id}/track`
    );

    // Email client
    await sendContactEmail({
      contactEmail: app.contact_email,
      contactName: app.contact_person,
      subject: `Halal Certificate Extension Approved - ${certNumber}`,
      bodyHtml: `
        <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:16px;margin:16px 0">
          <p style="margin:0;color:#065f46;font-weight:700;font-size:16px">Extension Certificate Approved!</p>
          <p style="margin:8px 0 0;color:#047857;font-size:13px">
            Your Halal certification for <strong>${app.site_name}</strong> has been extended.
          </p>
        </div>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">
          <tr><td style="padding:6px 0;color:#64748b">Certificate Number:</td><td style="font-weight:700">${certNumber}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b">Site:</td><td style="font-weight:700">${app.site_name}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b">Extended Valid Until:</td><td style="font-weight:700;color:#059669">${newExpiryDate.toLocaleDateString()}</td></tr>
        </table>
      `
    });

    emitExtensionUpdate(app, 'certificate_issued');

    res.json({
      success: true,
      message: 'Extension Certificate approved and issued successfully.',
      data: {
        application: app,
        certificate: cert
      }
    });
  } catch (err) {
    console.error('Error issuing extension certificate:', err);
    res.status(500).json({ error: err.message || 'Failed to issue extension certificate.' });
  }
});

export default router;
