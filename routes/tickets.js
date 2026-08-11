import express from 'express';
import Ticket from '../models/Ticket.js';
import User from '../models/User.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { createNotification } from '../lib/notifications.js';
const router = express.Router();

// Get user tickets
router.get('/', authenticateToken, async (req, res) => {
  try {
    const filter = ['admin', 'superadmin'].includes(req.user.role) ? {} : { user_id: req.user.id };
    const tickets = await Ticket.find(filter).sort({ created_at: -1 });
    res.json({ data: tickets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create ticket
router.post('/', authenticateToken, async (req, res) => {
  try {
    const ticketCount = await Ticket.countDocuments();
    const ticket_number = `TKT-${String(ticketCount + 1).padStart(5, '0')}`;
    const ticket = new Ticket({
      ...req.body,
      ticket_number,
      user_id: req.user.id
    });
    await ticket.save();

    // Notify Admin if it's a new ticket from a client
    if (req.user.role === 'client') {
      const admins = await User.find({ role: { $in: ['admin', 'superadmin', 'staff', 'food_tech_manager', 'food_tech'] } });
      for (const admin of admins) {
        await createNotification(
          admin._id,
          'New Support Ticket 🎫',
          `A new ticket (${ticket.ticket_number}) has been opened by ${req.user.full_name}.`,
          'info',
          '/tickets'
        );
      }
    }

    res.json({ data: ticket });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reply to ticket
router.post('/:id/reply', authenticateToken, async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    
    ticket.responses.push({
      user_id: req.user.id,
      user_name: req.user.full_name,
      message: req.body.message
    });
    
    if (['admin', 'superadmin'].includes(req.user.role)) ticket.status = 'in_progress';
    
    await ticket.save();

    // Notify the other party
    const recipientId = ['admin', 'superadmin'].includes(req.user.role) ? ticket.user_id : (await User.findOne({ role: { $in: ['admin', 'superadmin'] } }))._id;
    await createNotification(
      recipientId,
      'New Reply on Ticket 💬',
      `${req.user.full_name} replied to ticket ${ticket.ticket_number}.`,
      'info',
      '/tickets'
    );

    res.json({ data: ticket });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
