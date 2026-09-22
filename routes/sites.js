import express from 'express';
import mongoose from 'mongoose';
import Site from '../models/Site.js';
import User from '../models/User.js';
import { authenticateToken } from '../middleware/auth.js';
const router = express.Router();

router.get('/', authenticateToken, async (req, res) => {
  try {
    let query = {};
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      const userObjId = req.user._id && mongoose.Types.ObjectId.isValid(req.user._id)
        ? new mongoose.Types.ObjectId(req.user._id)
        : req.user._id;
      const userStr = req.user._id ? req.user._id.toString() : '';

      query.$or = [
        { client_id: userObjId },
        { client_id: userStr }
      ];
    }
    const sites = await Site.find(query)
      .populate('client_id', 'company_name full_name email phone address')
      .sort({ created_at: -1 });

    // Fallback: If any site's client_id wasn't populated (e.g. because client_id was stored as string or mismatch), fetch the User
    const unpopulatedClientIds = sites
      .map(s => (s.client_id && typeof s.client_id === 'object' && s.client_id.company_name) ? null : s.client_id)
      .filter(cid => cid && typeof cid === 'string' && mongoose.Types.ObjectId.isValid(cid));

    let userMap = {};
    if (unpopulatedClientIds.length > 0) {
      const users = await User.find({ _id: { $in: unpopulatedClientIds } }, 'company_name full_name email phone address');
      users.forEach(u => {
        userMap[u._id.toString()] = u;
      });
    }

    const data = sites.map(s => {
      const obj = s.toObject ? s.toObject() : { ...s };
      const rawCid = obj.client_id;
      const client = (rawCid && typeof rawCid === 'object' && rawCid.company_name)
        ? rawCid
        : (userMap[String(rawCid)] || (req.user?._id?.toString() === String(rawCid) ? req.user : null));

      obj.profiles = {
        company_name: client?.company_name || obj.est_name || obj.trading_name || client?.full_name || '—',
        full_name: client?.full_name || '',
        email: client?.email || ''
      };
      return obj;
    });

    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const site = await Site.findById(req.params.id)
      .populate('client_id', 'company_name full_name email phone address');
    if (!site) return res.status(404).json({ error: 'Site not found' });

    if (!['admin', 'superadmin'].includes(req.user.role)) {
      const siteClientId = site.client_id?._id?.toString() || site.client_id?.toString();
      if (siteClientId !== req.user._id.toString()) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const obj = site.toObject ? site.toObject() : { ...site };
    let client = (obj.client_id && typeof obj.client_id === 'object' && obj.client_id.company_name)
      ? obj.client_id
      : null;

    if (!client && obj.client_id && mongoose.Types.ObjectId.isValid(obj.client_id)) {
      client = await User.findById(obj.client_id, 'company_name full_name email phone address');
    }
    if (!client && req.user?._id?.toString() === String(obj.client_id)) {
      client = req.user;
    }

    obj.profiles = {
      company_name: client?.company_name || obj.est_name || obj.trading_name || client?.full_name || '—',
      full_name: client?.full_name || '',
      email: client?.email || ''
    };
    res.json({ data: obj });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  const { name, email, address_1, postcode, state, country, contact_name, contact_phone_number } = req.body;
  const errors = {};
  if (!name) errors.name = 'Site name is required';
  if (!email) errors.email = 'Email is required';
  if (!address_1) errors.address_1 = 'Address line 1 is required';
  if (!postcode) errors.postcode = 'Postcode is required';
  if (!state) errors.state = 'State/County is required';
  if (!country) errors.country = 'Country is required';
  if (!contact_name) errors.contact_name = 'Contact name is required';
  if (!contact_phone_number) errors.contact_phone_number = 'Contact phone number is required';

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ error: 'Validation failed', fields: errors });
  }

  try {
    const site = new Site({
      ...req.body,
      client_id: req.user._id
    });
    const data = await site.save();
    res.status(201).json({ data });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  const { name, email, address_1, postcode, state, country, contact_name, contact_phone_number } = req.body;
  const errors = {};
  if (email === '') errors.email = 'Email cannot be empty';
  if (address_1 === '') errors.address_1 = 'Address line 1 cannot be empty';
  if (postcode === '') errors.postcode = 'Postcode cannot be empty';
  if (state === '') errors.state = 'State/County cannot be empty';
  if (country === '') errors.country = 'Country cannot be empty';
  if (contact_name === '') errors.contact_name = 'Contact name cannot be empty';
  if (contact_phone_number === '') errors.contact_phone_number = 'Contact phone number cannot be empty';

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ error: 'Validation failed', fields: errors });
  }

  try {
    const existing = await Site.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Site not found' });

    // Clients cannot change site name or modify other clients' sites
    const updateData = { ...req.body };
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      const existingClientId = existing.client_id?._id?.toString() || existing.client_id?.toString();
      if (existingClientId !== req.user._id.toString()) {
        return res.status(403).json({ error: 'Access denied' });
      }
      delete updateData.name; // Keep existing site name locked for clients
      delete updateData.client_id;
    }

    const data = await Site.findByIdAndUpdate(req.params.id, updateData, { new: true });
    res.json({ data });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    // Only admins can delete sites
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Clients cannot delete registered sites. Please contact support.' });
    }
    const result = await Site.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'Site not found' });
    res.json({ message: 'Site deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
