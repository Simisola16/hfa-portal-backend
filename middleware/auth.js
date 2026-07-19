import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import dotenv from 'dotenv';

dotenv.config();

export const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    
    if (!user) {
      return res.status(401).json({ error: 'User not found or token invalid' });
    }

    if (user.role !== 'admin' && user.is_active === false) {
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

export const requireAdmin = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

export const requireClient = async (req, res, next) => {
  if (!req.user || req.user.role !== 'client') {
    return res.status(403).json({ error: 'Client access required' });
  }
  next();
};

export const requireFoodTechManager = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.user.role !== 'food_tech_manager') {
    return res.status(403).json({ error: 'Food Tech Manager access required' });
  }
  next();
};

export const requireFoodTechManagerOrAdmin = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.user.role !== 'food_tech_manager' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Food Tech Manager or Admin role required.' });
  }
  next();
};

export const requireFoodTech = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.user.role !== 'food_tech') {
    return res.status(403).json({ error: 'Food Tech access required' });
  }
  next();
};

export const requireStaff = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const isStaff = ['admin', 'food_tech_manager', 'food_tech'].includes(req.user.role);
  if (!isStaff) {
    return res.status(403).json({ error: 'Staff access required' });
  }
  next();
};
