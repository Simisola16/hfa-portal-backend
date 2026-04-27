import express from 'express';
import Certificate from '../models/Certificate.js';
import Application from '../models/Application.js';
import User from '../models/User.js';
import { authenticateToken } from '../middleware/auth.js';
import { Resend } from 'resend';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);

router.get('/', authenticateToken, async (req, res) => {
  try {
    let query = {};
    if (req.user.role !== 'admin') {
      query.client_id = req.user._id;
    }
    const data = await Certificate.find(query).sort({ created_at: -1 });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const data = await Certificate.findById(req.params.id);
    if (!data) return res.status(404).json({ error: 'Certificate not found' });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    const { client_id, application_id, site_id, certificate_type, issue_date, expiry_date, products_covered, certificate_number } = req.body;
    const certNo = certificate_number || `HFA-CERT-${Date.now().toString().slice(-8)}`;

    const certificate = new Certificate({
      certificate_number: certNo, client_id, application_id, site_id,
      certificate_type, issue_date, expiry_date, products_covered,
      status: 'active'
    });

    const data = await certificate.save();

    // Update application status
    await Application.findByIdAndUpdate(application_id, { status: 'certificate_issued' });

    // Send email
    const client = await User.findById(client_id);
    if (client) {
      try {
        await resend.emails.send({
          from: 'halalfoodfoundation.co.uk <info@theyoungpioneers.com>',
          to: client.email,
          subject: `Your Halal Certificate is Ready – ${certNo}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#f9fafb">
              <div style="background:linear-gradient(135deg,#15803d,#166534);border-radius:12px;padding:32px;text-align:center;margin-bottom:24px">
                <h1 style="color:white;margin:0">🏅 Certificate Issued</h1>
                <p style="color:#bbf7d0">Halal Food Authority</p>
              </div>
              <div style="background:white;border-radius:12px;padding:32px">
                <h2 style="color:#166534">Congratulations, ${client.full_name}!</h2>
                <p>Your Halal Certificate has been issued for <strong>${client.company_name}</strong>.</p>
                <a href="${process.env.FRONTEND_CLIENT_URL || 'http://localhost:5173'}/certificates/${data._id}" style="display:inline-block;background:#15803d;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:24px">Download Certificate</a>
              </div>
            </div>
          `,
        });
      } catch (emailErr) {
        console.error('Resend Email Error:', emailErr);
      }
    }

    res.status(201).json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/revoke', authenticateToken, async (req, res) => {
  try {
    const { reason } = req.body;
    const data = await Certificate.findByIdAndUpdate(req.params.id, { status: 'revoked', revocation_reason: reason }, { new: true });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
