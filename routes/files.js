import express from 'express';
import mongoose from 'mongoose';
import { getGridFSBucket } from '../lib/gridfs.js';
import { getS3Stream, getS3PresignedUrl, isS3Resource, extractS3Key } from '../lib/s3.js';

const router = express.Router();

/**
 * GET /api/files/s3/*
 * Securely streams files stored in AWS S3 or redirects to Pre-signed URL.
 */
router.get('/s3/*', async (req, res) => {
  try {
    const rawKey = req.params[0];
    if (!rawKey) {
      return res.status(400).json({ error: 'Missing S3 object key' });
    }

    const key = decodeURIComponent(rawKey);
    const isDownload = req.query.download === 'true' || req.query.download === '1';
    const usePresigned = req.query.presigned === 'true' || req.query.presigned === '1';

    // Option: Redirect to short-lived AWS Pre-signed URL if requested
    if (usePresigned) {
      const presignedUrl = await getS3PresignedUrl(key, 3600);
      return res.redirect(presignedUrl);
    }

    // Stream directly from S3
    const { stream, contentType, contentLength, filename } = await getS3Stream(key);

    const isInlineType = contentType && (
      contentType.startsWith('image/') ||
      contentType === 'application/pdf' ||
      contentType.includes('pdf')
    );
    const disposition = (!isDownload && isInlineType) ? 'inline' : 'attachment';

    res.set('Content-Type', contentType || 'application/pdf');
    res.set('Content-Disposition', `${disposition}; filename="${encodeURIComponent(filename)}"`);
    res.set('Accept-Ranges', 'bytes');
    if (contentLength) {
      res.set('Content-Length', contentLength);
    }

    // Node stream piping to express response
    stream.pipe(res);

    stream.on('error', (err) => {
      console.error('S3 stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error streaming file from S3' });
      }
    });
  } catch (err) {
    console.error('S3 file retrieval error:', err);
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      return res.status(404).json({ error: 'File not found in S3' });
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/files/:id
 * Legacy handler: streams legacy MongoDB GridFS files, or forwards S3 keys if applicable.
 */
router.get('/:id', async (req, res) => {
  try {
    const id = req.params.id;

    // If ID indicates an S3 path
    if (isS3Resource(id)) {
      const s3Key = extractS3Key(id);
      return res.redirect(`/api/files/s3/${encodeURIComponent(s3Key)}`);
    }

    // If not a valid ObjectId, return 404
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ error: 'File not found or invalid ID' });
    }

    const gfs = await getGridFSBucket();
    if (!gfs) return res.status(500).json({ error: 'GridFS storage not ready' });

    const fileId = new mongoose.Types.ObjectId(id);
    const files = await gfs.find({ _id: fileId }).toArray();

    if (!files || files.length === 0) {
      return res.status(404).json({ error: 'File not found in GridFS' });
    }

    const file = files[0];

    const isDownload = req.query.download === 'true' || req.query.download === '1';
    const isInlineType = file.contentType && (
      file.contentType.startsWith('image/') ||
      file.contentType === 'application/pdf' ||
      file.contentType.includes('pdf')
    );
    const disposition = (!isDownload && isInlineType) ? 'inline' : 'attachment';

    res.set('Content-Type', file.contentType || 'application/pdf');
    res.set('Content-Disposition', `${disposition}; filename="${file.filename}"`);
    res.set('Accept-Ranges', 'bytes');

    const readStream = gfs.openDownloadStream(fileId);
    readStream.pipe(res);

    readStream.on('error', (err) => {
      console.error('GridFS stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error streaming file from GridFS' });
      }
    });
  } catch (err) {
    console.error('File route error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
