import express from 'express';
import mongoose from 'mongoose';
import ApplicationLogsheet from '../models/ApplicationLogsheet.js';
import Application from '../models/Application.js';
import User from '../models/User.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { Resend } from 'resend';
import { emitApplicationUpdate } from '../lib/socket.js';
import { createNotification } from '../lib/notifications.js';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);
const emailFrom = process.env.EMAIL_FROM || 'HFA Portal <info@halalfoodfoundation.org.uk>';

/**
 * getSignatoryEmails()
 * Reads LOGSHEET_SIGNATORY_EMAILS from .env — a comma-separated list of all
 * HFA internal staff who should receive logsheet signature-request notifications.
 *
 * All addresses receive every notification so that backup/delegate staff covering
 * a role (e.g. a deputy Mufti or acting CEO) are always included.
 * Example in .env:
 *   LOGSHEET_SIGNATORY_EMAILS=mufti@hfa.org,ceo@hfa.org,manager@hfa.org,sharia@hfa.org
 */
function getSignatoryEmails() {
  const raw = process.env.LOGSHEET_SIGNATORY_EMAILS || '';
  return raw.split(',').map(e => e.trim()).filter(Boolean);
}

/**
 * sendSignatoryEmails()
 * Sends a signature-request notification email to every address in LOGSHEET_SIGNATORY_EMAILS.
 * Gracefully skips (logs warning) if no addresses are configured.
 * Returns { sent: number, failed: number }.
 */
async function sendSignatoryEmails({ logsheet, applicationNumber, adminUrl, customEmails, customMessage }) {
  let addresses = [];
  if (customEmails && customEmails.length > 0) {
    addresses = customEmails;
  } else {
    addresses = getSignatoryEmails();
  }

  if (addresses.length === 0) {
    console.warn('[Logsheet] No signatory email addresses provided or configured.');
    return { sent: 0, failed: 0 };
  }

  const loginUrl = `${adminUrl || process.env.ADMIN_URL || 'http://localhost:5175'}/login`;
  const companyName = logsheet.company_name || 'the applicant company';
  const appRef = applicationNumber || 'N/A';
  const issueDate = logsheet.issue_date
    ? new Date(logsheet.issue_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : 'N/A';

  const emailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px;">
      <div style="background: linear-gradient(135deg, #0e7490, #0891b2); border-radius: 8px 8px 0 0; padding: 24px; text-align: center; color: white;">
        <h2 style="margin: 0; font-size: 22px; font-weight: 800;">Halal Food Authority</h2>
        <p style="margin: 4px 0 0; font-size: 14px; opacity: 0.9;">LogSheet Signature Request</p>
      </div>
      <div style="padding: 24px; background: white; border-radius: 0 0 8px 8px;">
        <h3 style="color: #1e293b; margin-top: 0;">Your Signature is Required</h3>
        <p style="font-size: 14px; color: #475569; line-height: 1.6;">
          A Halal Certification LogSheet has been sent for your review and signature before the application can proceed.
        </p>
        ${customMessage ? `
          <div style="background-color: #fefce8; border-left: 4px solid #eab308; padding: 12px 16px; border-radius: 6px; margin: 16px 0;">
            <strong style="color: #854d0e; font-size: 13px;">Message from Admin:</strong>
            <p style="margin: 4px 0 0; color: #713f12; font-size: 13.5px; line-height: 1.4;">${customMessage}</p>
          </div>
        ` : ''}
        <div style="background-color: #f1f5f9; padding: 16px; border-radius: 8px; margin: 20px 0;">
          <h4 style="margin: 0 0 8px 0; color: #334155; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em;">LogSheet Details</h4>
          <table style="width: 100%; font-size: 13.5px; color: #475569; border-collapse: collapse;">
            <tr><td style="padding: 4px 0; font-weight: 600; width: 150px;">Application Ref:</td><td style="padding: 4px 0; font-weight: 700; color: #0e7490;">${appRef}</td></tr>
            <tr><td style="padding: 4px 0; font-weight: 600;">Company:</td><td style="padding: 4px 0;">${companyName}</td></tr>
            <tr><td style="padding: 4px 0; font-weight: 600;">Issue Date:</td><td style="padding: 4px 0;">${issueDate}</td></tr>
            <tr><td style="padding: 4px 0; font-weight: 600;">Audit Type:</td><td style="padding: 4px 0;">${logsheet.audit_type || 'New'}</td></tr>
          </table>
        </div>
        <p style="font-size: 13px; color: #64748b; line-height: 1.5;">
          Please log in to the HFA Admin Portal to review and sign the logsheet. If another authorised staff member is covering your role, they may sign on your behalf.
        </p>
        <div style="text-align: center; margin-top: 24px;">
          <a href="${loginUrl}" style="display: inline-block; padding: 12px 28px; background-color: #0e7490; color: white; text-decoration: none; border-radius: 6px; font-weight: 700; font-size: 14px; box-shadow: 0 4px 6px -1px rgba(14, 116, 144, 0.2);">
            Log In to Sign LogSheet
          </a>
        </div>
      </div>
    </div>
  `;

  let sent = 0;
  let failed = 0;

  for (const address of addresses) {
    try {
      await resend.emails.send({
        from: emailFrom,
        to: address,
        subject: `LogSheet Signature Required — ${appRef} (${companyName})`,
        html: emailHtml,
      });
      sent++;
    } catch (err) {
      console.error(`[Logsheet] Failed to send email to ${address}:`, err.message);
      failed++;
    }
  }

  return { sent, failed };
}

/**
 * Access control:
 * Clients must NOT be able to view logsheet content via any API route.
 * Admin (and any internal staff/signers if they have admin role) only.
 */
function rejectClients(req, res) {
  if (req.user?.role === 'client') {
    return res.status(403).json({ error: 'Access denied' });
  }
  return null;
}

// GET /api/application-logsheets/application/:appId
router.get('/application/:appId', authenticateToken, async (req, res) => {
  try {
    const clientReject = rejectClients(req, res);
    if (clientReject) return;

    const appId = req.params.appId;
    const isObjId = mongoose.Types.ObjectId.isValid(appId);

    const app = await Application.findById(appId).lean();

    const logsheets = await ApplicationLogsheet.find({
      $or: [
        { application_id: appId },
        ...(isObjId ? [{ application_id: new mongoose.Types.ObjectId(appId) }] : []),
        ...(app?.logsheet_id ? [{ _id: app.logsheet_id }] : [])
      ]
    })
      .populate('client_id', 'full_name company_name email')
      .populate('site_id', 'name address')
      .sort({ createdAt: -1, created_at: -1 });

    const mainLogsheet = logsheets.find(l => {
      if (l.source_type === 'initial_product_application' || l.source_type === 'addon_application') return false;
      if (l.initial_product_application_id || l.addon_application_id) return false;
      if (l.audit_type === 'Initial Product Evaluation') return false;
      return true;
    }) || null;

    res.json({ data: mainLogsheet });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/application-logsheets
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      application_id,
      client_id,
      site_id,
      _id,
      id,
      initial_product_application_id,
      addon_application_id,
      source_type,
      ...logsheetData
    } = req.body;
    const isObjId = mongoose.Types.ObjectId.isValid(application_id);

    const allLogsheets = await ApplicationLogsheet.find({
      $or: [
        { application_id },
        ...(isObjId ? [{ application_id: new mongoose.Types.ObjectId(application_id) }] : [])
      ]
    });

    let logsheet = allLogsheets.find(l => {
      if (l.source_type === 'initial_product_application' || l.source_type === 'addon_application') return false;
      if (l.initial_product_application_id || l.addon_application_id) return false;
      if (l.audit_type === 'Initial Product Evaluation') return false;
      return true;
    });

    const clientIdVal = (client_id && typeof client_id === 'object') ? client_id._id : client_id;
    const siteIdVal = (site_id && typeof site_id === 'object') ? site_id._id : site_id;

    if (logsheet) {
      Object.assign(logsheet, logsheetData);
      logsheet.source_type = 'application';
      logsheet.initial_product_application_id = undefined;
      logsheet.addon_application_id = undefined;
      if (clientIdVal) logsheet.client_id = clientIdVal;
      if (siteIdVal) logsheet.site_id = siteIdVal;
      logsheet.updated_at = new Date();
    } else {
      logsheet = new ApplicationLogsheet({
        application_id,
        client_id: clientIdVal,
        site_id: siteIdVal,
        source_type: 'application',
        ...logsheetData
      });
      logsheet.initial_product_application_id = undefined;
      logsheet.addon_application_id = undefined;
    }
    
    await logsheet.save();

    // Clean up any duplicate main application logsheets
    if (application_id) {
      await ApplicationLogsheet.deleteMany({
        $or: [
          { application_id },
          ...(isObjId ? [{ application_id: new mongoose.Types.ObjectId(application_id) }] : [])
        ],
        source_type: 'application',
        _id: { $ne: logsheet._id }
      });
    }

    // Update application status to logsheet_created
    const app = await Application.findByIdAndUpdate(
      application_id,
      {
        logsheet_id: logsheet._id,
        status: 'logsheet_created',
        updated_at: new Date(),
        $push: {
          statusHistory: {
            status: 'logsheet_created',
            changedAt: new Date(),
            changedBy: req.user._id,
            note: 'Application submitted for Committee Review. Awaiting committee endorsement.'
          }
        }
      },
      { new: true }
    );
    if (app) emitApplicationUpdate(app, 'logsheet_created');

    // Send signatory email notifications
    const adminUrl = process.env.ADMIN_URL || 'http://localhost:5175';
    const emailResult = await sendSignatoryEmails({
      logsheet,
      applicationNumber: app?.application_number,
      adminUrl,
    });

    const emailNote = emailResult.sent > 0
      ? `Signature notifications sent to ${emailResult.sent} signatory address(es).`
      : 'No signatory email addresses configured (set LOGSHEET_SIGNATORY_EMAILS in .env to enable).';

    res.status(201).json({
      data: logsheet,
      message: 'Logsheet saved successfully',
      emailNote,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/application-logsheets (Admin only)
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const filter = {};
    if (req.query.initial_product_application_id) {
      filter.initial_product_application_id = req.query.initial_product_application_id;
    }
    if (req.query.application_id) {
      filter.application_id = req.query.application_id;
    }
    if (req.query.addon_application_id) {
      filter.addon_application_id = req.query.addon_application_id;
    }
    if (req.query.source_type) {
      filter.source_type = req.query.source_type;
    }

    const logsheets = await ApplicationLogsheet.find(filter)
      .populate('application_id', 'application_number application_type status category')
      .populate('addon_application_id', 'status')
      .populate('initial_product_application_id', 'status')
      .populate('client_id', 'full_name company_name email')
      .populate('site_id', 'name address')
      .sort({ created_at: -1 });

    // Auto-sync logsheets where certificate has already been issued
    const certIssuedLogs = logsheets.filter(l => l.application_id?.status === 'certificate_issued' && l.status !== 'Completed');
    if (certIssuedLogs.length > 0) {
      const idsToComplete = certIssuedLogs.map(l => l._id);
      ApplicationLogsheet.updateMany({ _id: { $in: idsToComplete } }, { $set: { status: 'Completed', updated_at: new Date() } }).exec().catch(() => {});
      certIssuedLogs.forEach(l => { l.status = 'Completed'; });
    }

    // Auto-sync initial product logsheets that mistakenly had Waiting For Certificate
    const ipLogsToComplete = logsheets.filter(l => (l.source_type === 'initial_product_application' || l.initial_product_application_id || l.audit_type === 'Initial Product Evaluation') && l.status === 'Waiting For Certificate');
    if (ipLogsToComplete.length > 0) {
      const ipIdsToComplete = ipLogsToComplete.map(l => l._id);
      ApplicationLogsheet.updateMany({ _id: { $in: ipIdsToComplete } }, { $set: { status: 'Completed', updated_at: new Date() } }).exec().catch(() => {});
      ipLogsToComplete.forEach(l => { l.status = 'Completed'; });
    }

    res.json({ data: logsheets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/application-logsheets/:id (Admin only)
router.get('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const logsheet = await ApplicationLogsheet.findById(req.params.id)
      .populate('application_id')
      .populate('client_id', 'full_name company_name email')
      .populate('site_id', 'name address');
    if (!logsheet) return res.status(404).json({ error: 'Logsheet not found' });
    res.json({ data: logsheet });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/application-logsheets/:id/documents (Admin only)
router.put('/:id/documents', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { document_urls, audit_reports, document_url } = req.body;
    const logsheet = await ApplicationLogsheet.findById(req.params.id);
    if (!logsheet) return res.status(404).json({ error: 'Logsheet not found' });

    if (Array.isArray(document_urls)) {
      logsheet.document_urls = document_urls;
    }
    if (Array.isArray(audit_reports)) {
      logsheet.audit_reports = audit_reports;
    } else if (Array.isArray(document_urls)) {
      logsheet.audit_reports = document_urls;
    }
    if (document_url !== undefined) {
      logsheet.document_url = document_url;
    } else if (Array.isArray(document_urls) && document_urls.length > 0) {
      logsheet.document_url = document_urls[0].url;
    }

    logsheet.updated_at = new Date();
    await logsheet.save();

    res.json({ data: logsheet, message: 'Documents updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/application-logsheets/:id (Admin only)
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const logsheet = await ApplicationLogsheet.findById(req.params.id);
    if (!logsheet) return res.status(404).json({ error: 'Logsheet not found' });

    const { _id, id, ...updates } = req.body;
    Object.assign(logsheet, updates);
    logsheet.updated_at = new Date();
    await logsheet.save();

    res.json({ data: logsheet, message: 'Logsheet updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const countLogsheetSignatures = (logsheet) => {
  let count = 0;
  if (logsheet.mufti_signature) count++;
  if (logsheet.ceo_signature) count++;
  if (logsheet.manager_signature) count++;
  if (logsheet.mufti2_signature) count++;
  return count;
};

// PUT /api/application-logsheets/:id/status (Admin only)
router.put('/:id/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { status, force } = req.body;
    const logsheet = await ApplicationLogsheet.findById(req.params.id);
    if (!logsheet) return res.status(404).json({ error: 'Logsheet not found' });

    if ((status === 'Signed' || status === 'Completed' || status === 'Waiting For Certificate') && !force) {
      const sigCount = countLogsheetSignatures(logsheet);
      if (sigCount < 4) {
        return res.status(400).json({ error: `All 4 committee roles must be signed before marking logsheet as done (currently ${sigCount}/4 signed).` });
      }
    }

    logsheet.status = status;
    logsheet.updated_at = new Date();
    await logsheet.save();

    if ((status === 'Signed' || status === 'Waiting For Certificate' || status === 'Completed') && logsheet.application_id) {
      const appId = logsheet.application_id._id || logsheet.application_id;
      const sigCount = countLogsheetSignatures(logsheet);
      
      const app = await Application.findById(appId);
      if (app) {
        const isRenewal = app.application_type === 'renewal';
        const hasLogsheetCreated = app.statusHistory?.some(h => h.status === 'logsheet_created');
        const newHistory = [];
        if (!hasLogsheetCreated) {
          newHistory.push({
            status: 'logsheet_created',
            changedAt: new Date(Date.now() - 2000),
            changedBy: req.user._id,
            note: 'Submitted for technical & shariah committee review.'
          });
        }
        newHistory.push({
          status: 'logsheet_signed',
          changedAt: new Date(Date.now() - 1000),
          changedBy: req.user._id,
          note: `Committee review completed and endorsed with ${sigCount}/4 signatures.`
        });

        if (isRenewal) {
          newHistory.push({
            status: 'application_successful',
            changedAt: new Date(),
            changedBy: req.user._id,
            note: 'Renewal review completed and verified. Application Successful — ready for Renewal Invoice.'
          });
          app.status = 'application_successful';
        } else {
          newHistory.push({
            status: 'application_successful',
            changedAt: new Date(),
            changedBy: req.user._id,
            note: 'Application Successful — committee review completed. Proceeding to Certification Agreement.'
          });
          app.status = 'application_successful';
        }

        app.updated_at = new Date();
        app.statusHistory.push(...newHistory);
        await app.save();
        emitApplicationUpdate(app, app.status);
      }
    }

    res.json({ data: logsheet, message: 'Logsheet status updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/application-logsheets/:id/sign (Admin only)
router.put('/:id/sign', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { role, signature_url, signature_name, comment, sendWithoutSignature, finalizeSignOff } = req.body;
    const logsheet = await ApplicationLogsheet.findById(req.params.id)
      .populate('application_id', 'application_number');
    if (!logsheet) return res.status(404).json({ error: 'Logsheet not found' });

    if (finalizeSignOff) {
      const sigCount = countLogsheetSignatures(logsheet);
      if (sigCount < 3) {
        return res.status(400).json({ error: `Cannot finalize logsheet without at least 3 committee signatures (currently ${sigCount}/4 signed).` });
      }

      const isInitialProductLogsheet = logsheet.source_type === 'initial_product_application' || Boolean(logsheet.initial_product_application_id) || logsheet.audit_type === 'Initial Product Evaluation';
      logsheet.status = isInitialProductLogsheet ? 'Completed' : 'Waiting For Certificate';
      await logsheet.save();

      const { approved_products } = req.body;

      // Handle add-on application logsheets separately
      const addonAppId = logsheet.addon_application_id || (logsheet.source_type === 'addon_application' ? logsheet.application_id : null);
      if (addonAppId) {
        try {
          const { default: AddOnApplication } = await import('../models/AddOnApplication.js');
          const { default: Product } = await import('../models/Product.js');
          const addonApp = await AddOnApplication.findById(addonAppId);
          if (addonApp) {
            const approvedList = Array.isArray(approved_products) && approved_products.length > 0
              ? approved_products
              : addonApp.products || [];

            addonApp.status = 'product_form_approved';
            addonApp.statusHistory.push({
              status: 'product_form_approved',
              changedAt: new Date(),
              changedBy: req.user._id,
              note: `Committee signatures verified (${sigCount}/4). ${approvedList.length} product(s) approved.`
            });
            addonApp.status = 'ready_for_certificate';
            addonApp.statusHistory.push({
              status: 'ready_for_certificate',
              changedAt: new Date(),
              changedBy: req.user._id,
              note: 'Ready for Certificate — product approval complete.'
            });
            await addonApp.save();

            // Sync approved products to Product collection for client dashboard visibility
            const clientId = addonApp.client_id?._id || addonApp.client_id;
            const siteId = addonApp.site_id?._id || addonApp.site_id;
            const certId = addonApp.certificate_id?._id || addonApp.certificate_id;

            for (const prod of approvedList) {
              const pName = prod.new_name || prod.name;
              const pCode = prod.new_code || prod.code || '';
              const pType = prod.type || 'Add product';
              if (pType === 'Add product' || pType === 'Change name/code') {
                await Product.findOneAndUpdate(
                  { client_id: clientId, name: pName },
                  {
                    client_id: clientId,
                    name: pName,
                    code: pCode,
                    site_id: siteId,
                    certificate_id: certId ? String(certId) : undefined,
                    status: 'approved',
                    category: addonApp.category || 'Halal Certified',
                    updated_at: new Date()
                  },
                  { upsert: true, new: true }
                );
              } else if (pType === 'Remove product') {
                await Product.findOneAndUpdate(
                  { client_id: clientId, name: prod.name },
                  { status: 'inactive', updated_at: new Date() }
                );
              }
            }

            try {
              const { getIO } = await import('../lib/socket.js');
              const io = getIO();
              if (io) {
                io.emit('addon_updated', { addOnId: addonApp._id, status: 'ready_for_certificate' });
                io.emit('product_updated', { client_id: clientId });
              }
            } catch (sockErr) {}
          }
        } catch (addonErr) {
          console.error('[Logsheet] Failed to update add-on application after sign-off:', addonErr.message);
        }
      }

      // Handle initial product application logsheets
      const initialProductAppId = logsheet.initial_product_application_id || (logsheet.source_type === 'initial_product_application' ? logsheet.application_id : null);
      if (initialProductAppId) {
        try {
          const { default: InitialProductApplication } = await import('../models/InitialProductApplication.js');
          const { default: Product } = await import('../models/Product.js');
          const initialApp = await InitialProductApplication.findById(initialProductAppId);
          if (initialApp) {
            initialApp.status = 'initial_product_approved';
            initialApp.statusHistory.push({
              status: 'initial_product_approved',
              changedAt: new Date(),
              changedBy: req.user._id,
              note: `Committee signatures verified (${sigCount}/4). 1 product(s) approved.`
            });
            await initialApp.save();

            const clientId = initialApp.client_id?._id || initialApp.client_id;
            const siteId = initialApp.site_id?._id || initialApp.site_id;
            const prodName = initialApp.product?.name;

            if (prodName) {
              await Product.findOneAndUpdate(
                { client_id: clientId, name: prodName },
                {
                  client_id: clientId,
                  name: prodName,
                  code: initialApp.product?.code || '',
                  barcode: initialApp.product?.code || '',
                  site_id: siteId,
                  status: 'approved',
                  category: initialApp.product?.category || 'Initial Product',
                  is_initial: true,
                  updated_at: new Date()
                },
                { upsert: true, new: true }
              );
            }

            // Unlock main application audit stage
            if (initialApp.application_id) {
              try {
                const parentAppId = initialApp.application_id._id || initialApp.application_id;
                const parentApp = await Application.findById(parentAppId);
                if (parentApp) {
                  const auditEligibleStatuses = ['dates_proposed', 'dates_rejected', 'dates_accepted', 'date_finalized', 'audit_assigned', 'audit_successful', 'audit_completed'];
                  if (!auditEligibleStatuses.includes(parentApp.status)) {
                    parentApp.status = 'initial_product_approved';
                  }
                  parentApp.statusHistory.push({
                    status: parentApp.status,
                    changedAt: new Date(),
                    changedBy: req.user._id,
                    note: `Initial Product "${prodName || 'Product'}" approved by Committee. Facility audit scheduling is now ready.`
                  });
                  await parentApp.save();
                  emitApplicationUpdate(parentApp, parentApp.status);

                  // Email notification to Audit Managers
                  try {
                    const auditManagers = await User.find({ role: 'audit_manager' });
                    const recipients = auditManagers.length > 0 ? auditManagers : await User.find({ role: { $in: ['admin', 'superadmin'] } });
                    const adminBaseUrl = process.env.ADMIN_URL || 'https://admin.hfaportal.company';
                    for (const mgr of recipients) {
                      if (mgr.email) {
                        await resend.emails.send({
                          from: emailFrom,
                          to: mgr.email.trim(),
                          subject: `📋 Ready for Audit: Application ${parentApp.application_number} (${parentApp.site_name || parentApp.establishment_name || 'Client Site'})`,
                          html: `
                            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#f9fafb;border-radius:12px">
                              <div style="background:linear-gradient(135deg,#059669,#047857);border-radius:8px 8px 0 0;padding:24px;color:white">
                                <h2 style="margin:0;font-size:20px;font-weight:800">Halal Food Authority</h2>
                                <p style="margin:6px 0 0;font-size:13px;opacity:0.9">Audit Department &bull; Action Required</p>
                              </div>
                              <div style="padding:28px 24px;background:white;border-radius:0 0 8px 8px;border:1px solid #e2e8f0">
                                <p style="margin-top:0;font-size:14px;color:#334155">Dear ${mgr.full_name || 'Audit Manager'},</p>
                                <p style="font-size:14px;color:#334155;line-height:1.6">
                                  The Initial Product (<strong>${prodName || 'Initial Product'}</strong>) for application <strong>${parentApp.application_number}</strong> has been officially approved by the Committee.
                                </p>
                                <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:16px 18px;margin:20px 0">
                                  <div style="font-size:12px;font-weight:800;text-transform:uppercase;color:#166534;margin-bottom:8px">Application Summary</div>
                                  <div style="font-size:13px;color:#1e293b;line-height:1.7">
                                    <strong>Reference:</strong> ${parentApp.application_number}<br/>
                                    <strong>Company:</strong> ${parentApp.establishment_name || 'Client'}<br/>
                                    <strong>Site:</strong> ${parentApp.site_name || parentApp.establishment_address || 'Main Site'}<br/>
                                    <strong>Scheme / Category:</strong> ${parentApp.category || 'Halal Certification'}<br/>
                                    <strong>Status:</strong> Initial Product Approved &bull; Ready for Facility Audit
                                  </div>
                                </div>
                                <p style="font-size:14px;color:#334155;line-height:1.6">
                                  This application is now ready for audit date proposals, audit scheduling, and auditor assignment.
                                </p>
                                <div style="margin:24px 0;text-align:center">
                                  <a href="${adminBaseUrl}/applications/${parentApp._id}/processing" style="background:#059669;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:14px;display:inline-block">
                                    Schedule Facility Audit &rarr;
                                  </a>
                                </div>
                                <p style="font-size:12px;color:#94a3b8;margin-top:24px;border-top:1px solid #f1f5f9;padding-top:16px">
                                  This is an automated notification from HFA Compliance Management.
                                </p>
                              </div>
                            </div>
                          `
                        });
                      }
                      await createNotification(
                        mgr._id,
                        'Application Ready for Audit 📋',
                        `Initial Product approved for ${parentApp.application_number} (${parentApp.site_name || parentApp.establishment_name || 'Site'}). Ready for audit scheduling.`,
                        'info',
                        `/applications/${parentApp._id}/processing`
                      );
                    }
                  } catch (mgrErr) {
                    console.error('[Logsheet] Failed to notify audit managers:', mgrErr.message);
                  }
                }
              } catch (pErr) {
                console.error('[Logsheet] Error updating parent application:', pErr.message);
              }
            }

            try {
              const { getIO } = await import('../lib/socket.js');
              const io = getIO();
              if (io) {
                io.emit('initial_product_updated', { id: initialApp._id, status: 'initial_product_approved' });
                io.emit('product_updated', { client_id: clientId });
              }
            } catch (sockErr) {}
          }
        } catch (initErr) {
          console.error('[Logsheet] Failed to update initial product application after sign-off:', initErr.message);
        }
      }

      // Update the linked main application to canonical milestone after logsheet sign-off
      if (!addonAppId && !initialProductAppId && logsheet.application_id) {
        const appId = logsheet.application_id._id || logsheet.application_id;
        const currentApp = await Application.findById(appId);
        const isRenewal = currentApp?.application_type === 'renewal';
        const isSurveillance = currentApp?.application_type === 'surveillance';
        const targetStatus = isSurveillance ? 'ready_for_certificate' : 'application_successful';

        const newHistoryEntries = [
          {
            status: 'logsheet_signed',
            changedAt: new Date(),
            changedBy: req.user._id,
            note: `Committee review completed and endorsed with ${sigCount}/4 signatures. Products approved.`
          }
        ];

        if (isSurveillance) {
          newHistoryEntries.push({
            status: 'ready_for_certificate',
            changedAt: new Date(),
            changedBy: req.user._id,
            note: 'Surveillance review endorsed & completed. Ready for Surveillance Letter Issuance.'
          });
        } else if (isRenewal) {
          newHistoryEntries.push({
            status: 'application_successful',
            changedAt: new Date(),
            changedBy: req.user._id,
            note: 'Renewal review endorsed & completed. Application Successful — ready for Renewal Invoice.'
          });
        } else {
          newHistoryEntries.push({
            status: 'application_successful',
            changedAt: new Date(),
            changedBy: req.user._id,
            note: 'Application Successful — committee review endorsed. Proceeding to certification agreement.'
          });
        }

        const app = await Application.findByIdAndUpdate(
          appId,
          {
            status: targetStatus,
            updated_at: new Date(),
            $push: {
              statusHistory: newHistoryEntries
            }
          },
          { new: true }
        );
        if (app) emitApplicationUpdate(app, targetStatus);

        // Sync approved products to Product collection
        if (Array.isArray(approved_products) && approved_products.length > 0 && currentApp) {
          try {
            const { default: Product } = await import('../models/Product.js');
            const clientId = currentApp.client_id?._id || currentApp.client_id;
            const siteId = currentApp.site_id?._id || currentApp.site_id;
            for (const prod of approved_products) {
              const pName = prod.name || prod.product_name;
              if (pName) {
                await Product.findOneAndUpdate(
                  { client_id: clientId, name: pName },
                  {
                    client_id: clientId,
                    name: pName,
                    code: prod.code || '',
                    category: prod.category || currentApp.category || 'Halal Certified',
                    site_id: siteId,
                    status: 'approved',
                    updated_at: new Date()
                  },
                  { upsert: true, new: true }
                );
              }
            }
          } catch (pErr) {
            console.error('Failed to sync main app products:', pErr.message);
          }
        }
      }

      return res.json({ data: logsheet, message: 'Products approved and logsheet marked as done!' });
    }

    if (sendWithoutSignature) {
      if (comment) logsheet.comment = comment;
      await logsheet.save();
      return res.json({ data: logsheet, message: 'Logsheet sent to review without signature' });
    }

    if (!role) return res.status(400).json({ error: 'Role is required for signature' });

    if (Array.isArray(role) && role.length > 1) {
      return res.status(400).json({ error: 'Please sign logsheet roles one by one. Bulk signing is not permitted.' });
    }

    const singleRole = Array.isArray(role) ? role[0] : role;
    const roleLower = (singleRole || '').toLowerCase();

    // Restrict Mufti from signing for CEO or Manager (Technical Auditor)
    const userRoleLower = (req.user.role || '').toLowerCase();
    const userUsernameLower = (req.user.username || '').toLowerCase();
    const userFullNameLower = (req.user.full_name || '').toLowerCase();
    const isMuftiSigner = userRoleLower === 'mufti' || userRoleLower === 'shariah' || userUsernameLower.includes('mufti') || userFullNameLower.includes('mufti');

    if (isMuftiSigner && (roleLower === 'ceo' || roleLower === 'manager')) {
      return res.status(403).json({ error: 'Mufti / Shariah Scholar signatories are not permitted to sign for CEO or Technical Auditor / Manager roles.' });
    }

    const signerFullName = req.user.full_name || signature_name || req.user.username || 'Authorized Signatory';

    if (roleLower === 'mufti') {
      if (logsheet.mufti_signature) return res.status(400).json({ error: 'Mufti role has already been signed.' });
      logsheet.mufti_signature = signature_url;
      logsheet.mufti_sign_name = signerFullName;
      logsheet.mufti_sign_date = new Date();
    } else if (roleLower === 'ceo') {
      if (logsheet.ceo_signature) return res.status(400).json({ error: 'CEO role has already been signed.' });
      logsheet.ceo_signature = signature_url;
      logsheet.ceo_sign_name = signerFullName;
      logsheet.ceo_sign_date = new Date();
    } else if (roleLower === 'manager') {
      if (logsheet.manager_signature) return res.status(400).json({ error: 'Manager role has already been signed.' });
      logsheet.manager_signature = signature_url;
      logsheet.manager_sign_name = signerFullName;
      logsheet.manager_sign_date = new Date();
    } else if (roleLower === 'mufti2') {
      if (logsheet.mufti2_signature) return res.status(400).json({ error: 'Mufti 2 role has already been signed.' });
      logsheet.mufti2_signature = signature_url;
      logsheet.mufti2_sign_name = signerFullName;
      logsheet.mufti2_sign_date = new Date();
    } else {
      return res.status(400).json({ error: `Invalid role selected: ${singleRole}` });
    }

    if (comment) {
      logsheet.comment = comment;
    }

    // Keep state in "Waiting for Signature" to allow further role sign-offs one-by-one
    await logsheet.save();
    
    res.json({ data: logsheet, message: `Successfully signed as ${singleRole}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/application-logsheets/:id/resend-emails (Admin only)
// Re-sends signatory notification emails for a specific logsheet.
router.post('/:id/resend-emails', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const logsheet = await ApplicationLogsheet.findById(req.params.id)
      .populate('application_id', 'application_number');
    if (!logsheet) return res.status(404).json({ error: 'Logsheet not found' });

    const applicationNumber = logsheet.application_id?.application_number;
    const adminUrl = process.env.ADMIN_URL || 'http://localhost:5175';

    let customEmails = [];
    if (req.body.emails) {
      if (Array.isArray(req.body.emails)) {
        customEmails = req.body.emails.map(e => String(e).trim()).filter(Boolean);
      } else if (typeof req.body.emails === 'string') {
        customEmails = req.body.emails.split(/[,;\n]+/).map(e => e.trim()).filter(Boolean);
      }
    } else if (req.body.email) {
      customEmails = [String(req.body.email).trim()].filter(Boolean);
    }

    const emailResult = await sendSignatoryEmails({
      logsheet,
      applicationNumber,
      adminUrl,
      customEmails: customEmails.length > 0 ? customEmails : undefined,
      customMessage: req.body.message || req.body.custom_message
    });

    if (emailResult.sent === 0 && emailResult.failed === 0) {
      return res.status(400).json({
        error: 'No recipient email addresses provided or configured.'
      });
    }

    const recipientDesc = customEmails.length > 0 ? ` to ${customEmails.join(', ')}` : '';
    res.json({
      message: `Emails sent successfully${recipientDesc} (${emailResult.sent} sent${emailResult.failed > 0 ? `, ${emailResult.failed} failed` : ''})`,
      sent: emailResult.sent,
      failed: emailResult.failed,
      recipients: customEmails.length > 0 ? customEmails : undefined
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/application-logsheets/:id (Admin only)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const logsheet = await ApplicationLogsheet.findByIdAndDelete(req.params.id);
    if (!logsheet) return res.status(404).json({ error: 'Logsheet not found' });
    res.json({ message: 'Logsheet deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
