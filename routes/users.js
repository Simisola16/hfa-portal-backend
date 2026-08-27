import express from 'express';
import User from '../models/User.js';
import { authenticateToken, requireAdmin, requireSuperAdmin } from '../middleware/auth.js';
const router = express.Router();

import Application from '../models/Application.js';
import Certificate from '../models/Certificate.js';
import { createNotification } from '../lib/notifications.js';

// GET /api/users/:id
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ data: user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users/company/subusers (Client endpoint to get primary user + subusers)
router.get('/company/subusers', authenticateToken, async (req, res) => {
  try {
    const parentId = req.user.parent_client_id || req.user._id;
    const [primaryUser, subUsers] = await Promise.all([
      User.findById(parentId).select('-password'),
      User.find({ parent_client_id: parentId }).select('-password').sort({ created_at: -1 })
    ]);

    const result = [];
    if (primaryUser) {
      const pObj = primaryUser.toJSON();
      result.push({
        ...pObj,
        id: pObj._id.toString(),
        is_owner: true,
        role: pObj.client_role || 'owner',
        display_role: 'Account Owner'
      });
    }
    subUsers.forEach(u => {
      const uObj = u.toJSON();
      result.push({
        ...uObj,
        id: uObj._id.toString(),
        is_owner: false,
        role: uObj.client_role || 'viewer',
        display_role: uObj.client_role ? (uObj.client_role.charAt(0).toUpperCase() + uObj.client_role.slice(1)) : 'Viewer'
      });
    });

    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/company/subusers (Client endpoint to add a subuser)
router.post('/company/subusers', authenticateToken, async (req, res) => {
  try {
    const { full_name, email, role, password } = req.body;
    if (!full_name?.trim()) return res.status(400).json({ error: 'Full name is required' });
    if (!email?.trim()) return res.status(400).json({ error: 'Email is required' });

    const parentId = req.user.parent_client_id || req.user._id;
    const parent = await User.findById(parentId);
    if (!parent) return res.status(404).json({ error: 'Primary client account not found' });

    const existing = await User.findOne({ email: email.trim().toLowerCase() });
    if (existing) return res.status(400).json({ error: 'User with this email already exists' });

    const subUserPassword = password || `HFA${Math.random().toString(36).slice(-8)}!`;

    const subUser = new User({
      full_name: full_name.trim(),
      email: email.trim().toLowerCase(),
      password: subUserPassword,
      role: 'client',
      client_role: ['admin', 'editor', 'viewer'].includes(role) ? role : 'viewer',
      parent_client_id: parentId,
      company_name: parent.company_name || parent.full_name,
      phone: parent.phone,
      address: parent.address,
      postcode: parent.postcode,
      country: parent.country,
      is_verified: true,
      is_active: true
    });

    const data = await subUser.save();
    const resData = data.toJSON();
    delete resData.password;

    res.status(201).json({ data: resData, message: 'Team member added successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/users/company/subusers/:id (Client endpoint to remove subuser)
router.delete('/company/subusers/:id', authenticateToken, async (req, res) => {
  try {
    const parentId = req.user.parent_client_id || req.user._id;
    const subUser = await User.findOne({ _id: req.params.id, parent_client_id: parentId });
    if (!subUser) return res.status(404).json({ error: 'Team member not found or cannot be removed' });

    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'Team member removed successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  const { email, password, full_name, role, roles, username, company_name, phone, address, postcode, country, can_issue_direct_certificate } = req.body;
  
  if (!email?.trim()) {
    return res.status(400).json({ error: 'Email address is required.' });
  }
  if (!password?.trim()) {
    return res.status(400).json({ error: 'Password is required.' });
  }

  // Parse and normalize assigned roles
  let assignedRoles = [];
  if (Array.isArray(roles) && roles.length > 0) {
    assignedRoles = roles.filter(Boolean);
  } else if (role) {
    assignedRoles = Array.isArray(role) ? role : [role];
  } else {
    assignedRoles = ['food_tech'];
  }

  const rolePriority = ['superadmin', 'admin', 'audit_manager', 'food_tech_manager', 'food_tech', 'inspector', 'client'];
  const primaryRole = assignedRoles.slice().sort((a, b) => rolePriority.indexOf(a) - rolePriority.indexOf(b))[0] || 'food_tech';

  try {
    const existing = await User.findOne({ email: email.trim().toLowerCase() });
    if (existing) return res.status(400).json({ error: 'Email already exists' });
    if (username?.trim()) {
      const existingUser = await User.findOne({ username: username.trim() });
      if (existingUser) return res.status(400).json({ error: 'Username already exists' });
    }

    const user = new User({
      email: email.trim().toLowerCase(),
      password,
      full_name: full_name?.trim() || '',
      company_name: company_name || full_name || '',
      phone,
      address,
      postcode,
      country,
      role: primaryRole,
      roles: assignedRoles,
      can_issue_direct_certificate: Boolean(can_issue_direct_certificate || primaryRole === 'superadmin' || assignedRoles.includes('superadmin')),
      username: username?.trim() || undefined,
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
    
    // Enrich users with stats and normalized roles
    const enrichedUsers = await Promise.all(users.map(async (u) => {
      const appCount = await Application.countDocuments({ client_id: u._id });
      const approvedAppCount = await Application.countDocuments({ client_id: u._id, status: 'approved' });
      const certCount = await Certificate.countDocuments({ client_id: u._id, status: 'active' });
      const userObj = u.toJSON();
      const userRoles = (u.roles && u.roles.length > 0) ? u.roles : (u.role ? [u.role] : []);
      return { ...userObj, roles: userRoles, appCount, approvedAppCount, certCount };
    }));

    res.json({ data: enrichedUsers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/role', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { role, roles, can_issue_direct_certificate } = req.body;
    let assignedRoles = [];
    if (Array.isArray(roles) && roles.length > 0) {
      assignedRoles = roles.filter(Boolean);
    } else if (role) {
      assignedRoles = Array.isArray(role) ? role : [role];
    } else {
      assignedRoles = ['food_tech'];
    }

    const rolePriority = ['superadmin', 'admin', 'audit_manager', 'food_tech_manager', 'food_tech', 'inspector', 'client'];
    const primaryRole = assignedRoles.slice().sort((a, b) => rolePriority.indexOf(a) - rolePriority.indexOf(b))[0] || 'food_tech';

    const updateObj = {
      role: primaryRole,
      roles: assignedRoles
    };
    if (primaryRole === 'superadmin' || assignedRoles.includes('superadmin')) {
      updateObj.can_issue_direct_certificate = true;
    } else if (can_issue_direct_certificate !== undefined) {
      updateObj.can_issue_direct_certificate = Boolean(can_issue_direct_certificate);
    }

    const data = await User.findByIdAndUpdate(req.params.id, updateObj, { new: true });
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
