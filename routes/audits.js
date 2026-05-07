import express from 'express';
import Audit from '../models/Audit.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { createNotification } from '../lib/notifications.js';
const router = express.Router();

router.get('/', authenticateToken, async (req, res) => {
  try {
    let query = {};
    if (req.user.role !== 'admin') {
      query.client_id = req.user._id;
    }
    const data = await Audit.find(query)
      .populate('application_id site_id inspector_id')
      .sort({ scheduled_date: -1 });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const payload = { ...req.body };
    if (payload.inspector_id === "") payload.inspector_id = null;
    const audit = new Audit(payload);
    const data = await audit.save();

    // Notify Client
    await createNotification(
      data.client_id,
      'Audit Scheduled 🗓️',
      `An audit has been scheduled for your site on ${new Date(data.scheduled_date).toLocaleDateString()}. Please ensure all documentation is ready.`,
      'info',
      '/audits'
    );

    res.status(201).json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const payload = { ...req.body };
    if (payload.inspector_id === "") payload.inspector_id = null;
    const data = await Audit.findByIdAndUpdate(req.params.id, payload, { new: true });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await Audit.findByIdAndDelete(req.params.id);
    res.json({ message: 'Audit deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
