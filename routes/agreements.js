import express from 'express';
import multer from 'multer';
import { uploadToGridFS } from '../lib/gridfs.js';
import Agreement from '../models/Agreement.js';
import Application from '../models/Application.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { createNotification } from '../lib/notifications.js';
import User from '../models/User.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// GET /api/agreements/application/:appId
router.get('/application/:appId', authenticateToken, async (req, res) => {
  try {
    const data = await Agreement.findOne({ application_id: req.params.appId }).sort({ createdAt: -1 });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/agreements (Admin only - send agreement)
router.post('/', authenticateToken, requireAdmin, upload.single('agreement_file'), async (req, res) => {
  try {
    const agreementData = { ...req.body };
    if (req.file) {
      agreementData.agreement_url = await uploadToGridFS(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );
    }
    const agreement = new Agreement(agreementData);
    const data = await agreement.save();

    // Automatically update Application status to AGREEMENT SENT
    await Application.findByIdAndUpdate(agreement.application_id, { status: 'AGREEMENT SENT' });

    // Notify Client
    await createNotification(
      data.client_id,
      'Certification Agreement Sent 📄',
      `Your certification agreement "${data.title}" is ready. Please review, sign, and upload a copy.`,
      'info',
      '/applications'
    );

    res.status(201).json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/agreements/:id (Update status / upload signed copy / approve)
router.put('/:id', authenticateToken, upload.single('signed_agreement_file'), async (req, res) => {
  try {
    const agreement = await Agreement.findById(req.params.id);
    if (!agreement) return res.status(404).json({ error: 'Agreement not found' });

    // If client, check ownership
    if (req.user.role !== 'admin' && agreement.client_id !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { status, client_comment, admin_comment, title, details } = req.body;

    if (req.file) {
      agreement.signed_agreement_url = await uploadToGridFS(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );
    }

    if (status) agreement.status = status;
    if (client_comment) agreement.client_comment = client_comment;
    if (admin_comment) agreement.admin_comment = admin_comment;
    if (title) agreement.title = title;
    if (details) agreement.details = details;

    const data = await agreement.save();

    // Side-effects based on status updates
    if (status === 'signed') {
      // Automatically update Application status to SIGNED COPY OF AGREEMENT SENT
      await Application.findByIdAndUpdate(agreement.application_id, { status: 'SIGNED COPY OF AGREEMENT SENT' });

      // Notify Admins
      const admins = await User.find({ role: 'admin' });
      for (const admin of admins) {
        await createNotification(
          admin._id,
          'Signed Agreement Received ✍️',
          `Client has uploaded the signed copy of certification agreement: ${agreement.title}.`,
          'success',
          '/applications'
        );
      }
    } else if (status === 'approved') {
      // Automatically update Application status to AGREEMENT SIGNED COPY RECEIVED
      await Application.findByIdAndUpdate(agreement.application_id, { status: 'AGREEMENT SIGNED COPY RECEIVED' });

      // Notify Client
      await createNotification(
        agreement.client_id,
        'Agreement Approved ✅',
        `Your signed certification agreement "${agreement.title}" has been approved by HFA.`,
        'success',
        '/applications'
      );
    }

    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
