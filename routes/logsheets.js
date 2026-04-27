import express from 'express';
import Logsheet from '../models/Logsheet.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
const router = express.Router();

// Get logsheets (Admin only)
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const logs = await Logsheet.find().sort({ created_at: -1 });
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
