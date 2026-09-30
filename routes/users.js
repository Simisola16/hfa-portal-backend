import express from 'express';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import { authenticateToken, requireAdmin, requireSuperAdmin } from '../middleware/auth.js';
import Application from '../models/Application.js';
import Certificate from '../models/Certificate.js';
import Site from '../models/Site.js';
import { createNotification } from '../lib/notifications.js';
import { Resend } from 'resend';
import dotenv from 'dotenv';
import { getClientUrl } from '../lib/urls.js';

dotenv.config();

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);
const emailFrom = process.env.EMAIL_FROM || 'HFA Portal <info@halalfoodfoundation.org.uk>';

// ─── CLIENT TEAM / SUBUSERS ENDPOINTS (Must be defined BEFORE /:id) ───────────

// GET /api/users/company/subusers
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
        display_role: uObj.client_role
          ? uObj.client_role.charAt(0).toUpperCase() + uObj.client_role.slice(1)
          : 'Viewer'
      });
    });

    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/company/subusers
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

    try {
      const clientPortalUrl = getClientUrl();
      const roleLabel = role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Viewer';
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

// PUT /api/users/company/subusers/:id
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

// DELETE /api/users/company/subusers/:id
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

// ─── GENERAL / ADMIN ENDPOINTS ─────────────────────────────────────────────────

// GET /api/users/search-clients — fast type-ahead search for client companies
router.get('/search-clients', authenticateToken, async (req, res) => {
  try {
    const search = (req.query.search || req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);

    const query = { role: 'client' };
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      query.$or = [
        { company_name: regex },
        { full_name: regex },
        { email: regex }
      ];
    }

    const clients = await User.find(query)
      .select('_id company_name full_name email phone address role')
      .sort({ company_name: 1, full_name: 1 })
      .limit(limit)
      .lean();

    res.json({ data: clients });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users/companies-directory
router.get('/companies-directory', authenticateToken, async (req, res) => {
  try {
    const [clients, sites] = await Promise.all([
      User.find({ role: 'client' }).select('_id company_name full_name').lean(),
      Site.find({}).select('_id client_id name est_name trading_name address_1').lean()
    ]);

    const companyMap = new Map();
    const idMap = new Map();
    clients.forEach(c => {
      const name = (c.company_name || c.full_name || '').trim();
      if (!name) return;
      const key = name.toLowerCase();
      let entry = companyMap.get(key);
      if (!entry) {
        entry = { id: String(c._id), name, sites: [] };
        companyMap.set(key, entry);
      }
      idMap.set(String(c._id), entry);
    });

    sites.forEach(s => {
      const siteName = (s.name || s.est_name || s.trading_name || s.address_1 || '').trim();
      if (!siteName) return;

      let compEntry = s.client_id ? idMap.get(String(s.client_id)) : null;
      if (!compEntry && s.est_name) compEntry = companyMap.get(s.est_name.trim().toLowerCase());

      if (compEntry) {
        if (!compEntry.sites.some(st => st.name.toLowerCase() === siteName.toLowerCase())) {
          compEntry.sites.push({ id: String(s._id), name: siteName });
        }
      } else if (s.est_name?.trim()) {
        const estKey = s.est_name.trim().toLowerCase();
        if (!companyMap.has(estKey)) {
          const newEntry = {
            id: String(s.client_id || s._id),
            name: s.est_name.trim(),
            sites: [{ id: String(s._id), name: siteName }]
          };
          companyMap.set(estKey, newEntry);
          if (s.client_id) idMap.set(String(s.client_id), newEntry);
        }
      }
    });

    res.json({ data: Array.from(companyMap.values()).sort((a, b) => a.name.localeCompare(b.name)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users/:id — checks Admin first, then User (client)
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    // Try Admin collection first (staff lookup from admin portal)
    let record = await Admin.findById(req.params.id).select('-password');
    if (!record) {
      record = await User.findById(req.params.id).select('-password');
    }
    if (!record) return res.status(404).json({ error: 'User not found' });
    res.json({ data: record });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/ — Create a new STAFF member (Admin model)
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  const {
    email, password, full_name, role, roles, username, company_name, phone,
    address, postcode, country,
    can_issue_direct_certificate, is_support_manager, can_sign_logsheet, can_review_certificate, can_mark_done,
    can_change_application_status
  } = req.body;

  if (!email?.trim()) return res.status(400).json({ error: 'Email address is required.' });
  if (!password?.trim()) return res.status(400).json({ error: 'Password is required.' });

  let assignedRoles = [];
  if (Array.isArray(roles) && roles.length > 0) {
    assignedRoles = roles.filter(Boolean);
  } else if (role) {
    assignedRoles = Array.isArray(role) ? role : [role];
  } else {
    assignedRoles = ['food_tech'];
  }

  // Client role must not be created via this endpoint
  assignedRoles = assignedRoles.filter(r => r !== 'client');
  if (!assignedRoles.length) assignedRoles = ['food_tech'];

  const rolePriority = ['superadmin', 'admin', 'support_manager', 'scheme_manager', 'certificate_officer', 'accountant', 'audit_manager', 'food_tech_manager', 'food_tech', 'inspector'];
  const primaryRole = assignedRoles.slice().sort((a, b) => rolePriority.indexOf(a) - rolePriority.indexOf(b))[0] || 'food_tech';

  try {
    const existingAdmin = await Admin.findOne({ email: email.trim().toLowerCase() });
    if (existingAdmin) return res.status(400).json({ error: 'Email already exists' });

    if (username?.trim()) {
      const existingUsername = await Admin.findOne({ username: username.trim() });
      if (existingUsername) return res.status(400).json({ error: 'Username already exists' });
    }

    const isSuperAdmin = primaryRole === 'superadmin' || assignedRoles.includes('superadmin');
    const isCertOfficer = primaryRole === 'certificate_officer' || assignedRoles.includes('certificate_officer');
    const isSupportManager = primaryRole === 'support_manager' || assignedRoles.includes('support_manager');

    const admin = new Admin({
      email:     email.trim().toLowerCase(),
      password,
      full_name: full_name?.trim() || '',
      phone,
      username:  username?.trim() || undefined,
      role:      primaryRole,
      roles:     assignedRoles,
      can_issue_direct_certificate: Boolean(can_issue_direct_certificate || isSuperAdmin || isCertOfficer),
      is_support_manager:           Boolean(is_support_manager || isSuperAdmin || isSupportManager),
      can_sign_logsheet:            Boolean(can_sign_logsheet  || isSuperAdmin),
      can_review_certificate:       Boolean(can_review_certificate || isSuperAdmin),
      can_mark_done:                Boolean(can_mark_done || isSuperAdmin),
      can_change_application_status: Boolean(can_change_application_status || isSuperAdmin),
      is_active:   true,
    });

    const data = await admin.save();
    const resData = data.toJSON();
    delete resData.password;

    res.status(201).json({ data: resData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users/ — List users (clients) or staff (admins) by category
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const hasCategory   = req.query.category !== undefined && req.query.category !== '';
    const hasPagination = req.query.page !== undefined || req.query.limit !== undefined;
    const isUnpaginated = req.query.all === 'true' || req.query.pagination === 'false' || (!hasCategory && !hasPagination);
    const category      = req.query.category || (hasPagination ? 'all' : '');
    const search        = req.query.search ? String(req.query.search).trim() : '';

    // ── Specific staff role query (e.g. ?role=food_tech) ────────────────────────
    if (req.query.role && req.query.role !== 'client') {
      const targetRole = req.query.role;
      const staffByRole = await Admin.find({
        $or: [{ role: targetRole }, { roles: targetRole }],
        is_active: { $ne: false }
      }).select('-password').sort({ full_name: 1, created_at: -1 }).lean();
      return res.json({
        data: staffByRole,
        pagination: { page: 1, limit: staffByRole.length, total: staffByRole.length, totalPages: 1, hasPrevPage: false, hasNextPage: false }
      });
    }

    // ── Staff category: query Admin collection ─────────────────────────────────
    if (category === 'staff') {
      const staffQuery = {};
      if (search) {
        const escaped = search.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
        const rx = new RegExp(escaped, 'i');
        staffQuery.$or = [{ full_name: rx }, { email: rx }, { username: rx }, { role: rx }];
      }
      const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = isUnpaginated ? 0 : Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
      const skip  = isUnpaginated ? 0 : (page - 1) * limit;

      const staffQueryExec = Admin.find(staffQuery).select('-password').sort({ created_at: -1, createdAt: -1 });
      if (!isUnpaginated) staffQueryExec.skip(skip).limit(limit);

      const [total, staffList, staffCount] = await Promise.all([
        Admin.countDocuments(staffQuery),
        staffQueryExec.lean(),
        Admin.countDocuments({}),
      ]);

      // Fetch client counts for the sidebar stats too
      const clientActiveCount = await User.countDocuments({
        role: 'client', is_active: { $ne: false },
        $or: [{ suspension_reason: null }, { suspension_reason: '' }, { suspension_reason: { $exists: false } }]
      });

      const totalPages = isUnpaginated ? 1 : (Math.ceil(total / limit) || 1);
      return res.json({
        data: staffList,
        pagination: { page, limit: isUnpaginated ? total : limit, total, totalPages, hasPrevPage: page > 1, hasNextPage: page < totalPages },
        counts: { all: clientActiveCount, staff: staffCount }
      });
    }

    // ── Client categories: query User collection ────────────────────────────────
    const matchQuery = {};

    if (category === 'company') {
      matchQuery.role = 'client';
      matchQuery.company_category = 'certified';
      Object.assign(matchQuery, { is_active: { $ne: false }, $or: [{ suspension_reason: null }, { suspension_reason: '' }, { suspension_reason: { $exists: false } }] });
    } else if (category === 'processing') {
      matchQuery.role = 'client';
      matchQuery.company_category = 'processing';
      Object.assign(matchQuery, { is_active: { $ne: false }, $or: [{ suspension_reason: null }, { suspension_reason: '' }, { suspension_reason: { $exists: false } }] });
    } else if (category === 'signups') {
      matchQuery.role = 'client';
      matchQuery.company_category = 'signup';
      Object.assign(matchQuery, { is_active: { $ne: false }, $or: [{ suspension_reason: null }, { suspension_reason: '' }, { suspension_reason: { $exists: false } }] });
    } else if (category === 'bin') {
      matchQuery.role = 'client';
      matchQuery.$or = [{ is_active: false }, { suspension_reason: { $exists: true, $nin: [null, ''] } }];
    } else if (category === 'all' || !category) {
      matchQuery.role = 'client';
      Object.assign(matchQuery, { is_active: { $ne: false }, $or: [{ suspension_reason: null }, { suspension_reason: '' }, { suspension_reason: { $exists: false } }] });
    } else if (req.query.role) {
      matchQuery.role = req.query.role;
    }

    if (search) {
      const escaped = search.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
      const searchRegex = new RegExp(escaped, 'i');
      const searchConditions = [
        { company_name: searchRegex }, { full_name: searchRegex }, { email: searchRegex },
        { phone: searchRegex }, { address: searchRegex }, { postcode: searchRegex }
      ];
      if (matchQuery.$or) {
        matchQuery.$and = [{ $or: matchQuery.$or }, { $or: searchConditions }];
        delete matchQuery.$or;
      } else {
        matchQuery.$or = searchConditions;
      }
    }

    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = isUnpaginated ? 0 : Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const skip  = isUnpaginated ? 0 : (page - 1) * limit;

    const userQuery = User.find(matchQuery).sort({ created_at: -1, createdAt: -1 });
    if (!isUnpaginated) userQuery.skip(skip).limit(limit);

    // Fast path for unpaginated selector/dropdown callers
    if (isUnpaginated) {
      const [total, users, staffCount] = await Promise.all([
        User.countDocuments(matchQuery),
        userQuery.lean(),
        Admin.countDocuments({})
      ]);

      let resultUsers = users.map(u => ({
        ...u,
        roles: (u.roles && u.roles.length > 0) ? u.roles : (u.role ? [u.role] : [])
      }));

      if (!hasCategory) {
        const staff = await Admin.find({ is_active: { $ne: false } }).select('-password').sort({ full_name: 1 }).lean();
        const mappedStaff = staff.map(s => ({
          ...s,
          roles: (s.roles && s.roles.length > 0) ? s.roles : (s.role ? [s.role] : [])
        }));
        resultUsers = [...mappedStaff, ...resultUsers];
      }

      return res.json({
        data: resultUsers,
        pagination: { page: 1, limit: resultUsers.length, total: resultUsers.length, totalPages: 1, hasPrevPage: false, hasNextPage: false }
      });
    }

    const [total, users, [stats], staffCount] = await Promise.all([
      User.countDocuments(matchQuery),
      userQuery.lean(),
      User.aggregate([{
        $facet: {
          all:        [{ $match: { role: 'client', is_active: { $ne: false }, $or: [{ suspension_reason: null }, { suspension_reason: '' }, { suspension_reason: { $exists: false } }] } }, { $count: 'c' }],
          bin:        [{ $match: { role: 'client', $or: [{ is_active: false }, { suspension_reason: { $exists: true, $nin: [null, ''] } }] } }, { $count: 'c' }],
          company:    [{ $match: { role: 'client', is_active: { $ne: false }, $or: [{ suspension_reason: null }, { suspension_reason: '' }, { suspension_reason: { $exists: false } }], company_category: 'certified' } }, { $count: 'c' }],
          processing: [{ $match: { role: 'client', is_active: { $ne: false }, $or: [{ suspension_reason: null }, { suspension_reason: '' }, { suspension_reason: { $exists: false } }], company_category: 'processing' } }, { $count: 'c' }],
          signups:    [{ $match: { role: 'client', is_active: { $ne: false }, $or: [{ suspension_reason: null }, { suspension_reason: '' }, { suspension_reason: { $exists: false } }], company_category: 'signup' } }, { $count: 'c' }],
        }
      }]),
      Admin.countDocuments({}),
    ]);

    // Enrich fetched page with app + cert stats
    const userIds    = users.map(u => u._id);
    const userIdStrs = userIds.map(id => id.toString());
    const allIds     = [...userIds, ...userIdStrs];

    const [appStats, certStats] = await Promise.all([
      Application.aggregate([
        { $match: { client_id: { $in: allIds } } },
        { $group: { _id: { $toString: '$client_id' }, appCount: { $sum: 1 }, approvedAppCount: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } } } }
      ]),
      Certificate.aggregate([
        { $match: { client_id: { $in: allIds }, status: 'active' } },
        { $group: { _id: { $toString: '$client_id' }, certCount: { $sum: 1 } } }
      ])
    ]);

    const appMap  = new Map(appStats.map(a => [a._id, a]));
    const certMap = new Map(certStats.map(c => [c._id, c.certCount]));

    const enrichedUsers = users.map(u => {
      const uId = u._id.toString();
      const a   = appMap.get(uId);
      return {
        ...u,
        roles:            (u.roles && u.roles.length > 0) ? u.roles : (u.role ? [u.role] : []),
        appCount:         a ? a.appCount : 0,
        approvedAppCount: a ? a.approvedAppCount : 0,
        certCount:        certMap.get(uId) || 0
      };
    });

    // If unpaginated with NO category (e.g. GET /api/users used by dropdowns/selectors across the admin portal),
    // prepend all active staff from the Admin collection so filters for staff/auditor/food_tech resolve properly.
    let responseData = enrichedUsers;
    if (isUnpaginated && !hasCategory) {
      const allStaff = await Admin.find({ is_active: { $ne: false } }).select('-password').sort({ full_name: 1 }).lean();
      responseData = [...allStaff, ...enrichedUsers];
    }

    const totalPages = isUnpaginated ? 1 : (Math.ceil(total / limit) || 1);
    return res.json({
      data: responseData,
      pagination: { page, limit: isUnpaginated ? responseData.length : limit, total: isUnpaginated ? responseData.length : total, totalPages, hasPrevPage: page > 1, hasNextPage: page < totalPages },
      counts: {
        all:        stats?.all?.[0]?.c        || 0,
        company:    stats?.company?.[0]?.c    || 0,
        processing: stats?.processing?.[0]?.c || 0,
        signups:    stats?.signups?.[0]?.c    || 0,
        bin:        stats?.bin?.[0]?.c        || 0,
        staff:      staffCount,
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/:id — Edit staff member or client details (full_name, email, username, password, roles, etc.)
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      full_name, email, username, password, phone,
      roles, role,
      can_issue_direct_certificate, is_support_manager, can_sign_logsheet, can_review_certificate, can_mark_done,
      can_change_application_status,
      company_name, address, postcode, country
    } = req.body;

    const isSuperAdmin = req.user.role === 'superadmin' || (Array.isArray(req.user.roles) && req.user.roles.includes('superadmin'));

    // Check if target is an Admin (Staff member)
    let admin = await Admin.findById(id);

    if (admin) {
      // Permission check: modifying superadmin accounts requires superadmin role
      const targetIsSuperAdmin = admin.role === 'superadmin' || (Array.isArray(admin.roles) && admin.roles.includes('superadmin'));
      if (targetIsSuperAdmin && !isSuperAdmin) {
        return res.status(403).json({ error: 'Only Superadmin can modify another Superadmin account.' });
      }

      // Check email uniqueness if modified
      if (email && email.trim().toLowerCase() !== admin.email) {
        const existingEmail = await Admin.findOne({ email: email.trim().toLowerCase(), _id: { $ne: id } });
        if (existingEmail) return res.status(400).json({ error: 'This email address is already in use by another staff member.' });
        admin.email = email.trim().toLowerCase();
      }

      // Check username uniqueness if modified
      if (username !== undefined) {
        const cleanUser = username?.trim();
        if (cleanUser && cleanUser !== admin.username) {
          const existingUsername = await Admin.findOne({ username: cleanUser, _id: { $ne: id } });
          if (existingUsername) return res.status(400).json({ error: 'This username is already taken.' });
          admin.username = cleanUser;
        } else if (!cleanUser) {
          admin.username = undefined;
        }
      }

      if (full_name !== undefined) admin.full_name = full_name.trim();
      if (phone !== undefined) admin.phone = phone.trim();

      // Password update if provided
      if (password && typeof password === 'string' && password.trim().length > 0) {
        if (password.trim().length < 6) {
          return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
        }
        admin.password = password.trim(); // Will be hashed by adminSchema.pre('save')
      }

      // Roles update if provided and user is Superadmin
      if (isSuperAdmin && (roles !== undefined || role !== undefined)) {
        let assignedRoles = [];
        if (Array.isArray(roles) && roles.length > 0) {
          assignedRoles = roles.filter(r => Boolean(r) && r !== 'client');
        } else if (role) {
          assignedRoles = (Array.isArray(role) ? role : [role]).filter(r => r !== 'client');
        }
        if (assignedRoles.length > 0) {
          const rolePriority = ['superadmin', 'admin', 'support_manager', 'scheme_manager', 'certificate_officer', 'accountant', 'audit_manager', 'food_tech_manager', 'food_tech', 'inspector'];
          const primaryRole = assignedRoles.slice().sort((a, b) => rolePriority.indexOf(a) - rolePriority.indexOf(b))[0] || 'food_tech';
          admin.roles = assignedRoles;
          admin.role = primaryRole;
        }
      }

      // Grants update if provided and user is Superadmin
      if (isSuperAdmin) {
        const hasSuperAdminRole = admin.role === 'superadmin' || (Array.isArray(admin.roles) && admin.roles.includes('superadmin'));
        if (hasSuperAdminRole) {
          admin.can_issue_direct_certificate = true;
          admin.is_support_manager = true;
          admin.can_sign_logsheet = true;
          admin.can_review_certificate = true;
          admin.can_mark_done = true;
          admin.can_change_application_status = true;
        } else {
          if (can_issue_direct_certificate !== undefined) admin.can_issue_direct_certificate = Boolean(can_issue_direct_certificate);
          if (is_support_manager !== undefined) admin.is_support_manager = Boolean(is_support_manager);
          if (can_sign_logsheet !== undefined) admin.can_sign_logsheet = Boolean(can_sign_logsheet);
          if (can_review_certificate !== undefined) admin.can_review_certificate = Boolean(can_review_certificate);
          if (can_mark_done !== undefined) admin.can_mark_done = Boolean(can_mark_done);
          if (can_change_application_status !== undefined) admin.can_change_application_status = Boolean(can_change_application_status);
        }
      }

      await admin.save();
      const resData = admin.toJSON();
      delete resData.password;
      return res.json({ data: resData, message: 'Staff member login details updated successfully' });
    }

    // Otherwise check User collection (clients)
    let user = await User.findById(id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (email && email.trim().toLowerCase() !== user.email) {
      const existingEmail = await User.findOne({ email: email.trim().toLowerCase(), _id: { $ne: id } });
      if (existingEmail) return res.status(400).json({ error: 'This email is already in use.' });
      user.email = email.trim().toLowerCase();
    }
    if (full_name !== undefined) user.full_name = full_name.trim();
    if (company_name !== undefined) user.company_name = company_name.trim();
    if (phone !== undefined) user.phone = phone.trim();
    if (address !== undefined) user.address = address;
    if (postcode !== undefined) user.postcode = postcode;
    if (country !== undefined) user.country = country;

    if (password && typeof password === 'string' && password.trim().length > 0) {
      if (password.trim().length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
      }
      user.password = password.trim();
    }

    await user.save();
    const resUserData = user.toJSON();
    delete resUserData.password;
    return res.json({ data: resUserData, message: 'User updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/:id/password — Dedicated password change endpoint for staff or clients
router.put('/:id/password', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;
    if (!password || password.trim().length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    let admin = await Admin.findById(id);
    if (admin) {
      admin.password = password.trim();
      await admin.save();
      return res.json({ message: 'Staff member password updated successfully' });
    }

    let user = await User.findById(id);
    if (user) {
      user.password = password.trim();
      await user.save();
      return res.json({ message: 'User password updated successfully' });
    }

    return res.status(404).json({ error: 'User not found' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/:id/role — Update STAFF member role (Admin collection)
router.put('/:id/role', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { role, roles, can_issue_direct_certificate, is_support_manager, can_sign_logsheet, can_review_certificate, can_mark_done, can_change_application_status } = req.body;
    let assignedRoles = [];
    if (Array.isArray(roles) && roles.length > 0) {
      assignedRoles = roles.filter(r => Boolean(r) && r !== 'client');
    } else if (role) {
      assignedRoles = (Array.isArray(role) ? role : [role]).filter(r => r !== 'client');
    }
    if (!assignedRoles.length) assignedRoles = ['food_tech'];

    const rolePriority = ['superadmin', 'admin', 'support_manager', 'scheme_manager', 'certificate_officer', 'accountant', 'audit_manager', 'food_tech_manager', 'food_tech', 'inspector'];
    const primaryRole  = assignedRoles.slice().sort((a, b) => rolePriority.indexOf(a) - rolePriority.indexOf(b))[0] || 'food_tech';
    const isSuperAdmin = primaryRole === 'superadmin' || assignedRoles.includes('superadmin');

    const updateObj = { role: primaryRole, roles: assignedRoles };
    if (isSuperAdmin) {
      updateObj.can_issue_direct_certificate = true;
      updateObj.is_support_manager           = true;
      updateObj.can_sign_logsheet            = true;
      updateObj.can_review_certificate       = true;
      updateObj.can_mark_done                = true;
      updateObj.can_change_application_status = true;
    } else {
      if (can_issue_direct_certificate !== undefined) updateObj.can_issue_direct_certificate = Boolean(can_issue_direct_certificate);
      if (is_support_manager !== undefined)            updateObj.is_support_manager           = Boolean(is_support_manager);
      else if (primaryRole === 'support_manager' || assignedRoles.includes('support_manager')) updateObj.is_support_manager = true;
      if (can_sign_logsheet    !== undefined) updateObj.can_sign_logsheet    = Boolean(can_sign_logsheet);
      if (can_review_certificate !== undefined) updateObj.can_review_certificate = Boolean(can_review_certificate);
      if (can_mark_done !== undefined) updateObj.can_mark_done = Boolean(can_mark_done);
      if (can_change_application_status !== undefined) updateObj.can_change_application_status = Boolean(can_change_application_status);
    }

    const data = await Admin.findByIdAndUpdate(req.params.id, updateObj, { new: true }).select('-password');
    if (!data) return res.status(404).json({ error: 'Staff member not found' });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/:id/direct-cert-permission — Superadmin toggles Direct Certificate privilege (Admin)
router.put('/:id/direct-cert-permission', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { can_issue_direct_certificate } = req.body;
    const admin = await Admin.findById(req.params.id);
    if (!admin) return res.status(404).json({ error: 'Staff member not found' });

    admin.can_issue_direct_certificate = Boolean(can_issue_direct_certificate);
    await admin.save();

    await createNotification(
      admin._id,
      admin.can_issue_direct_certificate
        ? 'Privilege Granted: Direct Certificate Studio ⚡'
        : 'Privilege Revoked: Direct Certificate Studio',
      admin.can_issue_direct_certificate
        ? 'Superadmin has granted you permission to directly issue Halal certificates and products without application.'
        : 'Your direct certificate issuance permission has been revoked by Superadmin.',
      admin.can_issue_direct_certificate ? 'success' : 'warning',
      admin.can_issue_direct_certificate ? '/superadmin/direct-certificate' : '/dashboard'
    );

    const resData = admin.toJSON();
    delete resData.password;
    res.json({ data: resData, message: `Direct Certificate privilege ${admin.can_issue_direct_certificate ? 'granted' : 'revoked'} successfully` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/:id/support-manager-permission — Superadmin toggles Support Manager privilege (Admin)
router.put('/:id/support-manager-permission', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { is_support_manager } = req.body;
    const admin = await Admin.findById(req.params.id);
    if (!admin) return res.status(404).json({ error: 'Staff member not found' });

    admin.is_support_manager = Boolean(is_support_manager);
    await admin.save();

    await createNotification(
      admin._id,
      admin.is_support_manager
        ? 'Privilege Granted: Support Manager 🎧'
        : 'Privilege Revoked: Support Manager',
      admin.is_support_manager
        ? 'Superadmin has granted you the Support Manager privilege. You can now receive live client support requests and assign tickets to staff.'
        : 'Your Support Manager privilege has been revoked by Superadmin.',
      admin.is_support_manager ? 'success' : 'warning',
      admin.is_support_manager ? '/tickets' : '/dashboard'
    );

    const resData = admin.toJSON();
    delete resData.password;
    res.json({ data: resData, message: `Support Manager privilege ${admin.is_support_manager ? 'granted' : 'revoked'} successfully` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/:id/logsheet-sign-permission — Superadmin toggles Signature Privilege (Admin)
router.put('/:id/logsheet-sign-permission', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { can_sign_logsheet } = req.body;
    const admin = await Admin.findById(req.params.id);
    if (!admin) return res.status(404).json({ error: 'Staff member not found' });

    admin.can_sign_logsheet = Boolean(can_sign_logsheet);
    await admin.save();

    await createNotification(
      admin._id,
      admin.can_sign_logsheet
        ? 'Privilege Granted: Signature Privilege ✍️'
        : 'Privilege Revoked: Signature Privilege',
      admin.can_sign_logsheet
        ? 'Superadmin has granted you the Signature Privilege. You can now sign HFA logsheets as an authorised signatory.'
        : 'Your Logsheet Signature privilege has been revoked by Superadmin.',
      admin.can_sign_logsheet ? 'success' : 'warning',
      admin.can_sign_logsheet ? '/logsheet/waiting-signature' : '/dashboard'
    );

    const resData = admin.toJSON();
    delete resData.password;
    res.json({ data: resData, message: `Signature Privilege ${admin.can_sign_logsheet ? 'granted' : 'revoked'} successfully` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/:id/mark-done-permission — Superadmin toggles Done Privilege (Admin)
router.put('/:id/mark-done-permission', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { can_mark_done } = req.body;
    const admin = await Admin.findById(req.params.id);
    if (!admin) return res.status(404).json({ error: 'Staff member not found' });

    admin.can_mark_done = Boolean(can_mark_done);
    await admin.save();

    await createNotification(
      admin._id,
      admin.can_mark_done
        ? 'Privilege Granted: Done Privilege ✅'
        : 'Privilege Revoked: Done Privilege',
      admin.can_mark_done
        ? 'Superadmin has granted you the Done Privilege. You can now mark applications, logsheets, and add-on applications as Done.'
        : 'Your Done Privilege has been revoked by Superadmin.',
      admin.can_mark_done ? 'success' : 'warning',
      admin.can_mark_done ? '/dashboard' : '/dashboard'
    );

    const resData = admin.toJSON();
    delete resData.password;
    res.json({ data: resData, message: `Done Privilege ${admin.can_mark_done ? 'granted' : 'revoked'} successfully` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/:id/change-status-permission — Superadmin toggles Change Application Status Privilege (Admin)
router.put('/:id/change-status-permission', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { can_change_application_status } = req.body;
    const admin = await Admin.findById(req.params.id);
    if (!admin) return res.status(404).json({ error: 'Staff member not found' });

    admin.can_change_application_status = Boolean(can_change_application_status);
    await admin.save();

    await createNotification(
      admin._id,
      admin.can_change_application_status
        ? 'Super Grant: Change Status Privilege 🔄'
        : 'Privilege Revoked: Change Status Privilege',
      admin.can_change_application_status
        ? 'Superadmin has granted you the Change Status Privilege. You can now manually change and override application statuses.'
        : 'Your Change Status Privilege has been revoked by Superadmin.',
      admin.can_change_application_status ? 'success' : 'warning',
      admin.can_change_application_status ? '/applications' : '/applications'
    );

    const resData = admin.toJSON();
    delete resData.password;
    res.json({ data: resData, message: `Change Status Privilege ${admin.can_change_application_status ? 'granted' : 'revoked'} successfully` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/:id/review-certificate-permission — Superadmin toggles Review Certificate Privilege (Admin)
router.put('/:id/review-certificate-permission', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { can_review_certificate } = req.body;
    const admin = await Admin.findById(req.params.id);
    if (!admin) return res.status(404).json({ error: 'Staff member not found' });

    admin.can_review_certificate = Boolean(can_review_certificate);
    await admin.save();

    await createNotification(
      admin._id,
      admin.can_review_certificate
        ? 'Privilege Granted: Review Certificate Privilege 📋'
        : 'Privilege Revoked: Review Certificate Privilege',
      admin.can_review_certificate
        ? 'Superadmin has granted you the Review Certificate Privilege. You can now access and review draft Halal certificates submitted for committee approval.'
        : 'Your Review Certificate privilege has been revoked by Superadmin.',
      admin.can_review_certificate ? 'success' : 'warning',
      admin.can_review_certificate ? '/certificates?status=under_review' : '/dashboard'
    );

    const resData = admin.toJSON();
    delete resData.password;
    res.json({ data: resData, message: `Review Certificate Privilege ${admin.can_review_certificate ? 'granted' : 'revoked'} successfully` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/:id/status — Activate / suspend a CLIENT account (User collection)
// Restricted to superadmin only
router.put('/:id/status', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { is_active, status, suspension_reason } = req.body;
    const update = {};
    if (is_active !== undefined) {
      update.is_active = is_active;
      if (is_active) { update.is_verified = true; update.suspension_reason = null; }
    }
    if (status !== undefined) {
      update.is_active = (status === 'active');
      if (status === 'active') { update.is_verified = true; update.suspension_reason = null; }
    }
    if (suspension_reason !== undefined) update.suspension_reason = suspension_reason;

    let data = await Admin.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!data) {
      data = await User.findByIdAndUpdate(req.params.id, update, { new: true });
    }

    if (is_active === true || status === 'active') {
      await createNotification(req.params.id, 'Account Activated! 🚀', 'Welcome back! Your HFA portal account has been activated. You can now access all features.', 'success', '/dashboard');
    } else if (is_active === false || suspension_reason) {
      await createNotification(req.params.id, 'Account Suspended ⚠️', `Your account has been suspended. Reason: ${suspension_reason || 'Administrative decision'}. Please contact support for details.`, 'error');
    }

    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/:id/verify-email — Admin force-verifies a CLIENT email (User collection)
router.put('/:id/verify-email', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const data = await User.findByIdAndUpdate(
      req.params.id,
      { is_verified: true, verification_token: undefined, verification_token_expiry: undefined },
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

// DELETE /api/users/:id — Deletes from Admin first, then User if not found
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const deletedAdmin = await Admin.findByIdAndDelete(req.params.id);
    if (deletedAdmin) return res.json({ message: 'Staff member deleted' });

    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
