import express from 'express';
import User from '../models/User.js';
import { authenticateToken, requireAdmin, requireSuperAdmin } from '../middleware/auth.js';
const router = express.Router();

import Application from '../models/Application.js';
import Certificate from '../models/Certificate.js';
import { createNotification } from '../lib/notifications.js';

router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  const { email, password, full_name, role, username, company_name, phone, address, postcode, country, can_issue_direct_certificate } = req.body;
  const isStaffRole = ['admin', 'superadmin', 'audit_manager', 'food_tech_manager', 'food_tech', 'inspector'].includes(role);
  if (isStaffRole && !username?.trim()) {
    return res.status(400).json({ error: 'Username is required for HFA Staff accounts.' });
  }

  try {
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ error: 'Email already exists' });
    if (username?.trim()) {
      const existingUser = await User.findOne({ username: username.trim() });
      if (existingUser) return res.status(400).json({ error: 'Username already exists' });
    }

    const user = new User({
      email,
      password,
      full_name,
      company_name: company_name || full_name,
      phone,
      address,
      postcode,
      country,
      role: role || 'client',
      can_issue_direct_certificate: Boolean(can_issue_direct_certificate),
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

router.put('/:id/direct-cert-permission', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { can_issue_direct_certificate } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.can_issue_direct_certificate = Boolean(can_issue_direct_certificate);
    await user.save();

    if (user.can_issue_direct_certificate) {
      await createNotification(
        user._id,
        'Privilege Granted: Direct Certificate Studio ⚡',
        'Superadmin has granted you permission to directly issue Halal certificates and products without application.',
        'success',
        '/superadmin/direct-certificate'
      );
    } else {
      await createNotification(
        user._id,
        'Privilege Revoked: Direct Certificate Studio',
        'Your direct certificate issuance permission has been revoked by Superadmin.',
        'warning',
        '/dashboard'
      );
    }

    const resData = user.toJSON();
    delete resData.password;
    res.json({ data: resData, message: `Direct Certificate privilege ${user.can_issue_direct_certificate ? 'granted' : 'revoked'} successfully` });
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
      if (is_active) {
        update.is_verified = true;
        update.suspension_reason = null;
      }
    }
    if (status !== undefined) {
      update.is_active = (status === 'active');
      if (status === 'active') {
        update.is_verified = true;
        update.suspension_reason = null;
      }
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

router.put('/:id/verify-email', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const data = await User.findByIdAndUpdate(
      req.params.id,
      {
        is_verified: true,
        verification_token: undefined,
        verification_token_expiry: undefined
      },
      { new: true }
    );
    if (!data) return res.status(404).json({ error: 'User not found' });
    
    await createNotification(
      req.params.id,
      'Email Verified by Admin ✅',
      'Your email address has been verified by HFA Administration. You now have full portal access.',
      'success',
      '/dashboard'
    );

    res.json({ data, message: 'Email verified successfully' });
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
