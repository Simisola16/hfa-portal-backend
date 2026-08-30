import express from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { uploadToGridFS } from '../lib/gridfs.js';
import Application from '../models/Application.js';
import User from '../models/User.js';
import Certificate from '../models/Certificate.js';
import { generateCertificate } from '../services/certificateGenerator.js';
import { generateSurveillanceLetter, buildSurveillanceLetterHtml } from '../services/surveillanceLetterGenerator.js';
import { createNotification } from '../lib/notifications.js';
import { generateHfaId } from '../lib/idGenerator.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { Resend } from 'resend';
import dotenv from 'dotenv';
import { emitApplicationUpdate } from '../lib/socket.js';

dotenv.config();

const router = express.Router();
// Use memory storage — buffers are uploaded directly to Supabase
const upload = multer({ storage: multer.memoryStorage() });
const resend = new Resend(process.env.RESEND_API_KEY);
const emailFrom = process.env.EMAIL_FROM || 'HFA Portal <info@halalfoodfoundation.org.uk>';

// GET /api/applications
router.get('/', authenticateToken, async (req, res) => {
  try {
    let query = {};
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      query.client_id = req.user._id;
    }
    if (req.query.status) query.status = req.query.status;
    if (req.query.type) query.application_type = req.query.type;

    const data = await Application.find(query)
      .populate('profiles')
      .populate('inspectors')
      .sort({ created_at: -1 });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/applications/:id
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const isObjectId = mongoose.Types.ObjectId.isValid(req.params.id);
    const query = isObjectId ? { _id: req.params.id } : { application_number: req.params.id };
    const data = await Application.findOne(query)
      .populate('client_id', 'company_name full_name email phone address country postcode city')
      .populate('profiles')
      .populate('inspectors');
    if (!data) return res.status(404).json({ error: 'Application not found' });

    let finalData = data.toObject ? data.toObject() : data;

    // Attach site details if site_id is present
    if (finalData.site_id) {
      try {
        const Site = mongoose.model('Site');
        if (mongoose.Types.ObjectId.isValid(finalData.site_id)) {
          const s = await Site.findById(finalData.site_id).lean();
          if (s) finalData.site = s;
        }
      } catch (sErr) {}
    }

    // Auto-fix legacy uppercase statuses in DB (e.g. "PAYMENT RECEIVED" -> "payment_received")
    if (data.status && (data.status.includes(' ') || data.status !== data.status.toLowerCase())) {
      const normalized = data.status.toLowerCase().replace(/ /g, '_');
      data.status = normalized;
      finalData.status = normalized;
      await Application.findByIdAndUpdate(data._id, { status: normalized });
    }

    // Auto-sync status if logsheet exists and application status is lagging behind
    try {
      const ApplicationLogsheet = mongoose.model('ApplicationLogsheet');
      const logsheet = await ApplicationLogsheet.findOne({
        application_id: data._id,
        source_type: { $nin: ['initial_product_application', 'addon_application'] },
        initial_product_application_id: { $exists: false },
        addon_application_id: { $exists: false }
      }).sort({ created_at: -1 }).lean();

      if (logsheet) {
        let sigCount = 0;
        if (logsheet.mufti_signature) sigCount++;
        if (logsheet.ceo_signature) sigCount++;
        if (logsheet.manager_signature) sigCount++;
        if (logsheet.mufti2_signature) sigCount++;

        const isRenewal = data.application_type === 'renewal';
        const isLogsheetFinalized = logsheet.status === 'Waiting For Certificate' || logsheet.status === 'Signed' || logsheet.status === 'Completed' || sigCount >= 3;

        if (isLogsheetFinalized) {
          const targetStatus = isRenewal ? 'ready_for_certificate' : 'application_successful';
          if (['audit_successful', 'audit_completed', 'nc_flagged', 'nc_closed', 'logsheet_created'].includes(data.status)) {
            data.status = targetStatus;
            finalData.status = targetStatus;
            await Application.findByIdAndUpdate(data._id, {
              status: targetStatus,
              $addToSet: {
                statusHistory: {
                  status: targetStatus,
                  changedAt: new Date(),
                  note: isRenewal ? 'Renewal LogSheet completed.' : 'Application Successful — committee sign-off complete.'
                }
              }
            });
          }
        } else if (['audit_successful', 'audit_completed', 'nc_closed'].includes(data.status)) {
          data.status = 'logsheet_created';
          finalData.status = 'logsheet_created';
          await Application.findByIdAndUpdate(data._id, {
            status: 'logsheet_created',
            $addToSet: {
              statusHistory: {
                status: 'logsheet_created',
                changedAt: logsheet.created_at || new Date(),
                note: 'LogSheet created. Awaiting committee signatures.'
              }
            }
          });
        }
      } else {
        // If no main logsheet exists, ensure the application was not mistakenly pushed to application_successful or logsheet_created by initial product sign-off
        if (['application_successful', 'logsheet_created', 'logsheet_signed'].includes(data.status)) {
          const Audit = mongoose.model('Audit');
          const audit = await Audit.findOne({ application_id: data._id }).sort({ created_at: -1 });
          if (audit && (audit.status === 'audit_completed' || audit.status === 'audit_successful' || audit.completed_at)) {
            const properStatus = (data.statusHistory && data.statusHistory.some(h => h.status === 'nc_closed')) ? 'nc_closed' : 'audit_completed';
            data.status = properStatus;
            finalData.status = properStatus;
            // Clean up false application_successful and logsheet_created entries from statusHistory
            const cleanedHistory = (data.statusHistory || []).filter(h => !['application_successful', 'logsheet_created', 'logsheet_signed'].includes(h.status));
            finalData.statusHistory = cleanedHistory;
            await Application.findByIdAndUpdate(data._id, {
              status: properStatus,
              statusHistory: cleanedHistory
            });
          }
        }
      }
    } catch (lErr) {}

    res.json({ data: finalData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/applications
router.post('/', authenticateToken, upload.fields([
  { name: 'halal_policy', maxCount: 1 },
  { name: 'ingredient_list', maxCount: 1 },
  { name: 'floor_plan', maxCount: 1 },
  { name: 'haccp_plan', maxCount: 1 },
  { name: 'supporting_docs', maxCount: 5 },
]), async (req, res) => {
  try {
    // Gating Rules
    const { site_id, application_type } = req.body;
    if (site_id) {
      if (application_type === 'new') {
        const activeCert = await Certificate.findOne({
          site_id,
          status: 'active',
          expiry_date: { $gt: new Date() }
        });
        if (activeCert) {
          const expiryStr = new Date(activeCert.expiry_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
          return res.status(400).json({
            error: `This site already has an active certificate (valid until ${expiryStr}). You can submit a renewal application closer to the expiry date, or apply for a different site.`
          });
        }
      }

      const ongoingApp = await Application.findOne({
        site_id,
        client_id: req.user._id,
        status: { $nin: ['rejected', 'certificate_issued'] }
      });
      if (ongoingApp) {
        return res.status(400).json({
          error: `This site already has an application in progress (#${ongoingApp.application_number} - status: ${ongoingApp.status.replace(/_/g, ' ')}). You cannot submit another application for this site until the current one is completed.`
        });
      }
    }

    const documents = {};
    // Upload each document buffer to MongoDB GridFS
    if (req.files?.halal_policy?.[0]) {
      documents.halal_policy = await uploadToGridFS(
        req.files.halal_policy[0].buffer, req.files.halal_policy[0].originalname, req.files.halal_policy[0].mimetype
      );
    }
    if (req.files?.ingredient_list?.[0]) {
      documents.ingredient_list = await uploadToGridFS(
        req.files.ingredient_list[0].buffer, req.files.ingredient_list[0].originalname, req.files.ingredient_list[0].mimetype
      );
    }
    if (req.files?.floor_plan?.[0]) {
      documents.floor_plan = await uploadToGridFS(
        req.files.floor_plan[0].buffer, req.files.floor_plan[0].originalname, req.files.floor_plan[0].mimetype
      );
    }
    if (req.files?.haccp_plan?.[0]) {
      documents.haccp_plan = await uploadToGridFS(
        req.files.haccp_plan[0].buffer, req.files.haccp_plan[0].originalname, req.files.haccp_plan[0].mimetype
      );
    }

    let newSupportingDocs = [];
    if (req.files?.supporting_docs) {
      newSupportingDocs = await Promise.all(
        req.files.supporting_docs.map(f =>
          uploadToGridFS(f.buffer, f.originalname, f.mimetype)
        )
      );
    }
    documents.supporting_docs = newSupportingDocs;

    // If Renewal or Surveillance, inherit details and documents from the prior application for this site
    let priorApp = null;
    if (site_id && (application_type === 'renewal' || application_type === 'surveillance')) {
      priorApp = await Application.findOne({
        site_id: String(site_id),
        client_id: req.user._id
      }).sort({ created_at: -1 });

      if (priorApp) {
        // Inherit core document URLs if not explicitly provided in request
        if (!documents.halal_policy && priorApp.documents?.halal_policy) {
          documents.halal_policy = priorApp.documents.halal_policy;
        }
        if (!documents.ingredient_list && priorApp.documents?.ingredient_list) {
          documents.ingredient_list = priorApp.documents.ingredient_list;
        }
        if (!documents.floor_plan && priorApp.documents?.floor_plan) {
          documents.floor_plan = priorApp.documents.floor_plan;
        }
        if (!documents.haccp_plan && priorApp.documents?.haccp_plan) {
          documents.haccp_plan = priorApp.documents.haccp_plan;
        }
        // Merge supporting docs
        const pastSupporting = Array.isArray(priorApp.documents?.supporting_docs) ? priorApp.documents.supporting_docs : [];
        documents.supporting_docs = [...newSupportingDocs, ...pastSupporting];
      }
    }

    const companyForId = req.body.establishment_name || req.body.site_name || req.user.company_name || req.user.full_name || 'HFA';
    const appNumber = generateHfaId(companyForId);
    
    // Parse products if they come as a JSON string
    let products = [];
    if (req.body.products) {
      try {
        products = JSON.parse(req.body.products);
      } catch (e) {
        products = [];
      }
    } else if (priorApp && priorApp.products && priorApp.products.length > 0) {
      products = priorApp.products;
    }

    const applicationData = {
      ...req.body,
      application_number: appNumber,
      client_id: req.user._id,
      products,
      documents,
      status: 'submitted',
      statusHistory: [{
        status: 'submitted',
        changedAt: new Date(),
        changedBy: req.user._id,
        note: application_type === 'surveillance' 
          ? 'Surveillance application submitted by client.' 
          : (application_type === 'renewal' ? 'Renewal application submitted by client.' : 'Application submitted by client.'),
      }],
    };

    // If Renewal, pre-fill missing fields from prior application
    if (priorApp) {
      applicationData.category = req.body.category || priorApp.category;
      applicationData.scope = req.body.scope || priorApp.scope;
      applicationData.establishment_name = req.body.establishment_name || priorApp.establishment_name;
      applicationData.establishment_address = req.body.establishment_address || priorApp.establishment_address;
      applicationData.managing_director = req.body.managing_director || req.body.contact_person || priorApp.managing_director;
      applicationData.finance_contact = req.body.finance_contact || priorApp.finance_contact;
      applicationData.production_contact = req.body.production_contact || priorApp.production_contact;
      applicationData.qa_contact = req.body.qa_contact || priorApp.qa_contact;
      applicationData.halal_coordinator = req.body.halal_coordinator || priorApp.halal_coordinator;
      applicationData.employee_count = req.body.employee_count || priorApp.employee_count;
      applicationData.production_schedule = req.body.production_schedule || priorApp.production_schedule;
      applicationData.has_porcine = req.body.has_porcine !== undefined ? req.body.has_porcine : priorApp.has_porcine;
      applicationData.has_intoxicants = req.body.has_intoxicants !== undefined ? req.body.has_intoxicants : priorApp.has_intoxicants;
      applicationData.porcine_details = req.body.porcine_details || priorApp.porcine_details;
      applicationData.intoxicants_details = req.body.intoxicants_details || priorApp.intoxicants_details;
      if (!req.body.declared_true) applicationData.declared_true = true;
    }

    const application = new Application(applicationData);

    const data = await application.save();

    // Emit real-time application update
    emitApplicationUpdate(data, 'created');

    // Send confirmation email
    try {
      await resend.emails.send({
        from: emailFrom,
        to: req.user.email,
        subject: `Application Received – ${appNumber}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#f9fafb">
            <div style="background:linear-gradient(135deg,#15803d,#166534);border-radius:12px;padding:32px;text-align:center;margin-bottom:24px">
              <h1 style="color:white;margin:0">Halal Food Authority</h1>
            </div>
            <div style="background:white;border-radius:12px;padding:32px">
              <h2 style="color:#166534">Application Received</h2>
              <p>Dear ${req.user.full_name},</p>
              <p>Your application <strong>${appNumber}</strong> has been received and is being reviewed.</p>
              <a href="${process.env.FRONTEND_CLIENT_URL || 'http://localhost:5173'}/applications" style="display:inline-block;background:#15803d;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:24px">Track Application</a>
            </div>
          </div>
        `,
      });
    } catch (emailErr) {
      console.error('Resend Email Error:', emailErr);
    }

    // Notify Admin
    const admins = await User.find({ role: { $in: ['admin', 'superadmin', 'staff', 'food_tech_manager', 'food_tech'] } });
    for (const admin of admins) {
      await createNotification(
        admin._id,
        'New Application Received! 📄',
        `A new application (${appNumber}) has been submitted by ${req.user.company_name || req.user.full_name}.`,
        'info',
        `/applications?appId=${data._id}`
      );
    }

    res.status(201).json({ data, message: 'Application submitted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/applications/:id/approve (admin only)
router.put('/:id/approve', authenticateToken, async (req, res) => {
  try {
    const { note, category } = req.body;
    
    const app = await Application.findById(req.params.id);
    if (!app) return res.status(404).json({ error: 'Application not found' });

    let finalCategory = app.category;
    let originalCategory = app.original_category || app.category;
    let reclassified = false;

    if (category && category !== app.category) {
      finalCategory = category;
      originalCategory = app.category;
      reclassified = true;
    }

    const histNote = note || (reclassified ? `Application accepted and reclassified to: ${finalCategory}` : 'Application accepted by admin.');
    const histEntry = { status: 'approved', changedAt: new Date(), changedBy: req.user._id, note: histNote };
    
    const updateData = { 
      status: 'approved', 
      updated_at: new Date(), 
      $push: { statusHistory: histEntry } 
    };

    if (reclassified) {
      updateData.category = finalCategory;
      updateData.original_category = originalCategory;
    }

    const data = await Application.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).populate('profiles');
    
    // Notify client
    await createNotification(data.client_id, 'Application Accepted ✅', `Your application ${data.application_number} has been accepted.`, 'success', '/applications');
    
    // Emit socket event
    emitApplicationUpdate(data, 'approved');

    res.json({ data, message: 'Application accepted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/applications/:id/reject (admin only)
router.put('/:id/reject', authenticateToken, async (req, res) => {
  try {
    const { note } = req.body;
    if (!note?.trim()) return res.status(400).json({ error: 'A rejection reason is required.' });
    const histEntry = { status: 'rejected', changedAt: new Date(), changedBy: req.user._id, note: note.trim() };
    const data = await Application.findByIdAndUpdate(
      req.params.id,
      { status: 'rejected', updated_at: new Date(), $push: { statusHistory: histEntry } },
      { new: true }
    ).populate('profiles');
    if (!data) return res.status(404).json({ error: 'Application not found' });
    // Notify client
    await createNotification(data.client_id, 'Application Not Approved ❌', `Your application ${data.application_number} was not approved. Reason: ${note.trim()}`, 'error', '/applications');
    
    // Emit socket event
    emitApplicationUpdate(data, 'rejected');

    res.json({ data, message: 'Application rejected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/applications/:id/ready-for-certificate (admin only — mark ready for certificate)
router.put('/:id/ready-for-certificate', authenticateToken, async (req, res) => {
  try {
    const { note } = req.body;
    const app = await Application.findById(req.params.id);
    if (!app) return res.status(404).json({ error: 'Application not found' });

    const histNote = note || 'Application marked Ready for Certificate Issuance by admin.';
    const histEntry = { status: 'ready_for_certificate', changedAt: new Date(), changedBy: req.user._id, note: histNote };

    const data = await Application.findByIdAndUpdate(
      req.params.id,
      {
        status: 'ready_for_certificate',
        updated_at: new Date(),
        $push: { statusHistory: histEntry }
      },
      { new: true }
    ).populate('profiles');

    if (data) emitApplicationUpdate(data, 'ready_for_certificate');

    await createNotification(
      data.client_id,
      'Application Ready for Certificate 🎯',
      `Your application ${data.application_number} is ready for certificate issuance.`,
      'success',
      '/applications'
    );

    res.json({ data, message: 'Application marked ready for certificate.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/applications/:id/issue-surveillance-letter (admin only — issue surveillance letter to client)
router.post('/:id/issue-surveillance-letter', authenticateToken, requireAdmin, upload.single('letter_file'), async (req, res) => {
  try {
    const app = await Application.findById(req.params.id).populate('profiles');
    if (!app) return res.status(404).json({ error: 'Application not found' });

    let letterUrl = app.documents?.surveillance_letter || '';
    const {
      letter_number,
      issue_date,
      next_due_date,
      letter_mode = 'compose',
      recipient_name,
      recipient_address,
      recipient_attention,
      letter_subject,
      letter_salutation,
      letter_body,
      products_covered,
      standards,
      signatory_name,
      signatory_title,
      surveillance_cycle,
      notes
    } = req.body;

    if (req.file) {
      letterUrl = await uploadToGridFS(req.file.buffer, req.file.originalname, req.file.mimetype);
    } else {
      // Auto-generate official PDF letter with Puppeteer
      const clientProfile = app.profiles || {};
      const company = recipient_name || app.establishment_name || clientProfile.company_name || clientProfile.full_name || 'HFA Client';
      const address = recipient_address || app.establishment_address || clientProfile.address || '—';

      const pdfBuffer = await generateSurveillanceLetter({
        letter_number: letter_number || `HFA-SURV-${Date.now().toString().slice(-6)}`,
        issue_date: issue_date || new Date(),
        next_due_date: next_due_date || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        surveillance_cycle: surveillance_cycle || 'Annual Halal Surveillance Audit (UAE/GSO 3-Year Scheme)',
        recipient_name: company,
        recipient_address: address,
        recipient_attention: recipient_attention || 'Quality Assurance & Regulatory Compliance Team',
        letter_subject: letter_subject || 'CONFIRMATION OF CONTINUED HALAL CERTIFICATION COMPLIANCE — ANNUAL SURVEILLANCE',
        letter_salutation: letter_salutation || 'Dear Sir / Madam,',
        letter_body: letter_body || '',
        products_covered: products_covered || app.scope || (Array.isArray(app.products) ? app.products.map(p => p.name).join(', ') : 'Halal Certified Products'),
        standards: standards || 'UAE.S 2055-1:2015, GSO 2055-1:2015 & HFA Scheme Standards',
        signatory_name: signatory_name || 'HFA Halal Certification Committee',
        signatory_title: signatory_title || 'Lead Halal Auditor & Certification Director',
        verification_url: `${process.env.FRONTEND_CLIENT_URL || 'https://hfaportal.company'}/applications/${app._id}/track`
      });

      const fileName = `HFA-Surveillance-Letter-${letter_number || app.application_number || Date.now()}.pdf`;
      letterUrl = await uploadToGridFS(pdfBuffer, fileName, 'application/pdf');
    }

    const histNote = `Official Surveillance Letter issued (${letter_number || 'HFA-SURV'}). UAE/GSO 3-Year Halal Certification confirmed active.`;
    const histEntry = {
      status: 'certificate_issued',
      changedAt: new Date(),
      changedBy: req.user._id,
      note: histNote
    };

    const letterData = {
      letter_number: letter_number || `HFA-SURV-${Date.now().toString().slice(-6)}`,
      issue_date: issue_date || new Date(),
      next_due_date: next_due_date || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      letter_mode: req.file ? 'upload' : 'compose',
      recipient_name: recipient_name || app.establishment_name,
      recipient_address: recipient_address || app.establishment_address,
      recipient_attention,
      letter_subject,
      letter_salutation,
      letter_body,
      products_covered,
      standards,
      signatory_name,
      signatory_title,
      surveillance_cycle,
      pdf_url: letterUrl,
      issued_at: new Date()
    };

    const data = await Application.findByIdAndUpdate(
      req.params.id,
      {
        status: 'certificate_issued',
        certificate_url: letterUrl || app.certificate_url,
        'documents.surveillance_letter': letterUrl,
        surveillance_letter_data: letterData,
        updated_at: new Date(),
        $push: { statusHistory: histEntry }
      },
      { new: true, strict: false }
    ).populate('profiles');

    if (data) emitApplicationUpdate(data, 'certificate_issued');

    await createNotification(
      data.client_id,
      'Surveillance Letter Issued 📜',
      `Your annual UAE/GSO Halal Surveillance review is complete. Your official Surveillance Letter is now available in your portal.`,
      'success',
      `/applications/${data._id}/track`
    );

    res.json({ data, message: 'Surveillance Letter issued successfully.' });
  } catch (err) {
    console.error('Error issuing surveillance letter:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/applications/:id/preview-surveillance-letter (admin only — generate HTML preview)
router.post('/:id/preview-surveillance-letter', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const app = await Application.findById(req.params.id).populate('profiles');
    if (!app) return res.status(404).json({ error: 'Application not found' });

    const clientProfile = app.profiles || {};
    const company = req.body.recipient_name || app.establishment_name || clientProfile.company_name || clientProfile.full_name || 'HFA Client';
    const address = req.body.recipient_address || app.establishment_address || clientProfile.address || '—';

    const html = await buildSurveillanceLetterHtml({
      letter_number: req.body.letter_number || `HFA-SURV-${Date.now().toString().slice(-6)}`,
      issue_date: req.body.issue_date || new Date(),
      next_due_date: req.body.next_due_date || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      surveillance_cycle: req.body.surveillance_cycle || 'Annual Halal Surveillance Audit (UAE/GSO 3-Year Scheme)',
      recipient_name: company,
      recipient_address: address,
      recipient_attention: req.body.recipient_attention || 'Quality Assurance & Regulatory Compliance Team',
      letter_subject: req.body.letter_subject || 'CONFIRMATION OF CONTINUED HALAL CERTIFICATION COMPLIANCE — ANNUAL SURVEILLANCE',
      letter_salutation: req.body.letter_salutation || 'Dear Sir / Madam,',
      letter_body: req.body.letter_body || '',
      products_covered: req.body.products_covered || app.scope || (Array.isArray(app.products) ? app.products.map(p => p.name).join(', ') : 'Halal Certified Products'),
      standards: req.body.standards || 'UAE.S 2055-1:2015, GSO 2055-1:2015 & HFA Scheme Standards',
      signatory_name: req.body.signatory_name || 'HFA Halal Certification Committee',
      signatory_title: req.body.signatory_title || 'Lead Halal Auditor & Certification Director',
      verification_url: `${process.env.FRONTEND_CLIENT_URL || 'https://hfaportal.company'}/applications/${app._id}/track`
    });

    res.json({ html });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/applications/:id/status (admin only — generic, used by all phases)
router.put('/:id/status', authenticateToken, async (req, res) => {
  try {
    const { status, notes, note, inspector_id, audit_date } = req.body;
    const inspectorIdVal = inspector_id === "" ? null : inspector_id;

    const histEntry = {
      status,
      changedAt: new Date(),
      changedBy: req.user._id,
      note: note || notes || '',
    };

    const data = await Application.findByIdAndUpdate(
      req.params.id,
      {
        status,
        admin_notes: notes,
        inspector_id: inspectorIdVal,
        audit_date,
        updated_at: new Date(),
        $push: { statusHistory: histEntry },
      },
      { new: true, runValidators: false }
    );

    if (!data) return res.status(404).json({ error: 'Application not found' });
    
    const client = await User.findById(data.client_id);
    
    // Auto-generate certificate if application status is updated to 'approved'
    if (status === 'approved' && data) {
      try {
        const existingCert = await Certificate.findOne({ application_id: data._id, status: 'active' });
        if (!existingCert) {
          const companyForId = client ? (client.company_name || client.full_name) : data.establishment_name;
          const certNumber = generateHfaId(companyForId);
          
          const productCategories = (data.products || []).map(p => ({
            code: p.brand || 'GEN',
            name: p.name
          }));

          const certData = {
            businessName: client ? (client.company_name || client.full_name) : data.establishment_name,
            businessAddress: data.establishment_address || '—',
            manufacturerAddress: data.manufacturer_address || 'Same as above',
            certificateNumber: certNumber,
            scopeOfCertification: data.scope || 'Halal Food Certification',
            productCategories,
            issueDate: new Date(),
            expiryDate: data.category === 'UAE/GSO Approved Halal Certification For Exporters To UAE'
              ? new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000)
              : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
            verificationUrl: `${process.env.FRONTEND_CLIENT_URL || 'https://hfa-portal.vercel.app'}/verify/${certNumber}`
          };

          const pdfBuffer = await generateCertificate(certData);
          const filename = `${certNumber}.pdf`;
          const certificate_url = await uploadToGridFS(pdfBuffer, filename, 'application/pdf');

          const certificate = new Certificate({
            certificate_number: certNumber,
            client_id: data.client_id.toString(),
            application_id: data._id,
            site_id: data.site_id,
            certificate_type: data.application_type || 'Halal Certificate',
            issue_date: certData.issueDate,
            expiry_date: certData.expiryDate,
            products_covered: (certData.productCategories || []).map(p => typeof p === 'string' ? p : (p?.name || '')).filter(Boolean).length > 0
               ? (certData.productCategories || []).map(p => typeof p === 'string' ? p : (p?.name || '')).filter(Boolean)
               : ['Certified Halal Food Products'],
            certificate_url,
            status: 'active'
          });

          await certificate.save();

          // Change local data status to certificate_issued so the notification/email matches
          data.status = 'certificate_issued';
          await data.save();

          // Notify client about the certificate specifically
          await createNotification(
            data.client_id,
            '🏅 Certificate Issued',
            `Your Halal Certification certificate (${certNumber}) has been issued. Please log in to download it.`,
            'success',
            '/certificates'
          );
        }
      } catch (genErr) {
        console.error('Auto certificate generation failed on application approval:', genErr);
      }
    }

    if (client) {
      const statusLabels = {
        under_review: 'Under Review', approved: 'Approved', rejected: 'Rejected',
        on_hold: 'On Hold', audit_scheduled: 'Audit Scheduled', audit_completed: 'Audit Completed',
        certificate_issued: 'Certificate Issued',
      };

      try {
        await resend.emails.send({
          from: emailFrom,
          to: client.email,
          subject: `Application Update – ${data.application_number}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#f9fafb">
              <div style="background:white;border-radius:12px;padding:32px">
                <h2 style="color:#166534">Application Status Update</h2>
                <p>Dear ${client.full_name},</p>
                 <p>New Status: <strong style="color:#15803d">${statusLabels[data.status] || data.status}</strong></p>
                 <a href="${process.env.FRONTEND_CLIENT_URL}/applications/${req.params.id}" style="display:inline-block;background:#15803d;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:16px">View Application</a>
              </div>
            </div>
          `,
        });
      } catch (emailErr) {
        console.error('Email failed:', emailErr);
      }
    }

    // Notify Client via Dashboard Notification
    await createNotification(
      data.client_id,
      'Application Status Updated 📢',
      `Your application ${data.application_number} status has been changed to: ${data.status.replace(/_/g, ' ')}.`,
      'info',
      '/applications'
    );

    // Emit socket event
    emitApplicationUpdate(data, 'status_updated');

    res.json({ data, message: 'Status updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/applications/:id
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const result = await Application.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ error: 'Application not found' });
    res.json({ message: 'Application deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/applications/renew — client submits a renewal for an expired/expiring certificate
router.post('/renew', authenticateToken, upload.fields([
  { name: 'supporting_docs', maxCount: 10 },
]), async (req, res) => {
  try {
    const { certificate_id, contact_person, contact_email, contact_phone } = req.body;

    if (!certificate_id) return res.status(400).json({ error: 'certificate_id is required.' });
    if (!contact_person?.trim()) return res.status(400).json({ error: 'Contact person name is required.' });

    // Load the certificate
    const cert = await Certificate.findById(certificate_id);
    if (!cert) return res.status(404).json({ error: 'Certificate not found.' });

    // Only the certificate owner may renew
    if (cert.client_id?.toString() !== req.user._id?.toString()) {
      return res.status(403).json({ error: 'You can only renew your own certificates.' });
    }

    if (cert.is_renewed || cert.status === 'renewed') {
      return res.status(400).json({ error: 'This certificate has already been renewed.' });
    }

    // Gate: no ongoing renewal application for this site
    if (cert.site_id) {
      const ongoingQuery = {
        site_id: cert.site_id,
        client_id: req.user._id,
        application_type: 'renewal',
        status: { $nin: ['rejected', 'certificate_issued'] }
      };
      if (cert.application_id) {
        ongoingQuery._id = { $ne: cert.application_id };
      }
      const ongoingApp = await Application.findOne(ongoingQuery);
      if (ongoingApp) {
        return res.status(400).json({
          error: `This site already has a renewal application in progress (#${ongoingApp.application_number} – status: ${ongoingApp.status.replace(/_/g, ' ')}). Please wait for it to complete.`
        });
      }
    }

    // Pull original application data to pre-fill the renewal
    let originalApp = null;
    if (cert.application_id && mongoose.isValidObjectId(cert.application_id)) {
      originalApp = await Application.findById(cert.application_id);
    }
    if (!originalApp && cert.site_id) {
      originalApp = await Application.findOne({ site_id: cert.site_id, client_id: req.user._id }).sort({ created_at: -1 });
    }

    // Upload supporting documents
    const uploadedDocs = [];
    if (req.files?.supporting_docs) {
      for (const f of req.files.supporting_docs) {
        const url = await uploadToGridFS(f.buffer, f.originalname, f.mimetype);
        uploadedDocs.push(url);
      }
    }

    const pastSupporting = Array.isArray(originalApp?.documents?.supporting_docs) ? originalApp.documents.supporting_docs : [];
    const mergedDocs = {
      halal_policy: originalApp?.documents?.halal_policy || '',
      ingredient_list: originalApp?.documents?.ingredient_list || '',
      floor_plan: originalApp?.documents?.floor_plan || '',
      haccp_plan: originalApp?.documents?.haccp_plan || '',
      supporting_docs: [...uploadedDocs, ...pastSupporting]
    };

    const companyForId = originalApp?.establishment_name || req.user.company_name || req.user.full_name || 'HFA';
    const appNumber = generateHfaId(companyForId);
    const emailVal = (contact_email && contact_email.trim()) || originalApp?.primary_email || originalApp?.company_email || req.user.email || '';
    const phoneVal = (contact_phone && contact_phone.trim()) || originalApp?.primary_work_tel || originalApp?.primary_mobile || req.user.phone || '';

    const application = new Application({
      application_number: appNumber,
      client_id: req.user._id,
      application_type: 'renewal',
      renewed_certificate_id: cert._id,
      category: originalApp?.category || cert.certificate_type || 'Annual Certification – Food and General processing',
      site_id: cert.site_id,
      site_name: originalApp?.site_name || '',
      establishment_name: originalApp?.establishment_name || req.user.company_name || '',
      establishment_address: originalApp?.establishment_address || '',
      managing_director: contact_person.trim(),
      primary_contact_name: contact_person.trim(),
      primary_email: emailVal,
      company_email: emailVal,
      primary_work_tel: phoneVal,
      primary_mobile: phoneVal,
      finance_contact: originalApp?.finance_contact || '',
      qa_contact: originalApp?.qa_contact || '',
      halal_coordinator: originalApp?.halal_coordinator || '',
      production_contact: originalApp?.production_contact || '',
      production_schedule: originalApp?.production_schedule || '',
      employee_count: originalApp?.employee_count || 0,
      has_porcine: originalApp?.has_porcine || false,
      has_intoxicants: originalApp?.has_intoxicants || false,
      porcine_details: originalApp?.porcine_details || '',
      intoxicants_details: originalApp?.intoxicants_details || '',
      scope: originalApp?.scope || cert.certificate_type || 'Halal Food Certification',
      products: originalApp?.products || cert.products_covered?.map(p => ({ name: p, brand: '', category: '' })) || [],
      documents: mergedDocs,
      declared_true: true,
      notes: `Renewal of certificate ${cert.certificate_number}${cert.expiry_date ? ` (expired/expiring: ${new Date(cert.expiry_date).toLocaleDateString('en-GB')})` : ''}.`,
      status: 'submitted',
      statusHistory: [{
        status: 'submitted',
        changedAt: new Date(),
        changedBy: req.user._id,
        note: `Renewal application submitted for certificate ${cert.certificate_number}.`,
      }],
    });

    const data = await application.save();
    emitApplicationUpdate(data, 'created');

    // Confirmation email to client
    try {
      await resend.emails.send({
        from: emailFrom,
        to: req.user.email,
        subject: `Renewal Application Received – ${appNumber}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#f9fafb">
            <div style="background:linear-gradient(135deg,#15803d,#166534);border-radius:12px;padding:32px;text-align:center;margin-bottom:24px">
              <h1 style="color:white;margin:0">🔄 Renewal Submitted</h1>
              <p style="color:#bbf7d0;margin:8px 0 0">Halal Food Authority</p>
            </div>
            <div style="background:white;border-radius:12px;padding:32px">
              <h2 style="color:#166534;margin:0 0 16px">Renewal Application Received</h2>
              <p style="color:#374151">Dear ${req.user.full_name},</p>
              <p style="color:#374151">Your renewal application <strong>${appNumber}</strong> for certificate <strong>${cert.certificate_number}</strong> has been received and is under review.</p>
              <a href="${process.env.FRONTEND_CLIENT_URL || 'http://localhost:5173'}/applications" style="display:inline-block;background:#15803d;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:24px">Track Application</a>
            </div>
          </div>
        `,
      });
    } catch (emailErr) {
      console.error('Renewal email error:', emailErr);
    }

    // Notify admins
    const admins = await User.find({ role: { $in: ['admin', 'superadmin'] } });
    for (const admin of admins) {
      await createNotification(
        admin._id,
        '🔄 Renewal Application Received',
        `A renewal application (${appNumber}) has been submitted by ${req.user.company_name || req.user.full_name} for certificate ${cert.certificate_number}.`,
        'info',
        `/applications?appId=${data._id}`
      );
    }

    res.status(201).json({ data, message: 'Renewal application submitted successfully.' });
  } catch (err) {
    console.error('Renewal application error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

