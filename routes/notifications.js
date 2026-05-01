import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import Application from '../models/Application.js';
import Certificate from '../models/Certificate.js';

const router = express.Router();

// GET /api/notifications — generate notifications from real data
router.get('/', authenticateToken, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const notifications = [];
    const now = new Date();

    if (isAdmin) {
      // Admin: new applications submitted in last 7 days
      const recentApps = await Application.find({
        status: 'submitted',
        created_at: { $gte: new Date(now - 7 * 864e5) }
      }).populate('profiles').sort({ created_at: -1 }).limit(10);

      recentApps.forEach(a => {
        notifications.push({
          id: `app-${a._id}`,
          type: 'application',
          title: 'New Application Received',
          message: `${a.profiles?.company_name || 'A client'} submitted ${a.application_number}`,
          time: a.created_at,
          read: false,
          link: `/applications?appId=${a._id}`
        });
      });

      // Admin: certs expiring in 60 days
      const expiring = await Certificate.find({
        status: 'active',
        expiry_date: { $lte: new Date(now.getTime() + 60 * 864e5), $gte: now }
      }).populate('profiles').sort({ expiry_date: 1 }).limit(5);

      expiring.forEach(c => {
        const days = Math.ceil((new Date(c.expiry_date) - now) / 864e5);
        notifications.push({
          id: `cert-exp-${c._id}`,
          type: 'warning',
          title: 'Certificate Expiring Soon',
          message: `${c.certificate_number} expires in ${days} day${days !== 1 ? 's' : ''}`,
          time: c.expiry_date,
          read: false,
          link: `/certificates`
        });
      });

      // Admin: under_review applications
      const underReview = await Application.find({ status: 'under_review' })
        .populate('profiles').sort({ updated_at: -1 }).limit(5);

      underReview.forEach(a => {
        notifications.push({
          id: `review-${a._id}`,
          type: 'info',
          title: 'Application Under Review',
          message: `${a.application_number} is pending your review`,
          time: a.updated_at || a.created_at,
          read: false,
          link: `/applications?appId=${a._id}`
        });
      });

    } else {
      // Client: their own applications with status updates
      const myApps = await Application.find({ client_id: req.user._id })
        .sort({ updated_at: -1 }).limit(10);

      myApps.forEach(a => {
        const statusMessages = {
          under_review: 'Your application is now under review by HFA',
          approved: 'Congratulations! Your application has been approved',
          rejected: 'Your application was not successful. Please contact HFA',
          on_hold: 'Your application has been placed on hold',
          audit_scheduled: 'An audit has been scheduled for your site',
          audit_completed: 'Your site audit has been completed',
          certificate_issued: '🎉 Your Halal Certificate has been issued!',
        };
        const msg = statusMessages[a.status];
        if (msg) {
          notifications.push({
            id: `app-${a._id}`,
            type: a.status === 'rejected' ? 'error' : a.status === 'certificate_issued' ? 'success' : 'info',
            title: `Application ${a.application_number}`,
            message: msg,
            time: a.updated_at || a.created_at,
            read: false,
            link: `/applications?appId=${a._id}`
          });
        }
      });

      // Client: Proposals received
      const { default: Proposal } = await import('../models/Proposal.js');
      const proposals = await Proposal.find({ client_id: req.user._id }).sort({ created_at: -1 }).limit(5);

      proposals.forEach(p => {
        if (p.status === 'pending') {
          notifications.push({
            id: `prop-${p._id}`,
            type: 'info',
            title: 'New Proposal Received',
            message: `HFA has sent a certification proposal for your review.`,
            time: p.created_at,
            read: false,
            link: `/applications?appId=${p.application_id}`
          });
        }
      });

      // Client: active certs expiring
      const expiring = await Certificate.find({
        client_id: req.user._id,
        status: 'active',
        expiry_date: { $lte: new Date(now.getTime() + 90 * 864e5), $gte: now }
      }).sort({ expiry_date: 1 }).limit(3);

      expiring.forEach(c => {
        const days = Math.ceil((new Date(c.expiry_date) - now) / 864e5);
        notifications.push({
          id: `cert-exp-${c._id}`,
          type: 'warning',
          title: 'Certificate Expiring Soon',
          message: `${c.certificate_number} expires in ${days} day${days !== 1 ? 's' : ''}`,
          time: c.expiry_date,
          read: false,
          link: `/certificates`
        });
      });
    }

    // Sort by most recent first
    notifications.sort((a, b) => new Date(b.time) - new Date(a.time));

    res.json({ data: notifications, unread: notifications.filter(n => !n.read).length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/notifications/mark-read — mark all as read (client-side state is enough, but good to have)
router.post('/mark-read', authenticateToken, async (req, res) => {
  res.json({ success: true });
});

export default router;
