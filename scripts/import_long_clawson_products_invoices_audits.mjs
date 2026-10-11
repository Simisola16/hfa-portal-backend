import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  const User = (await import('../models/User.js')).default;
  const Site = (await import('../models/Site.js')).default;
  const Product = (await import('../models/Product.js')).default;
  const Invoice = (await import('../models/Invoice.js')).default;
  const Audit = (await import('../models/Audit.js')).default;
  const Application = (await import('../models/Application.js')).default;

  const user = await User.findOne({ email: 'carl.robinson@clawson.co.uk' });
  if (!user) throw new Error('User not found!');

  const meltonSite = await Site.findOne({ client_id: user._id, name: /Melton/i });
  const bottesfordSite = await Site.findOne({ client_id: user._id, name: /Bottesford/i });

  // 1. Import Products from Prolister.json
  const prolisterPath = path.resolve(__dirname, '../sql-server-export/export/HaProlister/tables/dbo.Prolister.json');
  const proData = JSON.parse(fs.readFileSync(prolisterPath, 'utf8'));
  const proRows = (proData.rows || []).filter(r => r.AppComp == '401' || JSON.stringify(r).toLowerCase().includes('clawson'));

  console.log(`\n📦 Importing ${proRows.length} Products...`);
  let prodsCreated = 0;
  for (const p of proRows) {
    const isBottesford = String(p.SiteName || p.CiteID || '').toLowerCase().includes('bottesford') || p.CiteID == '20306';
    const site = isBottesford ? bottesfordSite : meltonSite;

    const prodDoc = {
      client_id: user._id,
      site_id: site._id,
      name: (p.ProName || '').trim(),
      code: (p.ProCoder || '').trim(),
      category: p.Status || 'Dairy (CI)',
      product_type: 'Dairy',
      status: 'active',
      source: 'admin',
      application_type: 'Direct',
      notes: `Imported from legacy HFA database (ProID: ${p.ProID})`,
      created_at: new Date('2020-05-05T12:00:00.000Z'),
      updated_at: new Date()
    };

    let existing = await Product.findOne({ client_id: user._id, name: prodDoc.name, site_id: site._id });
    if (!existing) {
      existing = await Product.create(prodDoc);
      console.log(` ✓ Created Product: ${prodDoc.name} [Code: ${prodDoc.code}] (${site.name})`);
    } else {
      Object.assign(existing, prodDoc);
      await existing.save();
      console.log(` ✓ Updated Product: ${prodDoc.name} [Code: ${prodDoc.code}] (${site.name})`);
    }
    prodsCreated++;
  }

  // 2. Import Invoices / Payment Requests
  const payReqPath = path.resolve(__dirname, '../sql-server-export/export/HalalAcc/tables/dbo.tlbPayReques.json');
  const payData = JSON.parse(fs.readFileSync(payReqPath, 'utf8'));
  const payRows = (payData.rows || []).filter(r => JSON.stringify(r).toLowerCase().includes('clawson') || r.CID == '401');

  console.log(`\n💳 Importing ${payRows.length} Invoices / Payment Requests...`);
  let invCreated = 0;
  for (const pr of payRows) {
    const invNum = pr.ClaimReNumber || `INV-${pr.Ider}`;
    const invDate = new Date(pr.Dteer ? pr.Dteer.trim() : '2022-05-09');
    const isPaid = (pr.RStatus || '').toLowerCase().includes('paid');

    const invDoc = {
      client_id: user._id,
      invoice_number: invNum,
      title: `Certification & Audit Invoice - ${pr.CompanyName || 'Long Clawson Dairy Ltd'}`,
      description: pr.Type || 'Annual Certification Audit Fee',
      invoice_type: 'initial',
      amount: 1500, // standard historical fee amount
      currency: 'GBP',
      status: isPaid ? 'paid' : 'unpaid',
      due_date: invDate,
      paid_at: isPaid ? invDate : undefined,
      payment_date: isPaid ? invDate : undefined,
      notes: `Imported from legacy HFA accounts (Ider: ${pr.Ider}, Staff: ${pr.StffName || ''}, Approver: ${pr.ApproBy || ''})`
    };

    let existingInv = await Invoice.findOne({ invoice_number: invNum });
    if (!existingInv) {
      existingInv = await Invoice.create(invDoc);
      console.log(` ✓ Created Invoice: ${invNum} [Status: ${invDoc.status}]`);
    } else {
      Object.assign(existingInv, invDoc);
      await existingInv.save();
      console.log(` ✓ Updated Invoice: ${invNum} [Status: ${invDoc.status}]`);
    }
    invCreated++;
  }

  // 3. Import Audits
  const auditListPath = path.resolve(__dirname, '../sql-server-export/export/HalalyMain/tables/dbo.tlbAudlister.json');
  const auditData = JSON.parse(fs.readFileSync(auditListPath, 'utf8'));
  const auditRows = (auditData.rows || []).filter(r => JSON.stringify(r).toLowerCase().includes('clawson') || r.CompID == '401');

  console.log(`\n🔍 Importing ${auditRows.length} Audits...`);
  let auditsCreated = 0;
  for (const ar of auditRows) {
    const auditDate = new Date(ar.AuditDate ? ar.AuditDate.trim() : '2021-04-20');
    const auditorName = ar.AuditorName || 'Ali Niazi';

    const auditDoc = {
      client_id: String(user._id),
      site_id: bottesfordSite._id,
      audit_type: ar.Statuss || 'Renewal',
      scheduled_date: auditDate,
      notes: `Imported audit from legacy HFA system (IDer: ${ar.IDer}, Auditor: ${auditorName})`,
      auditor: {
        name: auditorName,
        role: 'Lead Halal Auditor'
      },
      status: 'audit_completed',
      created_at: auditDate
    };

    const existingAudit = await Audit.findOne({ client_id: String(user._id), scheduled_date: auditDate });
    if (!existingAudit) {
      await Audit.create(auditDoc);
      console.log(` ✓ Created Audit: ${auditDate.toLocaleDateString()} (Auditor: ${auditorName})`);
    } else {
      Object.assign(existingAudit, auditDoc);
      await existingAudit.save();
      console.log(` ✓ Updated Audit: ${auditDate.toLocaleDateString()} (Auditor: ${auditorName})`);
    }
    auditsCreated++;
  }

  console.log('\n=============================================================================');
  console.log('🎉 ALL LONG CLAWSON DAIRY EXTRAS (PRODUCTS, INVOICES, AUDITS) IMPORTED!');
  console.log(`📦 Products: ${prodsCreated}`);
  console.log(`💳 Invoices: ${invCreated}`);
  console.log(`🔍 Audits:   ${auditsCreated}`);
  console.log('=============================================================================\n');

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
