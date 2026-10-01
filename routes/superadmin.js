import express from 'express';
import Admin from '../models/Admin.js';
import User from '../models/User.js';
import UserActivityLog from '../models/UserActivityLog.js';
import { authenticateToken, requireSuperAdmin } from '../middleware/auth.js';
import { isUserOnline, getOnlineUserIds } from '../lib/socket.js';

const router = express.Router();

/**
 * GET /api/superadmin/presence
 * Live presence breakdown of all staff admins and clients.
 * Exclusively accessible by Super Admin.
 */
router.get('/presence', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const [rawAdmins, rawClients] = await Promise.all([
      Admin.find({})
        .select('full_name username email role roles is_active last_active_at last_login_at last_logout_at is_online created_at')
        .sort({ role: 1, full_name: 1 })
        .lean(),
      User.find({})
        .select('full_name company_name email role client_role company_category is_active is_verified last_active_at last_login_at last_logout_at is_online created_at')
        .sort({ company_name: 1, full_name: 1 })
        .lean(),
    ]);

    const onlineSet = new Set(getOnlineUserIds());

    const admins = rawAdmins.map(a => {
      const online = onlineSet.has(a._id.toString());
      return {
        id: a._id,
        _id: a._id,
        name: a.full_name || a.username || 'Staff Member',
        username: a.username,
        email: a.email,
        role: a.role,
        roles: a.roles || [a.role],
        user_type: 'admin',
        is_active: a.is_active !== false,
        is_online: online,
        last_active_at: a.last_active_at,
        last_login_at: a.last_login_at,
        last_logout_at: a.last_logout_at,
        created_at: a.created_at,
      };
    });

    const clients = rawClients.map(c => {
      const online = onlineSet.has(c._id.toString());
      return {
        id: c._id,
        _id: c._id,
        name: c.company_name || c.full_name || c.email,
        full_name: c.full_name,
        company_name: c.company_name,
        email: c.email,
        role: 'client',
        client_role: c.client_role || 'member',
        company_category: c.company_category || 'signup',
        user_type: 'client',
        is_active: c.is_active !== false,
        is_verified: Boolean(c.is_verified),
        is_online: online,
        last_active_at: c.last_active_at,
        last_login_at: c.last_login_at,
        last_logout_at: c.last_logout_at,
        created_at: c.created_at,
      };
    });

    const onlineAdmins = admins.filter(a => a.is_online);
    const offlineAdmins = admins.filter(a => !a.is_online);
    const onlineClients = clients.filter(c => c.is_online);
    const offlineClients = clients.filter(c => !c.is_online);

    const summary = {
      totalUsers: admins.length + clients.length,
      totalOnline: onlineAdmins.length + onlineClients.length,
      totalOffline: offlineAdmins.length + offlineClients.length,
      adminCount: admins.length,
      onlineAdminsCount: onlineAdmins.length,
      offlineAdminsCount: offlineAdmins.length,
      clientCount: clients.length,
      onlineClientsCount: onlineClients.length,
      offlineClientsCount: offlineClients.length,
    };

    res.json({
      summary,
      admins,
      clients,
      timestamp: new Date(),
    });
  } catch (err) {
    console.error('[SuperAdmin Presence Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/superadmin/activity-logs
 * Real-time and historical sign-in and sign-out audit logs.
 * Exclusively accessible by Super Admin.
 */
router.get('/activity-logs', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { user_type, action, limit = 100 } = req.query;
    const query = {};

    if (user_type && ['admin', 'client'].includes(user_type)) {
      query.user_type = user_type;
    }
    if (action && ['sign_in', 'sign_out', 'connected', 'disconnected'].includes(action)) {
      query.action = action;
    }

    const logs = await UserActivityLog.find(query)
      .sort({ created_at: -1 })
      .limit(Math.min(parseInt(limit, 10) || 100, 300))
      .lean();

    res.json({ logs });
  } catch (err) {
    console.error('[SuperAdmin Activity Logs Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
