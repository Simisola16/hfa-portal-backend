import express from 'express';
import multer from 'multer';
import Certificate from '../models/Certificate.js';
import Application from '../models/Application.js';
import User from '../models/User.js';
import { uploadToGridFS } from '../lib/gridfs.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { createNotification } from '../lib/notifications.js';
import { Resend } from 'resend';
import dotenv from 'dotenv';
import { generateCertificate } from '../services/certificateGenerator.js';

dotenv.config();

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);
const emailFrom = process.env.EMAIL_FROM || 'HFA Portal <info@halalfoodfoundation.org.uk>';
const upload = multer({ storage: multer.memoryStorage() });

// GET all certificates (admin: all, client: own)
router.get('/', authenticateToken, async (req, res) => {
  try {
    let query = {};
    if (req.user.role !== 'admin') {
      query.client_id = req.user._id.toString();
    }
    const data = await Certificate.find(query).sort({ createdAt: -1 });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET certificate by application ID
router.get('/application/:appId', authenticateToken, async (req, res) => {
  try {
    const data = await Certificate.findOne({ application_id: req.params.appId }).sort({ createdAt: -1 });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single certificate
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const data = await Certificate.findById(req.params.id);
    if (!data) return res.status(404).json({ error: 'Certificate not found' });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create & issue certificate (with optional PDF upload)
router.post('/', authenticateToken, requireAdmin, upload.single('certificate_file'), async (req, res) => {
  try {
    const { client_id, application_id, site_id, certificate_type, issue_date, expiry_date, products_covered, certificate_number } = req.body;
    const certNo = certificate_number || `HFA-CERT-${Date.now().toString().slice(-8)}`;

    let certificate_url = null;
    if (req.file) {
      certificate_url = await uploadToGridFS(req.file.buffer, req.file.originalname, req.file.mimetype);
    }

    const parsedProducts = Array.isArray(products_covered) 
      ? products_covered 
      : (typeof products_covered === 'string' ? products_covered.split(',').map(p => p.trim()).filter(Boolean) : []);

    const certificate = new Certificate({
      certificate_number: certNo,
      client_id,
      application_id,
      site_id,
      certificate_type,
      issue_date,
      expiry_date,
      products_covered: parsedProducts,
      certificate_url,
      status: 'active'
    });

    const data = await certificate.save();

    // Update application status
    await Application.findByIdAndUpdate(application_id, {
      status: 'SEND CERTIFICATE',
      updated_at: new Date()
    });

    // Notify client
    await createNotification(
      client_id,
      '🏅 Certificate Issued',
      `Your Halal Certification certificate (${certNo}) has been issued. Please log in to download it.`,
      'success',
      '/certificates'
    );

    // Send email
    const client = await User.findById(client_id);
    if (client) {
      try {
        await resend.emails.send({
          from: emailFrom,
          to: client.email,
          subject: `🏅 Your Halal Certificate is Ready – ${certNo}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#f9fafb">
              <div style="background:linear-gradient(135deg,#15803d,#166534);border-radius:12px;padding:32px;text-align:center;margin-bottom:24px">
                <h1 style="color:white;margin:0">🏅 Certificate Issued</h1>
                <p style="color:#bbf7d0;margin:8px 0 0">Halal Food Authority</p>
              </div>
              <div style="background:white;border-radius:12px;padding:32px">
                <h2 style="color:#166534;margin:0 0 16px">Congratulations, ${client.full_name}!</h2>
                <p style="color:#374151">Your Halal Certificate has been issued for <strong>${client.company_name}</strong>.</p>
                <p style="color:#374151">Certificate Number: <strong>${certNo}</strong></p>
                <a href="${process.env.FRONTEND_CLIENT_URL || 'http://localhost:5173'}/certificates" style="display:inline-block;background:linear-gradient(135deg,#15803d,#166534);color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:24px">View My Certificate</a>
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

// Helper function to build cert data from Application
async function buildCertDataFromApplication(application) {
  const User = (await import('../models/User.js')).default;
  const client = await User.findById(application.client_id);
  const certNumber = `HFA-UK-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
  
  const productCategories = (application.products || []).map(p => ({
    code: p.brand || 'GEN',
    name: p.name
  }));

  return {
    businessName: client ? (client.company_name || client.full_name) : application.establishment_name,
    businessAddress: application.establishment_address || '—',
    manufacturerAddress: application.manufacturer_address || 'Same as above',
    certificateNumber: certNumber,
    scopeOfCertification: application.scope || 'Halal Food Certification',
    productCategories,
    issueDate: new Date(),
    expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year expiry
    verificationUrl: `${process.env.FRONTEND_CLIENT_URL || 'https://hfa-portal.vercel.app'}/verify/${certNumber}`
  };
}

// POST /api/certificates/generate
router.post('/generate', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { applicationId } = req.body;
    if (!applicationId) {
      return res.status(400).json({ error: 'applicationId is required' });
    }

    const application = await Application.findById(applicationId);
    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    // Check if an active certificate already exists for this application
    let existingCert = await Certificate.findOne({ application_id: applicationId, status: 'active' });
    if (existingCert) {
      return res.status(400).json({ 
        error: 'An active certificate already exists for this application. Use the regenerate endpoint to recreate it.',
        certificateNumber: existingCert.certificate_number,
        certificateUrl: existingCert.certificate_url
      });
    }

    const certData = await buildCertDataFromApplication(application);
    const pdfBuffer = await generateCertificate(certData);

    // Upload to GridFS
    const filename = `${certData.certificateNumber}.pdf`;
    const certificate_url = await uploadToGridFS(pdfBuffer, filename, 'application/pdf');

    // Save certificate record
    const certificate = new Certificate({
      certificate_number: certData.certificateNumber,
      client_id: application.client_id.toString(),
      application_id: application._id,
      site_id: application.site_id,
      certificate_type: application.application_type || 'Halal Certificate',
      issue_date: certData.issueDate,
      expiry_date: certData.expiryDate,
      products_covered: (certData.productCategories || []).map(p => typeof p === 'string' ? p : (p?.name || '')).filter(Boolean).length > 0
        ? (certData.productCategories || []).map(p => typeof p === 'string' ? p : (p?.name || '')).filter(Boolean)
        : ['Certified Halal Food Products'],
      certificate_url,
      status: 'active'
    });

    const data = await certificate.save();

    // Update application status to CERTIFICATE ISSUED (case matches the status list in frontend/routes)
    await Application.findByIdAndUpdate(applicationId, {
      status: 'certificate_issued',
      updated_at: new Date()
    });

    // Notify client
    await createNotification(
      application.client_id,
      '🏅 Certificate Issued',
      `Your Halal Certification certificate (${certData.certificateNumber}) has been issued. Please log in to download it.`,
      'success',
      '/certificates'
    );

    // Send email to client
    const client = await User.findById(application.client_id);
    if (client) {
      try {
        await resend.emails.send({
          from: emailFrom,
          to: client.email,
          subject: `🏅 Your Halal Certificate is Ready – ${certData.certificateNumber}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#f9fafb">
              <div style="background:linear-gradient(135deg,#15803d,#166534);border-radius:12px;padding:32px;text-align:center;margin-bottom:24px">
                <h1 style="color:white;margin:0">🏅 Certificate Issued</h1>
                <p style="color:#bbf7d0;margin:8px 0 0">Halal Food Authority</p>
              </div>
              <div style="background:white;border-radius:12px;padding:32px">
                <h2 style="color:#166534;margin:0 0 16px">Congratulations, ${client.full_name}!</h2>
                <p style="color:#374151">Your Halal Certificate has been issued for <strong>${client.company_name}</strong>.</p>
                <p style="color:#374151">Certificate Number: <strong>${certData.certificateNumber}</strong></p>
                <a href="${process.env.FRONTEND_CLIENT_URL || 'http://localhost:5173'}/certificates" style="display:inline-block;background:linear-gradient(135deg,#15803d,#166534);color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:24px">View My Certificate</a>
              </div>
            </div>
          `,
        });
      } catch (emailErr) {
        console.error('Resend Email Error:', emailErr);
      }
    }

    res.status(201).json({ 
      success: true, 
      certificateUrl: certificate_url, 
      certificateNumber: certData.certificateNumber,
      data 
    });
  } catch (err) {
    console.error('Certificate generation endpoint failed:', err);
    res.status(500).json({ error: 'Certificate generation failed: ' + err.message });
  }
});

// POST /api/certificates/:certificateId/regenerate
router.post('/:certificateId/regenerate', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const certificate = await Certificate.findById(req.params.certificateId);
    if (!certificate) {
      return res.status(404).json({ error: 'Certificate not found' });
    }

    const application = await Application.findById(certificate.application_id);
    if (!application) {
      return res.status(404).json({ error: 'Linked application not found' });
    }

    const client = await User.findById(application.client_id);
    const productCategories = (Array.isArray(certificate.products_covered) ? certificate.products_covered : [])
      .map((p, idx) => ({
        code: `GEN-${String(idx + 1).padStart(2, '0')}`,
        name: p
      }));

    const certData = {
      businessName: client ? (client.company_name || client.full_name) : application.establishment_name,
      businessAddress: application.establishment_address || '—',
      manufacturerAddress: application.manufacturer_address || 'Same as above',
      certificateNumber: certificate.certificate_number,
      scopeOfCertification: application.scope || 'Halal Food Certification',
      productCategories,
      issueDate: certificate.issue_date || new Date(),
      expiryDate: certificate.expiry_date || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      verificationUrl: `${process.env.FRONTEND_CLIENT_URL || 'https://hfa-portal.vercel.app'}/verify/${certificate.certificate_number}`
    };

    const pdfBuffer = await generateCertificate(certData);

    // Upload to GridFS
    const filename = `${certificate.certificate_number}.pdf`;
    const certificate_url = await uploadToGridFS(pdfBuffer, filename, 'application/pdf');

    // Update certificate URL
    certificate.certificate_url = certificate_url;
    certificate.updated_at = new Date();
    await certificate.save();

    res.json({ 
      success: true, 
      certificateUrl: certificate_url, 
      certificateNumber: certificate.certificate_number,
      data: certificate
    });
  } catch (err) {
    console.error('Certificate regeneration endpoint failed:', err);
    res.status(500).json({ error: 'Certificate regeneration failed: ' + err.message });
  }
});

// GET /api/certificates/:id/download
router.get('/:id/download', authenticateToken, async (req, res) => {
  try {
    const certificate = await Certificate.findById(req.params.id);
    if (!certificate) return res.status(404).json({ error: 'Certificate not found' });

    // Client can only download their own certificate
    if (req.user.role !== 'admin' && certificate.client_id !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!certificate.certificate_url) {
      return res.status(404).json({ error: 'Certificate file URL is not available' });
    }

    // Redirect to the internal GridFS file endpoint or direct link
    if (certificate.certificate_url.startsWith('/api/files/')) {
      const fileId = certificate.certificate_url.replace('/api/files/', '');
      res.redirect(`/api/files/${fileId}`);
    } else {
      res.redirect(certificate.certificate_url);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT revoke
router.put('/:id/revoke', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    const data = await Certificate.findByIdAndUpdate(req.params.id, { status: 'revoked', revocation_reason: reason }, { new: true });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
