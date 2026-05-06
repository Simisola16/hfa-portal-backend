import express from 'express';
import mongoose from 'mongoose';
import { getGridFSBucket } from '../lib/gridfs.js';

const router = express.Router();

// GET /api/files/:id
router.get('/:id', async (req, res) => {
  try {
    const gfs = getGridFSBucket();
    if (!gfs) return res.status(500).json({ error: 'GridFS not ready' });

    const fileId = new mongoose.Types.ObjectId(req.params.id);
    const files = await gfs.find({ _id: fileId }).toArray();

    if (!files || files.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = files[0];

    // Force browser to download the file instead of rendering PDF bugs
    res.set('Content-Type', file.contentType);
    res.set('Content-Disposition', `attachment; filename="${file.filename}"`);

    const readStream = gfs.openDownloadStream(fileId);
    readStream.pipe(res);
    
    readStream.on('error', (err) => {
      res.status(500).json({ error: 'Error streaming file' });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
