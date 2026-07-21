import express from 'express';
import AddOnApplication from '../models/AddOnApplication.js';
import Certificate from '../models/Certificate.js';
import User from '../models/User.js';
import { authenticateToken, requireStaff, requireFoodTechManagerOrAdmin } from '../middleware/auth.js';
import { createNotification } from '../lib/notifications.js';
import { emitAddOnUpdate } from '../lib/socket.js';
import { Resend } from 'resend';
import dotenv from 'dotenv';
import { generateCertificate } from '../services/certificateGenerator.js';
import { uploadToGridFS } from '../lib/gridfs.js';

dotenv.config();

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);
const emailFrom = process.env.EMAIL_FROM || 'HFA Portal <info@halalfoodfoundation.org.uk>';

// Helper function to regenerate and update Certificate PDF
async function regenerateCertPdf(certificate) {
  try {
    const { default: Application } = await import('../models/Application.js');
    const application = await Application.findById(certificate.application_id);
    const client = await User.findById(certificate.client_id);
    
    const productCategories = (certificate.products_covered || []).map((p, idx) => ({
      code: `GEN-${String(idx + 1).padStart(2, '0')}`,
      name: p
    }));

    const certData = {
      businessName: client ? (client.company_name || client.full_name) : (application?.establishment_name || 'HFA Client'),
      businessAddress: application?.establishment_address || '—',
      manufacturerAddress: application?.manufacturer_address || 'Same as above',
      certificateNumber: certificate.certificate_number,
      scopeOfCertification: application?.scope || 'Halal Food Certification',
      productCategories,
      issueDate: certificate.issue_date || new Date(),
      expiryDate: certificate.expiry_date || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      verificationUrl: `${process.env.FRONTEND_CLIENT_URL || 'https://hfa-portal.vercel.app'}/verify/${certificate.certificate_number}`
    };

    const pdfBuffer = await generateCertificate(certData);
    const filename = `${certificate.certificate_number}.pdf`;
    const certificate_url = await uploadToGridFS(pdfBuffer, filename, 'application/pdf');

    certificate.certificate_url = certificate_url;
    await certificate.save();
    console.log(`Successfully regenerated certificate PDF for ${certificate.certificate_number}`);
  } catch (err) {
    console.error('Failed to regenerate certificate PDF on add-on completion:', err);
  }
}

// POST /api/add-on-applications — client submits a request
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { certificate_id, contact_name, contact_email, contact_phone, action_type, product_name, new_product_name } = req.body;
    
    // Check if client has at least one active certificate
    const activeCerts = await Certificate.find({
      client_id: req.user._id.toString(),
      status: 'active',
      expiry_date: { $gte: new Date() }
    });

    if (activeCerts.length === 0) {
      return res.status(400).json({ error: 'Add-on applications are available once you hold an active certificate.' });
    }

    // Verify certificate_id belongs to the client and is active
    const cert = activeCerts.find(c => c._id.toString() === certificate_id);
    if (!cert) {
      return res.status(400).json({ error: 'Invalid or expired certificate selected.' });
    }

    // Validate request inputs based on action type
    if (action_type === 'add' && !new_product_name?.trim()) {
      return res.status(400).json({ error: 'New product name is required.' });
    }
    if (action_type === 'remove' && !product_name?.trim()) {
      return res.status(400).json({ error: 'Product name is required.' });
    }
    if (action_type === 'change_name' && (!product_name?.trim() || !new_product_name?.trim())) {
      return res.status(400).json({ error: 'Both original and new product names are required.' });
    }

    const newApp = new AddOnApplication({
      client_id: req.user._id,
      certificate_id,
      contact_name,
      contact_email,
      contact_phone,
      action_type,
      product_name,
      new_product_name,
      status: 'submitted',
      statusHistory: [{
        status: 'submitted',
        changedAt: new Date(),
        changedBy: req.user._id,
        note: `Add-on application submitted for action: ${action_type}`
      }]
    });

    const data = await newApp.save();

    // Emit socket event
    emitAddOnUpdate(data, 'created');

    // Notify food tech managers and admins
    const staffToNotify = await User.find({ role: { $in: ['admin', 'food_tech_manager'] } });
    for (const s of staffToNotify) {
      await createNotification(
        s._id,
        'New Add-on Request 📄',
        `A new product add-on request has been submitted by ${req.user.company_name || req.user.full_name}.`,
        'warning',
        '/addon-applications'
      );
    }

    res.status(201).json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/add-on-applications — get applications (filtered based on role)
router.get('/', authenticateToken, async (req, res) => {
  try {
    let query = {};
    if (req.user.role === 'client') {
      query.client_id = req.user._id;
    } else if (req.user.role === 'food_tech') {
      // Enforce route-level role-scoping: food_tech can only see what is assigned to them
      query.assigned_food_tech = req.user._id;
    }

    const data = await AddOnApplication.find(query)
      .populate('client_id', 'company_name full_name email phone')
      .populate('certificate_id', 'certificate_number products_covered')
      .populate('assigned_food_tech', 'full_name email phone')
      .sort({ createdAt: -1 });

    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/add-on-applications/:id — get single application details
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const app = await AddOnApplication.findById(req.params.id)
      .populate('client_id', 'company_name full_name email phone')
      .populate('certificate_id', 'certificate_number products_covered')
      .populate('assigned_food_tech', 'full_name email phone');

    if (!app) {
      return res.status(404).json({ error: 'Add-on application not found' });
    }

    // Role scoping checks
    if (req.user.role === 'client' && app.client_id._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (req.user.role === 'food_tech' && app.assigned_food_tech?._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied. You are not assigned to this application.' });
    }

    res.json({ data: app });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/add-on-applications/:id/review — Approve/Reject by manager
router.put('/:id/review', authenticateToken, requireFoodTechManagerOrAdmin, async (req, res) => {
  try {
    const { status, rejection_reason, food_tech_manager_notes } = req.body;
    if (!['approved', 'rejected', 'under_review'].includes(status)) {
      return res.status(400).json({ error: 'Invalid review status.' });
    }

    const app = await AddOnApplication.findById(req.params.id);
    if (!app) return res.status(404).json({ error: 'Add-on application not found' });

    app.status = status;
    if (rejection_reason) app.rejection_reason = rejection_reason;
    if (food_tech_manager_notes) app.food_tech_manager_notes = food_tech_manager_notes;

    app.statusHistory.push({
      status,
      changedAt: new Date(),
      changedBy: req.user._id,
      note: status === 'rejected' ? `Rejected: ${rejection_reason}` : 'Approved by Food Tech Manager'
    });

    const data = await app.save();

    // Emit socket event
    emitAddOnUpdate(data, 'reviewed');

    // Notify client
    const client = await User.findById(app.client_id);
    if (client) {
      await createNotification(
        client._id,
        status === 'approved' ? 'Add-on Approved! 👍' : 'Add-on Rejected ❌',
        status === 'approved' 
          ? `Your product add-on request has been approved. HFA will assign an inspector shortly.` 
          : `Your product add-on request has been rejected. Reason: ${rejection_reason}`,
        status === 'approved' ? 'success' : 'error',
        '/addon-applications'
      );

      // Email notification
      try {
        await resend.emails.send({
          from: emailFrom,
          to: client.email,
          subject: status === 'approved' ? '👍 HFA Add-on Application Approved' : '❌ HFA Add-on Application Rejected',
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#f9fafb">
              <h2 style="color:#166534">Hello, ${client.full_name}!</h2>
              <p>Your add-on request of type <strong>${app.action_type}</strong> has been <strong>${status}</strong>.</p>
              ${status === 'rejected' ? `<p style="color:#dc2626"><strong>Reason for Rejection:</strong> ${rejection_reason}</p>` : ''}
              <p style="margin-top:20px;font-size:12px;color:#64748b">Please log in to the HFA portal to check details.</p>
            </div>
          `
        });
      } catch (err) {
        console.error('Failed to send review email:', err);
      }
    }

    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/add-on-applications/:id/assign — Assign inspector
router.put('/:id/assign', authenticateToken, requireFoodTechManagerOrAdmin, async (req, res) => {
  try {
    const { assigned_food_tech } = req.body;
    if (!assigned_food_tech) return res.status(400).json({ error: 'Assigned food tech inspector is required.' });

    const inspector = await User.findOne({ _id: assigned_food_tech, role: 'food_tech' });
    if (!inspector) return res.status(400).json({ error: 'Invalid food tech inspector selected.' });

    const app = await AddOnApplication.findById(req.params.id);
    if (!app) return res.status(404).json({ error: 'Add-on application not found' });

    app.assigned_food_tech = assigned_food_tech;
    app.status = 'inspection_assigned';
    app.statusHistory.push({
      status: 'inspection_assigned',
      changedAt: new Date(),
      changedBy: req.user._id,
      note: `Assigned to inspector: ${inspector.full_name}`
    });

    const data = await app.save();

    // Emit socket event
    emitAddOnUpdate(data, 'assigned');

    // Send email to inspector
    try {
      await resend.emails.send({
        from: emailFrom,
        to: inspector.email,
        subject: '🔍 New Add-on Inspection Assignment',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#f9fafb">
            <h2 style="color:#166534">Hello, ${inspector.full_name}!</h2>
            <p>You have been assigned to conduct an inspection for a product add-on application.</p>
            <p><strong>Action required:</strong> Please coordinate the inspection and submit your reports inside the portal.</p>
            <p style="margin-top:20px;font-size:12px;color:#64748b">Halal Food Authority</p>
          </div>
        `
      });
    } catch (err) {
      console.error('Failed to send inspector email:', err);
    }

    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/add-on-applications/:id/inspect — Submit inspection notes by assigned inspector
router.put('/:id/inspect', authenticateToken, requireStaff, async (req, res) => {
  try {
    const { inspection_notes } = req.body;
    if (!inspection_notes?.trim()) return res.status(400).json({ error: 'Inspection notes are required.' });

    const app = await AddOnApplication.findById(req.params.id);
    if (!app) return res.status(404).json({ error: 'Add-on application not found' });

    // Enforce route-level scoping: food_tech user must be the assigned inspector
    if (req.user.role === 'food_tech' && app.assigned_food_tech?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied. You are not the assigned inspector for this application.' });
    }

    app.inspection_notes = inspection_notes;
    app.status = 'inspection_completed';
    app.statusHistory.push({
      status: 'inspection_completed',
      changedAt: new Date(),
      changedBy: req.user._id,
      note: 'Inspection completed and report submitted.'
    });

    const data = await app.save();

    // Emit socket event
    emitAddOnUpdate(data, 'inspected');

    // Notify managers
    const managers = await User.find({ role: { $in: ['admin', 'food_tech_manager'] } });
    for (const m of managers) {
      await createNotification(
        m._id,
        'Inspection Complete 🔍',
        `Inspector ${req.user.full_name} has completed the inspection report for an add-on request.`,
        'success',
        '/addon-applications'
      );
    }

    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/add-on-applications/:id/complete — Final completion & update certificate
router.put('/:id/complete', authenticateToken, requireFoodTechManagerOrAdmin, async (req, res) => {
  try {
    const app = await AddOnApplication.findById(req.params.id);
    if (!app) return res.status(404).json({ error: 'Add-on application not found' });

    if (app.status !== 'inspection_completed') {
      return res.status(400).json({ error: 'Cannot complete application before inspection is completed.' });
    }

    const cert = await Certificate.findById(app.certificate_id);
    if (!cert) return res.status(404).json({ error: 'Linked Certificate not found.' });

    // Perform Certificate Products Covered array changes
    let products = Array.isArray(cert.products_covered) ? cert.products_covered : [];

    if (app.action_type === 'add') {
      if (app.new_product_name && !products.includes(app.new_product_name)) {
        products.push(app.new_product_name);
      }
    } else if (app.action_type === 'remove') {
      products = products.filter(p => p !== app.product_name);
    } else if (app.action_type === 'change_name') {
      products = products.map(p => p === app.product_name ? app.new_product_name : p);
    }

    cert.products_covered = products;
    cert.updated_at = new Date();
    await cert.save();

    // Mark AddOnApplication completed
    app.status = 'completed';
    app.statusHistory.push({
      status: 'completed',
      changedAt: new Date(),
      changedBy: req.user._id,
      note: `Application finalized. Certificate ${cert.certificate_number} product list updated.`
    });

    const data = await app.save();

    // Emit socket event
    emitAddOnUpdate(data, 'completed');

    // Regenerate the certificate PDF asynchronously
    await regenerateCertPdf(cert);

    // Notify client
    await createNotification(
      app.client_id,
      'Add-on Finalized! 🎉',
      `Your product add-on request has been finalized and your Certificate (${cert.certificate_number}) updated.`,
      'success',
      '/certificates'
    );

    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
