import express from 'express';
import mongoose from 'mongoose';
import Ticket from '../models/Ticket.js';
import User from '../models/User.js';
import Application from '../models/Application.js';
import { authenticateToken } from '../middleware/auth.js';
import { createNotification } from '../lib/notifications.js';
import { emitToUser, emitToAdmins } from '../lib/socket.js';

const router = express.Router();

const STAFF_ROLES = ['admin', 'superadmin', 'scheme_manager', 'food_tech_manager', 'food_tech', 'certificate_officer', 'accountant', 'audit_manager', 'staff'];

const isStaffUser = (user) => {
  if (!user) return false;
  if (STAFF_ROLES.includes(user.role)) return true;
  if (Array.isArray(user.roles) && user.roles.some(r => STAFF_ROLES.includes(r))) return true;
  return false;
};

// Safe enrichment helper to populate user, assigned staff, and application without Mongoose CastError
const populateTicketsSafely = async (tickets) => {
  if (!tickets) return null;
  const isArray = Array.isArray(tickets);
  const ticketList = isArray ? tickets : [tickets];
  if (ticketList.length === 0 || !ticketList[0]) return tickets;

  const userIds = new Set();
  const staffIds = new Set();
  const appIds = new Set();

  ticketList.forEach(t => {
    if (t.user_id && mongoose.Types.ObjectId.isValid(t.user_id)) {
      userIds.add(t.user_id.toString());
    }
    if (t.assigned_to && mongoose.Types.ObjectId.isValid(t.assigned_to)) {
      staffIds.add(t.assigned_to.toString());
    }
    if (t.application_id && mongoose.Types.ObjectId.isValid(t.application_id)) {
      appIds.add(t.application_id.toString());
    }
  });

  const allUserIds = Array.from(new Set([...userIds, ...staffIds]));

  const [users, apps] = await Promise.all([
    allUserIds.length > 0 ? User.find({ _id: { $in: allUserIds } }).select('full_name company_name email phone role avatar_url').lean() : [],
    appIds.size > 0 ? Application.find({ _id: { $in: Array.from(appIds) } }).select('company_name scheme status').lean() : []
  ]);

  const userMap = new Map(users.map(u => [u._id.toString(), u]));
  const appMap = new Map(apps.map(a => [a._id.toString(), a]));

  const enriched = ticketList.map(t => {
    const doc = t.toObject ? t.toObject({ virtuals: true }) : { ...t };

    // User resolution
    if (doc.user_id && userMap.has(doc.user_id.toString())) {
      doc.user = userMap.get(doc.user_id.toString());
    } else {
      doc.user = {
        _id: doc.user_id,
        full_name: 'Client User',
        company_name: 'Client Company',
        role: 'client'
      };
    }

    // Assigned staff resolution
    if (doc.assigned_to && userMap.has(doc.assigned_to.toString())) {
      doc.assigned_staff = userMap.get(doc.assigned_to.toString());
    } else {
      doc.assigned_staff = null;
    }

    // Application resolution
    if (doc.application_id && appMap.has(doc.application_id.toString())) {
      doc.application_id = appMap.get(doc.application_id.toString());
    }

    return doc;
  });

  return isArray ? enriched : enriched[0];
};

// GET /api/tickets - List tickets
router.get('/', authenticateToken, async (req, res) => {
  try {
    const isStaff = isStaffUser(req.user);
    const filter = isStaff ? {} : { user_id: req.user.id || req.user._id.toString() };
    
    const raw = await Ticket.find(filter).sort({ updated_at: -1, created_at: -1 }).lean();
    const tickets = await populateTicketsSafely(raw);

    res.json({ data: tickets || [] });
  } catch (err) {
    console.error('Error fetching tickets:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tickets/:id - Get single ticket details
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const raw = await Ticket.findById(req.params.id).lean();
    if (!raw) return res.status(404).json({ error: 'Ticket not found' });

    const isStaff = isStaffUser(req.user);
    const userId = req.user.id || req.user._id.toString();

    if (!isStaff && raw.user_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized to view this ticket' });
    }

    const ticket = await populateTicketsSafely(raw);
    res.json({ data: ticket });
  } catch (err) {
    console.error('Error fetching ticket:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tickets - Create ticket
router.post('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id.toString();
    const ticketCount = await Ticket.countDocuments();
    const randomSuffix = Math.floor(100 + Math.random() * 900);
    const ticket_number = `TKT-${String(ticketCount + 1).padStart(4, '0')}${randomSuffix}`;

    const { subject, message, department, priority, application_id, attachments } = req.body;

    const ticket = new Ticket({
      ticket_number,
      user_id: userId,
      subject,
      message,
      department: department || 'General',
      priority: priority || 'medium',
      status: 'open',
      application_id: (application_id && mongoose.Types.ObjectId.isValid(application_id)) ? application_id : null,
      attachments: Array.isArray(attachments) ? attachments : [],
      responses: [],
      created_at: new Date(),
      updated_at: new Date()
    });

    const saved = await ticket.save();
    const populated = await populateTicketsSafely(saved);

    // Notify admins if created by client
    if (!isStaffUser(req.user)) {
      const clientName = req.user.company_name || req.user.full_name || 'Client';
      const admins = await User.find({ role: { $in: STAFF_ROLES } });
      for (const admin of admins) {
        await createNotification(
          admin._id,
          'New Support Ticket 🎫',
          `${ticket.ticket_number}: ${subject} from ${clientName}`,
          'info',
          '/tickets'
        );
      }
    }

    // Emit real-time events
    emitToAdmins('ticket_created', populated);
    emitToUser(userId, 'ticket_created', populated);

    res.status(201).json({ data: populated });
  } catch (err) {
    console.error('Error creating ticket:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tickets/:id/reply - Reply to ticket
router.post('/:id/reply', authenticateToken, async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const isStaff = isStaffUser(req.user);
    const userId = req.user.id || req.user._id.toString();
    const userRole = isStaff ? (req.user.role === 'superadmin' ? 'Superadmin' : 'HFA Staff') : 'Client';
    const userName = req.user.full_name || (isStaff ? 'HFA Support' : 'Client');

    const newResponse = {
      user_id: userId,
      user_name: userName,
      user_role: userRole,
      message: req.body.message,
      attachments: Array.isArray(req.body.attachments) ? req.body.attachments : [],
      created_at: new Date()
    };

    ticket.responses.push(newResponse);
    ticket.updated_at = new Date();

    // If staff replied and status was open, transition to in_progress
    if (isStaff && ticket.status === 'open') {
      ticket.status = 'in_progress';
    }

    // If client replied and status was resolved/closed, reopen
    if (!isStaff && (ticket.status === 'resolved' || ticket.status === 'closed')) {
      ticket.status = 'in_progress';
    }

    // Optional status update from staff during reply
    if (isStaff && req.body.status) {
      ticket.status = req.body.status;
      if (req.body.status === 'resolved') ticket.resolved_at = new Date();
      if (req.body.status === 'closed') ticket.closed_at = new Date();
    }

    await ticket.save();
    const populated = await populateTicketsSafely(ticket);

    // Send notification to the other party
    if (isStaff) {
      if (mongoose.Types.ObjectId.isValid(ticket.user_id)) {
        await createNotification(
          ticket.user_id,
          'Support Ticket Reply 💬',
          `HFA Support replied to your ticket ${ticket.ticket_number}.`,
          'info',
          '/tickets'
        );
      }
    } else {
      const admins = await User.find({ role: { $in: STAFF_ROLES } });
      const clientName = req.user.company_name || req.user.full_name || 'Client';
      for (const admin of admins) {
        await createNotification(
          admin._id,
          'Ticket Reply 💬',
          `${clientName} replied to ticket ${ticket.ticket_number}.`,
          'info',
          '/tickets'
        );
      }
    }

    // Real-time socket emits to both sides
    const eventPayload = { ticketId: ticket._id, ticket: populated, reply: newResponse };
    emitToUser(ticket.user_id, 'ticket_reply', eventPayload);
    emitToAdmins('ticket_reply', eventPayload);

    res.json({ data: populated });
  } catch (err) {
    console.error('Error replying to ticket:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/tickets/:id/status - Update status, priority, department, or assigned staff
router.patch('/:id/status', authenticateToken, async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const isStaff = isStaffUser(req.user);
    const { status, priority, department, assigned_to } = req.body;

    if (status) {
      ticket.status = status;
      if (status === 'resolved') ticket.resolved_at = new Date();
      if (status === 'closed') ticket.closed_at = new Date();
    }

    if (isStaff) {
      if (priority) ticket.priority = priority;
      if (department) ticket.department = department;
      if (assigned_to !== undefined) {
        ticket.assigned_to = (assigned_to && mongoose.Types.ObjectId.isValid(assigned_to)) ? assigned_to : null;
      }
    }

    ticket.updated_at = new Date();
    await ticket.save();

    const populated = await populateTicketsSafely(ticket);

    // Notify client if status changed
    if (status && mongoose.Types.ObjectId.isValid(ticket.user_id)) {
      const statusLabel = status.replace('_', ' ').toUpperCase();
      await createNotification(
        ticket.user_id,
        `Ticket Status Updated: ${statusLabel}`,
        `Your ticket ${ticket.ticket_number} has been updated to "${status.replace('_', ' ')}".`,
        status === 'resolved' ? 'success' : 'info',
        '/tickets'
      );
    }

    // Real-time socket emit
    emitToUser(ticket.user_id, 'ticket_updated', populated);
    emitToAdmins('ticket_updated', populated);

    res.json({ data: populated });
  } catch (err) {
    console.error('Error updating ticket status:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
