import express from 'express';
import multer from 'multer';
import { uploadToGridFS } from '../lib/gridfs.js';
import Agreement from '../models/Agreement.js';
import Application from '../models/Application.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { createNotification } from '../lib/notifications.js';
import User from '../models/User.js';
import { Resend } from 'resend';
import { emitApplicationUpdate } from '../lib/socket.js';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);
const emailFrom = process.env.EMAIL_FROM || 'HFA Portal <info@halalfoodfoundation.org.uk>';
const upload = multer({ storage: multer.memoryStorage() });

// Helper to get admin email addresses for Agreement signing notifications
function getAdminNotificationEmails() {
  const raw = process.env.AGREEMENT_NOTIFICATION_EMAILS || '';
  return raw.split(',').map(e => e.trim()).filter(Boolean);
}

// GET /api/agreements (Admin: all, Client: own)
router.get('/', authenticateToken, async (req, res) => {
  try {
    let query = {};
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      query.client_id = req.user._id.toString();
    }
    const data = await Agreement.find(query)
      .populate('application_id')
      .sort({ createdAt: -1 });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/agreements/application/:appId
router.get('/application/:appId', authenticateToken, async (req, res) => {
  try {
    const data = await Agreement.findOne({ application_id: req.params.appId }).sort({ createdAt: -1 });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/agreements (Admin only - send agreement)
router.post('/', authenticateToken, requireAdmin, upload.single('agreement_file'), async (req, res) => {
  try {
    const agreementData = { ...req.body };
    let fileUrl = null;
    if (req.file) {
      fileUrl = await uploadToGridFS(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );
      agreementData.agreement_url = fileUrl;
    }

    // Upsert: Only 1 agreement per application
    let agreement = await Agreement.findOne({ application_id: agreementData.application_id });
    if (agreement) {
      if (fileUrl) agreement.agreement_url = fileUrl;
      if (agreementData.title) agreement.title = agreementData.title;
      if (agreementData.details) agreement.details = agreementData.details;
      if (agreementData.admin_comment) agreement.admin_comment = agreementData.admin_comment;
      agreement.status = 'sent';
      agreement.client_signed = false;
      agreement.client_signature_url = undefined;
      agreement.client_sign_name = undefined;
      agreement.client_sign_date = undefined;
      agreement.signed_agreement_url = undefined;
    } else {
      agreement = new Agreement(agreementData);
    }

    const data = await agreement.save();

    // Fetch app for ref number
    const app = await Application.findById(agreement.application_id);
    const appNumber = app ? app.application_number : 'N/A';

    // Update Application status to lowercase 'agreement_sent'
    const updatedApp = await Application.findByIdAndUpdate(agreement.application_id, {
      status: 'agreement_sent',
      updated_at: new Date(),
      $push: {
        statusHistory: {
          status: 'agreement_sent',
          changedAt: new Date(),
          changedBy: req.user._id,
          note: `Certification agreement sent: "${data.title}"`
        }
      }
    }, { new: true });
    if (updatedApp) emitApplicationUpdate(updatedApp, 'agreement_sent');

    // Notify Client
    await createNotification(
      data.client_id,
      'Certification Agreement Sent 📄',
      `Your certification agreement "${data.title}" is ready. Please review and sign it.`,
      'info',
      '/agreements'
    );

    // Send email to client
    try {
      const clientUser = await User.findById(data.client_id);
      if (clientUser && clientUser.email) {
        const clientPortalUrl = process.env.FRONTEND_CLIENT_URL || 'http://localhost:5173';
        await resend.emails.send({
          from: emailFrom,
          to: clientUser.email,
          subject: `Certification Agreement Sent — ${appNumber}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px;">
              <div style="background: linear-gradient(135deg, #15803d, #166534); border-radius: 8px 8px 0 0; padding: 24px; text-align: center; color: white;">
                <h2 style="margin: 0; font-size: 22px; font-weight: 800;">Halal Food Authority</h2>
                <p style="margin: 4px 0 0; font-size: 14px; opacity: 0.9;">Certification Agreement Sent</p>
              </div>
              <div style="padding: 24px; background: white; border-radius: 0 0 8px 8px;">
                <h3 style="color: #1e293b; margin-top: 0;">Certification Agreement is Ready</h3>
                <p style="font-size: 14px; color: #475569; line-height: 1.6;">
                  Dear Partner,<br/><br/>
                  The certification agreement for your application <strong>${appNumber}</strong> is ready for review.
                </p>
                <div style="background-color: #f1f5f9; padding: 16px; border-radius: 8px; margin: 20px 0;">
                  <table style="width: 100%; font-size: 13.5px; color: #475569;">
                    <tr><td style="font-weight: 600; width: 140px;">Title:</td><td>${data.title}</td></tr>
                    <tr><td style="font-weight: 600;">Date:</td><td>${new Date().toLocaleDateString('en-GB')}</td></tr>
                  </table>
                </div>
                <div style="text-align: center; margin-top: 24px;">
                  <a href="${clientPortalUrl}/agreements" style="display: inline-block; padding: 12px 24px; background-color: #15803d; color: white; text-decoration: none; border-radius: 6px; font-weight: 700; font-size: 14px;">
                    Review & Sign Agreement
                  </a>
                </div>
              </div>
            </div>
          `
        });
      }
    } catch (mailErr) {
      console.error('[Agreement] Failed to send email to client:', mailErr.message);
    }

    res.status(201).json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/agreements/:id (Update status / upload signed copy / client signature)
router.put('/:id', authenticateToken, upload.fields([
  { name: 'signed_agreement_file', maxCount: 1 },
  { name: 'signature_file', maxCount: 1 }
]), async (req, res) => {
  try {
    const agreement = await Agreement.findById(req.params.id);
    if (!agreement) return res.status(404).json({ error: 'Agreement not found' });

    // If client, check ownership
    if (!['admin', 'superadmin'].includes(req.user.role) && agreement.client_id !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { status, client_comment, admin_comment, title, details, client_sign_name, signature_url } = req.body;

    // Handle signed agreement file (PDF) if uploaded
    if (req.files?.['signed_agreement_file']?.[0]) {
      const file = req.files['signed_agreement_file'][0];
      agreement.signed_agreement_url = await uploadToGridFS(
        file.buffer,
        file.originalname,
        file.mimetype
      );
    }

    // Handle digital signature image if uploaded (using GridFS)
    if (req.files?.['signature_file']?.[0]) {
      const file = req.files['signature_file'][0];
      agreement.client_signature_url = await uploadToGridFS(
        file.buffer,
        file.originalname,
        file.mimetype
      );
    } else if (signature_url) {
      // Reusing signature model/pattern: client used their saved signature
      agreement.client_signature_url = signature_url;
    }

    if (status) agreement.status = status;
    if (client_comment) agreement.client_comment = client_comment;
    if (admin_comment) agreement.admin_comment = admin_comment;
    if (title) agreement.title = title;
    if (details) agreement.details = details;
    if (client_sign_name) agreement.client_sign_name = client_sign_name;

    // If status is setting to signed
    if (status === 'signed') {
      agreement.client_signed = true;
      agreement.client_sign_date = new Date();

      // Update Application status to lowercase 'agreement_signed'
      const app = await Application.findByIdAndUpdate(
        agreement.application_id,
        {
          status: 'agreement_signed',
          updated_at: new Date(),
          $push: {
            statusHistory: {
              status: 'agreement_signed',
              changedAt: new Date(),
              changedBy: req.user._id,
              note: `Agreement signed by client: "${client_sign_name}"`
            }
          }
        },
        { new: true }
      );
      if (app) emitApplicationUpdate(app, 'agreement_signed');

      const appNumber = app ? app.application_number : 'N/A';
      const companyName = app?.establishment_name || 'HFA Partner';

      // Notify HFA Admins in-portal
      const admins = await User.find({ role: 'admin' });
      for (const admin of admins) {
        await createNotification(
          admin._id,
          'Agreement Signed ✍️',
          `Client has signed the certification agreement for ${appNumber}.`,
          'success',
          `/applications/${agreement.application_id}/processing`
        );
      }

      // Send email notifications to HFA admin list (Phase 9 corrected variable)
      const adminAddresses = getAdminNotificationEmails();
      if (adminAddresses.length > 0) {
        const adminUrl = process.env.ADMIN_URL || 'http://localhost:5175';
        const emailHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px;">
            <div style="background: linear-gradient(135deg, #0e7490, #0891b2); border-radius: 8px 8px 0 0; padding: 24px; text-align: center; color: white;">
              <h2 style="margin: 0; font-size: 22px; font-weight: 800;">Halal Food Authority</h2>
              <p style="margin: 4px 0 0; font-size: 14px; opacity: 0.9;">Agreement Signed Notification</p>
            </div>
            <div style="padding: 24px; background: white; border-radius: 0 0 8px 8px;">
              <h3 style="color: #1e293b; margin-top: 0;">Partner Agreement Fully Signed</h3>
              <p style="font-size: 14px; color: #475569; line-height: 1.6;">
                Client <strong>${companyName}</strong> has signed the certification agreement for application ref <strong>${appNumber}</strong>.
              </p>
              <div style="background-color: #f1f5f9; padding: 16px; border-radius: 8px; margin: 20px 0;">
                <table style="width: 100%; font-size: 13.5px; color: #475569;">
                  <tr><td style="font-weight: 600; width: 140px;">Signee Name:</td><td>${client_sign_name}</td></tr>
                  <tr><td style="font-weight: 600;">Sign Date:</td><td>${new Date().toLocaleDateString('en-GB')}</td></tr>
                </table>
              </div>
              <div style="text-align: center; margin-top: 24px;">
                <a href="${adminUrl}/applications/${agreement.application_id}/processing" style="display: inline-block; padding: 12px 24px; background-color: #0e7490; color: white; text-decoration: none; border-radius: 6px; font-weight: 700; font-size: 14px;">
                  View Agreement & Issue Certificate
                </a>
              </div>
            </div>
          </div>
        `;

        for (const address of adminAddresses) {
          try {
            await resend.emails.send({
              from: emailFrom,
              to: address,
              subject: `Client Agreement Signed — ${appNumber} (${companyName})`,
              html: emailHtml
            });
          } catch (mailErr) {
            console.error(`[Agreement] Failed to email admin ${address}:`, mailErr.message);
          }
        }
      }
    } else if (status === 'approved') {
      // If admin approves the agreement, update application status to canonical agreement_signed
      await Application.findByIdAndUpdate(agreement.application_id, {
        status: 'agreement_signed',
        updated_at: new Date()
      });

      // Notify Client
      await createNotification(
        agreement.client_id,
        'Agreement Approved ✅',
        `Your signed certification agreement "${agreement.title}" has been approved by HFA.`,
        'success',
        '/agreements'
      );
    }

    const data = await agreement.save();
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/agreements/:id/finalize (Admin only — Send Final Countersigned Agreement)
router.post('/:id/finalize', authenticateToken, requireAdmin, upload.single('final_agreement_file'), async (req, res) => {
  try {
    const agreement = await Agreement.findById(req.params.id);
    if (!agreement) return res.status(404).json({ error: 'Agreement not found' });

    let fileUrl = null;
    if (req.file) {
      fileUrl = await uploadToGridFS(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );
      agreement.final_agreement_url = fileUrl;
    } else if (req.body.final_agreement_url) {
      agreement.final_agreement_url = req.body.final_agreement_url;
    } else {
      return res.status(400).json({ error: 'Countersigned agreement PDF file is required.' });
    }

    agreement.status = 'finalized';
    agreement.final_agreement_sent_at = new Date();
    const data = await agreement.save();

    // Advance Application status to agreement_finalised
    const updatedApp = await Application.findByIdAndUpdate(agreement.application_id, {
      status: 'agreement_finalised',
      updated_at: new Date(),
      $push: {
        statusHistory: {
          status: 'agreement_finalised',
          changedAt: new Date(),
          changedBy: req.user._id,
          note: `Final countersigned certification agreement sent to client: "${agreement.title}"`
        }
      }
    }, { new: true });

    if (updatedApp) emitApplicationUpdate(updatedApp, 'agreement_finalised');

    // Notify Client
    await createNotification(
      agreement.client_id,
      'Final Signed Agreement Sent 📑',
      `HFA has uploaded the final countersigned copy of your certification agreement "${agreement.title}".`,
      'success',
      '/agreements'
    );

    // Send email to client
    try {
      const clientUser = await User.findById(agreement.client_id);
      if (clientUser && clientUser.email) {
        const clientPortalUrl = process.env.FRONTEND_CLIENT_URL || 'http://localhost:5173';
        const appNumber = updatedApp ? updatedApp.application_number : 'N/A';
        await resend.emails.send({
          from: emailFrom,
          to: clientUser.email,
          subject: `Final Countersigned Agreement Sent — ${appNumber}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px;">
              <div style="background: linear-gradient(135deg, #15803d, #166534); border-radius: 8px 8px 0 0; padding: 24px; text-align: center; color: white;">
                <h2 style="margin: 0; font-size: 22px; font-weight: 800;">Halal Food Authority</h2>
                <p style="margin: 4px 0 0; font-size: 14px; opacity: 0.9;">Final Signed Agreement Document</p>
              </div>
              <div style="padding: 24px; background: white; border-radius: 0 0 8px 8px;">
                <h3 style="color: #1e293b; margin-top: 0;">Final Countersigned Copy Available</h3>
                <p style="font-size: 14px; color: #475569; line-height: 1.6;">
                  Dear Partner,<br/><br/>
                  The final countersigned certification agreement for application <strong>${appNumber}</strong> has been uploaded by HFA and is now available in your portal.
                </p>
                <div style="text-align: center; margin-top: 24px;">
                  <a href="${clientPortalUrl}/agreements" style="display: inline-block; padding: 12px 24px; background-color: #15803d; color: white; text-decoration: none; border-radius: 6px; font-weight: 700; font-size: 14px;">
                    View & Download Final Agreement
                  </a>
                </div>
              </div>
            </div>
          `
        });
      }
    } catch (mailErr) {
      console.error('[Agreement] Failed to email final copy to client:', mailErr.message);
    }

    res.json({ data, message: 'Final countersigned agreement sent successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
