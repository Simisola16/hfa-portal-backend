import express from 'express';
import multer from 'multer';
import { uploadToSupabase } from '../lib/supabase.js';
import Application from '../models/Application.js';
import User from '../models/User.js';
import { authenticateToken } from '../middleware/auth.js';
import { Resend } from 'resend';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();
// Use memory storage — buffers are uploaded directly to Supabase
const upload = multer({ storage: multer.memoryStorage() });
const resend = new Resend(process.env.RESEND_API_KEY);

// GET /api/applications
router.get('/', authenticateToken, async (req, res) => {
  try {
    let query = {};
    if (req.user.role !== 'admin') {
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
  { name: 'company_registration', maxCount: 1 },
  { name: 'haccp_plan', maxCount: 1 },
  { name: 'supporting_docs', maxCount: 5 },
]), async (req, res) => {
  try {
    const documents = {};
    // Upload each document buffer to Supabase Storage
    if (req.files?.halal_policy?.[0]) {
      documents.halal_policy = await uploadToSupabase(
        req.files.halal_policy[0].buffer, req.files.halal_policy[0].originalname, 'applications/halal_policy'
      );
    }
    if (req.files?.ingredient_list?.[0]) {
      documents.ingredient_list = await uploadToSupabase(
        req.files.ingredient_list[0].buffer, req.files.ingredient_list[0].originalname, 'applications/ingredient_list'
      );
    }
    if (req.files?.floor_plan?.[0]) {
      documents.floor_plan = await uploadToSupabase(
        req.files.floor_plan[0].buffer, req.files.floor_plan[0].originalname, 'applications/floor_plan'
      );
    }
    if (req.files?.company_registration?.[0]) {
      documents.company_registration = await uploadToSupabase(
        req.files.company_registration[0].buffer, req.files.company_registration[0].originalname, 'applications/company_registration'
      );
    }
    if (req.files?.haccp_plan?.[0]) {
      documents.haccp_plan = await uploadToSupabase(
        req.files.haccp_plan[0].buffer, req.files.haccp_plan[0].originalname, 'applications/haccp_plan'
      );
    }
    if (req.files?.supporting_docs) {
      documents.supporting_docs = await Promise.all(
        req.files.supporting_docs.map(f =>
          uploadToSupabase(f.buffer, f.originalname, 'applications/supporting_docs')
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
    });

    const data = await application.save();

    // Send confirmation email
    try {
      await resend.emails.send({
        from: 'halalfoodfoundation.co.uk <info@theyoungpioneers.com>',
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

    res.status(201).json({ data, message: 'Application submitted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/applications/:id/status (admin only)
router.put('/:id/status', authenticateToken, async (req, res) => {
  try {
    const { status, notes, inspector_id, audit_date } = req.body;
    const inspectorIdVal = inspector_id === "" ? null : inspector_id;

    const data = await Application.findByIdAndUpdate(
      req.params.id,
      { status, admin_notes: notes, inspector_id: inspectorIdVal, audit_date, updated_at: new Date() },
      { new: true }
    );

    if (!data) return res.status(404).json({ error: 'Application not found' });
    
    const client = await User.findById(data.client_id);
    if (client) {
      const statusLabels = {
        under_review: 'Under Review', approved: 'Approved', rejected: 'Rejected',
        on_hold: 'On Hold', audit_scheduled: 'Audit Scheduled', audit_completed: 'Audit Completed',
        certificate_issued: 'Certificate Issued',
      };

      try {
        await resend.emails.send({
          from: 'halalfoodfoundation.co.uk <info@theyoungpioneers.com>',
          to: client.email,
          subject: `Application Update – ${data.application_number}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#f9fafb">
              <div style="background:white;border-radius:12px;padding:32px">
                <h2 style="color:#166534">Application Status Update</h2>
                <p>Dear ${client.full_name},</p>
                <p>New Status: <strong style="color:#15803d">${statusLabels[status] || status}</strong></p>
                <a href="${process.env.FRONTEND_CLIENT_URL}/applications/${req.params.id}" style="display:inline-block;background:#15803d;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:16px">View Application</a>
              </div>
            </div>
          `,
        });
      } catch (emailErr) {
        console.error('Email failed:', emailErr);
      }
    }

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
