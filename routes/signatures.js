import express from 'express';
import multer from 'multer';
import { uploadToGridFS } from '../lib/gridfs.js';
import { authenticateToken } from '../middleware/auth.js';
import Signature from '../models/Signature.js';
import User from '../models/User.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Only image files are allowed for signatures'));
  },
});

// GET /api/signatures — list all with optional search
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { search = '' } = req.query;
    const query = search
      ? { $or: [
          { name: { $regex: search, $options: 'i' } },
          { username: { $regex: search, $options: 'i' } },
        ]}
      : {};
    const signatures = await Signature.find(query).sort({ created_at: -1 });
    res.json(signatures);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/signatures — create new signature
router.post('/', authenticateToken, upload.single('signature_file'), async (req, res) => {
  try {
    const { name, username, user_id } = req.body;
    if (!name || !username) return res.status(400).json({ error: 'Name and username are required' });

    let signature_url = null;
    if (req.file) {
      signature_url = await uploadToGridFS(req.file.buffer, req.file.originalname, req.file.mimetype);
    }

    const sig = new Signature({ name: name.trim(), username: username.trim(), user_id: user_id || undefined, signature_url });
    await sig.save();
    res.status(201).json(sig);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/signatures/:id — update signature (re-upload image)
router.put('/:id', authenticateToken, upload.single('signature_file'), async (req, res) => {
  try {
    const sig = await Signature.findById(req.params.id);
    if (!sig) return res.status(404).json({ error: 'Signature not found' });

    const { name, username, user_id } = req.body;
    if (name) sig.name = name.trim();
    if (username) sig.username = username.trim();
    if (user_id) sig.user_id = user_id;
    if (req.file) {
      sig.signature_url = await uploadToGridFS(req.file.buffer, req.file.originalname, req.file.mimetype);
    }
    await sig.save();
    res.json(sig);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/signatures/:id
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const sig = await Signature.findByIdAndDelete(req.params.id);
    if (!sig) return res.status(404).json({ error: 'Signature not found' });
    res.json({ message: 'Signature deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
