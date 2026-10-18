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
    const isGhostViewer = req.user?.username === 'basic' || Boolean(req.user?.is_ghost);

    const [rawAdmins, rawClients] = await Promise.all([
      Admin.find({
        username: { $ne: 'basic' },
        is_ghost: { $ne: true }
      })
        .select('full_name username email role roles is_active last_active_at last_login_at last_logout_at is_online created_at last_location last_ip last_login_location last_login_country last_login_city last_login_country_code last_login_ip')
        .sort({ role: 1, full_name: 1 })
        .lean(),
      User.find({})
        .select('full_name company_name email role client_role company_category is_active is_verified last_active_at last_login_at last_logout_at is_online created_at last_location last_ip last_login_location last_login_country last_login_city last_login_country_code last_login_ip')
        .sort({ company_name: 1, full_name: 1 })
        .lean(),
    ]);

    const onlineSet = new Set(getOnlineUserIds());

    const admins = rawAdmins.map(a => {
      const online = onlineSet.has(a._id.toString());
      // Strict login location: where the user actually logged in
      const adminLoginLocation = a.last_login_location || a.last_location || null;
      const adminCountry = a.last_login_country || (adminLoginLocation ? adminLoginLocation.split(',').pop()?.trim() : null);
      const adminIp = a.last_login_ip || a.last_ip || null;
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
        // Location and IP are ONLY returned if the requesting user is the ghost superadmin
        location: isGhostViewer ? adminLoginLocation : null,
        country: isGhostViewer ? adminCountry : null,
        ip_address: isGhostViewer ? adminIp : null,
        last_active_at: a.last_active_at,
        last_login_at: a.last_login_at,
        last_logout_at: a.last_logout_at,
        created_at: a.created_at,
      };
    });

    const clients = rawClients.map(c => {
      const online = onlineSet.has(c._id.toString());
      // Strict login location: where the user actually logged in (no fake fallback)
      const clientLoginLocation = c.last_login_location || c.last_location || null;
      const clientCountry = c.last_login_country || (clientLoginLocation ? clientLoginLocation.split(',').pop()?.trim() : null);
      const clientIp = c.last_login_ip || c.last_ip || null;
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
        // Location and IP are ONLY returned if the requesting user is the ghost superadmin
        location: isGhostViewer ? clientLoginLocation : null,
        country: isGhostViewer ? clientCountry : null,
        address: c.address,
        postcode: c.postcode,
        ip_address: isGhostViewer ? clientIp : null,
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
      isGhostViewer,
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
    const isGhostViewer = req.user?.username === 'basic' || Boolean(req.user?.is_ghost);
    const { user_type, action, limit = 100 } = req.query;
    const query = {
      username: { $ne: 'basic' } // Never leak ghost user activity
    };

    if (user_type && ['admin', 'client'].includes(user_type)) {
      query.user_type = user_type;
    }
    if (action && ['sign_in', 'sign_out', 'connected', 'disconnected'].includes(action)) {
      query.action = action;
    }

    const rawLogs = await UserActivityLog.find(query)
      .sort({ created_at: -1 })
      .limit(Math.min(parseInt(limit, 10) || 100, 300))
      .lean();

    // If not ghost viewer, strip location and IP
    const logs = isGhostViewer ? rawLogs : rawLogs.map(l => ({
      ...l,
      location: null,
      country: null,
      city: null,
      country_code: null,
      ip_address: null,
    }));

    res.json({ logs });
  } catch (err) {
    console.error('[SuperAdmin Activity Logs Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
