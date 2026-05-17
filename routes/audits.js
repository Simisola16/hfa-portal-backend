import express from 'express';
import Audit from '../models/Audit.js';
import Application from '../models/Application.js';
import User from '../models/User.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { createNotification } from '../lib/notifications.js';
import { Resend } from 'resend';
import { uploadToGridFS } from '../lib/gridfs.js';
import multer from 'multer';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const resend = new Resend(process.env.RESEND_API_KEY);

// GET /api/audits/application/:appId
router.get('/application/:appId', authenticateToken, async (req, res) => {
  try {
    let audit = await Audit.findOne({ application_id: req.params.appId }).sort({ createdAt: -1 });
    if (!audit) {
      return res.status(404).json({ error: 'Audit not found' });
    }
    // Check permission
    if (req.user.role !== 'admin' && audit.client_id !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json({ data: audit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/audits/propose-dates (Admin)
router.post('/propose-dates', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { application_id, client_id, dates } = req.body;
    if (!dates || dates.length !== 3) {
      return res.status(400).json({ error: 'Must provide exactly 3 dates' });
    }

    let audit = await Audit.findOne({ application_id });
    if (!audit) {
      audit = new Audit({ application_id, client_id });
    }
    
    audit.proposed_dates = dates;
    audit.client_unavailable = false;
    audit.selected_dates = [];
    audit.status = 'dates_proposed';
    await audit.save();

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

    // Update application status to AUDIT DATE FINALIZED
    await Application.findByIdAndUpdate(audit.application_id, {
      status: 'AUDIT DATE FINALIZED',
      updated_at: new Date()
    });

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

    // Update application status to ASSIGN AUDITOR
    await Application.findByIdAndUpdate(audit.application_id?._id || audit.application_id, {
      status: 'ASSIGN AUDITOR',
      updated_at: new Date()
    });

    // Send emails to auditors
    for (const auditor of auditors) {
      try {
        await resend.emails.send({
          from: 'Halal Food Authority <noreply@hfalogin.com>',
          to: auditor.email,
          subject: `Audit Assignment: ${audit.application_id?.site_name || 'HFA Audit'}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#f9fafb">
              <div style="background:linear-gradient(135deg,#1e40af,#1d4ed8);border-radius:12px;padding:32px;text-align:center;margin-bottom:24px">
                <h1 style="color:white;margin:0">👨‍💼 Audit Assignment</h1>
                <p style="color:#bfdbfe;margin:8px 0 0">Halal Food Authority</p>
              </div>
              <div style="background:white;border-radius:12px;padding:32px">
                <h2 style="color:#1e40af;margin:0 0 16px">You have been assigned to an audit</h2>
                <p><strong>Auditor:</strong> ${auditor.name}</p>
                <p><strong>Contact:</strong> ${auditor.contact_number}</p>
                <p><strong>Purpose:</strong> ${auditor.purpose}</p>
                <p><strong>Confirmed Audit Date:</strong></p>
                <ul>
                  ${audit.finalized_date ? `<li style="font-weight:bold;color:#1e40af">${new Date(audit.finalized_date).toDateString()}</li>` : audit.selected_dates.map(d => `<li>${new Date(d).toDateString()}</li>`).join('')}
                </ul>
              </div>
            </div>
          `
        });
      } catch (emailErr) {
        console.error('Failed to send email to auditor:', emailErr);
      }
    }

    await createNotification(
      audit.client_id,
      'Auditors Assigned 👨‍💼',
      'Auditors have been assigned for your upcoming audit. Please check the audit details.',
      'info',
      '/applications'
    );

    res.json({ data: audit });
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

// POST /api/audits/complete-clean (Admin)
router.post('/complete-clean', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { audit_id } = req.body;
    const audit = await Audit.findById(audit_id);
    if (!audit) return res.status(404).json({ error: 'Audit not found' });

    audit.status = 'audit_completed';
    await audit.save();

    await createNotification(
      audit.client_id,
      'Audit Completed Successfully! 🎉',
      'Congratulations! Your audit session has been completed with no Non-Conformity (NC) reports flagged.',
      'success',
      '/applications'
    );

    res.json({ data: audit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
