import express from 'express';
import Product from '../models/Product.js';
import AddOnApplication from '../models/AddOnApplication.js';
import User from '../models/User.js';
import { authenticateToken } from '../middleware/auth.js';
import { createNotification } from '../lib/notifications.js';
import { emitAddOnUpdate } from '../lib/socket.js';
const router = express.Router();

router.get('/', authenticateToken, async (req, res) => {
  try {
    let query = {};
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      query.client_id = req.user._id;
    }
    const products = await Product.find(query).populate('site_id').sort({ created_at: -1 }).lean();

    // Enrich with client user information
    const userIds = [...new Set(products.map(p => {
      if (!p.client_id) return null;
      if (typeof p.client_id === 'object' && p.client_id._id) return p.client_id._id.toString();
      return p.client_id.toString();
    }).filter(Boolean))];

    const users = await User.find({ _id: { $in: userIds } }, 'company_name full_name email phone').lean();
    const userMap = {};
    users.forEach(u => { userMap[u._id.toString()] = u; });

    const data = products.map(p => {
      const clientIdStr = p.client_id ? (p.client_id._id ? p.client_id._id.toString() : p.client_id.toString()) : null;
      const clientObj = (p.client_id && typeof p.client_id === 'object' && p.client_id.company_name) 
        ? p.client_id 
        : (clientIdStr ? userMap[clientIdStr] : null);

      return {
        ...p,
        id: p._id.toString(),
        barcode: p.barcode || p.code || '',
        client_id: clientObj || p.client_id,
        profiles: clientObj ? {
          company_name: clientObj.company_name,
          full_name: clientObj.full_name,
          email: clientObj.email,
          phone: clientObj.phone
        } : null
      };
    });

    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    const {
      name, description, category, site_id, ingredients,
      barcode, product_type, contact_name, contact_number, contact_email, subject, message
    } = req.body;

    const product = new Product({
      client_id: req.user._id,
      name,
      description,
      category,
      site_id: site_id || undefined,
      ingredients,
      barcode: barcode || '',
      status: 'pending'
    });
    const data = await product.save();

    // If added by a client, automatically create an AddOnApplication so it enters the admin add-on flow
    if (req.user.role === 'client' || !['admin', 'superadmin'].includes(req.user.role)) {
      try {
        const addOnApp = new AddOnApplication({
          client_id: req.user._id,
          site_id: site_id || undefined,
          contact_name: contact_name || req.user.full_name || req.user.company_name || 'Client Contact',
          contact_email: contact_email || req.user.email || 'client@example.com',
          contact_phone: contact_number || req.user.phone || '',
          message: subject ? `Subject: ${subject}\n\n${message || ''}` : (message || ''),
          products: [{
            name,
            code: barcode || '',
            type: product_type === 'Change ingredient' ? 'Change ingredients' : (product_type || 'Add product')
          }],
          status: 'submitted',
          statusHistory: [{
            status: 'submitted',
            changedAt: new Date(),
            changedBy: req.user._id,
            note: `Product "${name}" submitted from Products page.`
          }]
        });
        const savedAddOn = await addOnApp.save();
        emitAddOnUpdate(savedAddOn, 'created');

        const admins = await User.find({ role: { $in: ['admin', 'food_tech_manager'] } }).lean();
        for (const a of admins) {
          await createNotification(
            a._id,
            'New Add-on Application 📄',
            `${req.user.company_name || req.user.full_name} submitted a product (${name}) via Products page.`,
            'info',
            '/addon-applications'
          );
        }
      } catch (addonErr) {
        console.error('[Products] Failed to create add-on application for product:', addonErr.message);
      }
    }

    res.status(201).json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/status', authenticateToken, async (req, res) => {
  try {
    const { status, notes } = req.body;
    const data = await Product.findByIdAndUpdate(
      req.params.id, 
      { status, notes, updated_at: new Date() }, 
      { new: true }
    );
    if (!data) return res.status(404).json({ error: 'Product not found' });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const data = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!data) return res.status(404).json({ error: 'Product not found' });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const result = await Product.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'Product not found' });
    res.json({ message: 'Product deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
