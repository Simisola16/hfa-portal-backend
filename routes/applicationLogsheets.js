import express from 'express';
import ApplicationLogsheet from '../models/ApplicationLogsheet.js';
import Application from '../models/Application.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// GET /api/application-logsheets/application/:appId
router.get('/application/:appId', authenticateToken, async (req, res) => {
  try {
    const logsheet = await ApplicationLogsheet.findOne({ application_id: req.params.appId })
      .populate('client_id', 'full_name company_name email')
      .populate('site_id', 'name address');
    
    if (!logsheet) return res.status(404).json({ error: 'Logsheet not found' });
    res.json({ data: logsheet });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/application-logsheets
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { application_id, client_id, site_id, ...logsheetData } = req.body;
    
    // Check if one already exists
    let logsheet = await ApplicationLogsheet.findOne({ application_id });
    if (logsheet) {
      Object.assign(logsheet, logsheetData);
    } else {
      logsheet = new ApplicationLogsheet({ application_id, client_id, site_id, ...logsheetData });
    }
    
    await logsheet.save();

    // Optionally update application status if confirmed
    if (logsheet.confirmed) {
      await Application.findByIdAndUpdate(application_id, { status: 'AGREEMENT SENT' });
    }

    res.status(201).json({ data: logsheet, message: 'Logsheet saved successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/application-logsheets (Admin only)
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const logsheets = await ApplicationLogsheet.find({})
      .populate('application_id', 'application_number application_type status category')
      .populate('client_id', 'full_name company_name email')
      .populate('site_id', 'name address')
      .sort({ created_at: -1 });
    res.json({ data: logsheets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/application-logsheets/:id/status (Admin only)
router.put('/:id/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const logsheet = await ApplicationLogsheet.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    if (!logsheet) return res.status(404).json({ error: 'Logsheet not found' });
    res.json({ data: logsheet, message: 'Logsheet status updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/application-logsheets/:id/sign (Admin only)
router.put('/:id/sign', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { role, signature_url, signature_name, comment, sendWithoutSignature, finalizeSignOff } = req.body;
    const logsheet = await ApplicationLogsheet.findById(req.params.id);
    if (!logsheet) return res.status(404).json({ error: 'Logsheet not found' });

    if (finalizeSignOff) {
      logsheet.status = 'Signed';
      await logsheet.save();
      return res.json({ data: logsheet, message: 'Logsheet sign-off finalized successfully!' });
    }

    if (sendWithoutSignature) {
      if (comment) logsheet.comment = comment;
      await logsheet.save();
      return res.json({ data: logsheet, message: 'Logsheet sent to review without signature' });
    }

    if (!role) return res.status(400).json({ error: 'Role is required for signature' });

    const rolesArray = Array.isArray(role) ? role : [role];
    for (const r of rolesArray) {
      const roleLower = r.toLowerCase();
      if (roleLower === 'mufti') {
        logsheet.mufti_signature = signature_url;
        logsheet.mufti_sign_name = signature_name;
        logsheet.mufti_sign_date = new Date();
      } else if (roleLower === 'ceo') {
        logsheet.ceo_signature = signature_url;
        logsheet.ceo_sign_name = signature_name;
        logsheet.ceo_sign_date = new Date();
      } else if (roleLower === 'manager') {
        logsheet.manager_signature = signature_url;
        logsheet.manager_sign_name = signature_name;
        logsheet.manager_sign_date = new Date();
      } else if (roleLower === 'mufti2') {
        logsheet.mufti2_signature = signature_url;
        logsheet.mufti2_sign_name = signature_name;
        logsheet.mufti2_sign_date = new Date();
      } else {
        return res.status(400).json({ error: `Invalid role selected: ${r}` });
      }
    }

    if (comment) {
      logsheet.comment = comment;
    }

    // Keep state in "Waiting for Signature" to allow further role sign-offs one-by-one
    await logsheet.save();
    
    res.json({ data: logsheet, message: `Successfully signed as ${role}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/application-logsheets/:id (Admin only)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const logsheet = await ApplicationLogsheet.findByIdAndDelete(req.params.id);
    if (!logsheet) return res.status(404).json({ error: 'Logsheet not found' });
    res.json({ message: 'Logsheet deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
