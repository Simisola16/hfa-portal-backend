import express from 'express';
import mongoose from 'mongoose';
import Ticket from '../models/Ticket.js';
import User from '../models/User.js';
import Application from '../models/Application.js';
import { authenticateToken } from '../middleware/auth.js';
import { createNotification } from '../lib/notifications.js';
import { emitToUser, emitToAdmins } from '../lib/socket.js';
import { generateSupportAiResponse } from '../lib/supportAi.js';

const router = express.Router();

const STAFF_ROLES = ['admin', 'superadmin', 'support_manager', 'scheme_manager', 'food_tech_manager', 'food_tech', 'certificate_officer', 'accountant', 'audit_manager', 'staff', 'inspector'];

const isStaffUser = (user) => {
  if (!user) return false;
  if (user.role && user.role !== 'client') return true;
  if (Array.isArray(user.roles) && user.roles.some(r => r !== 'client')) return true;
  if (STAFF_ROLES.includes(user.role)) return true;
  return false;
};

// Returns true if the user is a support manager or superadmin (full ticket visibility)
const isSupportManagerUser = (user) => {
  if (!user) return false;
  const role = user.role || '';
  const roles = Array.isArray(user.roles) ? user.roles : [];
  return (
    role === 'superadmin' || roles.includes('superadmin') ||
    role === 'support_manager' || roles.includes('support_manager') ||
    Boolean(user.is_support_manager)
  );
};

// Sanitize ticket for client so they do NOT know when an admin has been assigned
// until the assigned agent actually views/connects
const sanitizeTicketForClient = (ticket) => {
  if (!ticket) return null;
  const isAgentConnected = Boolean(
    ticket.agent_connected ||
    ticket.agent_viewed_at ||
    (ticket.responses && ticket.responses.some(r => {
      const role = r.user_role?.toLowerCase() || '';
      return role.includes('staff') || role.includes('admin') || role.includes('agent');
    }))
  );

  if (!isAgentConnected) {
    const copy = { ...ticket };
    // Strip internal staff assignment details from client view
    copy.assigned_staff = null;
    copy.assigned_to = null;
    return copy;
  }
  return ticket;
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
    const isManager = isSupportManagerUser(req.user);
    const userId = req.user.id || req.user._id?.toString();

    let filter;
    if (!isStaff) {
      // Client: only their own tickets
      filter = { user_id: userId };
    } else if (isManager) {
      // Support manager / superadmin: see all tickets
      filter = {};
    } else {
      // Regular staff: only tickets assigned to them
      filter = mongoose.Types.ObjectId.isValid(userId) ? { assigned_to: new mongoose.Types.ObjectId(userId) } : { assigned_to: null };
    }

    const raw = await Ticket.find(filter).sort({ updated_at: -1, created_at: -1 }).lean();
    const tickets = await populateTicketsSafely(raw);
    const result = isStaff ? tickets : (tickets || []).map(t => sanitizeTicketForClient(t));

    res.json({ data: result || [] });
  } catch (err) {
    console.error('Error fetching tickets:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tickets/active-chat - Get current active support chat ticket for client
router.get('/active-chat', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id?.toString();
    if (!userId) {
      return res.json({ data: null });
    }

    const raw = await Ticket.findOne({
      user_id: userId,
      status: { $in: ['open', 'in_progress'] }
    }).sort({ updated_at: -1, created_at: -1 }).lean();

    if (!raw) {
      return res.json({ data: null });
    }

    const ticket = await populateTicketsSafely(raw);
    res.json({ data: ticket || null });
  } catch (err) {
    console.error('Error fetching active chat ticket:', err);
    res.json({ data: null });
  }
});

// GET /api/tickets/:id - Get single ticket details
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const raw = await Ticket.findById(req.params.id).lean();
    if (!raw) return res.status(404).json({ error: 'Ticket not found' });

    const isStaff = isStaffUser(req.user);
    const isManager = isSupportManagerUser(req.user);
    const userId = req.user.id || req.user._id.toString();

    // Clients can only view their own tickets
    if (!isStaff && raw.user_id?.toString() !== userId) {
      return res.status(403).json({ error: 'Unauthorized to view this ticket' });
    }

    // Non-manager staff can only view tickets assigned to them
    if (isStaff && !isManager) {
      const assignedTo = raw.assigned_to?.toString();
      if (assignedTo !== userId) {
        return res.status(403).json({ error: 'This ticket is not assigned to you' });
      }
    }

    const ticket = await populateTicketsSafely(raw);
    const result = isStaff ? ticket : sanitizeTicketForClient(ticket);
    res.json({ data: result });
  } catch (err) {
    console.error('Error fetching ticket:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tickets/ai-chat - Interactive AI Support Assistant
router.post('/ai-chat', authenticateToken, async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message cannot be empty.' });
    }
    const response = generateSupportAiResponse(message, history || []);
    res.json({ data: response });
  } catch (err) {
    console.error('Error in AI support chat:', err);
    res.status(500).json({ error: 'Failed to process AI chat query' });
  }
});

// POST /api/tickets/request-human - Client requests a real person / human agent
router.post('/request-human', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id.toString();
    const { department, description, priority, application_id } = req.body;

    if (!description || !description.trim()) {
      return res.status(400).json({ error: 'Please provide a description of your issue.' });
    }

    const dept = department || 'General Support';
    const ticketCount = await Ticket.countDocuments();
    const randomSuffix = Math.floor(100 + Math.random() * 900);
    const ticket_number = `TKT-${String(ticketCount + 1).padStart(4, '0')}${randomSuffix}`;

    const ticket = new Ticket({
      ticket_number,
      user_id: userId,
      subject: `Human Agent Request: ${dept}`,
      message: description.trim(),
      department: dept,
      priority: priority || 'medium',
      status: 'open',
      source: 'chat_widget',
      application_id: (application_id && mongoose.Types.ObjectId.isValid(application_id)) ? application_id : null,
      responses: [],
      created_at: new Date(),
      updated_at: new Date()
    });

    const saved = await ticket.save();
    const populated = await populateTicketsSafely(saved);

    // Find all users who have the Support Manager privilege or Superadmin
    const supportManagers = await User.find({
      $or: [
        { is_support_manager: true },
        { role: 'support_manager' },
        { roles: 'support_manager' },
        { role: 'superadmin' },
        { roles: 'superadmin' }
      ],
      is_active: true
    });

    const clientName = req.user.company_name || req.user.full_name || 'Client';

    // Dispatch direct notification to each Support Manager
    for (const sm of supportManagers) {
      await createNotification(
        sm._id,
        '🚨 Human Support Requested',
        `${clientName} requested human support for ${dept}: "${description.trim().slice(0, 65)}..."`,
        'warning',
        '/tickets'
      );
      emitToUser(sm._id, 'support_manager_alert', {
        ticket: populated,
        clientName,
        department: dept,
        description: description.trim()
      });
    }

    // Broadcast standard real-time events to all staff and client
    emitToAdmins('ticket_created', populated);
    emitToUser(userId, 'ticket_created', populated);

    res.status(201).json({
      data: populated,
      message: 'Support request dispatched. An HFA Support Manager has been notified to assign an agent to your case.'
    });
  } catch (err) {
    console.error('Error requesting human agent:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tickets - Create ticket
router.post('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id.toString();
    const { subject, message, department, priority, application_id, attachments } = req.body;

    // Deduplication guard for new ticket
    const twoSecondsAgo = new Date(Date.now() - 2500);
    const recentDuplicate = await Ticket.findOne({
      user_id: userId,
      subject: subject?.trim(),
      message: message?.trim(),
      $or: [
        { created_at: { $gte: twoSecondsAgo } },
        { createdAt: { $gte: twoSecondsAgo } }
      ]
    });
    if (recentDuplicate) {
      const populated = await populateTicketsSafely(recentDuplicate);
      return res.status(200).json({ data: populated });
    }

    const ticketCount = await Ticket.countDocuments();
    const randomSuffix = Math.floor(100 + Math.random() * 900);
    const ticket_number = `TKT-${String(ticketCount + 1).padStart(4, '0')}${randomSuffix}`;

    const ticket = new Ticket({
      ticket_number,
      user_id: userId,
      subject: subject?.trim(),
      message: message?.trim(),
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
    const isManager = isSupportManagerUser(req.user);
    const userId = req.user.id || req.user._id.toString();

    // Staff access control: only the assigned agent or a support manager can reply
    if (isStaff && !isManager) {
      const assignedTo = ticket.assigned_to?.toString();
      if (assignedTo !== userId) {
        return res.status(403).json({
          error: 'You are not authorized to reply to this ticket. Only the assigned agent or a support manager can send messages.'
        });
      }
    }

    // Deduplication guard for reply within last 2.5s
    const lastResponse = ticket.responses && ticket.responses[ticket.responses.length - 1];
    const lastTime = lastResponse ? (lastResponse.created_at || lastResponse.createdAt) : null;
    if (
      lastResponse &&
      lastResponse.user_id === userId &&
      lastResponse.message === req.body.message?.trim() &&
      lastTime &&
      (Date.now() - new Date(lastTime).getTime()) < 2500
    ) {
      const populated = await populateTicketsSafely(ticket);
      return res.json({ data: populated });
    }

    const userRole = isStaff ? (req.user.role === 'superadmin' ? 'Superadmin' : 'HFA Staff') : 'Client';
    const userName = req.user.full_name || (isStaff ? 'HFA Support' : 'Client');

    const newResponse = {
      user_id: userId,
      user_name: userName,
      user_role: userRole,
      message: req.body.message?.trim(),
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

    // If staff replied and agent wasn't marked connected yet:
    let justConnected = false;
    if (isStaff && ticket.assigned_to && !ticket.agent_viewed_at) {
      ticket.agent_viewed_at = new Date();
      ticket.agent_connected = true;
      justConnected = true;
    }

    await ticket.save();
    const populated = await populateTicketsSafely(ticket);

    if (justConnected && populated.assigned_staff) {
      const fullName = populated.assigned_staff.full_name || populated.assigned_staff.username || 'Support Agent';
      const firstName = fullName.trim().split(/\s+/)[0] || 'Support';
      emitToUser(ticket.user_id, 'agent_connected', {
        ticketId: ticket._id,
        ticketNumber: ticket.ticket_number,
        agent_first_name: firstName,
        agent_full_name: fullName,
        agent: populated.assigned_staff,
        ticket: populated
      });
    }

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

    let newlyAssignedStaffId = null;

    if (isStaff) {
      if (priority) ticket.priority = priority;
      if (department) ticket.department = department;
      if (assigned_to !== undefined) {
        const prevAssigned = ticket.assigned_to ? ticket.assigned_to.toString() : null;
        const nextAssigned = (assigned_to && mongoose.Types.ObjectId.isValid(assigned_to)) ? assigned_to.toString() : null;
        ticket.assigned_to = nextAssigned ? new mongoose.Types.ObjectId(nextAssigned) : null;
        if (nextAssigned && nextAssigned !== prevAssigned) {
          newlyAssignedStaffId = nextAssigned;
          // Reset viewed/connected so client won't know admin assignment until new agent views it
          ticket.agent_viewed_at = null;
          ticket.agent_connected = false;
        }
      }
    }

    ticket.updated_at = new Date();
    await ticket.save();

    const populated = await populateTicketsSafely(ticket);

    // If an admin was just assigned, dispatch a notification and socket event to them
    if (newlyAssignedStaffId) {
      const clientName = (populated.user && (populated.user.company_name || populated.user.full_name)) || 'Client';
      await createNotification(
        newlyAssignedStaffId,
        'Support Ticket Assigned 🎫',
        `Support Manager assigned you to Ticket ${ticket.ticket_number} (${clientName}) for ${ticket.department}.`,
        'info',
        '/tickets'
      );
      emitToUser(newlyAssignedStaffId, 'ticket_assigned', {
        ticketId: ticket._id,
        ticket: populated,
        ticketNumber: ticket.ticket_number
      });
    }

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
    // Client should NOT know an admin has been assigned until agent views/connects
    emitToUser(ticket.user_id, 'ticket_updated', sanitizeTicketForClient(populated));
    emitToAdmins('ticket_updated', populated);

    res.json({ data: populated });
  } catch (err) {
    console.error('Error updating ticket status:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tickets/:id/view - Staff/Agent views the ticket, marking it viewed and connecting agent
router.post('/:id/view', authenticateToken, async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const isStaff = isStaffUser(req.user);
    if (!isStaff) {
      return res.status(403).json({ error: 'Only staff can mark ticket as viewed' });
    }

    let newlyConnected = false;
    // When the ticket has an assigned staff and staff views it
    if (ticket.assigned_to && !ticket.agent_viewed_at) {
      ticket.agent_viewed_at = new Date();
      ticket.agent_connected = true;
      ticket.updated_at = new Date();
      await ticket.save();
      newlyConnected = true;
    }

    const populated = await populateTicketsSafely(ticket);

    if (newlyConnected && populated.assigned_staff) {
      const fullName = populated.assigned_staff.full_name || populated.assigned_staff.username || 'Support Agent';
      const firstName = fullName.trim().split(/\s+/)[0] || 'Support';

      emitToUser(ticket.user_id, 'agent_connected', {
        ticketId: ticket._id,
        ticketNumber: ticket.ticket_number,
        agent_first_name: firstName,
        agent_full_name: fullName,
        agent: populated.assigned_staff,
        ticket: populated
      });

      emitToUser(ticket.user_id, 'ticket_updated', populated);
      emitToAdmins('ticket_updated', populated);
    }

    res.json({ data: populated });
  } catch (err) {
    console.error('Error in ticket view:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tickets/active-chat - Get current user's latest active chat widget ticket
router.get('/active-chat', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id.toString();
    const ticket = await Ticket.findOne({
      user_id: userId,
      status: { $in: ['open', 'in_progress'] }
    }).sort({ updated_at: -1, created_at: -1 }).lean();

    if (!ticket) return res.json({ data: null });
    const populated = await populateTicketsSafely(ticket);
    const isStaff = isStaffUser(req.user);
    const result = isStaff ? populated : sanitizeTicketForClient(populated);
    res.json({ data: result });
  } catch (err) {
    console.error('Error fetching active chat ticket:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
