import express from 'express';
import Logsheet from '../models/Logsheet.js';
import Invoice from '../models/Invoice.js';
import Application from '../models/Application.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Get log entries
router.get('/', authenticateToken, async (req, res) => {
  try {
    let query = {};
    if (req.query.entity_type) query.entity_type = req.query.entity_type;
    if (req.query.entity_id) query.entity_id = req.query.entity_id;
    const logs = await Logsheet.find(query).sort({ created_at: -1 });
    res.json({ data: logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create log entry
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
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
