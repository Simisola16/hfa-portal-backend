import express from 'express';
import Site from '../models/Site.js';
import { authenticateToken } from '../middleware/auth.js';
const router = express.Router();

router.get('/', authenticateToken, async (req, res) => {
  try {
    let query = {};
    if (req.user.role !== 'admin') {
      query.client_id = req.user._id;
    }
    const data = await Site.find(query).sort({ created_at: -1 });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, address, postcode, country, contact_person, contact_email, contact_phone } = req.body;
    const site = new Site({
      client_id: req.user._id,
      name, address, postcode, country, contact_person, contact_email, contact_phone
    });
    const data = await site.save();
    res.status(201).json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const data = await Site.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!data) return res.status(404).json({ error: 'Site not found' });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const result = await Site.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'Site not found' });
    res.json({ message: 'Site deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
