import express from 'express';
import Site from '../models/Site.js';
import { authenticateToken } from '../middleware/auth.js';
const router = express.Router();

router.get('/', authenticateToken, async (req, res) => {
  try {
    let query = {};
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      query.client_id = req.user._id;
    }
    const data = await Site.find(query).sort({ created_at: -1 });
    res.json({ data });
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
      if (existing.client_id.toString() !== req.user._id.toString()) {
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
