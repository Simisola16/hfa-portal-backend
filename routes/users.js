import express from 'express';
import User from '../models/User.js';
import { authenticateToken, requireAdmin, requireSuperAdmin } from '../middleware/auth.js';
import Application from '../models/Application.js';
import Certificate from '../models/Certificate.js';
import { createNotification } from '../lib/notifications.js';
import { Resend } from 'resend';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);
const emailFrom = process.env.EMAIL_FROM || 'HFA Portal <info@halalfoodfoundation.org.uk>';

// ─── CLIENT TEAM / SUBUSERS ENDPOINTS (Must be defined BEFORE /:id) ───────────────

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

    const subUserPassword = password?.trim() || `HFA${Math.random().toString(36).slice(-8)}!`;

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

    // Send Welcome / Credentials email to newly created subuser
    try {
      const clientPortalUrl = process.env.FRONTEND_CLIENT_URL || 'http://localhost:5173';
      const roleLabel = role ? (role.charAt(0).toUpperCase() + role.slice(1)) : 'Viewer';
      await resend.emails.send({
        from: emailFrom,
        to: subUser.email,
        subject: `Welcome to HFA Portal — Team Account for ${parent.company_name || parent.full_name}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0;">
            <div style="background: linear-gradient(135deg, #15803d, #166534); padding: 28px 32px; text-align: center; color: white;">
              <h2 style="margin: 0; font-size: 22px; font-weight: 800;">Halal Food Authority</h2>
              <p style="margin: 6px 0 0; font-size: 13.5px; opacity: 0.9;">Company Team Portal Access</p>
            </div>
            <div style="padding: 28px 32px; background: white;">
              <p style="font-size: 15px; color: #1e293b; margin-top: 0;">Hello <strong>${subUser.full_name}</strong>,</p>
              <p style="font-size: 14px; color: #475569; line-height: 1.6;">
                You have been added as a team member (<strong>${roleLabel}</strong>) for <strong>${parent.company_name || parent.full_name}</strong> on the HFA Certification Portal.
              </p>
              <div style="background: #f1f5f9; border-radius: 8px; padding: 18px 20px; margin: 20px 0;">
                <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; margin-bottom: 8px;">Your Login Credentials</div>
                <div style="font-size: 13.5px; color: #1e293b; margin-bottom: 6px;"><strong>Email:</strong> ${subUser.email}</div>
                <div style="font-size: 13.5px; color: #1e293b;"><strong>Password:</strong> <code style="background: #e2e8f0; padding: 3px 8px; border-radius: 4px; font-family: monospace;">${subUserPassword}</code></div>
              </div>
              <div style="text-align: center; margin: 24px 0;">
                <a href="${clientPortalUrl}/login" style="display: inline-block; background: #15803d; color: white; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 700; font-size: 14px;">
                  Log In to Client Portal &rarr;
                </a>
              </div>
              <p style="font-size: 12px; color: #94a3b8; line-height: 1.5; margin-top: 20px; border-top: 1px solid #f1f5f9; padding-top: 14px;">
                You can change your password anytime in your profile settings after logging in.
              </p>
            </div>
          </div>
        `
      });
    } catch (emailErr) {
      console.warn('[Users] Welcome email failed for subuser:', emailErr.message);
    }

    res.status(201).json({
      data: resData,
      temp_password: subUserPassword,
      message: 'Team member added successfully'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/company/subusers/:id (Client endpoint to update a subuser)
router.put('/company/subusers/:id', authenticateToken, async (req, res) => {
  try {
    const parentId = req.user.parent_client_id || req.user._id;
    const subUser = await User.findOne({ _id: req.params.id, parent_client_id: parentId });
    if (!subUser) return res.status(404).json({ error: 'Team member not found or access denied' });

    const { full_name, role, password } = req.body;
    if (full_name?.trim()) subUser.full_name = full_name.trim();
    if (role && ['admin', 'editor', 'viewer'].includes(role)) subUser.client_role = role;
    if (password?.trim()) subUser.password = password.trim();

    await subUser.save();
    const resData = subUser.toJSON();
    delete resData.password;

    res.json({ data: resData, message: 'Team member updated successfully' });
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

// ─── GENERAL USER ENDPOINTS ───────────────────────────────────────────────────────

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

router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  const { email, password, full_name, role, roles, username, company_name, phone, address, postcode, country, can_issue_direct_certificate, is_support_manager } = req.body;
  
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

  const rolePriority = ['superadmin', 'admin', 'support_manager', 'scheme_manager', 'certificate_officer', 'accountant', 'audit_manager', 'food_tech_manager', 'food_tech', 'inspector', 'client'];
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
      can_issue_direct_certificate: Boolean(can_issue_direct_certificate || primaryRole === 'superadmin' || primaryRole === 'certificate_officer' || assignedRoles.includes('superadmin') || assignedRoles.includes('certificate_officer')),
      is_support_manager: Boolean(is_support_manager || primaryRole === 'superadmin' || primaryRole === 'support_manager' || assignedRoles.includes('superadmin') || assignedRoles.includes('support_manager')),
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
    const { role, roles, can_issue_direct_certificate, is_support_manager } = req.body;
    let assignedRoles = [];
    if (Array.isArray(roles) && roles.length > 0) {
      assignedRoles = roles.filter(Boolean);
    } else if (role) {
      assignedRoles = Array.isArray(role) ? role : [role];
    } else {
      assignedRoles = ['food_tech'];
    }

    const rolePriority = ['superadmin', 'admin', 'support_manager', 'scheme_manager', 'certificate_officer', 'accountant', 'audit_manager', 'food_tech_manager', 'food_tech', 'inspector', 'client'];
    const primaryRole = assignedRoles.slice().sort((a, b) => rolePriority.indexOf(a) - rolePriority.indexOf(b))[0] || 'food_tech';

    const updateObj = {
      role: primaryRole,
      roles: assignedRoles
    };
    if (primaryRole === 'superadmin' || assignedRoles.includes('superadmin')) {
      updateObj.can_issue_direct_certificate = true;
      updateObj.is_support_manager = true;
    } else {
      if (can_issue_direct_certificate !== undefined) {
        updateObj.can_issue_direct_certificate = Boolean(can_issue_direct_certificate);
      }
      if (is_support_manager !== undefined) {
        updateObj.is_support_manager = Boolean(is_support_manager);
      } else if (primaryRole === 'support_manager' || assignedRoles.includes('support_manager')) {
        updateObj.is_support_manager = true;
      }
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

router.put('/:id/support-manager-permission', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { is_support_manager } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.is_support_manager = Boolean(is_support_manager);
    await user.save();

    if (user.is_support_manager) {
      await createNotification(
        user._id,
        'Privilege Granted: Support Manager 🎧',
        'Superadmin has granted you the Support Manager privilege. You can now receive live client support requests and assign tickets to staff.',
        'success',
        '/tickets'
      );
    } else {
      await createNotification(
        user._id,
        'Privilege Revoked: Support Manager',
        'Your Support Manager privilege has been revoked by Superadmin.',
        'warning',
        '/dashboard'
      );
    }

    const resData = user.toJSON();
    delete resData.password;
    res.json({ data: resData, message: `Support Manager privilege ${user.is_support_manager ? 'granted' : 'revoked'} successfully` });
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
