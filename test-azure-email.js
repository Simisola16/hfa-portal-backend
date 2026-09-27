/**
 * Test script: sends a real email via Azure Graph API
 * - TO:  awwalsaminu9@gmail.com
 * - BCC: olamilekanmuhayad1980@gmail.com  (explicit BCC)
 *        + any active superadmins in the DB (auto-BCC from sendEmail)
 *
 * Run with: node test-azure-email.js
 */
import dotenv from 'dotenv';
dotenv.config();

import { sendEmail, emailFrom } from './lib/mailer.js';

const PRIMARY_RECIPIENT = 'awwalsaminu9@gmail.com';
const BCC_RECIPIENT     = 'olamilekanmuhayad1980@gmail.com';

async function runTest() {
  console.log('─────────────────────────────────────────────');
  console.log('🔷 Azure Graph API Email Test');
  console.log('─────────────────────────────────────────────');
  console.log(`From    : ${emailFrom}`);
  console.log(`To      : ${PRIMARY_RECIPIENT}`);
  console.log(`BCC     : ${BCC_RECIPIENT}  (+ auto-BCC superadmins)`);
  console.log('─────────────────────────────────────────────\n');

  try {
    await sendEmail({
      to: PRIMARY_RECIPIENT,
      bcc: BCC_RECIPIENT,
      subject: '✅ HFA Portal — Azure Email Test',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; background: #f9f9f9; border-radius: 8px; padding: 32px; border: 1px solid #e0e0e0;">
          <h2 style="color: #1a7a3e; margin-top: 0;">✅ Azure Email Test — Success!</h2>
          <p style="color: #333; font-size: 15px;">
            This is a test email sent from the <strong>Halal Food Authority Portal</strong>
            via <strong>Microsoft Azure Graph API</strong>.
          </p>
          <table style="width:100%; border-collapse:collapse; margin-top:20px; font-size:14px;">
            <tr style="background:#eaf4ee;">
              <td style="padding:10px; font-weight:bold; color:#555; width:35%;">Sent To (TO)</td>
              <td style="padding:10px; color:#222;">${PRIMARY_RECIPIENT}</td>
            </tr>
            <tr>
              <td style="padding:10px; font-weight:bold; color:#555;">BCC</td>
              <td style="padding:10px; color:#222;">${BCC_RECIPIENT} + superadmins</td>
            </tr>
            <tr style="background:#eaf4ee;">
              <td style="padding:10px; font-weight:bold; color:#555;">Sender</td>
              <td style="padding:10px; color:#222;">${emailFrom}</td>
            </tr>
            <tr>
              <td style="padding:10px; font-weight:bold; color:#555;">Time</td>
              <td style="padding:10px; color:#222;">${new Date().toUTCString()}</td>
            </tr>
          </table>
          <p style="margin-top:28px; font-size:13px; color:#888;">
            If you received this, the Azure email system is working correctly.
            BCC recipients receive this email without the primary recipient seeing them.
          </p>
        </div>
      `,
      text: `Azure Email Test — HFA Portal\n\nTo: ${PRIMARY_RECIPIENT}\nBCC: ${BCC_RECIPIENT}\nSent: ${new Date().toUTCString()}\n\nIf you received this, the Azure email system is working correctly.`
    });

    console.log('✅ Email sent successfully!');
    console.log(`\n📧 TO  → ${PRIMARY_RECIPIENT} should have the email in their inbox`);
    console.log(`📧 BCC → ${BCC_RECIPIENT} should have it too (as a hidden BCC)`);
    console.log('\nNote: BCC recipients receive the email but the TO recipient');
    console.log('      cannot see who was BCC\'d — that\'s the whole point of BCC.');

  } catch (err) {
    console.error('\n❌ Email failed:', err.message);
    if (err.message.includes('401') || err.message.includes('403')) {
      console.error('\n💡 Tip: Make sure Mail.Send permission has admin consent granted in Azure Portal.');
    }
    if (err.message.includes('AZURE_')) {
      console.error('\n💡 Tip: Check that all AZURE_ env vars are set in .env');
    }
    process.exit(1);
  }
}

runTest();
