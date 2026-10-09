import express from 'express';
import mongoose from 'mongoose';
import Certificate from '../models/Certificate.js';
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

    // Invalidate access to inactive/deactivated certificates if accessed via QR code or direct link (inline view)
    if (key.startsWith('certificates/') && !isDownload) {
      try {
        const cert = await Certificate.findOne({
          certificate_url: { $regex: key.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'), $options: 'i' }
        }).populate('client_id');

        if (cert && ['inactive', 'superseded', 'revoked', 'deactivated'].includes((cert.status || '').toLowerCase().trim())) {
          const isRevoked = (cert.status || '').toLowerCase() === 'revoked';
          const companyName = cert.company_name || cert.client_id?.company_name || cert.client_id?.name || '';
          return res.status(403).send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Certificate Inactive | Halal Food Authority</title>
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #1e293b; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; box-sizing: border-box; }
                .card { background: white; max-width: 520px; width: 100%; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.06); padding: 40px; text-align: center; border: 1px solid #e2e8f0; }
                .badge-deactivated { display: inline-block; padding: 6px 14px; border-radius: 9999px; background: #fee2e2; color: #b91c1c; font-weight: 700; font-size: 13px; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 16px; }
                .badge-inactive { display: inline-block; padding: 6px 14px; border-radius: 9999px; background: #f1f5f9; color: #475569; font-weight: 700; font-size: 13px; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 16px; }
                .icon { font-size: 44px; margin-bottom: 12px; }
                h1 { font-size: 22px; font-weight: 700; margin: 0 0 10px 0; color: #0f172a; }
                p { font-size: 14.5px; line-height: 1.6; color: #64748b; margin: 0 0 20px 0; }
                .details { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; margin: 20px 0; text-align: left; font-size: 13.5px; }
                .detail-row { display: flex; justify-content: space-between; margin-bottom: 8px; }
                .detail-row:last-child { margin-bottom: 0; }
                .detail-label { color: #64748b; font-weight: 500; }
                .detail-value { color: #0f172a; font-weight: 600; text-align: right; }
                .btn { display: inline-block; background: #15803d; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; }
                .footer-note { font-size: 12px; color: #94a3b8; margin-top: 24px; line-height: 1.4; }
              </style>
            </head>
            <body>
              <div class="card">
                <div class="icon">⛔</div>
                <div class="${isRevoked ? 'badge-deactivated' : 'badge-inactive'}">
                  ${isRevoked ? 'Certificate Revoked' : 'Certificate Inactive / Deactivated'}
                </div>
                <h1>Certificate No Longer Valid</h1>
                <p>
                  The certificate associated with this QR code has been <strong>${isRevoked ? 'revoked' : 'deactivated'}</strong> by the Halal Food Authority. This verification record is no longer active.
                </p>
                <div class="details">
                  <div class="detail-row">
                    <span class="detail-label">Certificate No:</span>
                    <span class="detail-value">${cert.certificate_number}</span>
                  </div>
                  ${companyName ? `
                  <div class="detail-row">
                    <span class="detail-label">Company:</span>
                    <span class="detail-value">${companyName}</span>
                  </div>` : ''}
                  <div class="detail-row">
                    <span class="detail-label">Status:</span>
                    <span class="detail-value" style="color: #dc2626; text-transform: capitalize;">${cert.status}</span>
                  </div>
                </div>
                <p style="font-size: 13px; color: #94a3b8; margin-bottom: 24px;">
                  If you require verification assistance, please contact the Halal Food Authority directly.
                </p>
                <a href="https://halalfoodauthority.com" class="btn">Visit HFA Official Site</a>
                <div class="footer-note">
                  Halal Food Authority (HFA) · Official Certification Registry
                </div>
              </div>
            </body>
            </html>
          `);
        }
      } catch (checkErr) {
        console.error('Error validating certificate status for inline S3 file:', checkErr);
      }
    }

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
