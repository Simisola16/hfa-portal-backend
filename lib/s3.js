import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import dotenv from 'dotenv';

dotenv.config();

const region = process.env.AWS_REGION || 'eu-west-2';
const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
export const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || 'hfaportal';

export const s3Client = new S3Client({
  region,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

/**
 * Sanitizes a filename to ensure safe S3 object keys.
 */
function sanitizeFilename(filename = 'file') {
  const parts = filename.split('.');
  const ext = parts.length > 1 ? parts.pop().toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  const base = parts.join('.')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 80);
  return ext ? `${base}.${ext}` : base;
}

/**
 * Uploads a file buffer to AWS S3.
 *
 * @param {Buffer} buffer - File buffer from multer memoryStorage or pdf-lib
 * @param {string} originalname - Original name of the file
 * @param {string} mimetype - MIME type (e.g. application/pdf, image/png)
 * @param {string} folder - Destination folder prefix in S3 (e.g. "certificates", "invoices")
 * @returns {Promise<string>} The file URL formatted as `/api/files/s3/${key}`
 */
export async function uploadToS3(buffer, originalname = 'document.pdf', mimetype = 'application/pdf', folder = 'uploads') {
  if (!buffer) {
    throw new Error('uploadToS3: No buffer provided');
  }

  const cleanFilename = sanitizeFilename(originalname);
  const key = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${cleanFilename}`;

  const resolvedContentType = mimetype || (cleanFilename.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: resolvedContentType,
    ContentDisposition: `inline; filename="${encodeURIComponent(cleanFilename)}"`,
  });

  await s3Client.send(command);

  // Return the unified streaming route path so private bucket access is securely handled
  return `/api/files/s3/${key}`;
}

/**
 * Generates an AWS Pre-signed URL for temporary direct access to an S3 object.
 *
 * @param {string} key - S3 object key
 * @param {number} expiresIn - Expiry in seconds (default 3600 = 1 hour)
 * @returns {Promise<string>} Pre-signed URL
 */
export async function getS3PresignedUrl(key, expiresIn = 3600) {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });
  return await getSignedUrl(s3Client, command, { expiresIn });
}

/**
 * Retrieves a readable stream and metadata from S3 for direct streaming.
 *
 * @param {string} key - S3 object key
 * @returns {Promise<{ stream: ReadableStream, contentType: string, contentLength: number, filename: string }>}
 */
export async function getS3Stream(key) {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  const response = await s3Client.send(command);

  if (!response.Body) {
    const err = new Error(`S3 returned empty body for key: ${key}`);
    err.name = 'NoSuchKey';
    throw err;
  }

  const filename = key.split('/').pop() || 'document';

  return {
    stream: response.Body,
    contentType: response.ContentType || 'application/octet-stream',
    contentLength: response.ContentLength,
    filename,
  };
}

/**
 * Deletes an object from AWS S3.
 *
 * @param {string} key - S3 object key
 */
export async function deleteFromS3(key) {
  try {
    const cleanKey = extractS3Key(key);
    if (!cleanKey) return;
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: cleanKey,
    });
    await s3Client.send(command);
  } catch (err) {
    console.error(`deleteFromS3 error for key ${key}:`, err.message);
  }
}

/**
 * Extracts the S3 key from a URL or relative path.
 * Supports `/api/files/s3/<key>` and full S3 bucket URLs.
 */
export function extractS3Key(urlOrKey) {
  if (!urlOrKey || typeof urlOrKey !== 'string') return null;

  // Case 1: /api/files/s3/<key>
  if (urlOrKey.startsWith('/api/files/s3/')) {
    return urlOrKey.replace('/api/files/s3/', '');
  }

  // Case 2: s3/<key>
  if (urlOrKey.startsWith('s3/')) {
    return urlOrKey.replace('s3/', '');
  }

  // Case 3: https://<bucket>.s3.<region>.amazonaws.com/<key>
  const s3Match = urlOrKey.match(/https?:\/\/[^/]+\.amazonaws\.com\/(.+?)(\?.*)?$/);
  if (s3Match) {
    return decodeURIComponent(s3Match[1]);
  }

  // Case 4: Plain key with a folder prefix
  if (urlOrKey.includes('/') && !urlOrKey.startsWith('http') && !urlOrKey.startsWith('/api/files/')) {
    return urlOrKey;
  }

  return null;
}

/**
 * Checks if a given URL or identifier is an S3-backed resource.
 */
export function isS3Resource(urlOrId) {
  if (!urlOrId || typeof urlOrId !== 'string') return false;
  return (
    urlOrId.startsWith('/api/files/s3/') ||
    urlOrId.startsWith('s3/') ||
    urlOrId.includes('.amazonaws.com/')
  );
}

export default {
  s3Client,
  BUCKET_NAME,
  uploadToS3,
  getS3PresignedUrl,
  getS3Stream,
  deleteFromS3,
  extractS3Key,
  isS3Resource,
};
