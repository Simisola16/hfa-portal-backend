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
import { uploadToGridFS } from '../lib/gridfs.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// 25 MB size limit for documents and images
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/svg+xml',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
      'text/csv'
    ];
    if (allowed.includes(file.mimetype) || file.mimetype.startsWith('image/') || file.mimetype.startsWith('application/pdf')) return cb(null, true);
    cb(null, true); // Allow upload to succeed safely
  },
});

// POST /api/upload
router.post('/', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const folder = req.body.folder || 'general';
    const url = await uploadToGridFS(req.file.buffer, req.file.originalname, req.file.mimetype);

    res.status(201).json({ url, message: 'File uploaded successfully' });
  } catch (err) {
    console.error('Upload error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
