import express from 'express';
import Audit from '../models/Audit.js';
import Application from '../models/Application.js';
import User from '../models/User.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { createNotification } from '../lib/notifications.js';
import { Resend } from 'resend';
import { uploadToGridFS } from '../lib/gridfs.js';
import multer from 'multer';
import mongoose from 'mongoose';
import { emitApplicationUpdate } from '../lib/socket.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const resend = new Resend(process.env.RESEND_API_KEY);
const emailFrom = process.env.EMAIL_FROM || 'HFA Portal <info@halalfoodfoundation.org.uk>';

// GET /api/audits (Admin: all, Client: own audits)
router.get('/', authenticateToken, async (req, res) => {
  try {
    let query = {};
    if (req.user.role !== 'admin') {
      query.client_id = req.user._id.toString();
    }
    const audits = await Audit.find(query)
      .populate('application_id', 'application_number status')
      .populate('inspector_id', 'full_name email')
      .sort({ createdAt: -1 });

    // Fetch clients safely
    const clientIds = audits
      .map(a => a.client_id)
      .filter(id => id && mongoose.Types.ObjectId.isValid(id.toString()));
      
    const clients = await User.find({ _id: { $in: clientIds } }, 'company_name full_name');
    const clientMap = clients.reduce((acc, c) => ({ ...acc, [c._id.toString()]: c }), {});

    const formatted = audits.map(a => {
      const clientIdStr = a.client_id ? a.client_id.toString() : '';
      const client = clientMap[clientIdStr];
      
      const inspectorName = a.auditors && a.auditors.length > 0
        ? a.auditors.map(aud => aud.name).join(', ')
        : (a.inspector_id ? a.inspector_id.full_name : 'Unassigned');

      return {
        _id: a._id.toString(),
        id: a._id.toString(),
        application_id: a.application_id,
        applications: a.application_id ? { application_number: a.application_id.application_number } : null,
        profiles: { company_name: client?.company_name || client?.full_name || 'Unknown Client' },
        inspectors: { full_name: inspectorName },
        sites: { name: 'Main Site' },
        audit_type: a.audit_type || 'Initial',
        stage: a.stage || 1,
        status: a.status || 'scheduled',
        proposed_dates: a.proposed_dates || [],
        selected_dates: a.selected_dates || [],
        finalized_date: a.finalized_date,
        auditors: a.auditors || [],
        nc_reports: a.nc_reports || [],
        scheduled_date: a.scheduled_date || a.finalized_date || a.selected_dates?.[0],
      };
    });

    res.json({ data: formatted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/audits (Create custom scheduled audit)
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { application_id, inspector_id, site_id, client_id, scheduled_date, audit_type, notes } = req.body;
    const audit = new Audit({
      application_id: application_id || undefined,
      client_id: client_id || 'system',
      inspector_id: inspector_id || undefined,
      site_id: site_id || undefined,
      finalized_date: scheduled_date ? new Date(scheduled_date) : undefined,
      scheduled_date: scheduled_date ? new Date(scheduled_date) : undefined,
      audit_type: audit_type || 'Initial',
      notes: notes || '',
      status: 'scheduled'
    });
    const saved = await audit.save();
    res.status(201).json({ data: saved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/audits/:id (Update custom scheduled audit status/findings)
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { status, findings } = req.body;
    const updated = await Audit.findByIdAndUpdate(
      req.params.id,
      { status, notes: findings },
      { new: true }
    );
    res.json({ data: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/audits/application/:appId
router.get('/application/:appId', authenticateToken, async (req, res) => {
  try {
    let audits = await Audit.find({ application_id: req.params.appId }).sort({ stage: 1, createdAt: 1 });
    if (!audits || audits.length === 0) {
      return res.json({ data: [] });
    }
    // Check permission
    if (req.user.role !== 'admin' && audits[0].client_id !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json({ data: audits });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/audits/propose-dates (Admin)
router.post('/propose-dates', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { application_id, client_id, dates, stage } = req.body;
    if (!dates || dates.length !== 3) {
      return res.status(400).json({ error: 'Must provide exactly 3 dates' });
    }

    let audit = await Audit.findOne({ application_id, stage: stage || 1 });
    if (!audit) {
      audit = new Audit({ application_id, client_id, stage: stage || 1 });
    }
    
    audit.proposed_dates = dates;
    audit.client_unavailable = false;
    audit.selected_dates = [];
    audit.status = 'dates_proposed';
    await audit.save();

    if (application_id) {
      const isStage2 = (stage === 2);
      // Only change app status for stage 1. Stage 2 operates concurrently with 'audit_report_submitted' logic?
      // Wait, if we are in Stage 2, should we update Application status?
      // For now, let's just leave the Application status alone if it's Stage 2, or set it back.
      // We can just add a history note for Stage 2.
      const statusToSet = isStage2 ? 'audit_assigned' : 'dates_proposed'; // We don't rollback app status for stage 2, it's just 'audit_assigned' for the whole audit process until both stages finish.
      
      const updatedApp = await Application.findByIdAndUpdate(application_id, {
        status: statusToSet,
        updated_at: new Date(),
        $push: {
          statusHistory: {
            status: statusToSet,
            changedAt: new Date(),
            changedBy: req.user._id,
            note: `Admin proposed 3 audit dates to client for Stage ${stage || 1}.`,
          }
        }
      }, { new: true });
      if (updatedApp) emitApplicationUpdate(updatedApp, statusToSet);
    }

    await createNotification(
      client_id,
      'Audit Dates Proposed 🗓️',
      'The admin has proposed 3 dates for your upcoming audit. Please select 2 dates or mark as unavailable.',
      'info',
      '/applications'
    );

    res.json({ data: audit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/audits/select-dates (Client)
router.post('/select-dates', authenticateToken, async (req, res) => {
  try {
    const { audit_id, selected_dates, unavailable } = req.body;
    const audit = await Audit.findById(audit_id);
    if (!audit) return res.status(404).json({ error: 'Audit not found' });

    if (audit.client_id !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (unavailable) {
      audit.client_unavailable = true;
      audit.status = 'dates_rejected';
      await audit.save();

        const updatedApp = await Application.findByIdAndUpdate(audit.application_id, {
          status: 'dates_rejected',
          updated_at: new Date(),
          $push: {
            statusHistory: {
              status: 'dates_rejected',
              changedAt: new Date(),
              changedBy: req.user._id,
              note: 'Client rejected proposed audit dates.',
            }
          }
        }, { new: true });
        if (updatedApp) emitApplicationUpdate(updatedApp, 'dates_rejected');
      
      const admins = await User.find({ role: 'admin' });
      for (const admin of admins) {
        await createNotification(
          admin._id,
          'Audit Dates Rejected ❌',
          `Client is unavailable on the proposed audit dates. Please propose 3 new dates.`,
          'warning',
          '/applications'
        );
      }
    } else {
      if (!selected_dates || selected_dates.length !== 2) {
        return res.status(400).json({ error: 'Must select exactly 2 dates' });
      }
      audit.selected_dates = selected_dates;
      audit.status = 'dates_accepted';
      await audit.save();

        const updatedApp = await Application.findByIdAndUpdate(audit.application_id, {
          status: 'dates_accepted',
          updated_at: new Date(),
          $push: {
            statusHistory: {
              status: 'dates_accepted',
              changedAt: new Date(),
              changedBy: req.user._id,
              note: 'Client selected 2 preferred audit dates.',
            }
          }
        }, { new: true });
        if (updatedApp) emitApplicationUpdate(updatedApp, 'dates_accepted');

      const admins = await User.find({ role: 'admin' });
      for (const admin of admins) {
        await createNotification(
          admin._id,
          'Audit Dates Accepted ✅',
          `Client has selected 2 audit dates. Please assign the auditor(s).`,
          'success',
          '/applications'
        );
      }
    }

    res.json({ data: audit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/audits/finalize-date (Admin picks 1 final date from client's 2)
router.post('/finalize-date', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { audit_id, finalized_date } = req.body;
    const audit = await Audit.findById(audit_id);
    if (!audit) return res.status(404).json({ error: 'Audit not found' });

    audit.finalized_date = new Date(finalized_date);
    audit.status = 'date_finalized';
    await audit.save();

    // Update application status to date_finalized with proper statusHistory entry
    const updatedApp = await Application.findByIdAndUpdate(audit.application_id, {
      status: 'date_finalized',
      updated_at: new Date(),
      $push: {
        statusHistory: {
          status: 'date_finalized',
          changedAt: new Date(),
          changedBy: req.user._id,
          note: `Audit date finalized: ${new Date(finalized_date).toDateString()}. An auditor will be assigned shortly.`,
        }
      }
    }, { new: true });
    if (updatedApp) emitApplicationUpdate(updatedApp, 'date_finalized');

    // Notify client
    await createNotification(
      audit.client_id,
      'Audit Date Confirmed 📅',
      `HFA has confirmed your audit date: ${new Date(finalized_date).toDateString()}. An auditor will be assigned shortly.`,
      'success',
      '/applications'
    );

    res.json({ data: audit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/audits/assign-auditors (Admin)
router.post('/assign-auditors', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { audit_id, auditors } = req.body;
    const audit = await Audit.findById(audit_id).populate('application_id');
    if (!audit) return res.status(404).json({ error: 'Audit not found' });

    audit.auditors = auditors;
    audit.status = 'auditors_assigned';
    await audit.save();

    const targetStatus = 'audit_assigned';
    const histEntry = {
      status: targetStatus,
      changedAt: new Date(),
      changedBy: req.user._id,
      note: `Auditors assigned: ${auditors.map(a => a.name).filter(Boolean).join(', ')}`,
    };

    // Update application status to audit_assigned
    const app = await Application.findByIdAndUpdate(
      audit.application_id?._id || audit.application_id,
      {
        status: targetStatus,
        updated_at: new Date(),
        $push: { statusHistory: histEntry }
      },
      { new: true }
    );
    if (app) emitApplicationUpdate(app, targetStatus);

    const companyName = app?.establishment_name || app?.company_name || 'HFA Client Facility';
    const appRef = app?.application_number || 'HFA Audit';
    const auditDate = audit.finalized_date 
      ? new Date(audit.finalized_date).toDateString() 
      : (audit.selected_dates?.[0] ? new Date(audit.selected_dates[0]).toDateString() : 'To Be Confirmed');

    const adminUrl = process.env.ADMIN_URL || 'http://localhost:5175';
    const loginUrl = `${adminUrl}/login`;

    let emailFailures = 0;

    // Send email notifications to each assigned auditor
    for (const auditor of auditors) {
      if (!auditor || !auditor.email || !auditor.email.trim()) continue;
      try {
        await resend.emails.send({
          from: emailFrom,
          to: auditor.email.trim(),
          subject: `Audit Assignment Notification: ${companyName} (${appRef})`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px;">
              <div style="background: linear-gradient(135deg, #15803d, #166534); border-radius: 8px 8px 0 0; padding: 24px; text-align: center; color: white;">
                <h2 style="margin: 0; font-size: 22px; font-weight: 800;">Halal Food Authority</h2>
                <p style="margin: 4px 0 0; font-size: 14px; opacity: 0.9;">Audit Assignment Notification</p>
              </div>
              <div style="padding: 24px; background: white; border-radius: 0 0 8px 8px;">
                <h3 style="color: #1e293b; margin-top: 0;">You have been assigned to conduct an audit</h3>
                <p style="font-size: 14px; color: #475569; line-height: 1.6;">
                  Hello <strong>${auditor.name || 'Auditor'}</strong>,<br/><br/>
                  You have been assigned to conduct the halal certification audit for <strong>${companyName}</strong> (Application Ref: <strong>${appRef}</strong>).
                </p>
                <div style="background-color: #f1f5f9; padding: 16px; border-radius: 8px; margin: 20px 0;">
                  <h4 style="margin: 0 0 8px 0; color: #334155; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em;">Audit Schedule Details</h4>
                  <table style="width: 100%; font-size: 13.5px; color: #475569; border-collapse: collapse;">
                    <tr>
                      <td style="padding: 4px 0; font-weight: 600; width: 120px;">Company:</td>
                      <td style="padding: 4px 0; font-weight: 700; color: #0f172a;">${companyName}</td>
                    </tr>
                    <tr>
                      <td style="padding: 4px 0; font-weight: 600;">Application Ref:</td>
                      <td style="padding: 4px 0;">${appRef}</td>
                    </tr>
                    <tr>
                      <td style="padding: 4px 0; font-weight: 600;">Audit Date:</td>
                      <td style="padding: 4px 0; font-weight: 700; color: #15803d;">${auditDate}</td>
                    </tr>
                    ${auditor.purpose ? `
                    <tr>
                      <td style="padding: 4px 0; font-weight: 600;">Purpose:</td>
                      <td style="padding: 4px 0;">${auditor.purpose}</td>
                    </tr>` : ''}
                    ${audit.notes ? `
                    <tr>
                      <td style="padding: 4px 0; font-weight: 600; vertical-align: top;">Notes:</td>
                      <td style="padding: 4px 0;">${audit.notes}</td>
                    </tr>` : ''}
                  </table>
                </div>
                <div style="text-align: center; margin-top: 24px;">
                  <a href="${loginUrl}" style="display: inline-block; padding: 12px 24px; background-color: #15803d; color: white; text-decoration: none; border-radius: 6px; font-weight: 700; font-size: 14px; box-shadow: 0 4px 6px -1px rgba(21, 128, 61, 0.2);">
                    Log In to Portal
                  </a>
                </div>
              </div>
            </div>
          `
        });
      } catch (emailErr) {
        console.error('Failed to send email to auditor:', emailErr);
        emailFailures++;
      }
    }

    await createNotification(
      audit.client_id,
      'Auditors Assigned 👨‍💼',
      'Auditors have been assigned for your upcoming audit. Please check the audit details.',
      'info',
      '/applications'
    );

    if (emailFailures > 0) {
      res.json({
        data: audit,
        warning: `Auditors assigned successfully, but ${emailFailures} email notifications failed to send (check server logs).`
      });
    } else {
      res.json({ data: audit });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// POST /api/audits/flag-nc (Admin)
router.post('/flag-nc', authenticateToken, requireAdmin, upload.single('nc_document'), async (req, res) => {
  try {
    const { audit_id, text } = req.body;
    const audit = await Audit.findById(audit_id);
    if (!audit) return res.status(404).json({ error: 'Audit not found' });

    let document_url = null;
    if (req.file) {
      document_url = await uploadToGridFS(req.file.buffer, req.file.originalname, req.file.mimetype);
    }

    audit.nc_reports.push({
      text,
      document_url,
      status: 'flagged',
      flagged_at: new Date()
    });
    
    await audit.save();

    // Update application status to on_hold so the client can see the NC on their timeline
    const ncHistEntry = {
      status: 'on_hold',
      changedAt: new Date(),
      changedBy: req.user._id,
      note: `Non-Conformity report flagged. Corrective action required: ${text || 'See audit report.'}`,
    };
    const updatedApp = await Application.findByIdAndUpdate(
      audit.application_id,
      {
        status: 'on_hold',
        updated_at: new Date(),
        $push: { statusHistory: ncHistEntry }
      },
      { new: true }
    );
    if (updatedApp) emitApplicationUpdate(updatedApp, 'on_hold');

    await createNotification(
      audit.client_id,
      'Non-Conformity Report Flagged ⚠️',
      'An NC report has been flagged during your audit. Please upload corrective actions.',
      'warning',
      '/applications'
    );

    res.json({ data: audit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/audits/resolve-nc (Client)
router.post('/resolve-nc', authenticateToken, async (req, res) => {
  try {
    const { audit_id, report_id } = req.body;
    const audit = await Audit.findById(audit_id);
    if (!audit) return res.status(404).json({ error: 'Audit not found' });

    if (audit.client_id !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const report = audit.nc_reports.id(report_id);
    if (report) {
      report.status = 'corrected';
      report.corrected_at = new Date();
    }
    
    await audit.save();

    const admins = await User.find({ role: 'admin' });
    for (const admin of admins) {
      await createNotification(
        admin._id,
        'NC Report Corrected 🛠️',
        `Client has resolved the NC report.`,
        'success',
        '/applications'
      );
    }

    res.json({ data: audit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/audits/complete-clean (Admin - Marks audit stage completed)
router.post('/complete-clean', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { audit_id } = req.body;
    const audit = await Audit.findById(audit_id).populate('application_id');
    if (!audit) return res.status(404).json({ error: 'Audit not found' });

    audit.status = 'audit_completed';
    await audit.save();

    const app = audit.application_id;
    const isDualStage = app?.category === 'UAE/GSO Approved Halal Certification For Exporters To UAE';
    const isFinalStage = !isDualStage || audit.stage === 2;

    if (isFinalStage && app) {
      // Update the linked application status to audit_completed
      const updatedApp = await Application.findByIdAndUpdate(
        app._id,
        {
          status: 'audit_completed',
          updated_at: new Date(),
          $push: {
            statusHistory: {
              status: 'audit_completed',
              changedAt: new Date(),
              changedBy: req.user._id,
              note: 'Audit completed successfully. Ready for Audit Report submission.'
            }
          }
        },
        { new: true }
      );
      if (updatedApp) emitApplicationUpdate(updatedApp, 'audit_completed');

      await createNotification(
        audit.client_id,
        'Audit Completed Successfully! 🎉',
        'Congratulations! Your audit session has been completed successfully.',
        'success',
        '/applications'
      );
    } else if (app) {
      await createNotification(
        audit.client_id,
        'Stage 1 Audit Completed ✅',
        'Your Stage 1 audit has been completed successfully. You can now proceed with Stage 2 scheduling.',
        'info',
        '/applications'
      );
    }

    res.json({ data: audit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/audits/submit-report (Admin - Submits final audit report)
router.post('/submit-report', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { application_id, audit_id } = req.body;
    let appId = application_id;
    if (!appId && audit_id) {
      const audit = await Audit.findById(audit_id);
      if (audit) appId = audit.application_id;
    }

    if (!appId) return res.status(400).json({ error: 'Application ID is required' });

    const updatedApp = await Application.findByIdAndUpdate(
      appId,
      {
        status: 'audit_report_submitted',
        updated_at: new Date(),
        $push: {
          statusHistory: {
            status: 'audit_report_submitted',
            changedAt: new Date(),
            changedBy: req.user._id,
            note: 'Official audit report submitted by HFA administration.'
          }
        }
      },
      { new: true }
    );

    if (updatedApp) emitApplicationUpdate(updatedApp, 'audit_report_submitted');

    const clientId = updatedApp?.client_id || updatedApp?.user_id;
    if (clientId) {
      await createNotification(
        clientId,
        'Audit Report Submitted 📄',
        'Your official audit report has been submitted.',
        'success',
        '/applications'
      );
    }

    res.json({ data: updatedApp });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
