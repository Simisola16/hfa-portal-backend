import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { uploadToS3 } from '../lib/s3.js';
import Invoice from '../models/Invoice.js';
import Application from '../models/Application.js';
import User from '../models/User.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { createNotification } from '../lib/notifications.js';
import { emitApplicationUpdate } from '../lib/socket.js';
import { Resend } from 'resend';
import { getSuperadminEmails, sendEmail, emailFrom } from '../lib/mailer.js';
import { generateHfaId } from '../lib/idGenerator.js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const resend = new Resend(process.env.RESEND_API_KEY);

async function generateInvoicePdf({ invoiceNumber, title, amount, notes, companyName, clientEmail }) {
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([595.28, 841.89]); // A4
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const { width, height } = page.getSize();

  // Header Banner
  page.drawRectangle({
    x: 0,
    y: height - 100,
    width: width,
    height: 100,
    color: rgb(0.08, 0.45, 0.3), // Dark emerald green
  });

  page.drawText('HALAL FOOD AUTHORITY (HFA)', {
    x: 40,
    y: height - 45,
    size: 18,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  page.drawText('INVOICE / PAYMENT REQUEST', {
    x: 40,
    y: height - 70,
    size: 13,
    font: fontRegular,
    color: rgb(0.85, 0.98, 0.9),
  });

  let currentY = height - 130;

  page.drawText(`Invoice Number: ${invoiceNumber || 'HFA-INV'}`, {
    x: 40,
    y: currentY,
    size: 14,
    font: fontBold,
    color: rgb(0.1, 0.15, 0.2),
  });
  currentY -= 20;

  if (companyName) {
    page.drawText(`Billed to: ${companyName}`, {
      x: 40,
      y: currentY,
      size: 11,
      font: fontRegular,
      color: rgb(0.3, 0.35, 0.4),
    });
    currentY -= 16;
  }

  if (clientEmail) {
    page.drawText(`Email: ${clientEmail}`, {
      x: 40,
      y: currentY,
      size: 10,
      font: fontRegular,
      color: rgb(0.4, 0.45, 0.5),
    });
    currentY -= 16;
  }

  page.drawText(`Issue Date: ${new Date().toLocaleDateString('en-GB')}`, {
    x: 40,
    y: currentY,
    size: 10,
    font: fontRegular,
    color: rgb(0.4, 0.45, 0.5),
  });
  currentY -= 22;

  page.drawLine({
    start: { x: 40, y: currentY },
    end: { x: width - 40, y: currentY },
    thickness: 1,
    color: rgb(0.85, 0.88, 0.92),
  });
  currentY -= 25;

  page.drawText(`Description: ${title || 'Halal Certification Fee'}`, {
    x: 40,
    y: currentY,
    size: 12,
    font: fontBold,
    color: rgb(0.1, 0.15, 0.2),
  });
  currentY -= 22;

  page.drawText(`Amount Due: £${Number(amount || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, {
    x: 40,
    y: currentY,
    size: 14,
    font: fontBold,
    color: rgb(0.08, 0.5, 0.25),
  });
  currentY -= 30;

  if (notes) {
    page.drawText('Payment Instructions / Notes:', {
      x: 40,
      y: currentY,
      size: 11,
      font: fontBold,
      color: rgb(0.1, 0.15, 0.2),
    });
    currentY -= 18;

    const lines = (notes || '').split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (currentY < 60) {
        page = pdfDoc.addPage([595.28, 841.89]);
        currentY = height - 60;
      }
      page.drawText(line || ' ', {
        x: 40,
        y: currentY,
        size: 10,
        font: fontRegular,
        color: rgb(0.3, 0.35, 0.4),
      });
      currentY -= 15;
    }
  }

  // Footer note
  page.drawText('Thank you for choosing Halal Food Authority (HFA). Please log in to your portal to submit payment confirmation.', {
    x: 40,
    y: 40,
    size: 8.5,
    font: fontRegular,
    color: rgb(0.5, 0.55, 0.6),
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

// GET /api/invoices — all (admin/staff) or client's own
router.get('/', authenticateToken, async (req, res) => {
  try {
    let query = {};
    const isStaffOrAdmin = [
      'admin', 'superadmin', 'scheme_manager', 'certificate_officer', 
      'accountant', 'audit_manager', 'food_tech_manager', 'food_tech', 'inspector', 'staff', 'support_manager'
    ].includes(req.user?.role) || (Array.isArray(req.user?.roles) && req.user.roles.some(r => [
      'admin', 'superadmin', 'scheme_manager', 'certificate_officer', 
      'accountant', 'audit_manager', 'food_tech_manager', 'food_tech', 'inspector', 'staff', 'support_manager'
    ].includes(r)));

    if (!isStaffOrAdmin && req.user?._id) {
      const userObjId = req.user._id;
      const userStr = req.user._id.toString();
      query.$or = [
        { client_id: userObjId },
        { client_id: userStr }
      ];
    }

    let invoices = await Invoice.find(query)
      .populate('application_id')
      .populate('profiles')
      .sort({ createdAt: -1 })
      .lean();

    // Ensure profiles is populated even if virtual population had mismatched types
    const unpopulatedInvoices = invoices.filter(inv => !inv.profiles && inv.client_id);
    if (unpopulatedInvoices.length > 0) {
      const validClientIds = [...new Set(
        unpopulatedInvoices
          .map(inv => inv.client_id)
          .filter(id => id && mongoose.isValidObjectId(id.toString()))
      )];
      if (validClientIds.length > 0) {
        const users = await User.find({ _id: { $in: validClientIds } })
          .select('_id full_name company_name email phone')
          .lean();
        const userMap = new Map(users.map(u => [u._id.toString(), u]));
        invoices = invoices.map(inv => {
          if (!inv.profiles && inv.client_id && userMap.has(inv.client_id.toString())) {
            return { ...inv, profiles: userMap.get(inv.client_id.toString()) };
          }
          return inv;
        });
      }
    }

    res.json({ data: invoices });
  } catch (err) {
    console.error('[Invoices GET /] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/invoices/application/:appId/all — fetch all invoices for a specific application
router.get('/application/:appId/all', authenticateToken, async (req, res) => {
  try {
    const { appId } = req.params;
    if (!appId || appId === 'undefined' || appId === 'null') {
      return res.json({ data: [] });
    }
    let targetAppId = appId;
    if (!mongoose.isValidObjectId(appId)) {
      const appDoc = await Application.findOne({ application_number: appId });
      if (appDoc) targetAppId = appDoc._id;
      else return res.json({ data: [] });
    }
    const data = await Invoice.find({ application_id: targetAppId }).sort({ updatedAt: -1, createdAt: -1 }).lean();
    res.json({ data });
  } catch (err) {
    console.error('[Invoices GET /application/:appId/all] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/invoices/application/:appId — fetch latest invoice for a specific application
router.get('/application/:appId', authenticateToken, async (req, res) => {
  try {
    const { appId } = req.params;
    if (!appId || appId === 'undefined' || appId === 'null') {
      return res.json({ data: null });
    }
    let targetAppId = appId;
    if (!mongoose.isValidObjectId(appId)) {
      const appDoc = await Application.findOne({ application_number: appId });
      if (appDoc) targetAppId = appDoc._id;
      else return res.json({ data: null });
    }
    const data = await Invoice.findOne({ application_id: targetAppId }).sort({ updatedAt: -1, createdAt: -1 }).lean();
    res.json({ data });
  } catch (err) {
    console.error('[Invoices GET /application/:appId] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/invoices — client or admin creates/uploads invoice (supports file upload & revision override)
router.post('/', authenticateToken, upload.single('invoice_file'), async (req, res) => {
  try {
    const invoiceData = { ...req.body };

    const isFinal = invoiceData.invoice_type === 'final' || invoiceData.stage === 'final' || invoiceData.target_status === 'final_invoice_sent';
    const invoiceType = isFinal ? 'final' : 'initial';
    invoiceData.invoice_type = invoiceType;

    let validAppId = null;
    let appDoc = null;
    if (invoiceData.application_id) {
      if (mongoose.isValidObjectId(invoiceData.application_id)) {
        appDoc = await Application.findById(invoiceData.application_id).lean();
        if (appDoc) validAppId = appDoc._id;
      }
      if (!appDoc) {
        appDoc = await Application.findOne({ application_number: invoiceData.application_id }).lean();
        if (appDoc) validAppId = appDoc._id;
      }
    }
    if (validAppId) {
      invoiceData.application_id = validAppId;
    }

    // Invoice PDF document is strictly required for ALL invoices (no auto-generation)
    if (!req.file && !invoiceData.invoice_url) {
      let existingInv = null;
      if (validAppId) {
        existingInv = await Invoice.findOne({
          application_id: validAppId,
          ...(isFinal
            ? { $or: [{ invoice_type: 'final' }, { stage: 'final' }, { target_status: 'final_invoice_sent' }] }
            : { $or: [{ invoice_type: 'initial' }, { stage: 'initial' }, { target_status: { $ne: 'final_invoice_sent' } }] })
        });
      }
      if (!existingInv || !existingInv.invoice_url) {
        return res.status(400).json({ error: 'Invoice document (PDF) is required. Please upload the invoice file.' });
      }
    }

    // Resolve client and company name
    let clientUser = null;
    let companyForId = appDoc?.establishment_name || 'HFA';
    if (invoiceData.client_id && mongoose.isValidObjectId(invoiceData.client_id.toString())) {
      clientUser = await User.findById(invoiceData.client_id).lean();
      if (clientUser) {
        companyForId = clientUser.company_name || clientUser.full_name || companyForId;
      }
    }

    // Parse amount
    const parsedAmount = (invoiceData.amount !== undefined && invoiceData.amount !== '' && !isNaN(parseFloat(invoiceData.amount)))
      ? parseFloat(invoiceData.amount)
      : 0;
    invoiceData.amount = parsedAmount;

    // Upload invoice PDF if attached
    if (req.file) {
      invoiceData.invoice_url = await uploadToS3(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        'invoices'
      );
    }

    let data;
    let isRevision = false;

    // Check if an existing invoice of this type already exists for this application
    if (validAppId) {
      const typeQuery = isFinal
        ? {
            application_id: validAppId,
            $or: [{ invoice_type: 'final' }, { stage: 'final' }, { target_status: 'final_invoice_sent' }]
          }
        : {
            application_id: validAppId,
            $or: [
              { invoice_type: 'initial' },
              { invoice_type: { $exists: false } },
              { invoice_type: null },
              { stage: 'initial' },
              { invoice_type: { $ne: 'final' } }
            ]
          };

      let existingInvoice = await Invoice.findOne(typeQuery).sort({ createdAt: -1 });

      if (existingInvoice) {
        isRevision = true;
        if (invoiceData.title) existingInvoice.title = invoiceData.title;
        existingInvoice.amount = parsedAmount;
        if (invoiceData.notes !== undefined) existingInvoice.notes = invoiceData.notes;
        if (invoiceData.invoice_url) {
          existingInvoice.invoice_url = invoiceData.invoice_url;
        } else if (!existingInvoice.invoice_url) {
          // Generate PDF on the fly if missing
          const pdfBuffer = await generateInvoicePdf({
            invoiceNumber: existingInvoice.invoice_number,
            title: existingInvoice.title || `${isFinal ? 'Final ' : ''}Invoice for ${appDoc?.application_number || 'Application'}`,
            amount: parsedAmount,
            notes: existingInvoice.notes,
            companyName: companyForId,
            clientEmail: clientUser?.email || ''
          });
          existingInvoice.invoice_url = await uploadToS3(
            pdfBuffer,
            `invoice_${existingInvoice.invoice_number}.pdf`,
            'application/pdf',
            'invoices'
          );
        }
        existingInvoice.invoice_type = invoiceType;
        existingInvoice.status = 'unpaid';
        existingInvoice.payment_proof_url = null;
        existingInvoice.paid_at = null;
        existingInvoice.version = (existingInvoice.version || 1) + 1;

        data = await existingInvoice.save();

        // Clean up any other duplicate invoices of this type for this application
        try {
          await Invoice.deleteMany({
            application_id: validAppId,
            _id: { $ne: existingInvoice._id },
            ...(isFinal ? { invoice_type: 'final' } : { invoice_type: { $ne: 'final' } })
          });
        } catch (delErr) {
          console.warn('Error cleaning duplicate invoices:', delErr.message);
        }
      }
    }

    if (!data) {
      if (!invoiceData.invoice_number) {
        let invNum = generateHfaId(companyForId, 'IN');
        let exists = await Invoice.findOne({ invoice_number: invNum }).lean();
        let attempts = 0;
        while (exists && attempts < 10) {
          invNum = generateHfaId(companyForId, 'IN');
          exists = await Invoice.findOne({ invoice_number: invNum }).lean();
          attempts++;
        }
        if (exists) {
          invNum = `HFA-INV-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
        }
        invoiceData.invoice_number = invNum;
      }

      if (!invoiceData.invoice_url) {
        // Auto-generate invoice PDF if not attached
        const pdfBuffer = await generateInvoicePdf({
          invoiceNumber: invoiceData.invoice_number,
          title: invoiceData.title || `${isFinal ? 'Final ' : ''}Invoice for ${appDoc?.application_number || 'Application'}`,
          amount: parsedAmount,
          notes: invoiceData.notes,
          companyName: companyForId,
          clientEmail: clientUser?.email || ''
        });
        invoiceData.invoice_url = await uploadToS3(
          pdfBuffer,
          `invoice_${invoiceData.invoice_number}.pdf`,
          'application/pdf',
          'invoices'
        );
      }

      invoiceData.status = 'unpaid';
      const invoice = new Invoice(invoiceData);
      data = await invoice.save();
    }

    // Update application status
    if (validAppId) {
      try {
        const targetStatus = isFinal ? 'final_invoice_sent' : 'invoice_sent';
        const changedById = (req.user?._id && mongoose.isValidObjectId(req.user._id.toString()))
          ? req.user._id
          : null;
        const histEntry = {
          status: targetStatus,
          changedAt: new Date(),
          changedBy: changedById,
          note: isRevision
            ? `Revised ${isFinal ? 'Final ' : 'Initial '}Invoice issued: ${data.invoice_number} (Amount: £${data.amount}, v${data.version || 1})`
            : `Invoice issued: ${data.invoice_number} (Amount: £${data.amount})`,
        };
        const updatedApp = await Application.findByIdAndUpdate(validAppId, {
          status: targetStatus,
          updated_at: new Date(),
          $push: { statusHistory: histEntry }
        }, { new: true });
        if (updatedApp) emitApplicationUpdate(updatedApp, targetStatus);
      } catch (appUpdateErr) {
        console.error('Error updating application status on invoice creation:', appUpdateErr.message);
      }
    }

    // Send Email Notification
    try {
      const recipientEmail = clientUser?.email;
      if (recipientEmail) {
        await sendEmail({
          to: recipientEmail,
          subject: isRevision
            ? `HFA Revised Invoice Issued: ${data.invoice_number}`
            : `HFA Invoice Issued: ${data.invoice_number}`,
          html: `<div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>${isRevision ? 'Revised Invoice Issued' : 'Invoice Issued'}</h2>
            <p>Dear ${clientUser?.full_name || 'Client'},</p>
            <p>${isRevision ? 'A revised invoice' : 'Invoice'} <strong>${data.invoice_number}</strong> for amount <strong>£${data.amount}</strong> has been issued for your application.</p>
            <p>Please log in to your HFA Portal account to view and process payment.</p>
          </div>`
        });
      }
    } catch (e) {
      console.error('Invoice Resend Email error:', e.message);
    }

    // Notify Client
    if (data.client_id) {
      try {
        await createNotification(
          data.client_id,
          isRevision ? 'Revised Invoice Issued 🧾' : 'Invoice Issued 🧾',
          `A ${isRevision ? 'revised ' : ''}invoice (${data.invoice_number}) has been issued for your application. Amount: £${data.amount}. Please review and confirm payment.`,
          'warning',
          '/invoices'
        );
      } catch (notifErr) {
        console.error('Invoice notification error:', notifErr.message);
      }
    }

    res.status(isRevision ? 200 : 201).json({ data });
  } catch (err) {
    console.error('[Invoices POST /] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/invoices/:id — admin update
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid invoice ID' });
    }
    const data = await Invoice.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!data) return res.status(404).json({ error: 'Invoice not found' });
    res.json({ data });
  } catch (err) {
    console.error('[Invoices PUT /:id] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/invoices/:id/pay — client confirms payment (optionally uploads proof)
router.put('/:id/pay', authenticateToken, upload.single('payment_proof'), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid invoice ID' });
    }
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    // Only the invoice owner or admin/staff can mark as paid
    const isStaffOrAdmin = [
      'admin', 'superadmin', 'scheme_manager', 'certificate_officer', 
      'accountant', 'audit_manager', 'food_tech_manager', 'food_tech', 'inspector', 'staff', 'support_manager'
    ].includes(req.user?.role) || (Array.isArray(req.user?.roles) && req.user.roles.some(r => [
      'admin', 'superadmin', 'scheme_manager', 'certificate_officer', 
      'accountant', 'audit_manager', 'food_tech_manager', 'food_tech', 'inspector', 'staff', 'support_manager'
    ].includes(r)));

    if (!isStaffOrAdmin && invoice.client_id?.toString() !== req.user._id?.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }

    invoice.status = 'client_paid';
    invoice.paid_at = new Date();

    // Upload payment proof if attached
    if (req.file) {
      invoice.payment_proof_url = await uploadToS3(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        'payment_proofs'
      );
    }

    const data = await invoice.save();

    // Ensure Application status is advanced to invoice_sent if it was on nc_closed / audit_report_submitted
    if (invoice.application_id && mongoose.isValidObjectId(invoice.application_id.toString())) {
      try {
        const app = await Application.findById(invoice.application_id);
        if (app && ['nc_closed', 'audit_report_submitted', 'audit_completed', 'audit_successful'].includes(app.status)) {
          const isFinal = invoice.invoice_type === 'final' || invoice.stage === 'final';
          const targetStatus = isFinal ? 'final_invoice_sent' : 'invoice_sent';
          app.status = targetStatus;
          app.updated_at = new Date();
          app.statusHistory.push({
            status: targetStatus,
            changedAt: new Date(),
            changedBy: req.user._id,
            note: `Client submitted payment for invoice ${invoice.invoice_number}.`
          });
          await app.save();
          emitApplicationUpdate(app, targetStatus);
        }
      } catch (appErr) {
        console.error('Error updating application on invoice pay:', appErr);
      }
    }

    // Notify admins
    try {
      const admins = await User.find({ role: { $in: ['admin', 'superadmin', 'staff', 'food_tech_manager', 'food_tech', 'accountant'] } });
      for (const admin of admins) {
        await createNotification(
          admin._id,
          'Payment Confirmed 💰',
          `Client has confirmed payment for invoice ${invoice.invoice_number}.`,
          'success',
          '/invoices'
        );
      }
    } catch (notifErr) {
      console.error('Admin payment notification error:', notifErr);
    }

    res.json({ data });
  } catch (err) {
    console.error('[Invoices PUT /:id/pay] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Helper to confirm invoice payment and synchronize application status and audit logs
const confirmInvoicePaymentHelper = async (invoice, adminUser) => {
  invoice.status = 'paid';
  invoice.payment_date = new Date();
  invoice.paid_at = invoice.paid_at || new Date();
  invoice.confirmed_by = adminUser?._id || null;
  invoice.confirmed_at = new Date();
  const savedInvoice = await invoice.save();

  let updatedApp = null;
  const targetAppId = invoice.application_id;
  const isFinal = invoice.invoice_type === 'final' || invoice.stage === 'final';

  if (targetAppId && mongoose.isValidObjectId(targetAppId.toString())) {
    const targetApp = await Application.findById(targetAppId);
    const isRenewal = (targetApp?.application_type || '').toLowerCase() === 'renewal' || (targetApp?.application_type || '').toLowerCase() === 'surveillance';
    const targetStatus = isFinal ? 'final_invoice_paid' : (isRenewal ? 'payment_received' : 'initial_product');

    const histEntry = {
      status: targetStatus,
      changedAt: new Date(),
      changedBy: adminUser?._id || null,
      note: isFinal
        ? `Payment confirmed by admin for final invoice ${invoice.invoice_number || ''}.`
        : (targetStatus === 'initial_product'
            ? `Initial Payment confirmed by admin. Application advanced to Initial Product Evaluation.`
            : `Payment confirmed by admin for invoice ${invoice.invoice_number || ''}.`),
    };

    const updateData = {
      status: targetStatus,
      updated_at: new Date(),
      $push: { statusHistory: histEntry }
    };

    if (isFinal) {
      updateData.final_payment_confirmed = true;
      updateData.final_invoice_paid = true;
    } else {
      updateData.initial_payment_confirmed = true;
      updateData.initial_invoice_paid = true;
    }

    updatedApp = await Application.findByIdAndUpdate(
      targetAppId,
      updateData,
      { new: true }
    );
    if (updatedApp) emitApplicationUpdate(updatedApp, targetStatus);

    try {
      const Audit = (await import('../models/Audit.js')).default;
      await Audit.updateMany(
        { application_id: targetAppId },
        { $set: { updated_at: new Date() } }
      );
    } catch (auditErr) {
      console.error('Error updating audit timestamp on payment confirmation:', auditErr);
    }
  }

  // Notify the client
  const clientId = invoice.client_id || updatedApp?.client_id;
  if (clientId) {
    try {
      await createNotification(
        clientId,
        'Payment Confirmed ✅',
        `Your payment for invoice ${invoice.invoice_number} has been confirmed by HFA. Your application will now proceed to the next stage.`,
        'success',
        '/applications'
      );
    } catch (notifErr) {
      console.error('Client payment notification error:', notifErr.message);
    }
  }

  // Email all Food Technology Managers & Superadmins — professional notification on initial payment confirmation
  try {
    const isFinalInvoice = invoice.invoice_type === 'final' || invoice.stage === 'final' || targetStatus === 'final_invoice_paid';
    if (!isFinalInvoice) {
      const staffRecipients = await User.find({
        $or: [
          { role: { $in: ['food_tech_manager', 'food_tech', 'superadmin', 'accountant'] } },
          { roles: { $in: ['food_tech_manager', 'food_tech', 'superadmin', 'accountant'] } }
        ],
        is_active: { $ne: false }
      }).lean();
      const appRef = updatedApp?.application_number || invoice.invoice_number || 'N/A';
      const clientName = updatedApp?.establishment_name || updatedApp?.site_name || 'Client';
      const appCategory = updatedApp?.category || 'Standard Halal Certification';
      const invoiceAmount = invoice.amount ? `£${Number(invoice.amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })}` : 'N/A';
      const invoiceType = 'Initial Certification Fee';

      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 0 auto; background: #f8fafc; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0;">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #15803d 0%, #166534 100%); padding: 28px 32px; text-align: center;">
            <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: 800; letter-spacing: -0.02em;">Halal Food Authority</h1>
            <p style="margin: 6px 0 0; color: #bbf7d0; font-size: 13px; font-weight: 500;">Internal Notification — Food Technology & Superadmin</p>
          </div>

          <!-- Body -->
          <div style="padding: 32px; background: #ffffff;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 24px;">
              <div style="width: 44px; height: 44px; background: #dcfce7; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 20px;">💰</div>
              <div>
                <h2 style="margin: 0; font-size: 18px; font-weight: 800; color: #14532d;">Initial Payment Confirmed</h2>
                <p style="margin: 2px 0 0; font-size: 13px; color: #64748b;">Action may be required — please review below</p>
              </div>
            </div>

            <p style="margin: 0 0 20px; font-size: 14px; color: #334155; line-height: 1.7;">
              An initial certification payment has been <strong>confirmed and verified</strong> by the HFA Finance team. The client is now ready to proceed with Initial Product submission and evaluation.
            </p>

            <!-- Details Table -->
            <table style="width: 100%; border-collapse: collapse; background: #f8fafc; border-radius: 8px; overflow: hidden; margin-bottom: 24px; border: 1px solid #e2e8f0;">
              <tr style="background: #f1f5f9;">
                <td style="padding: 10px 16px; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; width: 40%;">Application No.</td>
                <td style="padding: 10px 16px; font-size: 14px; font-weight: 700; color: #0f172a;">${appRef}</td>
              </tr>
              <tr>
                <td style="padding: 10px 16px; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">Client / Establishment</td>
                <td style="padding: 10px 16px; font-size: 14px; color: #1e293b;">${clientName}</td>
              </tr>
              <tr style="background: #f1f5f9;">
                <td style="padding: 10px 16px; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">Certification Category</td>
                <td style="padding: 10px 16px; font-size: 14px; color: #1e293b;">${appCategory}</td>
              </tr>
              <tr>
                <td style="padding: 10px 16px; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">Invoice</td>
                <td style="padding: 10px 16px; font-size: 14px; color: #1e293b;">${invoice.invoice_number || 'N/A'} — ${invoiceType}</td>
              </tr>
              <tr style="background: #f1f5f9;">
                <td style="padding: 10px 16px; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">Amount Paid</td>
                <td style="padding: 10px 16px; font-size: 14px; font-weight: 700; color: #15803d;">${invoiceAmount}</td>
              </tr>
              <tr>
                <td style="padding: 10px 16px; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">Confirmed At</td>
                <td style="padding: 10px 16px; font-size: 14px; color: #1e293b;">${new Date().toLocaleString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
              </tr>
            </table>

            <!-- Action Box -->
            <div style="background: #f0fdf4; border: 1.5px solid #bbf7d0; border-radius: 10px; padding: 18px 20px; margin-bottom: 24px;">
              <p style="margin: 0 0 8px; font-size: 13px; font-weight: 700; color: #15803d;">📋 Next Steps for Food Technology & Executive Team</p>
              <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #166534; line-height: 1.8;">
                <li>The client will now submit their <strong>Initial Product</strong> for evaluation.</li>
                <li>Once submitted, a separate notification will be sent for product assignment.</li>
                <li>Please monitor the HFA Admin Portal for new Initial Product submissions linked to this application.</li>
              </ul>
            </div>

            <div style="text-align: center;">
              <a href="${process.env.ADMIN_URL || 'https://admin.hfaportal.company'}/applications"
                 style="display: inline-block; background: linear-gradient(135deg, #15803d, #166534); color: white; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 14px; font-weight: 700; letter-spacing: 0.01em;">
                View in Admin Portal →
              </a>
            </div>
          </div>

          <!-- Footer -->
          <div style="padding: 18px 32px; background: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center;">
            <p style="margin: 0; font-size: 11px; color: #94a3b8;">This is an automated internal notification from the HFA Portal. Do not reply to this email.</p>
            <p style="margin: 4px 0 0; font-size: 11px; color: #94a3b8;">© ${new Date().getFullYear()} Halal Food Authority. All rights reserved.</p>
          </div>
        </div>
      `;

      for (const staff of staffRecipients) {
        if (staff.email) {
          try {
            await resend.emails.send({
              from: emailFrom,
              to: staff.email.trim(),
              subject: `[HFA] Initial Payment Confirmed — ${appRef} | ${clientName}`,
              html: emailHtml
            });
          } catch (sendErr) {
            console.warn(`Failed to email staff ${staff.email}:`, sendErr.message);
          }
        }
      }
    }
  } catch (ftEmailErr) {
    console.error('[Invoices] Failed to send payment confirmation email:', ftEmailErr.message);
  }

  return { invoice: savedInvoice, application: updatedApp };
};

// POST /api/invoices/confirm-payment — admin confirms payment for application
router.post('/confirm-payment', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { application_id, invoice_id } = req.body;
    let invoice = null;

    if (invoice_id && mongoose.isValidObjectId(invoice_id)) {
      invoice = await Invoice.findById(invoice_id);
    }
    if (!invoice && application_id) {
      let validAppId = application_id;
      if (!mongoose.isValidObjectId(application_id)) {
        const appDoc = await Application.findOne({ application_number: application_id });
        if (appDoc) validAppId = appDoc._id;
      }
      if (mongoose.isValidObjectId(validAppId)) {
        invoice = await Invoice.findOne({ application_id: validAppId }).sort({ createdAt: -1 });
      }
    }

    if (!invoice && !application_id) {
      return res.status(400).json({ error: 'invoice_id or application_id required' });
    }

    if (invoice) {
      const result = await confirmInvoicePaymentHelper(invoice, req.user);
      return res.json({ data: result.invoice, application: result.application });
    }

    // Fallback if invoice was not found but application_id was provided
    if (application_id && mongoose.isValidObjectId(application_id)) {
      const targetApp = await Application.findById(application_id);
      const isRenewal = (targetApp?.application_type || '').toLowerCase() === 'renewal' || (targetApp?.application_type || '').toLowerCase() === 'surveillance';
      const targetStatus = isRenewal ? 'payment_received' : 'initial_product';
      const histEntry = {
        status: targetStatus,
        changedAt: new Date(),
        changedBy: req.user._id,
        note: targetStatus === 'initial_product'
          ? `Payment confirmed by admin. Application advanced to Initial Product Evaluation.`
          : `Payment confirmed by admin.`,
      };
      const updatedApp = await Application.findByIdAndUpdate(
        application_id,
        {
          status: targetStatus,
          initial_payment_confirmed: true,
          initial_invoice_paid: true,
          updated_at: new Date(),
          $push: { statusHistory: histEntry }
        },
        { new: true }
      );
      if (updatedApp) emitApplicationUpdate(updatedApp, targetStatus);
      return res.json({ data: null, application: updatedApp });
    }

    return res.status(404).json({ error: 'Invoice or application not found' });
  } catch (err) {
    console.error('Error confirming payment:', err);
    res.status(500).json({ error: err.message });
  }
});

// Handler for single invoice confirmation
const handleConfirmInvoiceById = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid invoice ID' });
    }
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const result = await confirmInvoicePaymentHelper(invoice, req.user);
    res.json({ data: result.invoice, application: result.application });
  } catch (err) {
    console.error('Error confirming payment by ID:', err);
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/invoices/:id/confirm-payment — admin confirms client payment
router.put('/:id/confirm-payment', authenticateToken, requireAdmin, handleConfirmInvoiceById);

// PATCH /api/invoices/:id/confirm-payment — alias for confirm-payment
router.patch('/:id/confirm-payment', authenticateToken, requireAdmin, handleConfirmInvoiceById);

// PUT /api/invoices/:id/status — status change handler with support for 'paid'
router.put('/:id/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid invoice ID' });
    }
    const { status } = req.body;
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    if (status === 'paid') {
      const result = await confirmInvoicePaymentHelper(invoice, req.user);
      return res.json({ data: result.invoice, application: result.application });
    }

    invoice.status = status;
    if (req.body.payment_date) invoice.payment_date = new Date(req.body.payment_date);
    const saved = await invoice.save();
    res.json({ data: saved });
  } catch (err) {
    console.error('[Invoices PUT /:id/status] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
