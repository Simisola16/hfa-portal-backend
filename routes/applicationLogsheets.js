import express from 'express';
import ApplicationLogsheet from '../models/ApplicationLogsheet.js';
import Application from '../models/Application.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { Resend } from 'resend';
import { emitApplicationUpdate } from '../lib/socket.js';
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
async function sendSignatoryEmails({ logsheet, applicationNumber, adminUrl }) {
  const addresses = getSignatoryEmails();

  if (addresses.length === 0) {
    console.warn('[Logsheet] LOGSHEET_SIGNATORY_EMAILS not configured — skipping signatory email notifications.');
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
          A new Halal Certification LogSheet has been created and requires authorised signatures before the application can proceed.
        </p>
        <div style="background-color: #f1f5f9; padding: 16px; border-radius: 8px; margin: 20px 0;">
          <h4 style="margin: 0 0 8px 0; color: #334155; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em;">LogSheet Details</h4>
          <table style="width: 100%; font-size: 13.5px; color: #475569; border-collapse: collapse;">
            <tr><td style="padding: 4px 0; font-weight: 600; width: 150px;">Application Ref:</td><td style="padding: 4px 0; font-weight: 700; color: #0e7490;">${appRef}</td></tr>
            <tr><td style="padding: 4px 0; font-weight: 600;">Company:</td><td style="padding: 4px 0;">${companyName}</td></tr>
            <tr><td style="padding: 4px 0; font-weight: 600;">Issue Date:</td><td style="padding: 4px 0;">${issueDate}</td></tr>
            <tr><td style="padding: 4px 0; font-weight: 600;">Audit Type:</td><td style="padding: 4px 0;">${logsheet.audit_type || 'Initial'}</td></tr>
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

    const logsheet = await ApplicationLogsheet.findOne({ application_id: req.params.appId })
      .populate('client_id', 'full_name company_name email')
      .populate('site_id', 'name address');
    
    if (!logsheet) return res.status(404).json({ error: 'Logsheet not found' });
    res.json({ data: logsheet });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/application-logsheets
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { application_id, client_id, site_id, ...logsheetData } = req.body;
    
    // Upsert: update if exists, create if not
    let logsheet = await ApplicationLogsheet.findOne({ application_id });
    let isNew = false;
    if (logsheet) {
      Object.assign(logsheet, logsheetData);
    } else {
      logsheet = new ApplicationLogsheet({ application_id, client_id, site_id, ...logsheetData });
      isNew = true;
    }
    
    await logsheet.save();

    // Update application status to logsheet_created (fix: was incorrectly setting 'AGREEMENT SENT')
    const app = await Application.findByIdAndUpdate(
      application_id,
      {
        status: 'logsheet_created',
        updated_at: new Date(),
        $push: {
          statusHistory: {
            status: 'logsheet_created',
            changedAt: new Date(),
            changedBy: req.user._id,
            note: 'LogSheet created by admin. Awaiting signatory signatures.'
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
    const logsheets = await ApplicationLogsheet.find({})
      .populate('application_id', 'application_number application_type status category')
      .populate('client_id', 'full_name company_name email')
      .populate('site_id', 'name address')
      .sort({ created_at: -1 });
    res.json({ data: logsheets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/application-logsheets/:id/status (Admin only)
router.put('/:id/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const logsheet = await ApplicationLogsheet.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    if (!logsheet) return res.status(404).json({ error: 'Logsheet not found' });
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
      logsheet.status = 'Signed';
      await logsheet.save();

      // Update the linked application to logsheet_signed
      if (logsheet.application_id) {
        const appId = logsheet.application_id._id || logsheet.application_id;
        const app = await Application.findByIdAndUpdate(
          appId,
          {
            status: 'logsheet_signed',
            updated_at: new Date(),
            $push: {
              statusHistory: {
                status: 'logsheet_signed',
                changedAt: new Date(),
                changedBy: req.user._id,
                note: 'LogSheet fully signed. All required signatures collected.'
              }
            }
          },
          { new: true }
        );
        if (app) emitApplicationUpdate(app, 'logsheet_signed');
      }

      return res.json({ data: logsheet, message: 'Logsheet sign-off finalized successfully!' });
    }

    if (sendWithoutSignature) {
      if (comment) logsheet.comment = comment;
      await logsheet.save();
      return res.json({ data: logsheet, message: 'Logsheet sent to review without signature' });
    }

    if (!role) return res.status(400).json({ error: 'Role is required for signature' });

    const rolesArray = Array.isArray(role) ? role : [role];
    for (const r of rolesArray) {
      const roleLower = r.toLowerCase();
      if (roleLower === 'mufti') {
        logsheet.mufti_signature = signature_url;
        logsheet.mufti_sign_name = signature_name;
        logsheet.mufti_sign_date = new Date();
      } else if (roleLower === 'ceo') {
        logsheet.ceo_signature = signature_url;
        logsheet.ceo_sign_name = signature_name;
        logsheet.ceo_sign_date = new Date();
      } else if (roleLower === 'manager') {
        logsheet.manager_signature = signature_url;
        logsheet.manager_sign_name = signature_name;
        logsheet.manager_sign_date = new Date();
      } else if (roleLower === 'mufti2') {
        logsheet.mufti2_signature = signature_url;
        logsheet.mufti2_sign_name = signature_name;
        logsheet.mufti2_sign_date = new Date();
      } else {
        return res.status(400).json({ error: `Invalid role selected: ${r}` });
      }
    }

    if (comment) {
      logsheet.comment = comment;
    }

    // Keep state in "Waiting for Signature" to allow further role sign-offs one-by-one
    await logsheet.save();
    
    res.json({ data: logsheet, message: `Successfully signed as ${role}` });
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

    const emailResult = await sendSignatoryEmails({
      logsheet,
      applicationNumber,
      adminUrl,
    });

    if (emailResult.sent === 0 && emailResult.failed === 0) {
      return res.status(400).json({
        error: 'No signatory email addresses configured. Set LOGSHEET_SIGNATORY_EMAILS in your .env file.'
      });
    }

    res.json({
      message: `Emails sent: ${emailResult.sent}, failed: ${emailResult.failed}`,
      sent: emailResult.sent,
      failed: emailResult.failed,
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
