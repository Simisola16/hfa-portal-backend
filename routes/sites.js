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
      const ids = [req.user._id];
      if (req.user.parent_client_id) ids.push(req.user.parent_client_id);
      const strIds = ids.map(id => id.toString());
      const objIds = ids
        .filter(id => mongoose.isValidObjectId(id))
        .map(id => new mongoose.Types.ObjectId(id.toString()));

      query.client_id = { $in: [...new Set([...ids, ...strIds, ...objIds])] };
    }
    const sites = await Site.find(query)
      .sort({ created_at: -1 })
      .lean();

    const clientIds = [...new Set(
      sites
        .map(s => {
          if (!s.client_id) return null;
          if (typeof s.client_id === 'object' && s.client_id._id) return s.client_id._id.toString();
          return String(s.client_id);
        })
        .filter(id => id && mongoose.Types.ObjectId.isValid(id))
    )];

    const users = clientIds.length > 0
      ? await User.find({ _id: { $in: clientIds } }, 'company_name full_name email phone address').lean()
      : [];

    const userMap = new Map();
    users.forEach(u => userMap.set(String(u._id), u));

    const data = sites.map(s => {
      const rawCid = s.client_id ? (s.client_id._id ? String(s.client_id._id) : String(s.client_id)) : null;
      const client = rawCid ? (userMap.get(rawCid) || (req.user?._id?.toString() === rawCid ? req.user : null)) : null;

      return {
        ...s,
        client_id: client || s.client_id,
        profiles: {
          company_name: client?.company_name || s.est_name || s.trading_name || client?.full_name || '—',
          full_name: client?.full_name || '',
          email: client?.email || ''
        }
      };
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
      const allowed = [req.user._id.toString(), req.user.parent_client_id?.toString()].filter(Boolean);
      if (!allowed.includes(siteClientId)) {
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
      client_id: req.user.parent_client_id || req.user._id
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
      const allowed = [req.user._id.toString(), req.user.parent_client_id?.toString()].filter(Boolean);
      if (!allowed.includes(existingClientId)) {
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
