import express from 'express';
import multer from 'multer';
import Certificate from '../models/Certificate.js';
import Application from '../models/Application.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import Site from '../models/Site.js';
import Invoice from '../models/Invoice.js';
import { uploadToGridFS } from '../lib/gridfs.js';
import { authenticateToken, requireAdmin, requireSuperAdmin, requireDirectCertificatePermission } from '../middleware/auth.js';
import { createNotification } from '../lib/notifications.js';
import { generateHfaId } from '../lib/idGenerator.js';
import { Resend } from 'resend';
import dotenv from 'dotenv';
import { generateCertificate } from '../services/certificateGenerator.js';

dotenv.config();

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);
const emailFrom = process.env.EMAIL_FROM || 'HFA Portal <info@halalfoodfoundation.org.uk>';
const upload = multer({ storage: multer.memoryStorage() });

// Middleware: ensure final invoice is sent and paid before certificate issuance
async function requireFinalInvoicePaidForCertificate(req, res, next) {
  try {
    const application_id = req.body.application_id || req.body.applicationId;
    if (!application_id) return next();

    const app = await Application.findById(application_id);
    if (!app) {
      return res.status(404).json({ error: 'Application not found.' });
    }

    // Renewal applications do not require a Final Invoice — only Initial Invoice payment and ready_for_certificate status!
    if (app.application_type === 'renewal') {
      if (!['ready_for_certificate', 'certificate_issued'].includes(app.status)) {
        return res.status(403).json({
          error: 'Application must be marked "Ready for Certificate" before issuing a certificate.',
          code: 'READY_FOR_CERTIFICATE_REQUIRED',
          application_status: app.status
        });
      }
      return next();
    }

    const finalInvoice = await Invoice.findOne({ application_id, invoice_type: 'final' });

    if (!finalInvoice) {
      return res.status(403).json({
        error: 'A Final Invoice must be sent and paid before a Certificate can be issued.',
        code: 'FINAL_INVOICE_REQUIRED'
      });
    }

    if (!['paid', 'client_paid'].includes(finalInvoice.status)) {
      return res.status(403).json({
        error: 'The Final Invoice must be paid before a Certificate can be issued.',
        code: 'FINAL_INVOICE_NOT_PAID',
        invoice_status: finalInvoice.status
      });
    }

    if (!['ready_for_certificate', 'certificate_issued'].includes(app.status)) {
      return res.status(403).json({
        error: 'Application must be marked "Ready for Certificate" before issuing a certificate.',
        code: 'READY_FOR_CERTIFICATE_REQUIRED',
        application_status: app.status
      });
    }

    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET all certificates (admin: all, client: own)
router.get('/', authenticateToken, async (req, res) => {
  try {
    let query = {};
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      query.client_id = req.user._id.toString();
    }
    const data = await Certificate.find(query)
      .populate('site_id')
      .populate('application_id', 'establishment_name site_name scope')
      .sort({ createdAt: -1 });

    // Auto-expire: mark any active certificate whose expiry_date is in the past and not renewed
    const now = new Date();
    const expiredIds = data
      .filter(c => c.status === 'active' && !c.is_renewed && c.expiry_date && new Date(c.expiry_date) < now)
      .map(c => c._id);

    if (expiredIds.length > 0) {
      await Certificate.updateMany(
        { _id: { $in: expiredIds } },
        { $set: { status: 'expired', updated_at: now } }
      );
      data.forEach(c => {
        if (expiredIds.some(id => id.equals(c._id))) {
          c.status = 'expired';
        }
      });
    }

    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET certificate by application ID
router.get('/application/:appId', authenticateToken, async (req, res) => {
  try {
    const data = await Certificate.findOne({ application_id: req.params.appId }).sort({ createdAt: -1 });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single certificate
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const data = await Certificate.findById(req.params.id);
    if (!data) return res.status(404).json({ error: 'Certificate not found' });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create & issue certificate (with optional PDF upload)
router.post('/', authenticateToken, requireAdmin, requireFinalInvoicePaidForCertificate, upload.single('certificate_file'), async (req, res) => {
  try {
    const { client_id, application_id, site_id, certificate_type, issue_date, expiry_date, products_covered, certificate_number } = req.body;
    let companyForId = 'HFA';
    if (client_id) {
      const cUser = await User.findById(client_id);
      companyForId = cUser?.company_name || cUser?.full_name || 'HFA';
    }
    const certNo = certificate_number || generateHfaId(companyForId);

    let certificate_url = null;
    if (req.file) {
      certificate_url = await uploadToGridFS(req.file.buffer, req.file.originalname, req.file.mimetype);
    }

    const parsedProducts = Array.isArray(products_covered) 
      ? products_covered 
      : (typeof products_covered === 'string' ? products_covered.split(',').map(p => p.trim()).filter(Boolean) : []);

    const certificate = new Certificate({
      certificate_number: certNo,
      client_id,
      application_id,
      site_id,
      certificate_type,
      issue_date,
      expiry_date,
      products_covered: parsedProducts,
      certificate_url,
      status: 'active'
    });

    const data = await certificate.save();

    // If this is a renewal application, mark the old certificate as renewed
    const app = await Application.findById(application_id);
    if (app && (app.application_type === 'renewal' || app.renewed_certificate_id)) {
      const oldCertId = app.renewed_certificate_id || (await Certificate.findOne({
        site_id: app.site_id,
        client_id,
        _id: { $ne: data._id },
        status: { $in: ['active', 'expired'] }
      }).sort({ expiry_date: -1 }))?._id;

      if (oldCertId) {
        await Certificate.findByIdAndUpdate(oldCertId, {
          status: 'renewed',
          is_renewed: true,
          renewed_by: data._id,
          updated_at: new Date()
        });
      }
    }

    // Mark previous active certificates for this site / application as outdated
    const prevQuery = [];
    if (site_id) prevQuery.push({ site_id });
    if (application_id) prevQuery.push({ application_id });
    if (client_id && prevQuery.length === 0) prevQuery.push({ client_id });

    if (prevQuery.length > 0) {
      await Certificate.updateMany(
        {
          _id: { $ne: data._id },
          client_id,
          $or: prevQuery,
          status: 'active'
        },
        {
          $set: {
            status: 'outdated',
            superseded_by: data._id,
            updated_at: new Date()
          }
        }
      );
    }

    // Update application status to certificate_issued with statusHistory entry
    await Application.findByIdAndUpdate(application_id, {
      status: 'certificate_issued',
      updated_at: new Date(),
      $push: {
        statusHistory: {
          status: 'certificate_issued',
          changedAt: new Date(),
          changedBy: req.user._id,
          note: `Certificate issued: ${certNo}`,
        }
      }
    });

    // Notify client
    await createNotification(
      client_id,
      '🏅 Certificate Issued',
      `Your Halal Certification certificate (${certNo}) has been issued. Please log in to download it.`,
      'success',
      '/certificates'
    );

    // Send email
    const client = await User.findById(client_id);
    if (client) {
      try {
        await resend.emails.send({
          from: emailFrom,
          to: client.email,
          subject: `🏅 Your Halal Certificate is Ready – ${certNo}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#f9fafb">
              <div style="background:linear-gradient(135deg,#15803d,#166534);border-radius:12px;padding:32px;text-align:center;margin-bottom:24px">
                <h1 style="color:white;margin:0">🏅 Certificate Issued</h1>
                <p style="color:#bbf7d0;margin:8px 0 0">Halal Food Authority</p>
              </div>
              <div style="background:white;border-radius:12px;padding:32px">
                <h2 style="color:#166534;margin:0 0 16px">Congratulations, ${client.full_name}!</h2>
                <p style="color:#374151">Your Halal Certificate has been issued for <strong>${client.company_name}</strong>.</p>
                <p style="color:#374151">Certificate Number: <strong>${certNo}</strong></p>
                <a href="${process.env.FRONTEND_CLIENT_URL || 'http://localhost:5173'}/certificates" style="display:inline-block;background:linear-gradient(135deg,#15803d,#166534);color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:24px">View My Certificate</a>
              </div>
            </div>
          `,
        });
      } catch (emailErr) {
        console.error('Resend Email Error:', emailErr);
      }
    }

    res.status(201).json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper function to build cert data from Application
async function buildCertDataFromApplication(application) {
  const User = (await import('../models/User.js')).default;
  const client = await User.findById(application.client_id);
  const companyForId = client ? (client.company_name || client.full_name) : application.establishment_name;
  const certNumber = generateHfaId(companyForId);
  
  const productCategories = (application.products || []).map(p => ({
    code: p.brand || 'GEN',
    name: p.name
  }));

  return {
    businessName: client ? (client.company_name || client.full_name) : application.establishment_name,
    businessAddress: application.establishment_address || '—',
    manufacturerAddress: application.manufacturer_address || 'Same as above',
    certificateNumber: certNumber,
    scopeOfCertification: application.scope || 'Halal Food Certification',
    productCategories,
    issueDate: new Date(),
    expiryDate: application.category === 'UAE/GSO Approved Halal Certification For Exporters To UAE'
      ? new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000)
      : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    verificationUrl: `${process.env.FRONTEND_CLIENT_URL || 'https://hfa-portal.vercel.app'}/verify/${certNumber}`
  };
}

// POST /api/certificates/generate
router.post('/generate', authenticateToken, requireAdmin, requireFinalInvoicePaidForCertificate, async (req, res) => {
  try {
    const { applicationId } = req.body;
    if (!applicationId) {
      return res.status(400).json({ error: 'applicationId is required' });
    }

    const application = await Application.findById(applicationId);
    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    // Check if an active certificate already exists for this application
    let existingCert = await Certificate.findOne({ application_id: applicationId, status: 'active' });
    if (existingCert) {
      return res.status(400).json({ 
        error: 'An active certificate already exists for this application. Use the regenerate endpoint to recreate it.',
        certificateNumber: existingCert.certificate_number,
        certificateUrl: existingCert.certificate_url
      });
    }

    const certData = await buildCertDataFromApplication(application);
    const pdfBuffer = await generateCertificate(certData);

    // Upload to GridFS
    const filename = `${certData.certificateNumber}.pdf`;
    const certificate_url = await uploadToGridFS(pdfBuffer, filename, 'application/pdf');

    // Save certificate record
    const certificate = new Certificate({
      certificate_number: certData.certificateNumber,
      client_id: application.client_id.toString(),
      application_id: application._id,
      site_id: application.site_id,
      certificate_type: application.application_type || 'Halal Certificate',
      issue_date: certData.issueDate,
      expiry_date: certData.expiryDate,
      products_covered: (certData.productCategories || []).map(p => typeof p === 'string' ? p : (p?.name || '')).filter(Boolean).length > 0
        ? (certData.productCategories || []).map(p => typeof p === 'string' ? p : (p?.name || '')).filter(Boolean)
        : ['Certified Halal Food Products'],
      certificate_url,
      status: 'active'
    });

    const data = await certificate.save();

    // Update application status to CERTIFICATE ISSUED (case matches the status list in frontend/routes)
    await Application.findByIdAndUpdate(applicationId, {
      status: 'certificate_issued',
      updated_at: new Date()
    });

    // Notify client
    await createNotification(
      application.client_id,
      '🏅 Certificate Issued',
      `Your Halal Certification certificate (${certData.certificateNumber}) has been issued. Please log in to download it.`,
      'success',
      '/certificates'
    );

    // Send email to client
    const client = await User.findById(application.client_id);
    if (client) {
      try {
        await resend.emails.send({
          from: emailFrom,
          to: client.email,
          subject: `🏅 Your Halal Certificate is Ready – ${certData.certificateNumber}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#f9fafb">
              <div style="background:linear-gradient(135deg,#15803d,#166534);border-radius:12px;padding:32px;text-align:center;margin-bottom:24px">
                <h1 style="color:white;margin:0">🏅 Certificate Issued</h1>
                <p style="color:#bbf7d0;margin:8px 0 0">Halal Food Authority</p>
              </div>
              <div style="background:white;border-radius:12px;padding:32px">
                <h2 style="color:#166534;margin:0 0 16px">Congratulations, ${client.full_name}!</h2>
                <p style="color:#374151">Your Halal Certificate has been issued for <strong>${client.company_name}</strong>.</p>
                <p style="color:#374151">Certificate Number: <strong>${certData.certificateNumber}</strong></p>
                <a href="${process.env.FRONTEND_CLIENT_URL || 'http://localhost:5173'}/certificates" style="display:inline-block;background:linear-gradient(135deg,#15803d,#166534);color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:24px">View My Certificate</a>
              </div>
            </div>
          `,
        });
      } catch (emailErr) {
        console.error('Resend Email Error:', emailErr);
      }
    }

    res.status(201).json({ 
      success: true, 
      certificateUrl: certificate_url, 
      certificateNumber: certData.certificateNumber,
      data 
    });
  } catch (err) {
    console.error('Certificate generation endpoint failed:', err);
    res.status(500).json({ error: 'Certificate generation failed: ' + err.message });
  }
});

// POST /api/certificates/:certificateId/regenerate
router.post('/:certificateId/regenerate', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const certificate = await Certificate.findById(req.params.certificateId);
    if (!certificate) {
      return res.status(404).json({ error: 'Certificate not found' });
    }

    const application = await Application.findById(certificate.application_id);
    if (!application) {
      return res.status(404).json({ error: 'Linked application not found' });
    }

    const client = await User.findById(application.client_id);
    const productCategories = (Array.isArray(certificate.products_covered) ? certificate.products_covered : [])
      .map((p, idx) => ({
        code: `GEN-${String(idx + 1).padStart(2, '0')}`,
        name: p
      }));

    const certData = {
      businessName: client ? (client.company_name || client.full_name) : application.establishment_name,
      businessAddress: application.establishment_address || '—',
      manufacturerAddress: application.manufacturer_address || 'Same as above',
      certificateNumber: certificate.certificate_number,
      scopeOfCertification: application.scope || 'Halal Food Certification',
      productCategories,
      issueDate: certificate.issue_date || new Date(),
      expiryDate: certificate.expiry_date || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      verificationUrl: `${process.env.FRONTEND_CLIENT_URL || 'https://hfa-portal.vercel.app'}/verify/${certificate.certificate_number}`
    };

    const pdfBuffer = await generateCertificate(certData);

    // Upload to GridFS
    const filename = `${certificate.certificate_number}.pdf`;
    const certificate_url = await uploadToGridFS(pdfBuffer, filename, 'application/pdf');

    // Update certificate URL
    certificate.certificate_url = certificate_url;
    certificate.updated_at = new Date();
    await certificate.save();

    res.json({ 
      success: true, 
      certificateUrl: certificate_url, 
      certificateNumber: certificate.certificate_number,
      data: certificate
    });
  } catch (err) {
    console.error('Certificate regeneration endpoint failed:', err);
    res.status(500).json({ error: 'Certificate regeneration failed: ' + err.message });
  }
});

// GET /api/certificates/:id/download
router.get('/:id/download', authenticateToken, async (req, res) => {
  try {
    const certificate = await Certificate.findById(req.params.id);
    if (!certificate) return res.status(404).json({ error: 'Certificate not found' });

    // Client can only download their own certificate
    if (!['admin', 'superadmin'].includes(req.user.role) && certificate.client_id !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!certificate.certificate_url) {
      return res.status(404).json({ error: 'Certificate file URL is not available' });
    }

    // Redirect to the internal GridFS file endpoint or direct link
    const host = process.env.API_URL || `${req.protocol}://${req.get('host')}`;
    if (certificate.certificate_url.startsWith('/api/files/')) {
      const fileId = certificate.certificate_url.replace('/api/files/', '');
      res.redirect(`${host}/api/files/${fileId}`);
    } else if (certificate.certificate_url.startsWith('/')) {
      res.redirect(`${host}${certificate.certificate_url}`);
    } else {
      res.redirect(certificate.certificate_url);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/certificates/direct-issue (Superadmin & Authorized Staff: direct certificate and product issuance without application)
router.post('/direct-issue', authenticateToken, requireDirectCertificatePermission, upload.single('certificate_file'), async (req, res) => {
  try {
    const {
      client_id,
      new_client_name,
      new_client_company,
      new_client_email,
      new_client_phone,
      new_client_address,
      new_client_postcode,
      new_client_country,
      
      site_id,
      site_name,
      site_address,
      manufacturer_address,
      
      certificate_number,
      certificate_type,
      scope_of_certification,
      issue_date,
      expiry_date,
      status,
      notes,
      
      products,
      
      auto_generate_pdf,
      send_email,
      send_notification
    } = req.body;

    let targetClientId = client_id;
    let targetClient = null;

    // 1. Resolve or create client
    if (!targetClientId && new_client_email) {
      let existingUser = await User.findOne({ email: new_client_email.toLowerCase().trim() });
      if (existingUser) {
        targetClientId = existingUser._id.toString();
        targetClient = existingUser;
      } else {
        const randomPassword = Math.random().toString(36).slice(-10) + '!A1';
        const newUser = new User({
          email: new_client_email.toLowerCase().trim(),
          password: randomPassword,
          full_name: new_client_name || new_client_company,
          company_name: new_client_company || new_client_name,
          phone: new_client_phone || '',
          address: new_client_address || '',
          postcode: new_client_postcode || '',
          country: new_client_country || 'United Kingdom',
          role: 'client',
          is_verified: true,
          is_active: true
        });
        targetClient = await newUser.save();
        targetClientId = targetClient._id.toString();
      }
    } else if (targetClientId) {
      targetClient = await User.findById(targetClientId);
      if (!targetClient) {
        return res.status(404).json({ error: 'Client account not found.' });
      }
    } else {
      return res.status(400).json({ error: 'Client ID or new client details are required.' });
    }

    // 2. Resolve or create Site if needed
    let targetSiteId = site_id || null;
    let businessAddress = site_address || targetClient.address || '—';
    let manufacturerAddr = manufacturer_address || businessAddress || 'Same as above';

    if (!targetSiteId && site_name && site_address) {
      const newSite = new Site({
        client_id: targetClientId,
        name: site_name,
        email: targetClient.email,
        address_1: site_address,
        postcode: new_client_postcode || targetClient.postcode || '—',
        state: 'N/A',
        country: new_client_country || targetClient.country || 'United Kingdom',
        contact_name: targetClient.full_name || targetClient.company_name,
        contact_phone_number: targetClient.phone || '0000000000'
      });
      const savedSite = await newSite.save();
      targetSiteId = savedSite._id;
    } else if (targetSiteId) {
      const existingSite = await Site.findById(targetSiteId);
      if (existingSite) {
        businessAddress = existingSite.address_1 || businessAddress;
      }
    }

    // 3. Resolve Certificate Number
    const companyForId = targetClient?.company_name || targetClient?.full_name || new_client_company || 'HFA';
    const certNumber = (certificate_number && certificate_number.trim())
      ? certificate_number.trim()
      : generateHfaId(companyForId);

    const existingCertWithNo = await Certificate.findOne({ certificate_number: certNumber });
    if (existingCertWithNo) {
      return res.status(400).json({ error: `Certificate number "${certNumber}" is already in use. Please choose a different number.` });
    }

    // 4. Parse Products
    let parsedProducts = [];
    if (typeof products === 'string') {
      try {
        parsedProducts = JSON.parse(products);
      } catch {
        parsedProducts = products.split(',').map(p => ({ name: p.trim() })).filter(p => p.name);
      }
    } else if (Array.isArray(products)) {
      parsedProducts = products;
    }

    const cleanProducts = parsedProducts.map((p, idx) => ({
      name: typeof p === 'string' ? p.trim() : (p.name || '').trim(),
      code: typeof p === 'object' ? (p.code || p.barcode || `GEN-${String(idx + 1).padStart(2, '0')}`) : `GEN-${String(idx + 1).padStart(2, '0')}`,
      category: typeof p === 'object' ? (p.category || 'General Food') : 'General Food',
      product_type: typeof p === 'object' ? (p.product_type || 'Processed') : 'Processed',
      barcode: typeof p === 'object' ? (p.barcode || '') : '',
      description: typeof p === 'object' ? (p.description || '') : '',
      ingredients: typeof p === 'object' ? (Array.isArray(p.ingredients) ? p.ingredients : (p.ingredients ? [p.ingredients] : [])) : []
    })).filter(p => p.name);

    const productsCoveredNames = cleanProducts.map(p => p.name);
    if (productsCoveredNames.length === 0) {
      productsCoveredNames.push('Certified Halal Food Products');
    }

    // 5. Handle Certificate File / Generation
    let certificate_url = null;
    if (req.file) {
      certificate_url = await uploadToGridFS(req.file.buffer, req.file.originalname, req.file.mimetype);
    } else if (auto_generate_pdf === 'true' || auto_generate_pdf === true || !req.file) {
      const certData = {
        businessName: targetClient.company_name || targetClient.full_name || 'Valued Client',
        businessAddress: businessAddress,
        manufacturerAddress: manufacturerAddr,
        certificateNumber: certNumber,
        scopeOfCertification: scope_of_certification || 'Halal Food Certification',
        productCategories: cleanProducts.length > 0
          ? cleanProducts.map(p => ({ code: p.code || 'GEN', name: p.name }))
          : [{ code: 'GEN', name: 'Certified Halal Food Products' }],
        issueDate: issue_date ? new Date(issue_date) : new Date(),
        expiryDate: expiry_date ? new Date(expiry_date) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        verificationUrl: `${process.env.FRONTEND_CLIENT_URL || 'https://hfa-portal.vercel.app'}/verify/${certNumber}`
      };

      try {
        const pdfBuffer = await generateCertificate(certData);
        const filename = `${certNumber}.pdf`;
        certificate_url = await uploadToGridFS(pdfBuffer, filename, 'application/pdf');
      } catch (pdfErr) {
        console.warn('Auto PDF generation warning:', pdfErr.message);
      }
    }

    // 6. Save Certificate
    const parsedIssueDate = issue_date ? new Date(issue_date) : new Date();
    const parsedExpiryDate = expiry_date ? new Date(expiry_date) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    const certificate = new Certificate({
      certificate_number: certNumber,
      client_id: targetClientId,
      site_id: targetSiteId || undefined,
      certificate_type: certificate_type || 'Annual Halal Certificate',
      issue_date: parsedIssueDate,
      expiry_date: parsedExpiryDate,
      products_covered: productsCoveredNames,
      certificate_url,
      status: status || 'active',
      is_direct_issuance: true,
      issued_by: req.user._id,
      notes: notes || 'Directly issued by Superadmin'
    });

    const savedCert = await certificate.save();

    // Mark previous active certificates for this site / client as outdated
    const prevSiteFilter = targetSiteId ? { site_id: targetSiteId } : { client_id: targetClientId };
    await Certificate.updateMany(
      {
        _id: { $ne: savedCert._id },
        client_id: targetClientId,
        ...prevSiteFilter,
        status: 'active'
      },
      {
        $set: {
          status: 'outdated',
          superseded_by: savedCert._id,
          updated_at: new Date()
        }
      }
    );

    // 7. Save Created Products to Product collection linked to certificate
    const createdProductDocs = [];
    for (const prod of cleanProducts) {
      const newProd = new Product({
        client_id: targetClientId,
        site_id: targetSiteId || undefined,
        certificate_id: savedCert._id.toString(),
        name: prod.name,
        code: prod.code || '',
        barcode: prod.barcode || '',
        category: prod.category || '',
        product_type: prod.product_type || '',
        description: prod.description || '',
        ingredients: prod.ingredients || [],
        status: 'active'
      });
      const savedProd = await newProd.save();
      createdProductDocs.push(savedProd);
    }

    // 8. Send In-App Notification and Email
    if (send_notification !== 'false' && send_notification !== false) {
      await createNotification(
        targetClientId,
        '🏅 Certificate & Products Issued',
        `Your Halal Certificate (${certNumber}) and ${createdProductDocs.length} certified product(s) have been issued directly by HFA.`,
        'success',
        '/certificates'
      );
    }

    if (send_email !== 'false' && send_email !== false && targetClient.email) {
      try {
        await resend.emails.send({
          from: emailFrom,
          to: targetClient.email,
          subject: `🏅 Official Halal Certificate Issued – ${certNumber}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#f9fafb">
              <div style="background:linear-gradient(135deg,#15803d,#166534);border-radius:12px;padding:32px;text-align:center;margin-bottom:24px">
                <h1 style="color:white;margin:0">🏅 Halal Certificate Issued</h1>
                <p style="color:#bbf7d0;margin:8px 0 0">Halal Food Authority</p>
              </div>
              <div style="background:white;border-radius:12px;padding:32px">
                <h2 style="color:#166534;margin:0 0 16px">Dear ${targetClient.full_name || targetClient.company_name},</h2>
                <p style="color:#374151">Your official Halal Certificate has been issued for <strong>${targetClient.company_name || targetClient.full_name}</strong>.</p>
                <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:20px 0">
                  <p style="margin:4px 0;color:#166534;font-size:14px"><strong>Certificate Number:</strong> ${certNumber}</p>
                  <p style="margin:4px 0;color:#166534;font-size:14px"><strong>Certificate Type:</strong> ${certificate_type || 'Annual Halal Certificate'}</p>
                  <p style="margin:4px 0;color:#166534;font-size:14px"><strong>Certified Products:</strong> ${createdProductDocs.length} product(s) registered</p>
                  <p style="margin:4px 0;color:#166534;font-size:14px"><strong>Expiry Date:</strong> ${parsedExpiryDate.toLocaleDateString('en-GB')}</p>
                </div>
                <a href="${process.env.FRONTEND_CLIENT_URL || 'http://localhost:5173'}/certificates" style="display:inline-block;background:linear-gradient(135deg,#15803d,#166534);color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:16px">View & Download Certificate</a>
              </div>
            </div>
          `,
        });
      } catch (emailErr) {
        console.error('[Resend] Direct issue certificate email failed:', emailErr.message);
      }
    }

    res.status(201).json({
      success: true,
      message: 'Certificate and products issued successfully!',
      certificate: savedCert,
      products: createdProductDocs,
      certificateUrl: certificate_url,
      certificateNumber: certNumber
    });
  } catch (err) {
    console.error('Direct issue certificate failed:', err);
    res.status(500).json({ error: 'Direct certificate issuance failed: ' + err.message });
  }
});

// GET /api/certificates/direct-history (Superadmin & Authorized Staff)
router.get('/direct-history', authenticateToken, requireDirectCertificatePermission, async (req, res) => {
  try {
    const certs = await Certificate.find({ is_direct_issuance: true })
      .populate('site_id')
      .populate('issued_by', 'full_name email username')
      .sort({ createdAt: -1 })
      .lean();

    const userIds = [...new Set(certs.map(c => c.client_id).filter(Boolean))];
    const users = await User.find({ _id: { $in: userIds } }, 'company_name full_name email phone address country').lean();
    const userMap = {};
    users.forEach(u => { userMap[u._id.toString()] = u; });

    const enriched = await Promise.all(certs.map(async (c) => {
      const client = userMap[c.client_id] || null;
      const products = await Product.find({ certificate_id: c._id.toString() }).lean();
      return {
        ...c,
        id: c._id.toString(),
        client,
        products
      };
    }));

    res.json({ data: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT revoke
router.put('/:id/revoke', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    const data = await Certificate.findByIdAndUpdate(req.params.id, { status: 'revoked', revocation_reason: reason }, { new: true });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
