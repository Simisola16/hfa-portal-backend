import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dns from 'dns';

// Fix Node.js SRV resolution issue on Windows networks
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

import User from '../models/User.js';
import Site from '../models/Site.js';
import Certificate from '../models/Certificate.js';
import Product from '../models/Product.js';
import Application from '../models/Application.js';
import ExportCertificate from '../models/ExportCertificate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const exportBaseDir = path.resolve(__dirname, '../sql-server-export/export');

function readJsonTable(relPath) {
  const fullPath = path.join(exportBaseDir, relPath);
  if (!fs.existsSync(fullPath)) {
    console.warn(`File not found: ${fullPath}`);
    return [];
  }
  try {
    const raw = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    return raw.rows || (Array.isArray(raw) ? raw : []);
  } catch (err) {
    console.error(`Error reading ${relPath}:`, err.message);
    return [];
  }
}

async function migrateAnikeData() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB:', mongoose.connection.name);

    const email = 'anike@halalfoodauthority.com';
    const companyName = 'Anike International';

    // 1. Create or Update Client User
    console.log(`\n1️⃣ Processing User (${email})...`);
    let user = await User.findOne({ email });

    const userProfileData = {
      email,
      full_name: 'anike lekan',
      company_name: companyName,
      phone: '+44 7440 000000',
      address: '28 Woods Road, Peckham',
      city: 'London',
      postcode: 'SE15 2SW',
      country: 'United Kingdom',
      role: 'client',
      client_role: 'owner',
      roles: ['client'],
      is_active: true,
      is_verified: true,
    };

    if (!user) {
      user = new User({
        ...userProfileData,
        password: 'abc123', // Automatically hashed by User pre-save hook
      });
      await user.save();
      console.log(`   ✅ Created client user: ${user.email} (ID: ${user._id})`);
    } else {
      Object.assign(user, userProfileData);
      await user.save();
      console.log(`   ℹ️ User ${user.email} updated (ID: ${user._id})`);
    }

    const userIdStr = user._id.toString();

    // 2. Sites
    console.log(`\n2️⃣ Processing Sites...`);
    const siteDefs = [
      {
        name: 'Alamu',
        client_code: '10068',
        address_1: '3 Watcombe Road',
        address_2: '28 Woods Road',
        city: 'London',
        postcode: 'SE15 2SW',
        country: 'United Kingdom',
        est_name: companyName,
        trading_name: 'Anike foods tester 2',
        reg_number: '232',
        vat_number: '2342',
        status: 'active',
      },
      {
        name: 'grandma Hifza',
        client_code: '181073',
        address_1: '28 Woods Road',
        city: 'London',
        postcode: 'SE15 2SW',
        country: 'United Kingdom',
        est_name: companyName,
        status: 'active',
      },
      {
        name: 'gjuguih',
        client_code: '10043',
        address_1: '28 Woods Road',
        city: 'London',
        postcode: 'SE15 2SW',
        country: 'United Kingdom',
        est_name: companyName,
        status: 'active',
      }
    ];

    const siteMap = {};
    for (const sDef of siteDefs) {
      let site = await Site.findOne({ client_id: userIdStr, name: sDef.name });
      if (!site) {
        site = new Site({
          client_id: userIdStr,
          ...sDef,
        });
        await site.save();
        console.log(`   ✅ Created Site: ${site.name} (Code: ${site.client_code})`);
      } else {
        Object.assign(site, sDef);
        await site.save();
        console.log(`   ℹ️ Updated Site: ${site.name}`);
      }
      siteMap[sDef.name] = site;
    }

    // 3. Applications
    console.log(`\n3️⃣ Processing Applications (from dbo.AppleReg)...`);
    const appleRegRows = readJsonTable('HalalApp/tables/dbo.AppleReg.json');
    const anikeApps = appleRegRows.filter(r => 
      JSON.stringify(r).toLowerCase().includes('anike international')
    );

    let appCount = 0;
    const appMap = {};
    for (const row of anikeApps) {
      const appNum = (row.AppNumber || '').trim();
      if (!appNum) continue;

      let status = 'submitted';
      const rawStatus = (row.ApplStatus || '').trim().toLowerCase();
      if (rawStatus === 'successful') status = 'certificate_issued';
      else if (rawStatus === 'in-progress') status = 'under_review';
      else if (rawStatus === 'submitted') status = 'submitted';

      const matchedSiteName = (row.SiteName || '').trim() || (row.CiteID === '10068' ? 'Alamu' : '');
      const matchedSite = siteMap[matchedSiteName] || siteMap['Alamu'];

      const appData = {
        application_number: appNum,
        client_id: user._id,
        application_type: row.ApplicationTyp ? row.ApplicationTyp.trim() : 'New Application',
        category: row.AppCategory ? row.AppCategory.trim() : 'Annual Certification',
        establishment_name: companyName,
        establishment_address: row.CoHOfficeAddress ? row.CoHOfficeAddress.trim() : '28 Woods Road, Peckham',
        site_name: matchedSiteName || 'Alamu',
        site_id: matchedSite ? matchedSite._id.toString() : null,
        reg_number: row.CRNumber ? row.CRNumber.trim() : '232',
        vat_number: row.VATNumber ? row.VATNumber.trim() : '2342',
        managing_director: row.PCPrimaryContactN ? row.PCPrimaryContactN.trim() : 'anike lekan',
        employee_count: parseInt(row.NumberEmployees) || 4,
        products: (appNum === 'M2-0429/1900000181009' || appNum === 'M2-0429/190000076') ? [
          { name: 'biscui', brand: 'Anike Foods', category: 'K' },
          { name: 'RICE', brand: 'Anike Foods', category: 'K' }
        ] : [],
        status,
        notes: 'Migrated from legacy SQL Server database',
      };

      const savedApp = await Application.findOneAndUpdate(
        { application_number: appNum },
        { $set: appData },
        { upsert: true, new: true }
      );
      appMap[appNum] = savedApp;
      appCount++;
      console.log(`   ✅ Saved Application: ${appNum} (${status})`);
    }

    // 4. Certificates
    console.log(`\n4️⃣ Processing Halal Certificates (from dbo.tlbcertMas)...`);
    const certRows = readJsonTable('HalalCert/tables/dbo.tlbcertMas.json');
    const anikeCerts = certRows.filter(r => 
      (r.COMPANYNAME && r.COMPANYNAME.toLowerCase().includes('anike international')) ||
      r.CertificateNo === 'AN-BU/QR251217134523'
    );

    for (const c of anikeCerts) {
      const certNo = (c.CertificateNo || '').trim();
      if (!certNo) continue;

      const issueDate = c.IssueDate ? new Date(c.IssueDate) : new Date('2025-12-17');
      // Set 1-year cycle until Dec 2026 so active status is maintained in current 2026 setup
      const expiryDate = new Date('2026-12-27');
      const currentStart = c.CurrentCyStartDate ? new Date(c.CurrentCyStartDate) : new Date('2025-12-24');
      const linkedApp = appMap['M2-0429/1900000181009'] || appMap['M2-0429/190000076'];

      const certData = {
        certificate_number: certNo,
        client_id: userIdStr,
        application_id: linkedApp ? linkedApp._id : null,
        company_name: companyName,
        company_address: c.COMPANYADDRESS ? c.COMPANYADDRESS.trim() : '28 Woods Road, Peckham',
        manufacturing_address: c.MANUFATURINGFACILITY ? c.MANUFATURINGFACILITY.trim() : '3 Watcombe Road',
        scope: c.PRODUCTCATEGORY ? c.PRODUCTCATEGORY.trim() : 'Food and General processing',
        certificate_type: c.GFP ? c.GFP.trim() : 'GSO non-meat',
        issue_date: isNaN(issueDate.getTime()) ? new Date('2025-12-17') : issueDate,
        expiry_date: expiryDate,
        current_cycle_start_date: isNaN(currentStart.getTime()) ? new Date('2025-12-24') : currentStart,
        status: 'active',
        products_covered: ['biscui', 'RICE'],
        product_details: [
          { name: 'biscui', code: '8987899', category: 'K' },
          { name: 'RICE', code: '898754545', category: 'K' }
        ],
        site_id: siteMap['Alamu'] ? siteMap['Alamu']._id : null,
        notes: `Migrated from legacy SQL Server. Approved by ${c.AprovBuy || 'Builder'} on ${c.AproDate || '17-Dec-2025'}. Contact: ${c.ContactPerson || 'Taoheed Ogundapo'}`
      };

      await Certificate.findOneAndUpdate(
        { certificate_number: certNo },
        { $set: certData },
        { upsert: true, new: true }
      );
      console.log(`   ✅ Saved Certificate: ${certNo} (${certData.certificate_type}) - Active until ${expiryDate.toLocaleDateString()}`);
    }

    // 5. Products
    console.log(`\n5️⃣ Processing Products (from dbo.tldbprotem)...`);
    const productRows = readJsonTable('HalalTick/tables/dbo.tldbprotem.json');
    const anikeProducts = productRows.filter(r => 
      r.company && r.company.toLowerCase().includes('anike international')
    );

    for (const p of anikeProducts) {
      const prodName = (p.ProductNamerr || '').trim();
      const prodCode = (p.ProductCoder || '').trim();
      if (!prodName) continue;

      const prodData = {
        client_id: user._id,
        name: prodName,
        code: prodCode,
        category: p.Category ? p.Category.trim() : 'K',
        certificate_id: 'AN-BU/QR251217134523',
        site_id: siteMap['grandma Hifza'] ? siteMap['grandma Hifza']._id : null,
        status: 'active',
        notes: `Imported from legacy product template (ID: ${p.ider}, Cert Ref: ${p.certId || ''})`,
      };

      await Product.findOneAndUpdate(
        { client_id: user._id, name: prodName, code: prodCode },
        { $set: prodData },
        { upsert: true, new: true }
      );
      console.log(`   ✅ Saved Product: ${prodName} (Code: ${prodCode})`);
    }

    // 6. Export Certificates (from dbo.tlbhecmaster)
    console.log(`\n6️⃣ Processing Export Certificates (from dbo.tlbhecmaster)...`);
    const hecRows = readJsonTable('tlbExport/tables/dbo.tlbhecmaster.json');
    const anikeExports = hecRows.filter(r => r.CID === '133');

    let expCount = 0;
    for (const exp of anikeExports) {
      const refNo = exp.MasterID ? `EXP-${exp.MasterID}` : `EXP-${exp.Ider}`;
      const isDone = (exp.Statuss || '').trim().toLowerCase() === 'done';

      const exportData = {
        client_id: userIdStr,
        reference_number: refNo,
        destination_country: exp.PortofEntry ? exp.PortofEntry.trim() : 'United Arab Emirates',
        shipment_date: exp.Dateee ? new Date(exp.Dateee) : new Date(),
        consignee_name: exp.ConsigneeNameAddress ? exp.ConsigneeNameAddress.trim() : 'N/A',
        consignee_address: exp.DistributorsNameAddress ? exp.DistributorsNameAddress.trim() : 'N/A',
        products: exp.OrderNo ? `Order #${exp.OrderNo} - Consignor: ${exp.ConsignorExportersName || ''}` : (exp.CertyficateType || 'Halal Export'),
        consignment_details: `Facility: ${exp.ManufacturingFacilityNameAddress || 'N/A'}, Flight/Freight: ${exp.FlightFreightDetails || 'N/A'}`,
        status: isDone ? 'approved' : 'pending',
        notes: `Imported from legacy tlbhecmaster. Ider: ${exp.Ider}, MasterID: ${exp.MasterID}, Status: ${exp.Statuss}`,
      };

      await ExportCertificate.findOneAndUpdate(
        { client_id: userIdStr, reference_number: refNo },
        { $set: exportData },
        { upsert: true, new: true }
      );
      expCount++;
      console.log(`   ✅ Saved Export Certificate: ${refNo} (${exportData.status})`);
    }

    console.log('\n=============================================');
    console.log('🎉 ANIKE INTERNATIONAL MIGRATION COMPLETE!');
    console.log('=============================================');
    console.log(`👤 Client Email       : ${user.email}`);
    console.log(`🔑 Temporary Password : Password123!`);
    console.log(`🏢 Company Name       : ${companyName}`);
    console.log(`📍 Sites Created      : ${siteDefs.length}`);
    console.log(`📝 Applications       : ${appCount}`);
    console.log(`📜 Halal Certificates : ${anikeCerts.length}`);
    console.log(`📦 Certified Products : ${anikeProducts.length}`);
    console.log(`🚢 Export Certs       : ${expCount}`);
    console.log('=============================================\n');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrateAnikeData();
