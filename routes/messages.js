import express from 'express';
import mongoose from 'mongoose';
import Message from '../models/Message.js';
import User from '../models/User.js';
import Application from '../models/Application.js';
import { authenticateToken } from '../middleware/auth.js';
import { createNotification } from '../lib/notifications.js';
import { emitToUser, emitToAdmins } from '../lib/socket.js';

const router = express.Router();

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
    if (doc.recipient_id && userMap.has(doc.recipient_id.toString())) {
      doc.recipient = userMap.get(doc.recipient_id.toString());
    } else if (doc.recipient_id === 'admin' || doc.recipient_id === 'support' || doc.recipient_id === 'all_clients') {
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
      // Admins/Staff see messages addressed to them, or to general admin/support
      queryFilter = {
        $or: [
          { recipient_id: userId },
          { recipient_id: 'admin' },
          { recipient_id: 'support' },
          { recipient_id: { $exists: false } },
          { recipient_id: null },
          { recipient_id: '' }
        ]
      };
    } else {
      // Clients see messages addressed to them
      queryFilter = { recipient_id: userId };
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

// GET /api/messages/conversation/:userId - Full conversation history with a target user
router.get('/conversation/:targetId', authenticateToken, async (req, res) => {
  try {
    const currentUserId = req.user.id || req.user._id.toString();
    const targetId = req.params.targetId;

    let filter;
    if (isStaffUser(req.user)) {
      // If staff is looking at conversation with a client
      filter = {
        $or: [
          { sender_id: currentUserId, recipient_id: targetId },
          { sender_id: targetId, recipient_id: currentUserId },
          { sender_id: targetId, recipient_id: { $in: ['admin', 'support', null, ''] } }
        ]
      };
    } else {
      // If client is looking at conversation
      if (targetId === 'admin' || targetId === 'support') {
        filter = {
          $or: [
            { sender_id: currentUserId },
            { recipient_id: currentUserId }
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

// POST /api/messages - Send a message
router.post('/', authenticateToken, async (req, res) => {
  try {
    let { recipient_id, subject, body, application_id, attachments, reply_to } = req.body;
    const senderId = req.user.id || req.user._id.toString();

    // Default recipient for clients if not specified or specified as 'admin'/'support'
    if (!recipient_id || recipient_id === 'admin' || recipient_id === 'support') {
      recipient_id = isStaffUser(req.user) ? 'all_clients' : 'admin';
    }

    const message = new Message({
      sender_id: senderId,
      recipient_id,
      subject: subject || 'No Subject',
      body,
      application_id: (application_id && mongoose.Types.ObjectId.isValid(application_id)) ? application_id : null,
      attachments: Array.isArray(attachments) ? attachments : [],
      reply_to: (reply_to && mongoose.Types.ObjectId.isValid(reply_to)) ? reply_to : null,
      is_read: false,
      created_at: new Date()
    });

    const saved = await message.save();
    const populated = await populateMessagesSafely(saved);

    const senderName = req.user.full_name || req.user.company_name || 'User';

    // Notifications & Socket Emits
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
