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

/**
 * Builds the official HFA email HTML format with centered logo, green "HFA" branding,
 * message callout box, action button, and footer.
 *
 * @param {Object} options
 * @param {string} [options.recipientName]
 * @param {string} [options.introText]
 * @param {string} [options.boxTitle]
 * @param {string} options.body
 * @param {string} [options.buttonText]
 * @param {string} [options.buttonUrl]
 * @param {string} [options.senderNote]
 * @returns {string} HTML string
 */
export function buildHfaEmailTemplate({
  recipientName = 'Valued Client',
  introText = '',
  boxTitle = 'Announcement Details:',
  body = '',
  buttonText = 'Open Portal Messages',
  buttonUrl = 'https://www.hfaportal.company/messages',
  senderNote = ''
} = {}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Halal Food Authority</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #1e293b;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f8fafc; padding: 36px 12px; width: 100%;">
    <tr>
      <td align="center">
        <!-- Main Card Container -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 580px; width: 100%; background-color: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; box-shadow: 0 2px 8px rgba(0,0,0,0.04); overflow: hidden; text-align: left;">
          <tr>
            <td style="padding: 36px 32px 32px 32px;">

              <!-- Header: Logo & HFA Text -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 24px;">
                <tr>
                  <td align="center">
                    <img src="https://www.hfaportal.company/hfa-logo.png" alt="HFA Logo" width="70" height="70" style="display: block; margin: 0 auto 10px auto; width: 70px; height: 70px; border-radius: 50%; object-fit: contain; border: 0; outline: none; text-decoration: none;" />
                    <div style="font-size: 20px; font-weight: 700; color: #047857; letter-spacing: 0.5px; text-transform: uppercase; text-align: center;">HFA</div>
                  </td>
                </tr>
              </table>

              <!-- Salutation -->
              <p style="margin: 0 0 16px 0; font-size: 15px; color: #1e293b; line-height: 1.5;">
                Hello <strong>${recipientName}</strong>,
              </p>

              <!-- Context / Lead Paragraph -->
              ${introText ? `<p style="margin: 0 0 20px 0; font-size: 14.5px; color: #334155; line-height: 1.6;">${introText}</p>` : ''}

              <!-- Light Green Highlight / Callout Box -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f0fdf4; border-left: 4px solid #047857; border-radius: 6px; margin: 20px 0;">
                <tr>
                  <td style="padding: 16px 20px;">
                    ${boxTitle ? `<div style="font-weight: 700; font-size: 14px; color: #047857; margin-bottom: 8px;">${boxTitle}</div>` : ''}
                    <div style="font-size: 14px; line-height: 1.65; color: #14532d; white-space: pre-wrap;">${body}</div>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              ${buttonUrl ? `
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 28px 0 24px 0;">
                <tr>
                  <td align="center">
                    <a href="${buttonUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #047857; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700; padding: 12px 32px; border-radius: 6px; letter-spacing: 0.3px; text-align: center;">
                      ${buttonText}
                    </a>
                  </td>
                </tr>
              </table>
              ` : ''}

              ${senderNote ? `
              <p style="font-size: 12px; color: #64748b; line-height: 1.5; margin: 16px 0 0 0; text-align: center;">
                ${senderNote}
              </p>
              ` : ''}

              <!-- Divider -->
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 28px 0 20px 0;" />

              <!-- Footer -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="font-size: 13px; color: #4b5563; line-height: 1.6;">
                    <div style="font-weight: 700; color: #1f2937;">The HFA Team</div>
                    <div style="margin-top: 4px; color: #6b7280;">
                      Website: <a href="https://www.hfaportal.company" target="_blank" rel="noopener noreferrer" style="color: #047857; text-decoration: none; font-weight: 600;">hfaportal.company</a>
                    </div>
                  </td>
                </tr>
              </table>

            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

