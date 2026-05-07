import express from 'express';
import Invoice from '../models/Invoice.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { createNotification } from '../lib/notifications.js';
const router = express.Router();

router.get('/', authenticateToken, async (req, res) => {
  try {
    let query = {};
    if (req.user.role !== 'admin') {
      query.client_id = req.user._id;
    }
    const data = await Invoice.find(query).sort({ created_at: -1 });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const invoice = new Invoice(req.body);
    const data = await invoice.save();

    // Notify Client
    await createNotification(
      data.client_id,
      'New Invoice Issued 💳',
      `A new invoice (${data.invoice_number}) has been issued for your account. Amount: £${data.total_amount}.`,
      'warning',
      '/invoices'
    );

    res.status(201).json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const data = await Invoice.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
