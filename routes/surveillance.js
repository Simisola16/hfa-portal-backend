import express from 'express';
import multer from 'multer';
import { uploadToGridFS } from '../lib/gridfs.js';
import SurveillanceRequest from '../models/SurveillanceRequest.js';
import Certificate from '../models/Certificate.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { createNotification } from '../lib/notifications.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// ─── CLIENT ROUTES ───────────────────────────────────────────────────────────

// POST /api/surveillance — client requests a surveillance visit for a certificate
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { certificate_id } = req.body;
    if (!certificate_id) {
      return res.status(400).json({ error: 'certificate_id is required.' });
    }

    const cert = await Certificate.findById(certificate_id);
    if (!cert) {
      return res.status(404).json({ error: 'Certificate not found.' });
    }

    // Ensure the certificate belongs to this client
    if (req.user.role !== 'admin' && cert.client_id?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    // Prevent duplicate pending requests
    const existing = await SurveillanceRequest.findOne({ certificate_id, status: 'requested' });
    if (existing) {
      return res.status(409).json({ error: 'A surveillance request is already pending for this certificate.' });
    }

    // Verify request timing (available starting 3 months / 90 days before next surveillance due date)
    if (cert.issue_date) {
      const fulfilledReqs = await SurveillanceRequest.find({ certificate_id, status: 'fulfilled' });
      let nextDueDate = new Date(cert.issue_date);
      if (fulfilledReqs.length === 0) {
        nextDueDate.setFullYear(nextDueDate.getFullYear() + 1);
      } else if (fulfilledReqs.length === 1) {
        nextDueDate.setFullYear(nextDueDate.getFullYear() + 2);
      } else if (cert.expiry_date) {
        nextDueDate = new Date(cert.expiry_date);
      }

      const diffMs = nextDueDate.getTime() - Date.now();
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays > 90 && req.user.role !== 'admin') {
        return res.status(400).json({ error: `Surveillance request is locked. Requests can only be submitted starting 3 months before your next surveillance due date (${nextDueDate.toDateString()}).` });
      }
    }

    const request = new SurveillanceRequest({
      client_id: req.user._id.toString(),
      certificate_id,
    });
    await request.save();

    // Notify all admins
    const User = (await import('../models/User.js')).default;
    const admins = await User.find({ role: 'admin' });
    for (const admin of admins) {
      await createNotification(
        admin._id,
        'Surveillance Visit Requested 🔔',
        `A client has requested an annual surveillance visit for certificate #${cert.certificate_number}.`,
        'info',
        '/certificates'
      );
    }

    res.status(201).json({ data: request });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/surveillance/my — client gets their own surveillance requests
router.get('/my', authenticateToken, async (req, res) => {
  try {
    const requests = await SurveillanceRequest.find({ client_id: req.user._id.toString() })
      .populate('certificate_id')
      .sort({ requested_at: -1 });
    res.json({ data: requests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/surveillance/certificate/:certId — get requests for a specific cert (client or admin)
router.get('/certificate/:certId', authenticateToken, async (req, res) => {
  try {
    const requests = await SurveillanceRequest.find({ certificate_id: req.params.certId }).sort({ requested_at: -1 });
    res.json({ data: requests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ADMIN ROUTES ─────────────────────────────────────────────────────────────

// GET /api/surveillance — list all (admin only)
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const requests = await SurveillanceRequest.find({})
      .populate('certificate_id')
      .sort({ requested_at: -1 });
    res.json({ data: requests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/surveillance/:id/fulfill — admin uploads letter and marks fulfilled
router.put('/:id/fulfill', authenticateToken, requireAdmin, upload.single('letter_file'), async (req, res) => {
  try {
    const request = await SurveillanceRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Surveillance request not found.' });

    let letter_file_url = request.letter_file_url;
    if (req.file) {
      letter_file_url = await uploadToGridFS(req.file.buffer, req.file.originalname, req.file.mimetype);
    }

    request.status = 'fulfilled';
    request.letter_file_url = letter_file_url;
    request.fulfilled_at = new Date();
    if (req.body.notes) request.notes = req.body.notes;
    await request.save();

    // Notify client
    await createNotification(
      request.client_id,
      'Surveillance Visit Scheduled 📅',
      'Your surveillance visit request has been fulfilled. Please check your portal for details.',
      'success',
      '/certificates'
    );

    res.json({ data: request });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
