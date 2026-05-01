import express from 'express';
import multer from 'multer';
import { storage } from '../lib/cloudinary.js';
import Proposal from '../models/Proposal.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();
const upload = multer({ storage });

router.get('/', authenticateToken, async (req, res) => {
  try {
    let query = {};
    if (req.user.role !== 'admin') {
      query.client_id = req.user._id;
    }
    const data = await Proposal.find(query)
      .populate('application_id')
      .populate({ path: 'application_id', populate: { path: 'profiles' } })
      .sort({ created_at: -1 });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/application/:appId', authenticateToken, async (req, res) => {
  try {
    const data = await Proposal.findOne({ application_id: req.params.appId }).sort({ created_at: -1 });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticateToken, requireAdmin, upload.single('proposal_file'), async (req, res) => {
  try {
    const proposalData = { ...req.body };
    if (req.file) {
      proposalData.proposal_url = req.file.path;
    }
    const proposal = new Proposal(proposalData);
    const data = await proposal.save();
    res.status(201).json({ data });
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
