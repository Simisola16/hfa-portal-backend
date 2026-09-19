import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns';

// Fix Node.js SRV DNS resolution on Windows/certain networks
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

import User from '../models/User.js';
import Site from '../models/Site.js';
import Certificate from '../models/Certificate.js';
import Product from '../models/Product.js';
import Application from '../models/Application.js';
import ExportCertificate from '../models/ExportCertificate.js';
import { generateCertificate } from '../services/certificateGenerator.js';
import { uploadToGridFS } from '../lib/gridfs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const companyName = 'Anike International';
const email = 'anike@halalfoodauthority.com';
const plainPassword = 'abc123';

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

const applicationsData = [
  {
    application_number: 'M2-0429/190000076',
    application_type: 'New Application',
    category: 'Annual Certification – UAE/GSO approved halal certification for exporters to the UAE',
    site_name: 'Alamu',
    status: 'certificate_issued',
    products: []
  },
  {
    application_number: 'M2-0429/19000010041',
    application_type: 'New Application',
    category: 'Annual Certification – Food and General processing',
    site_name: 'Alamu',
    status: 'certificate_issued',
    products: []
  },
  {
    application_number: 'M2-0429/19000010043',
    application_type: 'New Application',
    category: 'Annual Certification – Food and General processing',
    site_name: 'gjuguih',
    status: 'certificate_issued',
    products: []
  },
  {
    application_number: 'M2-0429/19000010068',
    application_type: 'New Application',
    category: 'Annual Certification – UAE/GSO approved halal certification for exporters to the UAE',
    site_name: 'Alamu',
    status: 'certificate_issued',
    products: []
  },
  {
    application_number: 'M2-0429/190000030651',
    application_type: 'New Application',
    category: 'Annual Certification – UAE/GSO approved halal certification for exporters to the UAE',
    site_name: 'Alamu',
    status: 'under_review',
    products: []
  },
  {
    application_number: 'M2-0429/190000030652',
    application_type: 'New Application',
    category: 'Annual Certification – Food and General processing',
    site_name: 'Alamu',
    status: 'under_review',
    products: []
  },
  {
    application_number: 'M2-0429/190000030653',
    application_type: 'New Application',
    category: 'Annual Certification – Food and General processing',
    site_name: 'Alamu',
    status: 'under_review',
    products: []
  },
  {
    application_number: 'M2-0429/1900000100775',
    application_type: 'New Application',
    category: 'Annual Certification – UAE/GSO approved halal certification for exporters to the UAE',
    site_name: 'Alamu',
    status: 'submitted',
    products: []
  },
  {
    application_number: 'M2-0429/1900000181009',
    application_type: 'New Application',
    category: 'Annual Certification – Food and General processing',
    site_name: 'grandma Hifza',
    status: 'submitted',
    products: [
      { name: 'biscui', brand: 'Anike Foods', category: 'K' },
      { name: 'RICE', brand: 'Anike Foods', category: 'K' }
    ]
  }
];

const productsData = [
  {
    name: 'biscui',
    code: '8987899',
    category: 'K',
    site_name: 'grandma Hifza',
    certificate_id: 'AN-BU/QR251217134523'
  },
  {
    name: 'RICE',
    code: '898754545',
    category: 'K',
    site_name: 'grandma Hifza',
    certificate_id: 'AN-BU/QR251217134523'
  }
];

const exportCertsData = [
  {
    reference_number: 'EXP-08122024170808',
    destination_country: 'United Arab Emirates',
    shipment_date: new Date('2024-12-08'),
    consignee_name: 'Hifza Grcery',
    consignee_address: '28 woods road',
    products: 'Order #987653 - Consignor: Shirin Internation',
    consignment_details: 'Facility: 15 Linen House, Flight/Freight: 0990',
    status: 'approved'
  },
  {
    reference_number: 'EXP-16122024210247-1',
    destination_country: 'United Arab Emirates',
    shipment_date: new Date('2024-12-16'),
    consignee_name: 'smdns',
    consignee_address: 'sdksd',
    products: 'Order #ksdds - Consignor: alamu',
    consignment_details: 'Facility: kwnefd, Flight/Freight: msdn',
    status: 'approved'
  },
  {
    reference_number: 'EXP-16122024210247-2',
    destination_country: 'United Arab Emirates',
    shipment_date: new Date('2024-12-16'),
    consignee_name: 'smdns',
    consignee_address: 'sdksd',
    products: 'Order #ksdds - Consignor: alamu',
    consignment_details: 'Facility: kwnefd, Flight/Freight: msdn',
    status: 'approved'
  },
  {
    reference_number: 'EXP-07042025153929',
    destination_country: 'United Arab Emirates',
    shipment_date: new Date('2025-04-07'),
    consignee_name: 'ABC',
    consignee_address: 'Taoheed',
    products: 'Order #Test - Consignor: Anike',
    consignment_details: 'Facility: any, Flight/Freight: 07/04/2025',
    status: 'approved'
  },
  {
    reference_number: 'EXP-07042025154346',
    destination_country: 'United Arab Emirates',
    shipment_date: new Date('2025-04-07'),
    consignee_name: 'any',
    consignee_address: 'Taoheed',
    products: 'Order #Test - Consignor: Anike',
    consignment_details: 'Facility: ddvodofkow, Flight/Freight: 07/04/2025',
    status: 'pending'
  }
];

async function seedAnike() {
  try {
    console.log('Connecting to MongoDB...');
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI is not set in environment or .env file');
    }
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB:', mongoose.connection.name);

    // 1. User
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
        password: plainPassword,
      });
      await user.save();
      console.log(`   ✅ Created client user: ${user.email} (ID: ${user._id})`);
    } else {
      Object.assign(user, userProfileData);
      user.password = plainPassword; // pre-save hook will hash it
      await user.save();
      console.log(`   ℹ️ User ${user.email} updated with password ${plainPassword} (ID: ${user._id})`);
    }

    const userIdStr = user._id.toString();

    // 2. Sites
    console.log(`\n2️⃣ Processing Sites...`);
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
    console.log(`\n3️⃣ Processing Applications...`);
    const appMap = {};
    for (const app of applicationsData) {
      const site = siteMap[app.site_name] || siteMap['Alamu'];
      const appDoc = {
        application_number: app.application_number,
        client_id: user._id,
        application_type: app.application_type,
        category: app.category,
        establishment_name: companyName,
        establishment_address: '28 Woods Road, Peckham, London SE15 2SW',
        site_name: app.site_name,
        site_id: site ? site._id.toString() : null,
        reg_number: '232',
        vat_number: '2342',
        managing_director: 'anike lekan',
        employee_count: 4,
        products: app.products || [],
        status: app.status,
        notes: 'Imported from legacy HFA database',
      };

      const saved = await Application.findOneAndUpdate(
        { application_number: app.application_number },
        { $set: appDoc },
        { upsert: true, new: true }
      );
      appMap[app.application_number] = saved;
      console.log(`   ✅ Saved Application: ${app.application_number} (${app.status})`);
    }

    // 4. Halal Certificate
    console.log(`\n4️⃣ Processing Halal Certificate...`);
    const certNo = 'AN-BU/QR251217134523';
    const linkedApp = appMap['M2-0429/1900000181009'] || appMap['M2-0429/190000076'];

    let certificateUrl = null;
    try {
      console.log('   📄 Generating official Certificate PDF for Anike International...');
      const pdfBuffer = await generateCertificate({
        businessName: companyName,
        businessAddress: '28 Woods Road, Peckham, London SE15 2SW',
        manufacturerAddress: '3 Watcombe Road',
        certificateNumber: certNo,
        scopeOfCertification: 'Food and General processing',
        scheme: 'GSO non-meat',
        productCategories: [
          { code: '8987899', name: 'biscui' },
          { code: '898754545', name: 'RICE' }
        ],
        issueDate: new Date('2025-12-17'),
        expiryDate: new Date('2026-12-27'),
        cycleStartDate: new Date('2025-12-24'),
        verificationUrl: `${process.env.FRONTEND_CLIENT_URL || 'http://localhost:5173'}/verify/${encodeURIComponent(certNo)}`
      });

      const filename = `${certNo.replace(/[\/\\:]/g, '_')}.pdf`;
      certificateUrl = await uploadToGridFS(pdfBuffer, filename, 'application/pdf');
      console.log(`   ✅ Certificate PDF uploaded to GridFS: ${certificateUrl}`);
    } catch (pdfErr) {
      console.warn('   ⚠️ Note on PDF generation:', pdfErr.message);
    }

    const existingCert = await Certificate.findOne({ certificate_number: certNo });
    if (!certificateUrl && existingCert?.certificate_url) {
      certificateUrl = existingCert.certificate_url;
    }

    const certDoc = {
      certificate_number: certNo,
      client_id: userIdStr,
      application_id: linkedApp ? linkedApp._id : null,
      company_name: companyName,
      company_address: '28 Woods Road, Peckham, London SE15 2SW',
      manufacturing_address: '3 Watcombe Road',
      scope: 'Food and General processing',
      certificate_type: 'GSO non-meat',
      issue_date: new Date('2025-12-17'),
      expiry_date: new Date('2026-12-27'),
      current_cycle_start_date: new Date('2025-12-24'),
      status: 'active',
      certificate_url: certificateUrl,
      products_covered: ['biscui', 'RICE'],
      product_details: [
        { name: 'biscui', code: '8987899', category: 'K' },
        { name: 'RICE', code: '898754545', category: 'K' }
      ],
      site_id: siteMap['Alamu'] ? siteMap['Alamu']._id : null,
      notes: 'Imported from legacy HFA database. Active cycle through 2026.'
    };

    await Certificate.findOneAndUpdate(
      { certificate_number: certNo },
      { $set: certDoc },
      { upsert: true, new: true }
    );
    console.log(`   ✅ Saved Certificate: ${certNo} (GSO non-meat) - URL: ${certificateUrl || 'None'}`);

    // 5. Products
    console.log(`\n5️⃣ Processing Products...`);
    for (const p of productsData) {
      const site = siteMap[p.site_name] || siteMap['grandma Hifza'];
      const pDoc = {
        client_id: user._id,
        name: p.name,
        code: p.code,
        category: p.category,
        certificate_id: p.certificate_id,
        site_id: site ? site._id : null,
        status: 'active',
        notes: `Imported from legacy HFA database. Product code ${p.code}`
      };

      await Product.findOneAndUpdate(
        { client_id: user._id, name: p.name, code: p.code },
        { $set: pDoc },
        { upsert: true, new: true }
      );
      console.log(`   ✅ Saved Product: ${p.name} (Code: ${p.code})`);
    }

    // 6. Export Certificates
    console.log(`\n6️⃣ Processing Export Certificates...`);
    for (const exp of exportCertsData) {
      const expDoc = {
        client_id: userIdStr,
        reference_number: exp.reference_number,
        destination_country: exp.destination_country,
        shipment_date: exp.shipment_date,
        consignee_name: exp.consignee_name,
        consignee_address: exp.consignee_address,
        products: exp.products,
        consignment_details: exp.consignment_details,
        status: exp.status,
        notes: `Imported from legacy HFA database (Ref: ${exp.reference_number})`
      };

      await ExportCertificate.findOneAndUpdate(
        { client_id: userIdStr, reference_number: exp.reference_number },
        { $set: expDoc },
        { upsert: true, new: true }
      );
      console.log(`   ✅ Saved Export Certificate: ${exp.reference_number} (${exp.status})`);
    }

    console.log('\n=============================================');
    console.log('🎉 ANIKE INTERNATIONAL SEEDED SUCCESSFULLY!');
    console.log('=============================================');
    console.log(`👤 Email    : ${email}`);
    console.log(`🔑 Password : ${plainPassword}`);
    console.log(`🏢 Company  : ${companyName}`);
    console.log(`📍 Sites    : ${siteDefs.length}`);
    console.log(`📝 Apps     : ${applicationsData.length}`);
    console.log(`📜 Certs    : 1 (Active)`);
    console.log(`📦 Products : ${productsData.length}`);
    console.log(`🚢 Exports  : ${exportCertsData.length}`);
    console.log('=============================================\n');

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('❌ Seeding failed:', err);
    process.exit(1);
  }
}

seedAnike();
