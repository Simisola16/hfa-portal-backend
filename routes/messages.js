import express from 'express';
import Message from '../models/Message.js';
import User from '../models/User.js';
import { authenticateToken } from '../middleware/auth.js';
const router = express.Router();

router.get('/inbox', authenticateToken, async (req, res) => {
  try {
    const data = await Message.find({ recipient_id: req.user._id })
      .sort({ created_at: -1 });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/outbox', authenticateToken, async (req, res) => {
  try {
    const data = await Message.find({ sender_id: req.user._id })
      .sort({ created_at: -1 });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    const { recipient_id, subject, body, application_id } = req.body;
    const message = new Message({
      sender_id: req.user._id,
      recipient_id,
      subject,
      body,
      application_id: application_id || null
    });
    const data = await message.save();
    res.status(201).json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/read', authenticateToken, async (req, res) => {
  try {
    const data = await Message.findByIdAndUpdate(req.params.id, { is_read: true }, { new: true });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/unread-count', authenticateToken, async (req, res) => {
  try {
    const count = await Message.countDocuments({ recipient_id: req.user._id, is_read: false });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
