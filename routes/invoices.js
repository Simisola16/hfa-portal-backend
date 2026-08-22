import express from 'express';
import multer from 'multer';
import { uploadToGridFS } from '../lib/gridfs.js';
import Invoice from '../models/Invoice.js';
import Application from '../models/Application.js';
import User from '../models/User.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { createNotification } from '../lib/notifications.js';
import { generateHfaId } from '../lib/idGenerator.js';
import { emitApplicationUpdate } from '../lib/socket.js';
import { Resend } from 'resend';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const resend = new Resend(process.env.RESEND_API_KEY);
const emailFrom = process.env.EMAIL_FROM || 'HFA Portal <info@halalfoodfoundation.org.uk>';

// GET /api/invoices — all (admin) or client's own
router.get('/', authenticateToken, async (req, res) => {
  try {
    let query = {};
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      query.client_id = req.user._id.toString();
    }
    const data = await Invoice.find(query)
      .populate('application_id')
      .populate('profiles')
      .sort({ createdAt: -1 });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/invoices/application/:appId/all — fetch all invoices for a specific application
router.get('/application/:appId/all', authenticateToken, async (req, res) => {
  try {
    const data = await Invoice.find({ application_id: req.params.appId }).sort({ updatedAt: -1, createdAt: -1 });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/invoices/application/:appId — fetch latest invoice for a specific application
router.get('/application/:appId', authenticateToken, async (req, res) => {
  try {
    const data = await Invoice.findOne({ application_id: req.params.appId }).sort({ updatedAt: -1, createdAt: -1 });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/invoices — client or admin creates/uploads invoice (supports file upload & revision override)
router.post('/', authenticateToken, upload.single('invoice_file'), async (req, res) => {
  try {
    const invoiceData = { ...req.body };

    // Upload invoice PDF if attached
    if (req.file) {
      invoiceData.invoice_url = await uploadToGridFS(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );
    }

    const isFinal = invoiceData.invoice_type === 'final' || invoiceData.stage === 'final' || invoiceData.target_status === 'final_invoice_sent';
    const invoiceType = isFinal ? 'final' : 'initial';
    invoiceData.invoice_type = invoiceType;

    let companyForId = 'HFA';
    if (invoiceData.client_id) {
      const clientUser = await User.findById(invoiceData.client_id);
      companyForId = clientUser?.company_name || clientUser?.full_name || 'HFA';
    }

    let data;
    let isRevision = false;

    // Check if an existing invoice of this type already exists for this application
    if (invoiceData.application_id) {
      const typeQuery = isFinal
        ? {
            application_id: invoiceData.application_id,
            $or: [{ invoice_type: 'final' }, { stage: 'final' }, { target_status: 'final_invoice_sent' }]
          }
        : {
            application_id: invoiceData.application_id,
            $or: [
              { invoice_type: 'initial' },
              { invoice_type: { $exists: false } },
              { invoice_type: null },
              { stage: 'initial' },
              { invoice_type: { $ne: 'final' } }
            ]
          };

      let existingInvoice = await Invoice.findOne(typeQuery).sort({ createdAt: -1 });

      if (existingInvoice) {
        isRevision = true;
        if (invoiceData.title) existingInvoice.title = invoiceData.title;
        if (invoiceData.amount !== undefined) existingInvoice.amount = Number(invoiceData.amount);
        if (invoiceData.notes !== undefined) existingInvoice.notes = invoiceData.notes;
        if (invoiceData.invoice_url) existingInvoice.invoice_url = invoiceData.invoice_url;
        existingInvoice.invoice_type = invoiceType;
        existingInvoice.status = 'unpaid';
        existingInvoice.payment_proof_url = null;
        existingInvoice.paid_at = null;
        existingInvoice.version = (existingInvoice.version || 1) + 1;

        data = await existingInvoice.save();

        // Clean up any other duplicate invoices of this type for this application
        await Invoice.deleteMany({
          application_id: invoiceData.application_id,
          _id: { $ne: existingInvoice._id },
          ...typeQuery
        });
      }
    }

    if (!data) {
      invoiceData.invoice_number = invoiceData.invoice_number || generateHfaId(companyForId);
      const invoice = new Invoice(invoiceData);
      data = await invoice.save();
    }

    // Update application status
    if (invoiceData.application_id) {
      const targetStatus = isFinal ? 'final_invoice_sent' : 'invoice_sent';
      const histEntry = {
        status: targetStatus,
        changedAt: new Date(),
        changedBy: req.user._id,
        note: isRevision
          ? `Revised ${isFinal ? 'Final ' : 'Initial '}Invoice issued: ${data.invoice_number} (Amount: £${data.amount}, v${data.version || 1})`
          : `Invoice issued: ${data.invoice_number} (Amount: £${data.amount})`,
      };
      const updatedApp = await Application.findByIdAndUpdate(invoiceData.application_id, {
        status: targetStatus,
        updated_at: new Date(),
        $push: { statusHistory: histEntry }
      }, { new: true });
      if (updatedApp) emitApplicationUpdate(updatedApp, targetStatus);
    }

    // Send Email Notification
    try {
      const clientUser = await User.findById(data.client_id);
      if (clientUser?.email) {
        await resend.emails.send({
          from: emailFrom,
          to: clientUser.email,
          subject: isRevision
            ? `HFA Revised Invoice Issued: ${data.invoice_number}`
            : `HFA Invoice Issued: ${data.invoice_number}`,
          html: `<div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>${isRevision ? 'Revised Invoice Issued' : 'Invoice Issued'}</h2>
            <p>Dear ${clientUser.full_name || 'Client'},</p>
            <p>${isRevision ? 'A revised invoice' : 'Invoice'} <strong>${data.invoice_number}</strong> for amount <strong>£${data.amount}</strong> has been issued for your application.</p>
            <p>Please log in to your HFA Portal account to view and process payment.</p>
          </div>`
        });
      }
    } catch (e) {
      console.error('Invoice Resend Email error:', e.message);
    }

    // Notify Client
    await createNotification(
      data.client_id,
      isRevision ? 'Revised Invoice Issued 🧾' : 'Invoice Issued 🧾',
      `A ${isRevision ? 'revised ' : ''}invoice (${data.invoice_number}) has been issued for your application. Amount: £${data.amount}. Please review and confirm payment.`,
      'warning',
      '/invoices'
    );

    res.status(isRevision ? 200 : 201).json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/invoices/:id — admin update
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const data = await Invoice.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/invoices/:id/pay — client confirms payment (optionally uploads proof)
router.put('/:id/pay', authenticateToken, upload.single('payment_proof'), async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    // Only the invoice owner or admin can mark as paid
    if (!['admin', 'superadmin'].includes(req.user.role) && invoice.client_id !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }

    invoice.status = 'client_paid';
    invoice.paid_at = new Date();

    // Upload payment proof if attached
    if (req.file) {
      invoice.payment_proof_url = await uploadToGridFS(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );
    }

    const data = await invoice.save();

    // Ensure Application status is advanced to invoice_sent if it was on nc_closed / audit_report_submitted
    if (invoice.application_id) {
      try {
        const app = await Application.findById(invoice.application_id);
        if (app && ['nc_closed', 'audit_report_submitted', 'audit_completed', 'audit_successful'].includes(app.status)) {
          const isFinal = invoice.invoice_type === 'final' || invoice.stage === 'final';
          const targetStatus = isFinal ? 'final_invoice_sent' : 'invoice_sent';
          app.status = targetStatus;
          app.updated_at = new Date();
          app.statusHistory.push({
            status: targetStatus,
            changedAt: new Date(),
            changedBy: req.user._id,
            note: `Client submitted payment for invoice ${invoice.invoice_number}.`
          });
          await app.save();
          emitApplicationUpdate(app, targetStatus);
        }
      } catch (appErr) {
        console.error('Error updating application on invoice pay:', appErr);
      }
    }

    // Notify admins
    const { default: User } = await import('../models/User.js');
    const admins = await User.find({ role: { $in: ['admin', 'superadmin', 'staff', 'food_tech_manager', 'food_tech'] } });
    for (const admin of admins) {
      await createNotification(
        admin._id,
        'Payment Confirmed 💰',
        `Client has confirmed payment for invoice ${invoice.invoice_number}.`,
        'success',
        '/invoices'
      );
    }

    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/invoices/confirm-payment — admin confirms payment for application
router.post('/confirm-payment', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { application_id, invoice_id } = req.body;
    let invoice = null;

    if (invoice_id) {
      invoice = await Invoice.findById(invoice_id);
    }
    if (!invoice && application_id) {
      invoice = await Invoice.findOne({ application_id }).sort({ createdAt: -1 });
    }

    if (invoice) {
      invoice.status = 'paid';
      invoice.payment_date = new Date();
      await invoice.save();
    }

    const targetAppId = application_id || invoice?.application_id;
    let updatedApp = null;

    if (targetAppId) {
      const isFinal = invoice?.invoice_type === 'final' || invoice?.stage === 'final';
      const targetStatus = isFinal ? 'final_invoice_paid' : 'payment_received';

      const histEntry = {
        status: targetStatus,
        changedAt: new Date(),
        changedBy: req.user._id,
        note: `Payment confirmed by admin for ${isFinal ? 'final ' : ''}invoice ${invoice?.invoice_number || ''}.`,
      };

      const updateData = {
        status: targetStatus,
        updated_at: new Date(),
        $push: { statusHistory: histEntry }
      };

      updatedApp = await Application.findByIdAndUpdate(
        targetAppId,
        updateData,
        { new: true }
      );
      if (updatedApp) emitApplicationUpdate(updatedApp, targetStatus);
    }

    // Notify the client
    const clientId = invoice?.client_id || updatedApp?.client_id;
    if (clientId) {
      await createNotification(
        clientId,
        'Payment Confirmed ✅',
        `Your payment${invoice ? ` for invoice ${invoice.invoice_number}` : ''} has been confirmed by HFA. Your application will now proceed to the next stage.`,
        'success',
        '/applications'
      );
    }

    res.json({ data: invoice, application: updatedApp });
  } catch (err) {
    console.error('Error confirming payment:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/invoices/:id/confirm-payment — admin confirms client payment
router.put('/:id/confirm-payment', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    invoice.status = 'paid';
    invoice.payment_date = new Date();
    const data = await invoice.save();

    // Update application status
    if (invoice.application_id) {
      const isFinal = invoice.invoice_type === 'final';
      const targetStatus = isFinal ? 'final_invoice_paid' : 'payment_received';

      const histEntry = {
        status: targetStatus,
        changedAt: new Date(),
        changedBy: req.user._id,
        note: `Payment confirmed by admin for ${isFinal ? 'final ' : ''}invoice ${invoice.invoice_number}.`,
      };

      const updateData = {
        status: targetStatus,
        updated_at: new Date(),
        $push: { statusHistory: histEntry }
      };

      const updatedApp = await Application.findByIdAndUpdate(
        invoice.application_id,
        updateData,
        { new: true }
      );
      if (updatedApp) emitApplicationUpdate(updatedApp, targetStatus);
    }

    // Notify the client
    await createNotification(
      invoice.client_id,
      'Payment Confirmed ✅',
      `Your payment for invoice ${invoice.invoice_number} has been confirmed by HFA. Your application will now proceed to the next stage.`,
      'success',
      '/applications'
    );

    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
