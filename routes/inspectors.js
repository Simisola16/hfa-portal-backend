import express from 'express';
import Inspector from '../models/Inspector.js';
import Audit from '../models/Audit.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
const router = express.Router();

router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const data = await Inspector.find().sort({ full_name: 1 });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const inspector = new Inspector(req.body);
    const data = await inspector.save();
    res.status(201).json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const data = await Inspector.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await Inspector.findByIdAndDelete(req.params.id);
    res.json({ message: 'Inspector deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/schedule', authenticateToken, async (req, res) => {
  try {
    const data = await Audit.find({ inspector_id: req.params.id })
      .populate('site_id application_id')
      .sort({ scheduled_date: 1 });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
