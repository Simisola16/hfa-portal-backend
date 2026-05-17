import express from 'express';
import multer from 'multer';
import { uploadToGridFS } from '../lib/gridfs.js';
import Invoice from '../models/Invoice.js';
import Application from '../models/Application.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { createNotification } from '../lib/notifications.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// GET /api/invoices — all (admin) or client's own
router.get('/', authenticateToken, async (req, res) => {
  try {
    let query = {};
    if (req.user.role !== 'admin') {
      query.client_id = req.user._id.toString();
    }
    const data = await Invoice.find(query)
      .populate('application_id')
      .sort({ createdAt: -1 });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/invoices/application/:appId/all — fetch all invoices for a specific application
router.get('/application/:appId/all', authenticateToken, async (req, res) => {
  try {
    const data = await Invoice.find({ application_id: req.params.appId }).sort({ createdAt: 1 });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/invoices/application/:appId — fetch latest invoice for a specific application
router.get('/application/:appId', authenticateToken, async (req, res) => {
  try {
    const data = await Invoice.findOne({ application_id: req.params.appId }).sort({ createdAt: -1 });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/invoices — client or admin creates/uploads invoice (supports file upload)
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

    // Auto-generate invoice number
    invoiceData.invoice_number = `INV-${Date.now().toString().slice(-8)}`;

    const invoice = new Invoice(invoiceData);
    const data = await invoice.save();

    // Update application status
    if (invoiceData.application_id) {
      await Application.findByIdAndUpdate(invoiceData.application_id, {
        status: invoiceData.target_status || 'INVOICE SENT',
        updated_at: new Date()
      });
    }

    // Notify Client
    await createNotification(
      data.client_id,
      'Invoice Issued 🧾',
      `A new invoice (${data.invoice_number}) has been issued for your application. Amount: £${data.amount}. Please review and confirm payment.`,
      'warning',
      '/invoices'
    );

    res.status(201).json({ data });
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
    if (req.user.role !== 'admin' && invoice.client_id !== req.user._id.toString()) {
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

    // Notify admins
    const { default: User } = await import('../models/User.js');
    const admins = await User.find({ role: 'admin' });
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

export default router;
