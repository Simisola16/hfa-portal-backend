import { ConfidentialClientApplication } from '@azure/msal-node';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import dotenv from 'dotenv';

dotenv.config();

// ─── Azure App Credentials ────────────────────────────────────────────────────
// These come from your Azure App Registration (see README below).
const TENANT_ID     = process.env.AZURE_TENANT_ID;
const CLIENT_ID     = process.env.AZURE_CLIENT_ID;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET;

// The Microsoft 365 mailbox address you want to send FROM.
// This mailbox must exist in your tenant and the Azure app must have Mail.Send permission.
const SENDER_ADDRESS = process.env.AZURE_SENDER_EMAIL;

// Display name shown in the "From" field of every outgoing email
export const emailFrom = process.env.EMAIL_FROM || `"Halal Food Authority" <${SENDER_ADDRESS}>`;

// ─── MSAL Confidential Client (Client Credentials / App-Only Auth) ────────────
// Acquires tokens without a signed-in user — suitable for background/server use.
let msalClient = null;

function getMsalClient() {
  if (!msalClient) {
    if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
      throw new Error(
        '[Mailer] Azure credentials missing. Set AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET in .env'
      );
    }
    msalClient = new ConfidentialClientApplication({
      auth: {
        clientId: CLIENT_ID,
        authority: `https://login.microsoftonline.com/${TENANT_ID}`,
        clientSecret: CLIENT_SECRET
      }
    });
  }
  return msalClient;
}

/**
 * Acquires an OAuth2 access token for the Microsoft Graph API.
 * MSAL caches the token automatically and refreshes when near-expiry.
 */
async function getGraphAccessToken() {
  const client = getMsalClient();
  const result = await client.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default']
  });
  if (!result?.accessToken) {
    throw new Error('[Mailer] Failed to acquire Microsoft Graph access token.');
  }
  return result.accessToken;
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
 * Normalises a "to" value into a Graph API recipients array.
 * Accepts: string, "Name <email>" string, or array of either.
 */
function toRecipientList(input) {
  const raw = Array.isArray(input) ? input : [input];
  return raw.map(r => {
    const match = typeof r === 'string' ? r.match(/^"?([^"<]*)"?\s*<([^>]+)>$/) : null;
    if (match) {
      return { emailAddress: { name: match[1].trim(), address: match[2].trim() } };
    }
    return { emailAddress: { address: (r || '').trim() } };
  });
}

/**
 * Sends an email via Microsoft Graph API (Azure) and automatically BCCs all
 * active Superadmins. Superadmins already in `to` are not duplicated in BCC.
 *
 * @param {Object}          options
 * @param {string|string[]} options.to       - Primary recipient(s)
 * @param {string}          options.subject  - Email subject
 * @param {string}          options.html     - HTML body
 * @param {string}          [options.text]   - Plain-text fallback (optional)
 * @param {string|string[]} [options.bcc]    - Extra BCC address(es) (optional)
 * @returns {Promise<void>}
 */
export async function sendEmail({ to, subject, html, text, bcc }) {
  if (!to) return null;
  if (!SENDER_ADDRESS) {
    throw new Error('[Mailer] AZURE_SENDER_EMAIL is not set in .env');
  }

  // ── BCC: merge provided BCC + all superadmins (no duplicates) ──────────────
  const superadminEmails = await getSuperadminEmails();
  const toList = (Array.isArray(to) ? to : [to]).map(t => (t || '').replace(/.*<([^>]+)>/, '$1').trim().toLowerCase());
  const existingBcc = (Array.isArray(bcc) ? bcc : (bcc ? [bcc] : [])).map(b => (b || '').trim().toLowerCase());

  const extraBcc = superadminEmails.filter(
    sa => !toList.includes(sa.toLowerCase()) && !existingBcc.includes(sa.toLowerCase())
  );
  const mergedBcc = Array.from(new Set([...existingBcc, ...extraBcc])).filter(Boolean);

  // ── Build the Graph API message payload ────────────────────────────────────
  const message = {
    subject,
    body: {
      contentType: 'HTML',
      content: html
    },
    toRecipients: toRecipientList(to),
    ...(mergedBcc.length > 0 && {
      bccRecipients: mergedBcc.map(addr => ({ emailAddress: { address: addr } }))
    })
  };

  // Add plain-text body as an additional body if provided (Graph doesn't support both natively;
  // most clients auto-generate text — including it as an additional MIME part is optional)
  if (text) {
    // Graph API only supports one body type; HTML is used. Text is logged for debugging.
    console.log(`[Mailer] Plain-text alternative provided (HTML body used for send): ${subject}`);
  }

  // ── Acquire token and call Graph API ──────────────────────────────────────
  try {
    const accessToken = await getGraphAccessToken();

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(SENDER_ADDRESS)}/sendMail`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ message, saveToSentItems: true })
      }
    );

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Graph API error ${response.status}: ${errBody}`);
    }

    // Graph API returns 202 Accepted with no body on success
    console.log(`[Mailer] Email sent via Azure Graph API ✓ — "${subject}" → ${toList.join(', ')}${mergedBcc.length ? ` (BCC: ${mergedBcc.join(', ')})` : ''}`);
  } catch (err) {
    console.error(`[Mailer] Error sending email "${subject}":`, err.message);
    throw err;
  }
}
