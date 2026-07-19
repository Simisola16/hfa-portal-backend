import express from 'express';
import multer from 'multer';
import { uploadToGridFS } from '../lib/gridfs.js';
import Proposal from '../models/Proposal.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { createNotification } from '../lib/notifications.js';

const router = express.Router();
// Use memory storage — buffers are uploaded directly to Supabase
const upload = multer({ storage: multer.memoryStorage() });

router.get('/', authenticateToken, async (req, res) => {
  try {
    let query = {};
    if (req.user.role !== 'admin') {
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

    let proposal_url = '';
    if (req.file) {
      proposal_url = await uploadToGridFS(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );
    }

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
    if (req.user.role !== 'admin' && proposal.client_id !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { status, client_comment, admin_comment, ...otherData } = req.body;
    
    // Update logic
    if (status) proposal.status = status;
    if (client_comment) proposal.client_comment = client_comment;
    if (admin_comment) proposal.admin_comment = admin_comment;
    
    Object.assign(proposal, otherData);
    
    const data = await proposal.save();
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
