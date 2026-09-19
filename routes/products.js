import express from 'express';
import mongoose from 'mongoose';
import Product from '../models/Product.js';
import AddOnApplication from '../models/AddOnApplication.js';
import User from '../models/User.js';
import Site from '../models/Site.js';
import { authenticateToken } from '../middleware/auth.js';
import { createNotification } from '../lib/notifications.js';
import { emitAddOnUpdate } from '../lib/socket.js';
const router = express.Router();

router.get('/', authenticateToken, async (req, res) => {
  try {
    // Delete any orphaned pending products so Product List only displays active/certified products
    await Product.deleteMany({ status: 'pending' }).catch(() => {});

    let query = { status: { $ne: 'pending' } };
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      // client_id may be stored as ObjectId or string due to Mixed type — query both forms
      const clientIdStr = req.user._id.toString();
      query.client_id = { $in: [req.user._id, clientIdStr] };
    } else {
      if (req.query.client_id) {
        // Admin filtering: also match both ObjectId and string forms
        query.client_id = mongoose.isValidObjectId(req.query.client_id)
          ? { $in: [new mongoose.Types.ObjectId(req.query.client_id), req.query.client_id] }
          : req.query.client_id;
      }
      if (req.query.site_id) query.site_id = req.query.site_id;
    }
    const products = await Product.find(query).populate('site_id', 'name est_name trading_name address_1').sort({ created_at: -1 }).lean();

    // Deduplicate products by client_id + name + code
    const uniqueProducts = [];
    const seenProductKeys = new Set();
    for (const p of products) {
      const cIdStr = p.client_id ? (p.client_id._id ? p.client_id._id.toString() : p.client_id.toString()) : 'global';
      const nameStr = (p.name || '').trim().toLowerCase();
      const codeStr = (p.code || p.barcode || '').trim().toLowerCase();
      if (!nameStr) continue;
      const key = `${cIdStr}:${nameStr}:${codeStr}`;
      if (!seenProductKeys.has(key)) {
        seenProductKeys.add(key);
        uniqueProducts.push(p);
      }
    }

    // Enrich with client user information
    const userIds = [...new Set(uniqueProducts.map(p => {
      if (!p.client_id) return null;
      if (typeof p.client_id === 'object' && p.client_id._id) return p.client_id._id.toString();
      return p.client_id.toString();
    }).filter(Boolean))];

    const users = await User.find({ _id: { $in: userIds } }, 'company_name full_name email phone').lean();
    const userMap = {};
    users.forEach(u => { userMap[u._id.toString()] = u; });

    const data = uniqueProducts.map(p => {
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

// Direct Batch Product Creation (Admin / Superadmin)
router.post('/direct-batch', authenticateToken, async (req, res) => {
  try {
    const allowedRoles = ['admin', 'superadmin', 'food_tech_manager', 'food_tech', 'scheme_manager', 'certificate_officer', 'audit_manager'];
    const userRole = req.user.role;
    const userRoles = Array.isArray(req.user.roles) ? req.user.roles : [userRole].filter(Boolean);
    const hasAccess = userRole === 'superadmin' || userRoles.includes('superadmin') || userRoles.some(r => allowedRoles.includes(r));
    if (!hasAccess) {
      return res.status(403).json({ error: 'Unauthorized: Only admins and authorized staff can directly create products.' });
    }

    const { client_id, site_id, products, send_notification, notes } = req.body;

    if (!client_id) {
      return res.status(400).json({ error: 'Client / Company ID is required.' });
    }

    if (!mongoose.isValidObjectId(client_id)) {
      return res.status(400).json({ error: 'Invalid client company ID format.' });
    }

    if (site_id && !mongoose.isValidObjectId(site_id)) {
      return res.status(400).json({ error: 'Invalid facility site ID format.' });
    }

    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: 'At least one product is required.' });
    }

    const client = await User.findById(client_id).lean();
    if (!client) {
      return res.status(404).json({ error: 'Selected client company not found.' });
    }

    let site = null;
    if (site_id) {
      site = await Site.findById(site_id).lean();
    }

    const docsToInsert = products.map((p, index) => {
      const name = p.name ? p.name.trim() : '';
      if (!name) return null;

      const code = p.code && p.code.trim() ? p.code.trim() : `PRD-${String(index + 1).padStart(2, '0')}`;
      const category = p.category && p.category.trim() ? p.category.trim() : 'General Food Products';
      const product_type = p.product_type && p.product_type.trim() ? p.product_type.trim() : 'Processed';
      const description = p.description ? p.description.trim() : '';
      const productNotes = p.notes ? p.notes.trim() : (notes || 'Directly registered by administrator');

      return {
        client_id,
        site_id: site_id || undefined,
        name,
        code,
        barcode: code,
        category,
        product_type,
        description,
        notes: productNotes,
        status: p.status || 'active',
        created_at: new Date(),
        updated_at: new Date()
      };
    }).filter(Boolean);

    if (docsToInsert.length === 0) {
      return res.status(400).json({ error: 'Please specify at least one product with a valid name.' });
    }

    const created = await Product.insertMany(docsToInsert);

    // Optional Notification to client
    if (send_notification !== false) {
      const siteDisplay = site ? (site.name || site.est_name || 'facility site') : 'your facility site';
      await createNotification(
        client_id,
        'New Certified Products Added 📦',
        `${created.length} new product${created.length > 1 ? 's have' : ' has'} been directly registered and assigned to ${siteDisplay}.`,
        'success',
        '/products'
      );
    }

    res.status(201).json({
      success: true,
      message: `Successfully registered and assigned ${created.length} product(s).`,
      count: created.length,
      data: created
    });
  } catch (err) {
    console.error('Error in /api/products/direct-batch:', err);
    res.status(500).json({ error: err.message || 'Failed to directly create products.' });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    const {
      name, description, category, site_id, ingredients,
      barcode, product_type, contact_name, contact_number, contact_email, subject, message
    } = req.body;

    const isAdmin = ['admin', 'superadmin'].includes(req.user.role);

    // If added by admin directly, create as active product
    if (isAdmin) {
      const product = new Product({
        client_id: req.body.client_id || req.user._id,
        name,
        description,
        category,
        site_id: site_id || undefined,
        ingredients,
        barcode: barcode || '',
        status: 'active'
      });
      const data = await product.save();
      return res.status(201).json({ data });
    }

    // All add-on product requests from clients MUST go to the Add-on Request page ONLY
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
        note: `Product "${name}" requested from Products page.`
      }]
    });
    const savedAddOn = await addOnApp.save();
    emitAddOnUpdate(savedAddOn, 'created');

    const admins = await User.find({ role: { $in: ['admin', 'food_tech_manager'] } }).lean();
    for (const a of admins) {
      await createNotification(
        a._id,
        'New Add-on Application 📄',
        `${req.user.company_name || req.user.full_name} submitted a product addition request (${name}).`,
        'info',
        '/addon-applications'
      );
    }

    res.status(201).json({ data: savedAddOn, message: 'Product request submitted to Add-on Requests.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/status', authenticateToken, async (req, res) => {
  try {
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only admins can change product status.' });
    }
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
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Clients cannot modify certified products directly. Please submit an Add-on request.' });
    }
    const data = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!data) return res.status(404).json({ error: 'Product not found' });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Clients cannot delete certified products directly. Please submit an Add-on removal request.' });
    }
    const result = await Product.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'Product not found' });
    res.json({ message: 'Product deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;