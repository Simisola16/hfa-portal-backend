import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Returns all valid representations of client IDs for a user and their parent company.
 */
export const getAllowedClientIds = (user) => {
  if (!user) return [];
  const ids = [user._id || user.id].filter(Boolean);
  if (user.parent_client_id) {
    ids.push(user.parent_client_id);
  }
  const strIds = ids.map(id => id.toString());
  const objIds = ids
    .filter(id => mongoose.isValidObjectId(id))
    .map(id => new mongoose.Types.ObjectId(id.toString()));
  return [...new Set([...strIds, ...objIds])];
};

/**
 * Returns the effective company ID for a user.
 */
export const getEffectiveClientId = (user) => {
  if (!user) return null;
  return user.parent_client_id || user._id || user.id;
};

const JWT_SECRET = process.env.JWT_SECRET || 'hfa_portal_secret_key_2024_@!';

/**
 * Resolves the correct Mongoose model from a decoded JWT.
 * - Admin tokens carry { modelType: 'Admin' }
 * - Client tokens carry { modelType: 'User' }
 * - Legacy tokens (no modelType) fall back: check Admin first, then User.
 */
async function resolveUserFromToken(decoded) {
  if (decoded.modelType === 'Admin') {
    return await Admin.findById(decoded.id);
  }
  if (decoded.modelType === 'User') {
    return await User.findById(decoded.id);
  }
  // Legacy token fallback — try Admin first (staff tokens are more sensitive)
  const admin = await Admin.findById(decoded.id);
  if (admin) return admin;
  return await User.findById(decoded.id);
}

export const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.split(' ')[1]) || req.query?.token;

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await resolveUserFromToken(decoded);

    if (!user) {
      return res.status(401).json({ error: 'User not found or token invalid' });
    }

    // Inactive client accounts have limited access (admins are always allowed through)
    const isAdminAccount = decoded.modelType === 'Admin' || (user.constructor.modelName === 'Admin');
    if (!isAdminAccount && user.is_active === false) {
      const isGet      = req.method === 'GET';
      const isSites    = req.baseUrl === '/api/sites';
      const isProducts = req.baseUrl === '/api/products';
      if (!isGet && !isSites && !isProducts) {
        return res.status(403).json({ error: 'Your account is pending admin activation. Please wait for approval.' });
      }
    }

    req.user = user;
    // Expose a flag so downstream middleware knows which model was resolved
    req.userModelType = isAdminAccount ? 'Admin' : 'User';
    req.effectiveClientId = user.parent_client_id || user._id;
    req.isTeamMember = Boolean(user.parent_client_id);

    if (decoded.is_impersonation) {
      req.user.is_impersonation  = true;
      req.user.impersonated_by   = decoded.impersonated_by;
      req.user.admin_name        = decoded.admin_name;
      req.is_impersonation       = true;
      req.impersonated_by        = decoded.impersonated_by;
    }

    next();
  } catch {
    return res.status(401).json({ error: 'Token verification failed' });
  }
};

export const userHasRole = (user, ...allowedRoles) => {
  if (!user) return false;
  if (user.role === 'superadmin' || user.roles?.includes('superadmin')) return true;
  if (allowedRoles.includes(user.role)) return true;
  if (Array.isArray(user.roles) && user.roles.some(r => allowedRoles.includes(r))) return true;
  return false;
};

export const isStaffUser = (user, userModelType) => {
  if (!user) return false;
  if (userModelType === 'Admin') return true;
  return userHasRole(
    user,
    'admin', 'superadmin', 'scheme_manager', 'certificate_officer',
    'accountant', 'audit_manager', 'food_tech_manager', 'food_tech',
    'inspector', 'auditor', 'staff', 'support_manager'
  );
};

export const requireSuperAdmin = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.user.role !== 'superadmin' && !req.user.roles?.includes('superadmin')) {
    return res.status(403).json({ error: 'Superadmin access required' });
  }
  next();
};

export const requireDirectCertificatePermission = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const hasPermission =
    userHasRole(req.user, 'superadmin', 'certificate_officer') ||
    req.user.can_issue_direct_certificate === true;
  if (!hasPermission) {
    return res.status(403).json({ error: 'Direct certificate issuance privilege required. Contact Superadmin for access.' });
  }
  next();
};

export const requireSignaturePrivilege = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const isSuperAdmin = req.user.role === 'superadmin' || req.user.roles?.includes('superadmin');
  if (!isSuperAdmin && !req.user.can_sign_logsheet) {
    return res.status(403).json({
      error: 'Access denied. You do not have the Signature Privilege required to sign logsheets. Please contact a Superadmin to grant you this privilege.',
    });
  }
  next();
};

export const requireReviewCertificatePrivilege = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const isSuperAdmin = req.user.role === 'superadmin' || req.user.roles?.includes('superadmin');
  if (!isSuperAdmin && !req.user.can_review_certificate && !userHasRole(req.user, 'certificate_officer')) {
    return res.status(403).json({
      error: 'Access denied. You do not have the Review Certificate Privilege required to access, review, or send certificates. Please contact a Superadmin for access.',
    });
  }
  next();
};

export const requireChangeStatusPrivilege = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const isSuperAdmin = req.user.role === 'superadmin' || (Array.isArray(req.user.roles) && req.user.roles.includes('superadmin'));
  if (!isSuperAdmin && !req.user.can_change_application_status) {
    return res.status(403).json({
      error: 'Access denied. You do not have the Change Status Privilege. Please contact a Superadmin to grant you this privilege.',
    });
  }
  next();
};

export const requireAdmin = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!userHasRole(req.user, 'admin', 'superadmin', 'scheme_manager', 'certificate_officer', 'accountant', 'audit_manager', 'food_tech_manager', 'inspector', 'food_tech')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

export const requireSchemeManager = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!userHasRole(req.user, 'scheme_manager', 'admin', 'superadmin')) {
    return res.status(403).json({ error: 'Scheme Manager access required' });
  }
  next();
};

export const requireCertificateOfficer = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!userHasRole(req.user, 'certificate_officer', 'admin', 'superadmin') && !req.user.can_issue_direct_certificate) {
    return res.status(403).json({ error: 'Certificate Officer access required' });
  }
  next();
};

export const requireAccountant = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!userHasRole(req.user, 'accountant', 'admin', 'superadmin')) {
    return res.status(403).json({ error: 'Accountant access required' });
  }
  next();
};

export const requireClient = (req, res, next) => {
  if (!req.user || (req.user.role !== 'client' && !req.user.roles?.includes('client'))) {
    return res.status(403).json({ error: 'Client access required' });
  }
  next();
};

export const requireFoodTechManager = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!userHasRole(req.user, 'food_tech_manager', 'admin', 'superadmin')) {
    return res.status(403).json({ error: 'Food Tech Manager access required' });
  }
  next();
};

export const requireFoodTechManagerOrAdmin = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!userHasRole(req.user, 'food_tech_manager', 'admin', 'superadmin', 'food_tech', 'scheme_manager')) {
    return res.status(403).json({ error: 'Access denied. Food Tech Manager or Admin role required.' });
  }
  next();
};

export const requireFoodTech = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!userHasRole(req.user, 'food_tech', 'food_tech_manager', 'admin', 'superadmin')) {
    return res.status(403).json({ error: 'Food Tech access required' });
  }
  next();
};

export const requireAuditManager = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!userHasRole(req.user, 'audit_manager', 'admin', 'superadmin')) {
    return res.status(403).json({ error: 'Audit Manager access required' });
  }
  next();
};

export const requireAuditorOrManager = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!userHasRole(req.user, 'audit_manager', 'inspector', 'auditor', 'admin', 'superadmin')) {
    return res.status(403).json({ error: 'Audit Manager or Auditor access required' });
  }
  next();
};

export const requireStaff = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const isStaff = isStaffUser(req.user, req.userModelType);
  if (!isStaff) {
    return res.status(403).json({ error: 'Staff access required' });
  }
  next();
};
