import express from 'express';
import multer from 'multer';
import { uploadToGridFS } from '../lib/gridfs.js';
import Proposal from '../models/Proposal.js';
import User from '../models/User.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { createNotification } from '../lib/notifications.js';
import { Resend } from 'resend';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const resend = new Resend(process.env.RESEND_API_KEY);
const emailFrom = process.env.EMAIL_FROM || 'HFA Portal <info@halalfoodfoundation.org.uk>';

router.get('/', authenticateToken, async (req, res) => {
  try {
    let query = {};
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      query.client_id = req.user._id.toString();
    }
    const data = await Proposal.find(query)
      .populate('application_id')
      .populate({ path: 'application_id', populate: { path: 'profiles' } })
      .sort({ createdAt: -1 });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/application/:appId', authenticateToken, async (req, res) => {
  try {
    const data = await Proposal.findOne({ application_id: req.params.appId }).sort({ createdAt: -1 });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticateToken, requireAdmin, upload.single('proposal_file'), async (req, res) => {
  try {
    const { application_id, client_id, title, estimated_cost, admin_comment, details } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'Proposal PDF document is required.' });
    }

    const proposal_url = await uploadToGridFS(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    // Check if proposal already exists
    let proposal = await Proposal.findOne({ application_id });
    if (proposal) {
      if (proposal_url) proposal.proposal_url = proposal_url;
      if (title) proposal.title = title;
      if (estimated_cost) proposal.estimated_cost = estimated_cost;
      if (admin_comment !== undefined) proposal.admin_comment = admin_comment;
      if (details !== undefined) proposal.details = details;
      proposal.status = 'pending';
      proposal.client_comment = '';
      proposal.version = (proposal.version || 1) + 1;
      const data = await proposal.save();

      // Send Email Notification
      try {
        const clientUser = await User.findById(data.client_id);
        if (clientUser?.email) {
          await resend.emails.send({
            from: emailFrom,
            to: clientUser.email,
            subject: `HFA Certification Proposal Received: ${data.title}`,
            html: `<div style="font-family: Arial, sans-serif; padding: 20px;">
              <h2>Certification Proposal Received</h2>
              <p>Dear ${clientUser.full_name || 'Client'},</p>
              <p>You have received a revised certification proposal for <strong>${data.title}</strong> (v${data.version}).</p>
              <p>Please log in to your HFA Portal account to view details and respond.</p>
            </div>`
          });
        }
      } catch (e) {
        console.error('Proposal Resend Email error:', e.message);
      }

      // Clean up any other duplicate proposals for this application
      if (application_id) {
        await Proposal.deleteMany({
          application_id,
          _id: { $ne: data._id }
        });

        // Update application status to proposal_sent
        try {
          const Application = (await import('../models/Application.js')).default;
          const { emitApplicationUpdate } = await import('../lib/socket.js');
          const updatedApp = await Application.findByIdAndUpdate(application_id, {
            status: 'proposal_sent',
            updated_at: new Date(),
            $push: {
              statusHistory: {
                status: 'proposal_sent',
                changedAt: new Date(),
                changedBy: req.user._id,
                note: `Revised certification proposal (v${data.version}) sent: "${data.title}"`
              }
            }
          }, { new: true });
          if (updatedApp) emitApplicationUpdate(updatedApp, 'proposal_sent');
        } catch (appErr) {
          console.error('[Proposal] Error updating application status:', appErr.message);
        }
      }

      // Notify Client
      await createNotification(
        data.client_id,
        'Revised Proposal Received 📑',
        `You have received a revised certification proposal: ${data.title} (v${data.version}). Please review and respond.`,
        'info',
        '/proposals'
      );
      res.status(200).json({ data });
    } else {
      const proposalData = {
        client_id,
        application_id,
        title,
        estimated_cost: estimated_cost || 0,
        admin_comment: admin_comment || '',
        details: details || '',
        status: 'pending',
        version: 1,
      };
      if (proposal_url) proposalData.proposal_url = proposal_url;

      const newProposal = new Proposal(proposalData);
      const data = await newProposal.save();

      // Clean up any other duplicate proposals for this application
      if (application_id) {
        await Proposal.deleteMany({
          application_id,
          _id: { $ne: data._id }
        });

        // Update application status to proposal_sent
        try {
          const Application = (await import('../models/Application.js')).default;
          const { emitApplicationUpdate } = await import('../lib/socket.js');
          const updatedApp = await Application.findByIdAndUpdate(application_id, {
            status: 'proposal_sent',
            updated_at: new Date(),
            $push: {
              statusHistory: {
                status: 'proposal_sent',
                changedAt: new Date(),
                changedBy: req.user._id,
                note: `Certification proposal sent: "${data.title}"`
              }
            }
          }, { new: true });
          if (updatedApp) emitApplicationUpdate(updatedApp, 'proposal_sent');
        } catch (appErr) {
          console.error('[Proposal] Error updating application status:', appErr.message);
        }
      }

      // Send Email Notification
      try {
        const clientUser = await User.findById(data.client_id);
        if (clientUser?.email) {
          await resend.emails.send({
            from: emailFrom,
            to: clientUser.email,
            subject: `HFA Certification Proposal Issued: ${data.title}`,
            html: `<div style="font-family: Arial, sans-serif; padding: 20px;">
              <h2>New Certification Proposal</h2>
              <p>Dear ${clientUser.full_name || 'Client'},</p>
              <p>You have received a new certification proposal for <strong>${data.title}</strong>.</p>
              <p>Please log in to your HFA Portal account to review and respond.</p>
            </div>`
          });
        }
      } catch (e) {
        console.error('Proposal Resend Email error:', e.message);
      }

      // Notify Client
      await createNotification(
        data.client_id,
        'New Proposal Received 📑',
        `You have received a new certification proposal: ${data.title}. Please review and respond.`,
        'info',
        '/proposals'
      );
      res.status(201).json({ data });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const proposal = await Proposal.findById(req.params.id);
    if (!proposal) return res.status(404).json({ error: 'Proposal not found' });

    // If not admin, check if it's the right client
    if (!['admin', 'superadmin'].includes(req.user.role) && proposal.client_id !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { status, client_comment, admin_comment, ...otherData } = req.body;
    
    // Update logic
    if (status) proposal.status = status;
    if (client_comment) proposal.client_comment = client_comment;
    if (admin_comment) proposal.admin_comment = admin_comment;
    
    Object.assign(proposal, otherData);
    
    const data = await proposal.save();

    // Automatically synchronize Application status
    if (status && data.application_id) {
      try {
        const Application = (await import('../models/Application.js')).default;
        const { emitApplicationUpdate } = await import('../lib/socket.js');
        const targetStatus = status === 'accepted' ? 'proposal_approved' : status === 'rejected' ? 'proposal_rejected' : null;
        if (targetStatus) {
          const updatedApp = await Application.findByIdAndUpdate(
            data.application_id,
            {
              status: targetStatus,
              updated_at: new Date(),
              $push: {
                statusHistory: {
                  status: targetStatus,
                  changedAt: new Date(),
                  changedBy: req.user._id,
                  note: `Proposal ${status === 'accepted' ? 'accepted' : 'rejected'} by client.${client_comment ? ` Reason: "${client_comment}"` : ''}`
                }
              }
            },
            { new: true }
          );
          if (updatedApp) emitApplicationUpdate(updatedApp, targetStatus);
        }
      } catch (appErr) {
        console.error('[Proposal] Error syncing application status:', appErr.message);
      }
    }

    // Trigger email if proposal updated
    try {
      const clientUser = await User.findById(data.client_id);
      if (clientUser?.email && status) {
        await resend.emails.send({
          from: emailFrom,
          to: clientUser.email,
          subject: `Proposal Update: ${data.title} (${status})`,
          html: `<div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Proposal Status Updated</h2>
            <p>Proposal <strong>${data.title}</strong> has been updated to <strong>${status}</strong>.</p>
          </div>`
        });
      }
    } catch (e) {
      console.error('Proposal update email error:', e.message);
    }

    // Notify admins when a client (non-admin) responds to a proposal
    if (status && !['admin', 'superadmin', 'staff', 'food_tech_manager', 'food_tech'].includes(req.user.role)) {
      try {
        const clientName = req.user.company_name || req.user.full_name || 'A client';
        const statusLabel = status === 'accepted' ? 'accepted ✅' : status === 'rejected' ? 'rejected ❌' : `updated to "${status}"`;
        const admins = await User.find({ role: { $in: ['admin', 'superadmin', 'staff', 'food_tech_manager'] } });
        for (const admin of admins) {
          await createNotification(
            admin._id,
            `Proposal ${status === 'accepted' ? 'Accepted' : status === 'rejected' ? 'Rejected' : 'Updated'} 📑`,
            `${clientName} has ${statusLabel} the proposal: ${data.title}.${client_comment ? ` Comment: "${client_comment}"` : ''}`,
            status === 'accepted' ? 'success' : status === 'rejected' ? 'warning' : 'info',
            data.application_id ? `/applications?appId=${data.application_id}` : '/proposals'
          );
        }
      } catch (e) {
        console.error('Admin proposal notification error:', e.message);
      }
    }

    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
