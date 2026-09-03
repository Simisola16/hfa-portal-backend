import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import dotenv from 'dotenv';

dotenv.config();

export const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.split(' ')[1]) || req.query?.token;

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    
    if (!user) {
      return res.status(401).json({ error: 'User not found or token invalid' });
    }

    if (user.role !== 'admin' && user.role !== 'superadmin' && user.is_active === false) {
      // Scoped bypass for inactive clients:
      // - All GET requests (allows profile, site, product, notifications, and stats viewing)
      // - All site management requests (POST, PUT, DELETE to /api/sites)
      // - All product management requests (POST, PUT, DELETE to /api/products)
      const isGet = req.method === 'GET';
      const isSites = req.baseUrl === '/api/sites';
      const isProducts = req.baseUrl === '/api/products';

      if (!isGet && !isSites && !isProducts) {
        return res.status(403).json({ error: 'Your account is pending admin activation. Please wait for approval.' });
      }
    }
    
    req.user = user;
    if (decoded.is_impersonation) {
      req.user.is_impersonation = true;
      req.user.impersonated_by = decoded.impersonated_by;
      req.user.admin_name = decoded.admin_name;
      req.is_impersonation = true;
      req.impersonated_by = decoded.impersonated_by;
    }
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token verification failed' });
  }
};

const userHasRole = (user, ...allowedRoles) => {
  if (!user) return false;
  if (user.role === 'superadmin' || user.roles?.includes('superadmin')) return true;
  if (allowedRoles.includes(user.role)) return true;
  if (Array.isArray(user.roles) && user.roles.some(r => allowedRoles.includes(r))) return true;
  return false;
};

export const requireSuperAdmin = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  if (req.user.role !== 'superadmin' && !req.user.roles?.includes('superadmin')) {
    return res.status(403).json({ error: 'Superadmin access required' });
  }
  next();
};

export const requireDirectCertificatePermission = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const hasPermission = userHasRole(req.user, 'superadmin', 'certificate_officer') || req.user.can_issue_direct_certificate === true;
  if (!hasPermission) {
    return res.status(403).json({ error: 'Direct certificate issuance privilege required. Contact Superadmin for access.' });
  }
  next();
};

export const requireAdmin = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  if (!userHasRole(req.user, 'admin', 'superadmin', 'scheme_manager', 'certificate_officer', 'accountant', 'audit_manager', 'food_tech_manager')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

export const requireSchemeManager = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!userHasRole(req.user, 'scheme_manager', 'admin', 'superadmin')) {
    return res.status(403).json({ error: 'Scheme Manager or Admin access required' });
  }
  next();
};

export const requireCertificateOfficer = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!userHasRole(req.user, 'certificate_officer', 'admin', 'superadmin') && !req.user.can_issue_direct_certificate) {
    return res.status(403).json({ error: 'Certificate Officer or Admin access required' });
  }
  next();
};

export const requireAccountant = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!userHasRole(req.user, 'accountant', 'admin', 'superadmin')) {
    return res.status(403).json({ error: 'Accountant or Admin access required' });
  }
  next();
};

export const requireClient = async (req, res, next) => {
  if (!req.user || (req.user.role !== 'client' && !req.user.roles?.includes('client'))) {
    return res.status(403).json({ error: 'Client access required' });
  }
  next();
};

export const requireFoodTechManager = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!userHasRole(req.user, 'food_tech_manager')) {
    return res.status(403).json({ error: 'Food Tech Manager access required' });
  }
  next();
};

export const requireFoodTechManagerOrAdmin = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!userHasRole(req.user, 'food_tech_manager', 'admin', 'superadmin', 'food_tech', 'scheme_manager')) {
    return res.status(403).json({ error: 'Access denied. Food Tech Manager or Admin role required.' });
  }
  next();
};

export const requireFoodTech = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!userHasRole(req.user, 'food_tech', 'food_tech_manager', 'admin', 'superadmin')) {
    return res.status(403).json({ error: 'Food Tech access required' });
  }
  next();
};

export const requireAuditManager = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!userHasRole(req.user, 'audit_manager', 'admin', 'superadmin')) {
    return res.status(403).json({ error: 'Audit Manager or Admin access required' });
  }
  next();
};

export const requireStaff = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const isStaff = userHasRole(
    req.user,
    'admin',
    'superadmin',
    'scheme_manager',
    'certificate_officer',
    'accountant',
    'audit_manager',
    'food_tech_manager',
    'food_tech',
    'inspector'
  );
  if (!isStaff) {
    return res.status(403).json({ error: 'Staff access required' });
  }
  next();
};
