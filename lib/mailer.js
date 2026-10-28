export { getAdminUrl, getClientUrl } from './urls.js';
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
 * Low-level: send one email via Microsoft Graph API (Azure).
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
    throw new Error(`[Mailer] Azure Graph API error ${res.status}: ${errText}`);
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
 * Sends an email exclusively via Azure Microsoft Graph API.
 * Auto-BCCs all active superadmins unless skipSuperadminBcc is set to true.
 *
 * @param {Object} options
 * @param {string|string[]} options.to
 * @param {string} options.subject
 * @param {string} options.html
 * @param {string|string[]} [options.bcc]
 * @param {boolean} [options.skipSuperadminBcc=false]
 * @returns {Promise<any>}
 */
export async function sendEmail({ to, subject, html, bcc, skipSuperadminBcc = false, ...rest }) {
  if (!to) return null;

  let mergedBcc = (Array.isArray(bcc) ? bcc : (bcc ? [bcc] : [])).map(b => (b || '').trim().toLowerCase());

  if (!skipSuperadminBcc) {
    try {
      const superadminEmails = await getSuperadminEmails();
      const toList = (Array.isArray(to) ? to : [to]).map(t => (t || '').trim().toLowerCase());
      const extraBcc = superadminEmails.filter(
        sa => !toList.includes(sa.toLowerCase()) && !mergedBcc.includes(sa.toLowerCase())
      );
      mergedBcc = Array.from(new Set([...mergedBcc, ...extraBcc]));
    } catch (e) {
      console.warn('[Mailer] Superadmin email lookup warning:', e.message);
    }
  }

  mergedBcc = mergedBcc.filter(Boolean);

  if (!AZURE_TENANT_ID || !AZURE_CLIENT_ID || !AZURE_CLIENT_SECRET) {
    throw new Error('[Mailer] Azure Microsoft Graph credentials are not configured in environment variables.');
  }

  try {
    await sendViaMicrosoftGraph({ to, subject, html, bcc: mergedBcc });
    console.log(`[Mailer] ✅ Email sent via Azure Microsoft Graph → to: ${Array.isArray(to) ? to.join(', ') : to}${mergedBcc.length ? ` | bcc: ${mergedBcc.join(', ')}` : ''}`);
    return true;
  } catch (graphErr) {
    console.error(`[Mailer] Azure Microsoft Graph error for "${subject}": ${graphErr.message}`);
    throw graphErr;
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


function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Returns an array of active HFA staff members (Admin collection).
 * Excludes ghost, internal test, or deactivated accounts.
 */
export async function getAllStaffMembers() {
  try {
    const staff = await Admin.find({
      username: { $ne: 'basic' },
      is_ghost: { $ne: true },
      is_active: { $ne: false }
    }).select('_id email full_name role roles').lean();
    return staff.filter(s => s.email && s.email.includes('@') && !s.email.endsWith('.internal'));
  } catch (err) {
    console.error('[Mailer] Failed to retrieve staff members:', err.message);
    return [];
  }
}

/**
 * Returns an array of email addresses for all active HFA staff members.
 */
export async function getAllStaffEmails() {
  try {
    const staff = await getAllStaffMembers();
    const emails = staff.map(s => (s.email || '').trim().toLowerCase());
    return Array.from(new Set(emails));
  } catch (err) {
    console.error('[Mailer] Failed to retrieve all staff emails:', err.message);
    return [];
  }
}

/**
 * Builds a professional internal staff email when a client updates their profile.
 */
export function buildClientProfileUpdateEmail({
  client = {},
  changedFields = [],
  adminUrl = 'https://admin.hfaportal.company',
  updatedAt = new Date().toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' })
}) {
  const companyName = client.company_name || client.full_name || 'Verified Client';
  const primaryContact = client.full_name || '—';
  const email = client.email || '—';
  const phone = client.phone || 'Not provided';
  const addressParts = [client.address, client.postcode, client.country].filter(Boolean);
  const fullAddress = addressParts.length ? addressParts.join(', ') : 'Not provided';
  const reviewUrl = `${adminUrl}/clients?search=${encodeURIComponent(client.email || companyName)}`;

  const diffRows = (changedFields.length > 0 ? changedFields : [
    { label: 'Profile Update', before: 'Previous details', after: 'Updated details on file' }
  ]).map(f => `
    <tr style="border-bottom: 1px solid #e2e8f0;">
      <td style="padding: 12px 14px; font-size: 13px; font-weight: 700; color: #1e293b; vertical-align: top; width: 30%;">${escapeHtml(f.label)}</td>
      <td style="padding: 12px 14px; font-size: 13px; color: #64748b; vertical-align: top; width: 35%;">
        <span style="display: inline-block; background: #fee2e2; color: #991b1b; padding: 3px 8px; border-radius: 4px; font-size: 12px; text-decoration: line-through; word-break: break-word;">${escapeHtml(f.before || 'None on file')}</span>
      </td>
      <td style="padding: 12px 14px; font-size: 13px; vertical-align: top; width: 35%;">
        <span style="display: inline-block; background: #dcfce7; color: #166534; padding: 3px 8px; border-radius: 4px; font-size: 12px; font-weight: 700; word-break: break-word;">${escapeHtml(f.after || 'Removed')}</span>
      </td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Client Profile Updated — HFA Internal Notification</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;padding:36px 12px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background:#fff;border-radius:12px;border:1px solid #e2e8f0;box-shadow:0 4px 14px rgba(0,0,0,0.06);overflow:hidden;text-align:left;">

        <!-- HEADER -->
        <tr>
          <td style="background:linear-gradient(135deg,#15803d 0%,#166534 100%);padding:28px 32px;text-align:center;color:#fff;">
            <img src="https://www.hfaportal.company/hfa-logo.png" alt="HFA" width="60" height="60" style="display:block;margin:0 auto 12px;border-radius:50%;background:#fff;padding:4px;" />
            <div style="font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#bbf7d0;margin-bottom:6px;">Internal Staff Notification &bull; Portal Audit</div>
            <h1 style="margin:0;font-size:22px;font-weight:800;color:#fff;">Client Profile &amp; Settings Modified</h1>
            <p style="margin:6px 0 0;font-size:13.5px;color:#dcfce7;">${escapeHtml(companyName)} has updated their verified organisation details</p>
          </td>
        </tr>

        <!-- BODY -->
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 8px;font-size:15px;color:#1e293b;">Hello <strong>HFA Team</strong>,</p>
            <p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.7;">
              Please be advised that the client detailed below has made changes to their verified organisation profile in the HFA Certification Portal on
              <strong>${escapeHtml(updatedAt)}</strong>. Kindly review the modified fields below and ensure all relevant certification documentation is updated accordingly.
            </p>

            <!-- CLIENT SNAPSHOT -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:24px;border-collapse:collapse;">
              <tr><td colspan="2" style="background:#f1f5f9;padding:10px 16px;border-bottom:1px solid #e2e8f0;font-size:11.5px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;color:#475569;">Client Account Snapshot</td></tr>
              <tr><td style="padding:10px 16px;font-size:13px;font-weight:600;color:#64748b;width:36%;border-bottom:1px solid #f1f5f9;">Company / Entity</td><td style="padding:10px 16px;font-size:13.5px;font-weight:700;color:#0f172a;border-bottom:1px solid #f1f5f9;">${escapeHtml(companyName)}</td></tr>
              <tr><td style="padding:10px 16px;font-size:13px;font-weight:600;color:#64748b;border-bottom:1px solid #f1f5f9;">Primary Contact</td><td style="padding:10px 16px;font-size:13px;color:#1e293b;border-bottom:1px solid #f1f5f9;">${escapeHtml(primaryContact)}</td></tr>
              <tr><td style="padding:10px 16px;font-size:13px;font-weight:600;color:#64748b;border-bottom:1px solid #f1f5f9;">Account Email</td><td style="padding:10px 16px;font-size:13px;border-bottom:1px solid #f1f5f9;"><a href="mailto:${escapeHtml(email)}" style="color:#047857;font-weight:600;text-decoration:none;">${escapeHtml(email)}</a></td></tr>
              <tr><td style="padding:10px 16px;font-size:13px;font-weight:600;color:#64748b;border-bottom:1px solid #f1f5f9;">Telephone</td><td style="padding:10px 16px;font-size:13px;color:#1e293b;border-bottom:1px solid #f1f5f9;">${escapeHtml(phone)}</td></tr>
              <tr><td style="padding:10px 16px;font-size:13px;font-weight:600;color:#64748b;border-bottom:1px solid #f1f5f9;">Operating Address</td><td style="padding:10px 16px;font-size:13px;color:#1e293b;border-bottom:1px solid #f1f5f9;">${escapeHtml(fullAddress)}</td></tr>
              <tr><td style="padding:10px 16px;font-size:13px;font-weight:600;color:#64748b;">Updated At</td><td style="padding:10px 16px;font-size:13px;color:#1e293b;">${escapeHtml(updatedAt)}</td></tr>
            </table>

            <!-- CHANGES TABLE -->
            <div style="font-size:14px;font-weight:800;color:#0f172a;margin-bottom:10px;">Detailed Modifications:</div>
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border:1px solid #e2e8f0;border-radius:8px;border-collapse:collapse;margin-bottom:24px;">
              <thead>
                <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0;">
                  <th style="padding:10px 14px;font-size:11.5px;font-weight:800;text-transform:uppercase;color:#475569;text-align:left;letter-spacing:0.5px;">Field</th>
                  <th style="padding:10px 14px;font-size:11.5px;font-weight:800;text-transform:uppercase;color:#475569;text-align:left;letter-spacing:0.5px;">Previous Value</th>
                  <th style="padding:10px 14px;font-size:11.5px;font-weight:800;text-transform:uppercase;color:#475569;text-align:left;letter-spacing:0.5px;">Updated Value</th>
                </tr>
              </thead>
              <tbody>${diffRows}</tbody>
            </table>

            <!-- ADVISORY -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fefce8;border:1px solid #fef08a;border-left:4px solid #ca8a04;border-radius:6px;margin-bottom:28px;">
              <tr><td style="padding:16px 18px;">
                <div style="font-weight:700;font-size:13.5px;color:#854d0e;margin-bottom:6px;">Operational &amp; Certification Review Advisory</div>
                <div style="font-size:13px;line-height:1.7;color:#713f12;">
                  If this client currently holds active Halal Certificates, pending Applications, or scheduled Audits, please verify whether the updated details require amendments to master agreements, logsheets, or certificates on file.
                </div>
              </td></tr>
            </table>

            <!-- CTA -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
              <tr><td align="center">
                <a href="${reviewUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#15803d;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:13px 32px;border-radius:8px;box-shadow:0 2px 6px rgba(21,128,61,0.25);">
                  Review Client in Admin Portal &rarr;
                </a>
              </td></tr>
            </table>

            <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 18px;" />
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td align="center" style="font-size:12px;color:#64748b;line-height:1.7;">
                <div style="font-weight:700;color:#1e293b;">Halal Food Authority (HFA) — Compliance &amp; Operations</div>
                <div>Automated internal system notification &bull; <a href="https://admin.hfaportal.company" style="color:#047857;text-decoration:none;font-weight:600;">admin.hfaportal.company</a></div>
                <div style="font-size:11px;color:#94a3b8;margin-top:4px;">&copy; ${new Date().getFullYear()} Halal Food Authority. All rights reserved.</div>
              </td></tr>
            </table>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Builds a profile update confirmation email for the client.
 */
export function buildClientProfileUpdateConfirmationEmail({
  client = {},
  changedFields = [],
  updatedAt = new Date().toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' })
}) {
  const recipientName = client.full_name || client.company_name || 'Valued Client';
  const companyName = client.company_name || 'Your Organisation';

  const fieldList = (changedFields.length > 0 ? changedFields : [
    { label: 'Profile Information', after: 'Updated details saved' }
  ]).map(f => `
    <tr style="border-bottom:1px solid #e2e8f0;">
      <td style="padding:10px 14px;font-size:13px;font-weight:700;color:#1e293b;width:40%;">${escapeHtml(f.label)}</td>
      <td style="padding:10px 14px;font-size:13px;font-weight:600;color:#166534;width:60%;">${escapeHtml(f.after)}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Profile Updated — Halal Food Authority</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;padding:36px 12px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;background:#fff;border-radius:12px;border:1px solid #e2e8f0;box-shadow:0 4px 12px rgba(0,0,0,0.04);overflow:hidden;text-align:left;">
        <!-- HEADER -->
        <tr>
          <td style="background:linear-gradient(135deg,#15803d 0%,#166534 100%);padding:28px 32px;text-align:center;color:#fff;">
            <img src="https://www.hfaportal.company/hfa-logo.png" alt="HFA" width="60" height="60" style="display:block;margin:0 auto 10px;border-radius:50%;background:#fff;padding:3px;" />
            <div style="font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#bbf7d0;">Halal Food Authority</div>
            <h1 style="margin:4px 0 0;font-size:20px;font-weight:800;color:#fff;">Profile &amp; Settings Updated</h1>
          </td>
        </tr>
        <!-- BODY -->
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 16px;font-size:15px;color:#1e293b;">Hello <strong>${escapeHtml(recipientName)}</strong>,</p>
            <p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.7;">
              This email confirms that your organisation profile and settings for <strong>${escapeHtml(companyName)}</strong> were successfully updated on <strong>${escapeHtml(updatedAt)}</strong>.
            </p>

            <!-- CHANGES -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:24px;border-collapse:collapse;">
              <thead>
                <tr style="background:#f1f5f9;">
                  <th style="padding:10px 14px;font-size:11.5px;font-weight:800;text-transform:uppercase;color:#475569;text-align:left;">Updated Field</th>
                  <th style="padding:10px 14px;font-size:11.5px;font-weight:800;text-transform:uppercase;color:#475569;text-align:left;">New Value</th>
                </tr>
              </thead>
              <tbody>${fieldList}</tbody>
            </table>

            <!-- NOTICE -->
            <div style="background:#f0fdf4;border-left:4px solid #15803d;padding:14px 16px;border-radius:6px;font-size:13px;color:#166534;line-height:1.7;margin-bottom:24px;">
              <strong>Notice:</strong> All HFA staff and compliance officers have been automatically notified of this profile update to ensure your official certification records remain accurate and up to date.
            </div>

            <p style="font-size:12.5px;color:#64748b;line-height:1.6;margin:0 0 24px;">
              If you did not authorise these changes, please contact HFA support immediately at
              <a href="mailto:portals@halalfoodauthority.com" style="color:#15803d;font-weight:600;">portals@halalfoodauthority.com</a>.
            </p>

            <!-- CTA -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
              <tr><td align="center">
                <a href="https://hfaportal.company/profile" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#15803d;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 28px;border-radius:6px;">
                  View My Profile &rarr;
                </a>
              </td></tr>
            </table>

            <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 16px;" />
            <p style="font-size:11.5px;color:#94a3b8;text-align:center;margin:0;">&copy; ${new Date().getFullYear()} Halal Food Authority. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Builds a professional security alert email for all HFA Staff when a client changes their password.
 */
export function buildClientPasswordChangedStaffEmail({
  client = {},
  adminUrl = 'https://admin.hfaportal.company',
  updatedAt = new Date().toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' })
}) {
  const companyName = client.company_name || client.full_name || 'Client';
  const primaryContact = client.full_name || '—';
  const email = client.email || '—';
  const reviewUrl = `${adminUrl}/clients?search=${encodeURIComponent(client.email || companyName)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Security Alert: Client Password Updated — HFA</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;padding:36px 12px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#fff;border-radius:12px;border:1px solid #e2e8f0;box-shadow:0 4px 14px rgba(0,0,0,0.06);overflow:hidden;text-align:left;">
        <tr>
          <td style="background:linear-gradient(135deg,#0284c7 0%,#0369a1 100%);padding:26px 30px;text-align:center;color:#fff;">
            <img src="https://www.hfaportal.company/hfa-logo.png" alt="HFA" width="60" height="60" style="display:block;margin:0 auto 10px;border-radius:50%;background:#fff;padding:3px;" />
            <div style="font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#bae6fd;">Internal Security Alert</div>
            <h1 style="margin:4px 0 0;font-size:20px;font-weight:800;color:#fff;">Client Password Changed</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:30px;">
            <p style="margin:0 0 16px;font-size:15px;color:#1e293b;">Hello <strong>HFA Team</strong>,</p>
            <p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.7;">
              The client below has successfully updated their portal login password via their Account &amp; Security Settings on <strong>${escapeHtml(updatedAt)}</strong>.
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:24px;">
              <tr><td style="padding:10px 16px;font-size:13px;font-weight:600;color:#64748b;width:35%;border-bottom:1px solid #f1f5f9;">Company / Entity</td><td style="padding:10px 16px;font-size:13.5px;font-weight:700;color:#0f172a;border-bottom:1px solid #f1f5f9;">${escapeHtml(companyName)}</td></tr>
              <tr><td style="padding:10px 16px;font-size:13px;font-weight:600;color:#64748b;border-bottom:1px solid #f1f5f9;">Contact Person</td><td style="padding:10px 16px;font-size:13px;color:#1e293b;border-bottom:1px solid #f1f5f9;">${escapeHtml(primaryContact)}</td></tr>
              <tr><td style="padding:10px 16px;font-size:13px;font-weight:600;color:#64748b;border-bottom:1px solid #f1f5f9;">Account Email</td><td style="padding:10px 16px;font-size:13px;color:#1e293b;border-bottom:1px solid #f1f5f9;">${escapeHtml(email)}</td></tr>
              <tr><td style="padding:10px 16px;font-size:13px;font-weight:600;color:#64748b;">Timestamp</td><td style="padding:10px 16px;font-size:13px;color:#1e293b;">${escapeHtml(updatedAt)}</td></tr>
            </table>

            <div style="background:#f0f9ff;border-left:4px solid #0284c7;padding:14px 16px;border-radius:6px;font-size:13px;color:#075985;line-height:1.7;margin-bottom:24px;">
              <strong>Security Info:</strong> The password was updated securely via industry-standard bcrypt hashing. No administrative action is required unless the client reports suspicious account activity or a potential compromise.
            </div>

            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
              <tr><td align="center">
                <a href="${reviewUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#0284c7;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 28px;border-radius:6px;">
                  View Client in Admin Portal &rarr;
                </a>
              </td></tr>
            </table>

            <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 16px;" />
            <p style="font-size:11.5px;color:#94a3b8;text-align:center;margin:0;">Halal Food Authority &bull; Automated Internal Security Alert</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Builds a password change confirmation email for the client.
 */
export function buildClientPasswordChangedConfirmationEmail({
  client = {},
  updatedAt = new Date().toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' })
}) {
  const recipientName = client.full_name || client.company_name || 'Valued Client';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Security Notice: Password Changed — HFA</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;padding:36px 12px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;background:#fff;border-radius:12px;border:1px solid #e2e8f0;box-shadow:0 4px 12px rgba(0,0,0,0.04);overflow:hidden;text-align:left;">
        <tr>
          <td style="background:linear-gradient(135deg,#15803d 0%,#166534 100%);padding:26px 30px;text-align:center;color:#fff;">
            <img src="https://www.hfaportal.company/hfa-logo.png" alt="HFA" width="60" height="60" style="display:block;margin:0 auto 10px;border-radius:50%;background:#fff;padding:3px;" />
            <div style="font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#bbf7d0;">Halal Food Authority</div>
            <h1 style="margin:4px 0 0;font-size:20px;font-weight:800;color:#fff;">Password Changed Successfully</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:30px;">
            <p style="margin:0 0 16px;font-size:15px;color:#1e293b;">Hello <strong>${escapeHtml(recipientName)}</strong>,</p>
            <p style="margin:0 0 16px;font-size:14px;color:#475569;line-height:1.7;">
              Your HFA Portal account password was updated successfully on <strong>${escapeHtml(updatedAt)}</strong>.
            </p>
            <p style="margin:0 0 24px;font-size:13.5px;color:#475569;line-height:1.7;">
              If you made this change, no further action is required. You may continue accessing the portal using your new password.
            </p>

            <div style="background:#fef2f2;border-left:4px solid #ef4444;padding:14px 16px;border-radius:6px;font-size:13px;color:#991b1b;line-height:1.7;margin-bottom:24px;">
              <strong>Did not make this change?</strong> If you did not initiate this password change, please contact HFA support immediately at
              <a href="mailto:portals@halalfoodauthority.com" style="color:#991b1b;font-weight:700;">portals@halalfoodauthority.com</a> to secure your account.
            </div>

            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
              <tr><td align="center">
                <a href="https://hfaportal.company/login" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#15803d;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 28px;border-radius:6px;">
                  Log In to Client Portal &rarr;
                </a>
              </td></tr>
            </table>

            <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 16px;" />
            <p style="font-size:11.5px;color:#94a3b8;text-align:center;margin:0;">&copy; ${new Date().getFullYear()} Halal Food Authority. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
