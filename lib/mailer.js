import { Resend } from 'resend';
import User from '../models/User.js';
import dotenv from 'dotenv';

dotenv.config();

export const resend = new Resend(process.env.RESEND_API_KEY);
export const emailFrom = process.env.EMAIL_FROM || 'HFA Portal <info@halalfoodfoundation.org.uk>';

/**
 * Returns an array of active superadmin email addresses.
 */
export async function getSuperadminEmails() {
  try {
    const superadmins = await User.find({
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
 * Sends an email using Resend and ensures all active Superadmins are copied (via BCC).
 * If a superadmin is already listed in `to`, it avoids duplicate sending.
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

    const payload = {
      from: emailFrom,
      to,
      subject,
      html,
      ...rest
    };

    if (mergedBcc.length > 0) {
      payload.bcc = mergedBcc;
    }

    return await resend.emails.send(payload);
  } catch (err) {
    console.error(`[Mailer] Error sending email "${subject}":`, err.message);
    throw err;
  }
}
