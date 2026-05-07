import express from 'express';
import Notification from '../models/Notification.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// GET /api/notifications
router.get('/', authenticateToken, async (req, res) => {
  try {
    const notifications = await Notification.find({ recipient_id: req.user._id })
      .sort({ created_at: -1 })
      .limit(50);
    const unreadCount = await Notification.countDocuments({ recipient_id: req.user._id, is_read: false });
    res.json({ data: notifications, unreadCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/notifications/:id/read
router.put('/:id/read', authenticateToken, async (req, res) => {
  try {
    await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient_id: req.user._id },
      { is_read: true }
    );
    res.json({ message: 'Marked as read' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/notifications/read-all
router.put('/read-all', authenticateToken, async (req, res) => {
  try {
    await Notification.updateMany(
      { recipient_id: req.user._id, is_read: false },
      { is_read: true }
    );
    res.json({ message: 'All marked as read' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
