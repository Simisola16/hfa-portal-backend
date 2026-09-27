import User from '../models/User.js';
import Admin from '../models/Admin.js';
import dotenv from 'dotenv';

dotenv.config();

// ─── Azure / Microsoft Graph credentials ─────────────────────────────────────
const AZURE_TENANT_ID     = process.env.AZURE_TENANT_ID;
const AZURE_CLIENT_ID     = process.env.AZURE_CLIENT_ID;
const AZURE_CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET;
const AZURE_SENDER_EMAIL  = process.env.AZURE_SENDER_EMAIL || 'portals@halalfoodauthority.com';

export const emailFrom = AZURE_SENDER_EMAIL;

// Cache the access token so we don't re-fetch on every email
let _tokenCache = { token: null, expiresAt: 0 };

async function getAccessToken() {
  if (_tokenCache.token && Date.now() < _tokenCache.expiresAt - 60_000) {
    return _tokenCache.token;
  }

  const url = `https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     AZURE_CLIENT_ID,
    client_secret: AZURE_CLIENT_SECRET,
    scope:         'https://graph.microsoft.com/.default'
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`[Mailer] Azure token error: ${data.error_description || JSON.stringify(data)}`);
  }

  _tokenCache = {
    token:     data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000
  };

  return _tokenCache.token;
}

/**
 * Low-level: send one email via Microsoft Graph API.
 * @param {{ to: string|string[], subject: string, html: string, bcc?: string|string[] }} opts
 */
async function sendViaMicrosoftGraph({ to, subject, html, bcc }) {
  const token = await getAccessToken();

  const toAddresses = (Array.isArray(to) ? to : [to])
    .filter(Boolean)
    .map(addr => ({
      emailAddress: { address: addr.trim() }
    }));

  const bccAddresses = (Array.isArray(bcc) ? bcc : (bcc ? [bcc] : []))
    .filter(Boolean)
    .map(addr => ({
      emailAddress: { address: addr.trim() }
    }));

  const message = {
    subject,
    body: { contentType: 'HTML', content: html },
    toRecipients: toAddresses,
    ...(bccAddresses.length > 0 ? { bccRecipients: bccAddresses } : {})
  };

  const graphUrl = `https://graph.microsoft.com/v1.0/users/${AZURE_SENDER_EMAIL}/sendMail`;

  const res = await fetch(graphUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ message, saveToSentItems: true })
  });

  if (!res.ok) {
    let errText = '';
    try { errText = await res.text(); } catch {}
    throw new Error(`[Mailer] Graph API error ${res.status}: ${errText}`);
  }

  return true;
}

/**
 * Returns an array of active superadmin email addresses.
 */
export async function getSuperadminEmails() {
  try {
    const superadmins = await Admin.find({
      $or: [
        { role: 'superadmin' },
        { roles: 'superadmin' }
      ],
      is_active: { $ne: false }
    }).select('email').lean();

    const emails = superadmins
      .map(s => (s.email || '').trim())
      .filter(e => e && e.includes('@'));

    return Array.from(new Set(emails));
  } catch (err) {
    console.error('[Mailer] Failed to retrieve superadmin emails:', err.message);
    return [];
  }
}

/**
 * Sends an email via Microsoft Graph and auto-BCCs all active superadmins.
 *
 * @param {Object} options
 * @param {string|string[]} options.to
 * @param {string} options.subject
 * @param {string} options.html
 * @param {string|string[]} [options.bcc]
 * @returns {Promise<any>}
 */
export async function sendEmail({ to, subject, html, bcc, ...rest }) {
  if (!to) return null;

  try {
    const superadminEmails = await getSuperadminEmails();
    const toList = (Array.isArray(to) ? to : [to]).map(t => (t || '').trim().toLowerCase());
    const existingBcc = (Array.isArray(bcc) ? bcc : (bcc ? [bcc] : [])).map(b => (b || '').trim().toLowerCase());

    const extraBcc = superadminEmails.filter(
      sa => !toList.includes(sa.toLowerCase()) && !existingBcc.includes(sa.toLowerCase())
    );

    const mergedBcc = Array.from(new Set([...existingBcc, ...extraBcc])).filter(Boolean);

    await sendViaMicrosoftGraph({ to, subject, html, bcc: mergedBcc });

    console.log(`[Mailer] ✅ Email sent via Microsoft Graph → to: ${Array.isArray(to) ? to.join(', ') : to}${mergedBcc.length ? ` | bcc: ${mergedBcc.join(', ')}` : ''}`);
    return true;
  } catch (err) {
    console.error(`[Mailer] Error sending email "${subject}":`, err.message);
    throw err;
  }
}
