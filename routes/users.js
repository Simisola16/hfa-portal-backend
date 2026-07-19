import express from 'express';
import User from '../models/User.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
const router = express.Router();

import Application from '../models/Application.js';
import Certificate from '../models/Certificate.js';
import { createNotification } from '../lib/notifications.js';

router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  const { email, password, full_name, role, username } = req.body;
  try {
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ error: 'Email already exists' });
    if (username) {
      const existingUser = await User.findOne({ username });
      if (existingUser) return res.status(400).json({ error: 'Username already exists' });
    }

    const user = new User({
      email,
      password,
      full_name,
      role: role || 'client',
      username: username || undefined,
      is_verified: true,
      is_active: true
    });
    
    const data = await user.save();
    
    // Omit password from response
    const resData = data.toJSON();
    delete resData.password;
    
    res.status(201).json({ data: resData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await User.find().sort({ created_at: -1 });
    
    // Enrich users with stats
    const enrichedUsers = await Promise.all(users.map(async (u) => {
      const appCount = await Application.countDocuments({ client_id: u._id });
      const approvedAppCount = await Application.countDocuments({ client_id: u._id, status: 'approved' });
      const certCount = await Certificate.countDocuments({ client_id: u._id, status: 'active' });
      const userObj = u.toJSON();
      return { ...userObj, appCount, approvedAppCount, certCount };
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
    const { is_active, status, suspension_reason } = req.body;
    const update = {};
    if (is_active !== undefined) {
      update.is_active = is_active;
      // If activating, clear suspension reason
      if (is_active) update.suspension_reason = null;
    }
    if (status !== undefined) {
      update.is_active = (status === 'active');
      if (status === 'active') update.suspension_reason = null;
    }
    if (suspension_reason !== undefined) {
      update.suspension_reason = suspension_reason;
    }
    
    const data = await User.findByIdAndUpdate(req.params.id, update, { new: true });

    // Send Notification
    if (is_active === true || status === 'active') {
      await createNotification(
        req.params.id,
        'Account Activated! 🚀',
        'Welcome back! Your HFA portal account has been activated. You can now access all features.',
        'success',
        '/dashboard'
      );
    } else if (is_active === false || suspension_reason) {
      await createNotification(
        req.params.id,
        'Account Suspended ⚠️',
        `Your account has been suspended. Reason: ${suspension_reason || 'Administrative decision'}. Please contact support for details.`,
        'error'
      );
    }

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
