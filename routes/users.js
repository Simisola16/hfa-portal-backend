import express from 'express';
import User from '../models/User.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
const router = express.Router();

import Application from '../models/Application.js';
import Certificate from '../models/Certificate.js';

router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await User.find().sort({ created_at: -1 });
    
    // Enrich users with stats
    const enrichedUsers = await Promise.all(users.map(async (u) => {
      const appCount = await Application.countDocuments({ user_id: u._id });
      const certCount = await Certificate.countDocuments({ user_id: u._id, status: 'active' });
      const userObj = u.toJSON();
      return { ...userObj, appCount, certCount };
    }));

    res.json({ data: enrichedUsers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/role', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { role } = req.body;
    const data = await User.findByIdAndUpdate(req.params.id, { role }, { new: true });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { is_active, status } = req.body;
    const update = {};
    if (is_active !== undefined) update.is_active = is_active;
    if (status !== undefined) update.is_active = (status === 'active');
    
    const data = await User.findByIdAndUpdate(req.params.id, update, { new: true });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
