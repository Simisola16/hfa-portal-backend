import express from 'express';
import ExportCertificate from '../models/ExportCertificate.js';
import User from '../models/User.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// GET /api/exports - list all (admin sees all, client sees own)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const isAdmin = ['admin', 'superadmin'].includes(req.user.role) ||
                    (Array.isArray(req.user.roles) && req.user.roles.some(r => ['admin', 'superadmin'].includes(r)));

    const query = isAdmin ? {} : { client_id: (req.user._id || req.user.id).toString() };
    const data = await ExportCertificate.find(query).sort({ created_at: -1 });

    const clientIds = [...new Set(data.map(d => d.client_id).filter(Boolean))];
    const users = await User.find({ _id: { $in: clientIds } }, 'company_name email full_name').lean();
    const userMap = {};
    users.forEach(u => { userMap[u._id.toString()] = u; });

    const enriched = data.map(d => {
      const obj = d.toObject ? d.toObject() : { ...d };
      const user = userMap[obj.client_id];
      obj.id = obj._id.toString();
      obj.profiles = user || { company_name: 'Anike International', email: 'anike@halalfoodauthority.com' };
      return obj;
    });

    res.json({ data: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/exports - client creates a new export certificate request
router.post('/', authenticateToken, async (req, res) => {
  try {
    const {
      destination_country,
      shipment_date,
      products,
      consignee_name,
      consignee_address,
      notes,
      application_number,
      consignment_details,
    } = req.body;

    // Auto-generate a reference number
    const count = await ExportCertificate.countDocuments();
    const reference_number = `EXP-${String(count + 1).padStart(4, '0')}`;

    const exportCert = new ExportCertificate({
      client_id: (req.user._id || req.user.id).toString(),
      reference_number,
      destination_country,
      shipment_date: shipment_date ? new Date(shipment_date) : undefined,
      products,
      consignee_name,
      consignee_address,
      notes,
      application_number,
      consignment_details,
      status: 'pending',
      created_at: new Date(),
      updated_at: new Date(),
    });

    const data = await exportCert.save();
    res.status(201).json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/exports/:id/status  - admin approve / reject
router.put('/:id/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { status, notes } = req.body;
    const data = await ExportCertificate.findByIdAndUpdate(
      req.params.id,
      { status, admin_notes: notes, updated_at: new Date() },
      { new: true }
    );
    if (!data) return res.status(404).json({ error: 'Export certificate not found' });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/exports/:id - general update (admin)
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const data = await ExportCertificate.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updated_at: new Date() },
      { new: true }
    );
    if (!data) return res.status(404).json({ error: 'Export certificate not found' });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/exports/:id - admin delete
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await ExportCertificate.findByIdAndDelete(req.params.id);
    res.json({ message: 'Export certificate deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
