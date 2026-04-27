import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
const router = express.Router();

// Placeholder for notifications (can be moved to MongoDB later if needed)
router.get('/', authenticateToken, async (req, res) => {
  res.json({ data: [] });
});

export default router;
