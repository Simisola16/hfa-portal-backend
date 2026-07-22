import express from 'express';
import Logsheet from '../models/Logsheet.js';
import Invoice from '../models/Invoice.js';
import Application from '../models/Application.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

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
