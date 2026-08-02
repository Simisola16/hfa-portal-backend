import express from 'express';
import ExportCertificate from '../models/ExportCertificate.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
const router = express.Router();

router.get('/', authenticateToken, async (req, res) => {
  try {
    let query = {};
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      query.client_id = req.user._id;
    }
    const data = await ExportCertificate.find(query).sort({ created_at: -1 });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    const exportCert = new ExportCertificate({
      ...req.body,
      client_id: req.user._id
    });
    const data = await exportCert.save();
    res.status(201).json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const data = await ExportCertificate.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await ExportCertificate.findByIdAndDelete(req.params.id);
    res.json({ message: 'Export certificate deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
