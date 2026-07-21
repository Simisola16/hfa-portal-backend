import express from 'express';
import Logsheet from '../models/Logsheet.js';
import Invoice from '../models/Invoice.js';
import Application from '../models/Application.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Middleware: ensure final invoice is paid before logsheet creation
async function requireFinalInvoicePaid(req, res, next) {
  try {
    const application_id = req.body.application_id;
    if (!application_id) return next(); // If no app_id, skip (let schema validation catch it)

    // Find the application to check status
    const app = await Application.findById(application_id);
    if (!app) {
      return res.status(404).json({ error: 'Application not found.' });
    }

    // Only enforce if the app is past the audit_successful stage
    const postAuditStatuses = ['audit_successful', 'final_invoice_sent', 'logsheet_created', 'logsheet_signed', 'agreement_sent', 'agreement_signed', 'certificate_issued'];
    if (!postAuditStatuses.includes(app.status)) {
      return next(); // Not yet at the gating point — skip
    }

    // Find the final invoice for this application
    const finalInvoice = await Invoice.findOne({ application_id, invoice_type: 'final' });

    if (!finalInvoice) {
      return res.status(403).json({
        error: 'A Final Invoice must be sent and paid before a LogSheet can be created.',
        code: 'FINAL_INVOICE_REQUIRED'
      });
    }

    if (!['paid', 'client_paid'].includes(finalInvoice.status)) {
      return res.status(403).json({
        error: 'The Final Invoice must be paid before a LogSheet can be created.',
        code: 'FINAL_INVOICE_NOT_PAID',
        invoice_status: finalInvoice.status
      });
    }

    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Get logsheets (Admin only)
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const logs = await Logsheet.find().sort({ created_at: -1 });
    res.json({ data: logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create log entry — requires final invoice to be paid
router.post('/', authenticateToken, requireAdmin, requireFinalInvoicePaid, async (req, res) => {
  try {
    const log = new Logsheet({
      ...req.body,
      performed_by: req.user.id
    });
    await log.save();
    res.json({ data: log });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
