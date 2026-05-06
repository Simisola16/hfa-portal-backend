/**
 * POST /api/upload
 *
 * General-purpose Supabase Storage upload endpoint.
 * Accepts a single file (field name: "file") and an optional "folder" body field.
 * Returns { url } — the permanent public URL from Supabase Storage.
 *
 * Used by both the admin and client portals to upload PDFs
 * (certificates, export documents, invoices, etc.) on the fly.
 */
import express from 'express';
import multer from 'multer';
import { uploadToSupabase } from '../lib/supabase.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// 20 MB size limit for PDFs
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Only PDF and image files are allowed'));
  },
});

// POST /api/upload
router.post('/', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const folder = req.body.folder || 'general';
    const url = await uploadToSupabase(req.file.buffer, req.file.originalname, folder);

    res.status(201).json({ url, message: 'File uploaded successfully' });
  } catch (err) {
    console.error('Upload error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
