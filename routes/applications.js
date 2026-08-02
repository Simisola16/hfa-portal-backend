import express from 'express';
import multer from 'multer';
import { uploadToGridFS } from '../lib/gridfs.js';
import Application from '../models/Application.js';
import User from '../models/User.js';
import Certificate from '../models/Certificate.js';
import { generateCertificate } from '../services/certificateGenerator.js';
import { createNotification } from '../lib/notifications.js';
import { authenticateToken } from '../middleware/auth.js';
import { Resend } from 'resend';
import dotenv from 'dotenv';
import { emitApplicationUpdate } from '../lib/socket.js';

dotenv.config();

const router = express.Router();
// Use memory storage — buffers are uploaded directly to Supabase
const upload = multer({ storage: multer.memoryStorage() });
const resend = new Resend(process.env.RESEND_API_KEY);
const emailFrom = process.env.EMAIL_FROM || 'HFA Portal <info@halalfoodfoundation.org.uk>';

// GET /api/applications
router.get('/', authenticateToken, async (req, res) => {
  try {
    let query = {};
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      query.client_id = req.user._id;
    }
    if (req.query.status) query.status = req.query.status;
    if (req.query.type) query.application_type = req.query.type;

    const data = await Application.find(query)
      .populate('profiles')
      .populate('inspectors')
      .sort({ created_at: -1 });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/applications/:id
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const data = await Application.findById(req.params.id)
      .populate('profiles')
      .populate('inspectors');
    if (!data) return res.status(404).json({ error: 'Application not found' });

    // Auto-fix legacy uppercase statuses in DB (e.g. "PAYMENT RECEIVED" -> "payment_received")
    if (data.status && (data.status.includes(' ') || data.status !== data.status.toLowerCase())) {
      const normalized = data.status.toLowerCase().replace(/ /g, '_');
      data.status = normalized;
      await Application.findByIdAndUpdate(req.params.id, { status: normalized });
    }

    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/applications
router.post('/', authenticateToken, upload.fields([
  { name: 'halal_policy', maxCount: 1 },
  { name: 'ingredient_list', maxCount: 1 },
  { name: 'floor_plan', maxCount: 1 },
  { name: 'haccp_plan', maxCount: 1 },
  { name: 'supporting_docs', maxCount: 5 },
]), async (req, res) => {
  try {
    // Gating Rules
    const { site_id, application_type } = req.body;
    if (site_id) {
      if (application_type === 'new') {
        const activeCert = await Certificate.findOne({
          site_id,
          status: 'active',
          expiry_date: { $gt: new Date() }
        });
        if (activeCert) {
          const expiryStr = new Date(activeCert.expiry_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
          return res.status(400).json({
            error: `This site already has an active certificate (valid until ${expiryStr}). You can submit a renewal application closer to the expiry date, or apply for a different site.`
          });
        }
      }

      const ongoingApp = await Application.findOne({
        site_id,
        client_id: req.user._id,
        status: { $nin: ['rejected', 'certificate_issued'] }
      });
      if (ongoingApp) {
        return res.status(400).json({
          error: `This site already has an application in progress (#${ongoingApp.application_number} - status: ${ongoingApp.status.replace(/_/g, ' ')}). You cannot submit another application for this site until the current one is completed.`
        });
      }
    }

    const documents = {};
    // Upload each document buffer to MongoDB GridFS
    if (req.files?.halal_policy?.[0]) {
      documents.halal_policy = await uploadToGridFS(
        req.files.halal_policy[0].buffer, req.files.halal_policy[0].originalname, req.files.halal_policy[0].mimetype
      );
    }
    if (req.files?.ingredient_list?.[0]) {
      documents.ingredient_list = await uploadToGridFS(
        req.files.ingredient_list[0].buffer, req.files.ingredient_list[0].originalname, req.files.ingredient_list[0].mimetype
      );
    }
    if (req.files?.floor_plan?.[0]) {
      documents.floor_plan = await uploadToGridFS(
        req.files.floor_plan[0].buffer, req.files.floor_plan[0].originalname, req.files.floor_plan[0].mimetype
      );
    }
    if (req.files?.haccp_plan?.[0]) {
      documents.haccp_plan = await uploadToGridFS(
        req.files.haccp_plan[0].buffer, req.files.haccp_plan[0].originalname, req.files.haccp_plan[0].mimetype
      );
    }
    if (req.files?.supporting_docs) {
      documents.supporting_docs = await Promise.all(
        req.files.supporting_docs.map(f =>
          uploadToGridFS(f.buffer, f.originalname, f.mimetype)
        )
      );
    }

    const appNumber = `HFA-${Date.now().toString().slice(-8)}`;
    
    // Parse products if they come as a JSON string
    let products = [];
    if (req.body.products) {
      try {
        products = JSON.parse(req.body.products);
      } catch (e) {
        products = [];
      }
    }

    const application = new Application({
      ...req.body,
      application_number: appNumber,
      client_id: req.user._id,
      products,
      documents,
      status: 'submitted',
      statusHistory: [{
        status: 'submitted',
        changedAt: new Date(),
        changedBy: req.user._id,
        note: 'Application submitted by client.',
      }],
    });

    const data = await application.save();

    // Emit real-time application update
    emitApplicationUpdate(data, 'created');

    // Send confirmation email
    try {
      await resend.emails.send({
        from: emailFrom,
        to: req.user.email,
        subject: `Application Received – ${appNumber}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#f9fafb">
            <div style="background:linear-gradient(135deg,#15803d,#166534);border-radius:12px;padding:32px;text-align:center;margin-bottom:24px">
              <h1 style="color:white;margin:0">Halal Food Authority</h1>
            </div>
            <div style="background:white;border-radius:12px;padding:32px">
              <h2 style="color:#166534">Application Received</h2>
              <p>Dear ${req.user.full_name},</p>
              <p>Your application <strong>${appNumber}</strong> has been received and is being reviewed.</p>
              <a href="${process.env.FRONTEND_CLIENT_URL || 'http://localhost:5173'}/applications" style="display:inline-block;background:#15803d;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:24px">Track Application</a>
            </div>
          </div>
        `,
      });
    } catch (emailErr) {
      console.error('Resend Email Error:', emailErr);
    }

    // Notify Admin
    const admins = await User.find({ role: 'admin' });
    for (const admin of admins) {
      await createNotification(
        admin._id,
        'New Application Received! 📄',
        `A new application (${appNumber}) has been submitted by ${req.user.company_name || req.user.full_name}.`,
        'info',
        `/applications?appId=${data._id}`
      );
    }

    res.status(201).json({ data, message: 'Application submitted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/applications/:id/approve (admin only)
router.put('/:id/approve', authenticateToken, async (req, res) => {
  try {
    const { note, category } = req.body;
    
    const app = await Application.findById(req.params.id);
    if (!app) return res.status(404).json({ error: 'Application not found' });

    let finalCategory = app.category;
    let originalCategory = app.original_category || app.category;
    let reclassified = false;

    if (category && category !== app.category) {
      finalCategory = category;
      originalCategory = app.category;
      reclassified = true;
    }

    const histNote = note || (reclassified ? `Application accepted and reclassified to: ${finalCategory}` : 'Application accepted by admin.');
    const histEntry = { status: 'approved', changedAt: new Date(), changedBy: req.user._id, note: histNote };
    
    const updateData = { 
      status: 'approved', 
      updated_at: new Date(), 
      $push: { statusHistory: histEntry } 
    };

    if (reclassified) {
      updateData.category = finalCategory;
      updateData.original_category = originalCategory;
    }

    const data = await Application.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).populate('profiles');
    
    // Notify client
    await createNotification(data.client_id, 'Application Accepted ✅', `Your application ${data.application_number} has been accepted.`, 'success', '/applications');
    
    // Emit socket event
    emitApplicationUpdate(data, 'approved');

    res.json({ data, message: 'Application accepted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/applications/:id/reject (admin only)
router.put('/:id/reject', authenticateToken, async (req, res) => {
  try {
    const { note } = req.body;
    if (!note?.trim()) return res.status(400).json({ error: 'A rejection reason is required.' });
    const histEntry = { status: 'rejected', changedAt: new Date(), changedBy: req.user._id, note: note.trim() };
    const data = await Application.findByIdAndUpdate(
      req.params.id,
      { status: 'rejected', updated_at: new Date(), $push: { statusHistory: histEntry } },
      { new: true }
    ).populate('profiles');
    if (!data) return res.status(404).json({ error: 'Application not found' });
    // Notify client
    await createNotification(data.client_id, 'Application Not Approved ❌', `Your application ${data.application_number} was not approved. Reason: ${note.trim()}`, 'error', '/applications');
    
    // Emit socket event
    emitApplicationUpdate(data, 'rejected');

    res.json({ data, message: 'Application rejected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/applications/:id/ready-for-certificate (admin only — mark ready for certificate)
router.put('/:id/ready-for-certificate', authenticateToken, async (req, res) => {
  try {
    const { note } = req.body;
    const app = await Application.findById(req.params.id);
    if (!app) return res.status(404).json({ error: 'Application not found' });

    const histNote = note || 'Application marked Ready for Certificate Issuance by admin.';
    const histEntry = { status: 'ready_for_certificate', changedAt: new Date(), changedBy: req.user._id, note: histNote };

    const data = await Application.findByIdAndUpdate(
      req.params.id,
      {
        status: 'ready_for_certificate',
        updated_at: new Date(),
        $push: { statusHistory: histEntry }
      },
      { new: true }
    ).populate('profiles');

    if (data) emitApplicationUpdate(data, 'ready_for_certificate');

    await createNotification(
      data.client_id,
      'Application Ready for Certificate 🎯',
      `Your application ${data.application_number} is ready for certificate issuance.`,
      'success',
      '/applications'
    );

    res.json({ data, message: 'Application status set to Ready for Certificate' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/applications/:id/status (admin only — generic, used by all phases)
router.put('/:id/status', authenticateToken, async (req, res) => {
  try {
    const { status, notes, note, inspector_id, audit_date } = req.body;
    const inspectorIdVal = inspector_id === "" ? null : inspector_id;

    const histEntry = {
      status,
      changedAt: new Date(),
      changedBy: req.user._id,
      note: note || notes || '',
    };

    const data = await Application.findByIdAndUpdate(
      req.params.id,
      {
        status,
        admin_notes: notes,
        inspector_id: inspectorIdVal,
        audit_date,
        updated_at: new Date(),
        $push: { statusHistory: histEntry },
      },
      { new: true, runValidators: false }
    );

    if (!data) return res.status(404).json({ error: 'Application not found' });
    
    const client = await User.findById(data.client_id);
    
    // Auto-generate certificate if application status is updated to 'approved'
    if (status === 'approved' && data) {
      try {
        const existingCert = await Certificate.findOne({ application_id: data._id, status: 'active' });
        if (!existingCert) {
          const certNumber = `HFA-UK-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
          
          const productCategories = (data.products || []).map(p => ({
            code: p.brand || 'GEN',
            name: p.name
          }));

          const certData = {
            businessName: client ? (client.company_name || client.full_name) : data.establishment_name,
            businessAddress: data.establishment_address || '—',
            manufacturerAddress: data.manufacturer_address || 'Same as above',
            certificateNumber: certNumber,
            scopeOfCertification: data.scope || 'Halal Food Certification',
            productCategories,
            issueDate: new Date(),
            expiryDate: data.category === 'UAE/GSO Approved Halal Certification For Exporters To UAE'
              ? new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000)
              : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
            verificationUrl: `${process.env.FRONTEND_CLIENT_URL || 'https://hfa-portal.vercel.app'}/verify/${certNumber}`
          };

          const pdfBuffer = await generateCertificate(certData);
          const filename = `${certNumber}.pdf`;
          const certificate_url = await uploadToGridFS(pdfBuffer, filename, 'application/pdf');

          const certificate = new Certificate({
            certificate_number: certNumber,
            client_id: data.client_id.toString(),
            application_id: data._id,
            site_id: data.site_id,
            certificate_type: data.application_type || 'Halal Certificate',
            issue_date: certData.issueDate,
            expiry_date: certData.expiryDate,
            products_covered: (certData.productCategories || []).map(p => typeof p === 'string' ? p : (p?.name || '')).filter(Boolean).length > 0
               ? (certData.productCategories || []).map(p => typeof p === 'string' ? p : (p?.name || '')).filter(Boolean)
               : ['Certified Halal Food Products'],
            certificate_url,
            status: 'active'
          });

          await certificate.save();

          // Change local data status to certificate_issued so the notification/email matches
          data.status = 'certificate_issued';
          await data.save();

          // Notify client about the certificate specifically
          await createNotification(
            data.client_id,
            '🏅 Certificate Issued',
            `Your Halal Certification certificate (${certNumber}) has been issued. Please log in to download it.`,
            'success',
            '/certificates'
          );
        }
      } catch (genErr) {
        console.error('Auto certificate generation failed on application approval:', genErr);
      }
    }

    if (client) {
      const statusLabels = {
        under_review: 'Under Review', approved: 'Approved', rejected: 'Rejected',
        on_hold: 'On Hold', audit_scheduled: 'Audit Scheduled', audit_completed: 'Audit Completed',
        certificate_issued: 'Certificate Issued',
      };

      try {
        await resend.emails.send({
          from: emailFrom,
          to: client.email,
          subject: `Application Update – ${data.application_number}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#f9fafb">
              <div style="background:white;border-radius:12px;padding:32px">
                <h2 style="color:#166534">Application Status Update</h2>
                <p>Dear ${client.full_name},</p>
                 <p>New Status: <strong style="color:#15803d">${statusLabels[data.status] || data.status}</strong></p>
                 <a href="${process.env.FRONTEND_CLIENT_URL}/applications/${req.params.id}" style="display:inline-block;background:#15803d;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:16px">View Application</a>
              </div>
            </div>
          `,
        });
      } catch (emailErr) {
        console.error('Email failed:', emailErr);
      }
    }

    // Notify Client via Dashboard Notification
    await createNotification(
      data.client_id,
      'Application Status Updated 📢',
      `Your application ${data.application_number} status has been changed to: ${data.status.replace(/_/g, ' ')}.`,
      'info',
      '/applications'
    );

    // Emit socket event
    emitApplicationUpdate(data, 'status_updated');

    res.json({ data, message: 'Status updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/applications/:id
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const result = await Application.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'Application not found' });
    res.json({ message: 'Application deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
