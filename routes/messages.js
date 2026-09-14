import express from 'express';
import mongoose from 'mongoose';
import { Resend } from 'resend';
import Message from '../models/Message.js';
import User from '../models/User.js';
import Application from '../models/Application.js';
import { authenticateToken } from '../middleware/auth.js';
import { createNotification } from '../lib/notifications.js';
import { emitToUser, emitToAdmins, emitToClients } from '../lib/socket.js';

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);
const emailFrom = process.env.EMAIL_FROM || 'Halal Food Authority <info@hfaportal.company>';

const STAFF_ROLES = ['admin', 'superadmin', 'scheme_manager', 'food_tech_manager', 'food_tech', 'certificate_officer', 'accountant', 'audit_manager', 'staff'];

// Helper to check if role is staff/admin
const isStaffUser = (user) => {
  if (!user) return false;
  if (STAFF_ROLES.includes(user.role)) return true;
  if (Array.isArray(user.roles) && user.roles.some(r => STAFF_ROLES.includes(r))) return true;
  return false;
};

// Safe enrichment helper to populate sender, recipient, and application without Mongoose CastError
const populateMessagesSafely = async (messages) => {
  if (!messages) return null;
  const isArray = Array.isArray(messages);
  const msgList = isArray ? messages : [messages];
  if (msgList.length === 0 || !msgList[0]) return messages;

  const userIds = new Set();
  const appIds = new Set();

  msgList.forEach(m => {
    if (m.sender_id && mongoose.Types.ObjectId.isValid(m.sender_id)) {
      userIds.add(m.sender_id.toString());
    }
    if (m.recipient_id && mongoose.Types.ObjectId.isValid(m.recipient_id)) {
      userIds.add(m.recipient_id.toString());
    }
    if (m.application_id && mongoose.Types.ObjectId.isValid(m.application_id)) {
      appIds.add(m.application_id.toString());
    }
  });

  const [users, apps] = await Promise.all([
    userIds.size > 0 ? User.find({ _id: { $in: Array.from(userIds) } }).select('full_name company_name email role avatar_url').lean() : [],
    appIds.size > 0 ? Application.find({ _id: { $in: Array.from(appIds) } }).select('company_name scheme status').lean() : []
  ]);

  const userMap = new Map(users.map(u => [u._id.toString(), u]));
  const appMap = new Map(apps.map(a => [a._id.toString(), a]));

  const enriched = msgList.map(m => {
    const doc = m.toObject ? m.toObject({ virtuals: true }) : { ...m };

    // Sender resolution
    if (doc.sender_id && userMap.has(doc.sender_id.toString())) {
      doc.sender = userMap.get(doc.sender_id.toString());
    } else if (doc.sender_id === 'admin' || doc.sender_id === 'support') {
      doc.sender = {
        _id: 'admin',
        full_name: 'HFA Support & Compliance Team',
        company_name: 'Halal Food Authority',
        role: 'admin'
      };
    } else {
      doc.sender = {
        _id: doc.sender_id || 'system',
        full_name: 'User',
        role: 'client'
      };
    }

    // Recipient resolution
    if (doc.recipient_id === 'all_clients' || doc.recipient_id === 'all' || doc.is_broadcast) {
      doc.recipient = {
        _id: 'all_clients',
        full_name: 'All Registered Clients (Broadcast)',
        company_name: 'All Certified Clients',
        role: 'client'
      };
    } else if (doc.recipient_id && userMap.has(doc.recipient_id.toString())) {
      doc.recipient = userMap.get(doc.recipient_id.toString());
    } else if (doc.recipient_id === 'admin' || doc.recipient_id === 'support') {
      doc.recipient = {
        _id: doc.recipient_id,
        full_name: 'HFA Support & Compliance Team',
        company_name: 'Halal Food Authority',
        role: 'admin'
      };
    } else {
      doc.recipient = {
        _id: doc.recipient_id || 'system',
        full_name: 'User',
        role: 'client'
      };
    }

    // Application resolution
    if (doc.application_id && appMap.has(doc.application_id.toString())) {
      doc.application_id = appMap.get(doc.application_id.toString());
    }

    return doc;
  });

  return isArray ? enriched : enriched[0];
};

// GET /api/messages/inbox
router.get('/inbox', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id.toString();
    let queryFilter;

    if (isStaffUser(req.user)) {
      // Admins/Staff see messages addressed to them, or to general admin/support, or broadcast announcements
      queryFilter = {
        $or: [
          { recipient_id: userId },
          { recipient_id: 'admin' },
          { recipient_id: 'support' },
          { recipient_id: 'all_clients' },
          { recipient_id: 'all' },
          { is_broadcast: true },
          { recipient_id: { $exists: false } },
          { recipient_id: null },
          { recipient_id: '' }
        ]
      };
    } else {
      // Clients see messages addressed directly to them or broadcast announcements
      queryFilter = {
        $or: [
          { recipient_id: userId },
          { recipient_id: 'all_clients' },
          { recipient_id: 'all' },
          { is_broadcast: true }
        ]
      };
    }

    const raw = await Message.find(queryFilter).sort({ created_at: -1 }).lean();
    const data = await populateMessagesSafely(raw);

    res.json({ data: data || [] });
  } catch (err) {
    console.error('Error fetching inbox:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/messages/outbox
router.get('/outbox', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id.toString();
    const raw = await Message.find({ sender_id: userId }).sort({ created_at: -1 }).lean();
    const data = await populateMessagesSafely(raw);
    res.json({ data: data || [] });
  } catch (err) {
    console.error('Error fetching outbox:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/messages/conversation/:targetId - Full conversation history with a target user
router.get('/conversation/:targetId', authenticateToken, async (req, res) => {
  try {
    const currentUserId = req.user.id || req.user._id.toString();
    const targetId = req.params.targetId;

    let filter;
    if (isStaffUser(req.user)) {
      if (targetId === 'all_clients' || targetId === 'all' || targetId === 'broadcast') {
        filter = {
          $or: [
            { recipient_id: 'all_clients' },
            { recipient_id: 'all' },
            { is_broadcast: true }
          ]
        };
      } else {
        filter = {
          $or: [
            { sender_id: currentUserId, recipient_id: targetId },
            { sender_id: targetId, recipient_id: currentUserId },
            { sender_id: targetId, recipient_id: { $in: ['admin', 'support', null, ''] } }
          ]
        };
      }
    } else {
      // If client is looking at conversation
      if (targetId === 'admin' || targetId === 'support') {
        filter = {
          $or: [
            { sender_id: currentUserId },
            { recipient_id: currentUserId },
            { recipient_id: 'all_clients' },
            { recipient_id: 'all' },
            { is_broadcast: true }
          ]
        };
      } else if (targetId === 'all_clients' || targetId === 'broadcast') {
        filter = {
          $or: [
            { recipient_id: 'all_clients' },
            { recipient_id: 'all' },
            { is_broadcast: true }
          ]
        };
      } else {
        filter = {
          $or: [
            { sender_id: currentUserId, recipient_id: targetId },
            { sender_id: targetId, recipient_id: currentUserId }
          ]
        };
      }
    }

    const raw = await Message.find(filter).sort({ created_at: 1 }).lean();
    const data = await populateMessagesSafely(raw);

    res.json({ data: data || [] });
  } catch (err) {
    console.error('Error fetching conversation:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/messages - Send a message or broadcast to all clients
router.post('/', authenticateToken, async (req, res) => {
  try {
    let { recipient_id, subject, body, application_id, attachments, reply_to, is_broadcast } = req.body;
    const senderId = req.user.id || req.user._id.toString();
    const isStaff = isStaffUser(req.user);

    const isBroadcast = isStaff && (recipient_id === 'all_clients' || recipient_id === 'all' || is_broadcast === true);

    if (isBroadcast) {
      recipient_id = 'all_clients';
    } else if (!recipient_id || recipient_id === 'admin' || recipient_id === 'support') {
      recipient_id = isStaff ? 'all_clients' : 'admin';
    }

    // Deduplication guard: Check if identical message was already saved within the last 2.5 seconds
    const twoSecondsAgo = new Date(Date.now() - 2500);
    const existingRecent = await Message.findOne({
      sender_id: senderId,
      recipient_id,
      body: body?.trim(),
      $or: [
        { created_at: { $gte: twoSecondsAgo } },
        { createdAt: { $gte: twoSecondsAgo } }
      ]
    });

    if (existingRecent) {
      const populated = await populateMessagesSafely(existingRecent);
      return res.status(200).json({ data: populated });
    }

    const message = new Message({
      sender_id: senderId,
      recipient_id,
      subject: subject || (isBroadcast ? 'HFA Official Broadcast Announcement' : 'No Subject'),
      body: body?.trim(),
      is_broadcast: isBroadcast,
      application_id: (application_id && mongoose.Types.ObjectId.isValid(application_id)) ? application_id : null,
      attachments: Array.isArray(attachments) ? attachments : [],
      reply_to: (reply_to && mongoose.Types.ObjectId.isValid(reply_to)) ? reply_to : null,
      is_read: false,
      created_at: new Date()
    });

    const saved = await message.save();
    const populated = await populateMessagesSafely(saved);

    const senderName = req.user.full_name || req.user.company_name || 'HFA Support & Compliance Team';

    // BROADCAST TO ALL CLIENTS WITH EMAIL NOTIFICATIONS
    if (isBroadcast) {
      const clients = await User.find({ role: 'client' }).select('_id full_name company_name email').lean();

      // Real-time socket broadcast to all connected clients & staff
      emitToClients('new_message', populated);
      emitToAdmins('new_message', populated);

      // In-app notifications for all registered clients
      for (const client of clients) {
        createNotification(
          client._id,
          `Announcement: ${subject || 'New Notice from HFA'} 📢`,
          body?.length > 120 ? body.substring(0, 117) + '...' : body,
          'info',
          '/messages'
        ).catch(() => {});
      }

      // Email notifications to all clients via Resend
      const frontendClientUrl = process.env.FRONTEND_CLIENT_URL || 'https://client.hfaportal.company';
      const clientsWithEmail = clients.filter(c => c.email && c.email.includes('@'));

      let emailsDispatched = 0;
      const emailBatch = clientsWithEmail.map(async (c) => {
        try {
          const clientName = c.full_name || c.company_name || 'Valued Client';
          await resend.emails.send({
            from: emailFrom,
            to: c.email,
            subject: `[HFA Announcement] ${subject || 'Important Notice from Halal Food Authority'}`,
            html: `
              <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:620px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 4px 12px rgba(0,0,0,0.05)">
                <div style="background:linear-gradient(135deg,#15803d 0%,#166534 100%);padding:32px 24px;text-align:center;color:white">
                  <h1 style="margin:0;font-size:24px;font-weight:800;letter-spacing:-0.5px">Halal Food Authority</h1>
                  <div style="font-size:13px;opacity:0.9;margin-top:4px;text-transform:uppercase;letter-spacing:1px">Official Broadcast Notification</div>
                </div>
                <div style="padding:32px 28px">
                  <div style="display:inline-block;background:#ecfdf5;color:#166534;font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;margin-bottom:16px;border:1px solid #bbf7d0">
                    📢 BROADCAST ANNOUNCEMENT
                  </div>
                  <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0f172a;line-height:1.3">
                    ${subject || 'Important Notice from HFA Support'}
                  </h2>
                  <p style="font-size:14px;color:#475569;margin:0 0 16px">Dear <strong>${clientName}</strong>,</p>
                  <div style="font-size:14.5px;color:#1e293b;line-height:1.7;background:#f8fafc;padding:20px;border-radius:10px;border-left:4px solid #16a34a;white-space:pre-wrap;margin-bottom:24px">${body}</div>
                  <div style="text-align:center;margin:28px 0">
                    <a href="${frontendClientUrl}/messages" style="display:inline-block;background:#16a34a;color:white;text-decoration:none;padding:13px 32px;border-radius:8px;font-weight:700;font-size:14px;box-shadow:0 2px 6px rgba(22,163,74,0.3)">
                      Open Portal Messages →
                    </a>
                  </div>
                  <hr style="border:none;border-top:1px solid #f1f5f9;margin:24px 0" />
                  <div style="font-size:12px;color:#94a3b8;line-height:1.5">
                    Sent by <strong>${senderName}</strong> via HFA Official Portal.<br/>
                    You can reply to this message directly from your HFA Client Portal.
                  </div>
                </div>
              </div>
            `
          });
          emailsDispatched++;
        } catch (emailErr) {
          console.error(`[Resend Broadcast Error for ${c.email}]:`, emailErr.message);
        }
      });

      Promise.allSettled(emailBatch).then(async () => {
        try {
          await Message.findByIdAndUpdate(saved._id, {
            broadcast_stats: {
              recipient_count: clients.length,
              email_count: emailsDispatched
            }
          });
          console.log(`✅ Broadcast message sent to ${clients.length} clients (${emailsDispatched} emails dispatched)`);
        } catch (err) {}
      });

      // Also emit to sender
      emitToUser(senderId, 'message_sent', populated);

      return res.status(201).json({
        data: populated,
        broadcast: true,
        recipient_count: clients.length,
        email_count: clientsWithEmail.length,
        message: `Broadcast message sent to all ${clients.length} clients and dispatched via email`
      });
    }

    // DIRECT MESSAGE NOTIFICATIONS & SOCKET EMITS
    if (recipient_id === 'admin' || recipient_id === 'support' || isStaffUser({ role: recipient_id })) {
      // Message to admin team
      emitToAdmins('new_message', populated);

      // Create notification for staff
      const admins = await User.find({ role: { $in: STAFF_ROLES } });
      for (const admin of admins) {
        await createNotification(
          admin._id,
          'New Message ✉️',
          `${senderName}: ${subject || 'Sent a new message'}`,
          'info',
          '/messages'
        );
      }
    } else {
      // Message to specific user
      emitToUser(recipient_id, 'new_message', populated);
      
      if (mongoose.Types.ObjectId.isValid(recipient_id)) {
        await createNotification(
          recipient_id,
          'New Message ✉️',
          `${senderName}: ${subject || 'Sent a new message'}`,
          'info',
          '/messages'
        );

        // Also send single email notification to client if sent by staff
        if (isStaff) {
          try {
            const targetClient = await User.findById(recipient_id);
            if (targetClient?.email) {
              const frontendClientUrl = process.env.FRONTEND_CLIENT_URL || 'https://client.hfaportal.company';
              await resend.emails.send({
                from: emailFrom,
                to: targetClient.email,
                subject: `[HFA Support] ${subject || 'New Message from Halal Food Authority'}`,
                html: `
                  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
                    <div style="background:linear-gradient(135deg,#15803d,#166534);padding:28px 24px;text-align:center;color:white">
                      <h1 style="margin:0;font-size:22px;font-weight:800">Halal Food Authority</h1>
                      <div style="font-size:12px;opacity:0.9;margin-top:4px">Official Support Communication</div>
                    </div>
                    <div style="padding:28px 24px">
                      <h3 style="margin:0 0 12px;font-size:18px;color:#0f172a">${subject || 'New Message from HFA Support'}</h3>
                      <p style="font-size:14px;color:#475569;margin:0 0 16px">Dear <strong>${targetClient.full_name || targetClient.company_name || 'Client'}</strong>,</p>
                      <div style="font-size:14px;color:#1e293b;line-height:1.6;background:#f8fafc;padding:16px;border-radius:8px;border-left:4px solid #16a34a;white-space:pre-wrap;margin-bottom:20px">${body}</div>
                      <div style="text-align:center;margin:24px 0">
                        <a href="${frontendClientUrl}/messages" style="display:inline-block;background:#16a34a;color:white;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;font-size:14px">
                          View & Reply in Portal →
                        </a>
                      </div>
                    </div>
                  </div>
                `
              });
            }
          } catch (e) {
            console.error('Direct Message Resend Email error:', e.message);
          }
        }
      }
    }

    // Also emit to sender so other tabs/devices update immediately
    emitToUser(senderId, 'message_sent', populated);

    res.status(201).json({ data: populated });
  } catch (err) {
    console.error('Error sending message:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/messages/:id/read - Mark message as read
router.put('/:id/read', authenticateToken, async (req, res) => {
  try {
    const data = await Message.findByIdAndUpdate(
      req.params.id,
      { is_read: true, read_at: new Date() },
      { new: true }
    );
    if (!data) return res.status(404).json({ error: 'Message not found' });

    // Emit read receipt to sender
    if (data.sender_id) {
      emitToUser(data.sender_id, 'message_read', { messageId: data._id, read_at: data.read_at });
    }

    res.json({ data });
  } catch (err) {
    console.error('Error marking message read:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/messages/conversation/:targetId/read - Mark entire conversation as read
router.put('/conversation/:targetId/read', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id.toString();
    const targetId = req.params.targetId;

    let filter;
    if (isStaffUser(req.user)) {
      filter = {
        sender_id: targetId,
        $or: [
          { recipient_id: userId },
          { recipient_id: 'admin' },
          { recipient_id: 'support' },
          { recipient_id: null }
        ],
        is_read: false
      };
    } else {
      filter = {
        sender_id: targetId === 'admin' ? { $ne: userId } : targetId,
        recipient_id: userId,
        is_read: false
      };
    }

    await Message.updateMany(filter, { is_read: true, read_at: new Date() });
    res.json({ success: true });
  } catch (err) {
    console.error('Error bulk reading conversation:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/messages/:id
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id.toString();
    const message = await Message.findById(req.params.id);
    if (!message) return res.status(404).json({ error: 'Message not found' });

    if (message.sender_id !== userId && message.recipient_id !== userId && !isStaffUser(req.user)) {
      return res.status(403).json({ error: 'Unauthorized to delete this message' });
    }

    await Message.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting message:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/messages/unread-count
router.get('/unread-count', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id.toString();
    let queryFilter;

    if (isStaffUser(req.user)) {
      queryFilter = {
        $or: [
          { recipient_id: userId },
          { recipient_id: 'admin' },
          { recipient_id: 'support' },
          { recipient_id: null }
        ],
        is_read: false
      };
    } else {
      queryFilter = { recipient_id: userId, is_read: false };
    }

    const count = await Message.countDocuments(queryFilter);
    res.json({ count });
  } catch (err) {
    console.error('Error fetching unread count:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
