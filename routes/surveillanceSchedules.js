import express from 'express';
import SurveillanceSchedule from '../models/SurveillanceSchedule.js';
import Application from '../models/Application.js';
import User from '../models/User.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { sendEmail } from '../lib/mailer.js';
import { createNotification } from '../lib/notifications.js';
import { getClientUrl } from '../lib/urls.js';

const router = express.Router();

// GET /api/surveillance-schedules — List all surveillance schedules (Admin only)
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { search, status, sort } = req.query;
    const filter = {};

    if (search && search.trim()) {
      const q = search.trim();
      const regex = new RegExp(q, 'i');
      filter.$or = [
        { company_name: regex },
        { site_name: regex },
        { application_number: regex },
        { admin_name: regex },
        { notes: regex }
      ];
    }

    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    if (status && status !== 'all') {
      if (status === 'overdue') {
        filter.next_surveillance_due_date = { $lt: now };
      } else if (status === 'due_soon') {
        filter.next_surveillance_due_date = { $gte: now, $lte: thirtyDaysFromNow };
      } else if (status === 'scheduled') {
        filter.next_surveillance_due_date = { $gt: thirtyDaysFromNow };
      } else if (status === 'completed') {
        filter.status = 'completed';
      }
    }

    let sortOption = { next_surveillance_due_date: 1 };
    if (sort === 'created_desc') sortOption = { created_at: -1 };
    if (sort === 'created_asc') sortOption = { created_at: 1 };
    if (sort === 'due_desc') sortOption = { next_surveillance_due_date: -1 };
    if (sort === 'company_asc') sortOption = { company_name: 1 };

    const schedules = await SurveillanceSchedule.find(filter)
      .populate('application_id', 'application_number application_type status category site_id site_name')
      .populate('client_id', 'full_name company_name email phone')
      .sort(sortOption);

    // Compute dynamic status badges
    const result = schedules.map(s => {
      const doc = s.toObject();
      const dueDate = new Date(doc.next_surveillance_due_date);
      if (doc.status !== 'completed') {
        if (dueDate < now) {
          doc.dynamic_status = 'overdue';
        } else if (dueDate <= thirtyDaysFromNow) {
          doc.dynamic_status = 'due_soon';
        } else {
          doc.dynamic_status = 'scheduled';
        }
      } else {
        doc.dynamic_status = 'completed';
      }
      return doc;
    });

    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/surveillance-schedules — Create or update a schedule (Admin only)
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      application_id,
      next_surveillance_due_date,
      admin_name,
      notes,
      company_name,
      site_name,
      site_id
    } = req.body;

    if (!application_id) {
      return res.status(400).json({ error: 'application_id is required' });
    }
    if (!next_surveillance_due_date) {
      return res.status(400).json({ error: 'next_surveillance_due_date is required' });
    }

    const app = await Application.findById(application_id);
    if (!app) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const effectiveAdminName = (admin_name && admin_name.trim()) || req.user.full_name || req.user.username || 'Admin';
    const parsedDate = new Date(next_surveillance_due_date);

    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: 'Invalid next_surveillance_due_date format' });
    }

    // Update application next_surveillance_due_date
    app.next_surveillance_due_date = parsedDate;
    await app.save();

    const resolvedSiteName = site_name || app.site_name || app.establishment_name || 'Main Facility';
    const isSiteColliding = (str) => {
      if (!str) return true;
      const s = String(str).trim().toLowerCase();
      return s === String(resolvedSiteName).trim().toLowerCase() ||
             s === String(app.establishment_name || '').trim().toLowerCase() ||
             s === String(app.site_name || '').trim().toLowerCase();
    };

    let resolvedCompName = company_name;
    if (!resolvedCompName || isSiteColliding(resolvedCompName)) {
      try {
        const User = mongoose.model('User');
        const cUser = await User.findById(app.client_id).select('company_name full_name').lean();
        if (cUser?.company_name) resolvedCompName = cUser.company_name;
        else if (cUser?.full_name) resolvedCompName = cUser.full_name;
      } catch (e) {}
    }
    if (!resolvedCompName || isSiteColliding(resolvedCompName)) {
      resolvedCompName = app.company_name || 'Manufacturing Client';
    }

    // Upsert SurveillanceSchedule record
    const scheduleData = {
      application_id: app._id,
      client_id: app.client_id,
      company_name: resolvedCompName,
      site_id: site_id || app.site_id || '',
      site_name: resolvedSiteName,
      application_number: app.application_number,
      application_type: app.application_type || 'new',
      category: app.category || 'UAE/GSO Approved Halal Certification For Exporters To UAE',
      next_surveillance_due_date: parsedDate,
      admin_id: req.user._id,
      admin_name: effectiveAdminName,
      notes: notes || '',
      updated_at: new Date()
    };

    const schedule = await SurveillanceSchedule.findOneAndUpdate(
      { application_id: app._id },
      { $set: scheduleData, $setOnInsert: { created_at: new Date(), status: 'scheduled' } },
      { upsert: true, new: true }
    );

    res.status(201).json({ data: schedule, message: 'Surveillance due date saved successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/surveillance-schedules/:id — Edit schedule (Admin only)
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { next_surveillance_due_date, notes, admin_name } = req.body;
    const schedule = await SurveillanceSchedule.findById(req.params.id);
    if (!schedule) {
      return res.status(404).json({ error: 'Surveillance schedule not found' });
    }

    if (next_surveillance_due_date) {
      const parsedDate = new Date(next_surveillance_due_date);
      if (isNaN(parsedDate.getTime())) {
        return res.status(400).json({ error: 'Invalid date format' });
      }
      schedule.next_surveillance_due_date = parsedDate;

      // Sync to Application
      if (schedule.application_id) {
        await Application.findByIdAndUpdate(schedule.application_id, {
          next_surveillance_due_date: parsedDate
        });
      }
    }

    if (notes !== undefined) schedule.notes = notes;
    if (admin_name) schedule.admin_name = admin_name;
    schedule.updated_at = new Date();

    await schedule.save();
    res.json({ data: schedule, message: 'Surveillance schedule updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/surveillance-schedules/:id/remind — Send surveillance due date reminder email & notification to client (Admin only)
router.post('/:id/remind', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { custom_message } = req.body;
    const schedule = await SurveillanceSchedule.findById(req.params.id)
      .populate('application_id')
      .populate('client_id');

    if (!schedule) {
      return res.status(404).json({ error: 'Surveillance schedule not found' });
    }

    // Determine client
    let clientUser = schedule.client_id;
    const app = schedule.application_id;

    if ((!clientUser || !clientUser.email) && app?.client_id) {
      clientUser = await User.findById(app.client_id);
    }

    const recipientEmail = (
      clientUser?.email ||
      app?.company_email ||
      app?.primary_email ||
      app?.managing_director_email
    )?.trim();

    if (!recipientEmail) {
      return res.status(400).json({
        error: 'No valid client email address found for this application to send a reminder.'
      });
    }

    const recipientName =
      clientUser?.full_name ||
      clientUser?.name ||
      app?.primary_contact_name ||
      app?.managing_director ||
      schedule.company_name ||
      'Valued Client';

    const dueDate = new Date(schedule.next_surveillance_due_date);
    const formattedDueDate = dueDate.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const dueTime = new Date(dueDate);
    dueTime.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((dueTime.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    let timingStatusText = '';
    let statusPillBg = '#ecfdf5';
    let statusPillColor = '#047857';

    if (diffDays < 0) {
      timingStatusText = `Overdue by ${Math.abs(diffDays)} days`;
      statusPillBg = '#fee2e2';
      statusPillColor = '#b91c1c';
    } else if (diffDays === 0) {
      timingStatusText = 'Due Today';
      statusPillBg = '#fef3c7';
      statusPillColor = '#b45309';
    } else {
      timingStatusText = `Due in ${diffDays} day${diffDays === 1 ? '' : 's'}`;
      if (diffDays <= 60) {
        statusPillBg = '#fef3c7';
        statusPillColor = '#b45309';
      }
    }

    const clientUrl = getClientUrl();
    const portalLoginLink = `${clientUrl}/applications`;

    const emailSubject = `Important Reminder: Halal Surveillance Audit Due — ${schedule.company_name} (${schedule.application_number})`;

    const emailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #065f46 0%, #047857 100%); padding: 32px 24px; text-align: center; color: #ffffff;">
          <h1 style="margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.02em;">Halal Food Authority</h1>
          <p style="margin: 6px 0 0; font-size: 13px; color: #a7f3d0; font-weight: 500;">Annual Halal Surveillance Schedule Reminder</p>
        </div>

        <!-- Body Content -->
        <div style="padding: 32px 28px; color: #334155; line-height: 1.6; font-size: 14px;">
          <p style="margin-top: 0; font-size: 16px; font-weight: 600; color: #0f172a;">
            Dear ${recipientName},
          </p>

          <p>
            This is an official notification regarding the upcoming annual Halal surveillance schedule for your certified facility.
          </p>

          <!-- Details Card -->
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; margin: 24px 0;">
            <table style="width: 100%; border-collapse: collapse; font-size: 13.5px;">
              <tr>
                <td style="padding: 6px 0; color: #64748b; width: 42%;">Company Name:</td>
                <td style="padding: 6px 0; font-weight: 600; color: #0f172a;">${schedule.company_name}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #64748b;">Facility / Site:</td>
                <td style="padding: 6px 0; font-weight: 600; color: #0f172a;">${schedule.site_name}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #64748b;">Application Number:</td>
                <td style="padding: 6px 0; font-weight: 600; color: #0f172a;">${schedule.application_number}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #64748b;">Scheme / Standard:</td>
                <td style="padding: 6px 0; font-weight: 600; color: #0f172a;">${schedule.category || 'UAE/GSO Halal Certification'}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0 4px; color: #64748b;">Next Surveillance Due:</td>
                <td style="padding: 8px 0 4px;">
                  <strong style="color: #0f172a; font-size: 15px;">${formattedDueDate}</strong>
                  <span style="display: inline-block; margin-left: 8px; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px; background: ${statusPillBg}; color: ${statusPillColor};">
                    ${timingStatusText}
                  </span>
                </td>
              </tr>
            </table>
          </div>

          ${custom_message ? `
          <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 14px 18px; margin: 20px 0; border-radius: 0 8px 8px 0; font-size: 13.5px; color: #1e40af;">
            <strong>Note from Certification Administration:</strong><br />
            ${custom_message.replace(/\n/g, '<br/>')}
          </div>
          ` : ''}

          <p>
            Under the UAE/GSO Halal Certification rules and international accreditation criteria, periodic surveillance audits are mandatory to verify uninterrupted compliance with Halal standards and maintain certificate validity.
          </p>

          <p style="margin-bottom: 28px;">
            Please log in to your HFA Portal dashboard to initiate your annual surveillance application or review your audit preparation checklist.
          </p>

          <!-- CTA Button -->
          <div style="text-align: center; margin: 30px 0;">
            <a href="${portalLoginLink}" style="display: inline-block; background: linear-gradient(135deg, #065f46 0%, #047857 100%); color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14.5px; padding: 12px 28px; border-radius: 8px; box-shadow: 0 2px 4px rgba(6, 95, 70, 0.2);">
              Open Client Portal &rarr;
            </a>
          </div>

          <p style="font-size: 12px; color: #64748b; margin-top: 28px; border-top: 1px solid #f1f5f9; padding-top: 20px;">
            If you have already submitted your surveillance application or scheduled your audit with our team, please disregard this reminder. For any questions, please contact HFA Certification Secretariat at <a href="mailto:info@halalfoodfoundation.org.uk" style="color: #047857;">info@halalfoodfoundation.org.uk</a>.
          </p>
        </div>

        <!-- Footer -->
        <div style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 16px 24px; text-align: center; font-size: 11.5px; color: #94a3b8;">
          &copy; ${new Date().getFullYear()} Halal Food Authority (HFA). All rights reserved.
        </div>
      </div>
    `;

    // 1. Send Email via centralized mailer (with superadmin BCC automatically included)
    await sendEmail({
      to: recipientEmail,
      subject: emailSubject,
      html: emailHtml
    });

    // 2. In-App Notification if client user exists
    if (clientUser?._id) {
      await createNotification(
        clientUser._id,
        'Surveillance Due Date Reminder 📅',
        `Your next annual Halal surveillance audit for ${schedule.site_name} (${schedule.application_number}) is due on ${formattedDueDate} (${timingStatusText}).`,
        diffDays < 0 ? 'error' : (diffDays <= 60 ? 'warning' : 'info'),
        '/applications'
      );
    }

    // 3. Update last_reminded_at and reminder_count on schedule
    schedule.last_reminded_at = new Date();
    schedule.reminder_count = (schedule.reminder_count || 0) + 1;
    await schedule.save();

    res.json({
      message: `Surveillance reminder sent successfully to ${recipientEmail}`,
      last_reminded_at: schedule.last_reminded_at,
      reminder_count: schedule.reminder_count,
      recipient_email: recipientEmail
    });
  } catch (err) {
    console.error('Error sending surveillance schedule reminder:', err);
    res.status(500).json({ error: err.message || 'Failed to send surveillance reminder' });
  }
});

// DELETE /api/surveillance-schedules/:id — Delete schedule (Admin only)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const schedule = await SurveillanceSchedule.findByIdAndDelete(req.params.id);
    if (!schedule) {
      return res.status(404).json({ error: 'Surveillance schedule not found' });
    }
    res.json({ message: 'Surveillance schedule deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
