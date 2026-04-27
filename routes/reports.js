import express from 'express';
import Application from '../models/Application.js';
import Certificate from '../models/Certificate.js';
import User from '../models/User.js';
import Audit from '../models/Audit.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
const router = express.Router();

router.get('/dashboard', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const applications = await Application.find().sort({ created_at: -1 });
    const certificates = await Certificate.find().sort({ created_at: -1 });
    const users = await User.find().sort({ created_at: -1 });
    const audits = await Audit.find().sort({ created_at: -1 });

    res.json({
      applications,
      certificates,
      users,
      audits
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const totalApps = await Application.countDocuments();
    const totalCerts = await Certificate.countDocuments({ status: 'active' });
    const totalClients = await User.countDocuments({ role: 'client' });
    
    // Status distribution
    const statusDistribution = await Application.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]);

    res.json({
      totalApps,
      totalCerts,
      totalClients,
      statusDistribution
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
