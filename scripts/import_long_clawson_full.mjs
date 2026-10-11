import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const REGION = process.env.AWS_REGION || 'eu-north-1';
const BUCKET = process.env.AWS_S3_BUCKET_NAME || 'hfa-portal-uploads';
const S3_FOLDER = 'certificates';

const s3 = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const SOURCE = path.resolve(__dirname, '../sql-server-export/export/HalalCert/tables/dbo.RegCert.json');

const CERT_METADATA = [
  {
    certNo: 'LO-MU/QR250529095501',
    siteKey: 'bottesford',
    certType: 'HFA Scheme',
    issueDate: new Date('2026-06-11T12:00:00.000Z'),
    expiryDate: new Date('2026-06-10T12:00:00.000Z'),
    scope: 'Dairy Processing - 8 Cheese (CI)',
    products: ['8 Cheese (CI)'],
    status: 'expired'
  },
  {
    certNo: 'L103-BT/MA-IH/QR0008',
    siteKey: 'bottesford',
    certType: 'Renewal Application',
    issueDate: new Date('2024-05-28T12:00:00.000Z'),
    expiryDate: new Date('2025-05-11T12:00:00.000Z'),
    scope: 'Dairy (Food Processor)',
    products: [],
    status: 'expired'
  },
  {
    certNo: 'L103-BT/MA-IH/QR0007',
    siteKey: 'bottesford',
    certType: 'Renewal Application',
    issueDate: new Date('2023-06-06T12:00:00.000Z'),
    expiryDate: new Date('2024-05-11T12:00:00.000Z'),
    scope: 'Dairy (Food Processor)',
    products: [],
    status: 'expired'
  },
  {
    certNo: 'L103-MM/MA-IH/QR0006',
    siteKey: 'melton',
    certType: 'Renewal Application',
    issueDate: new Date('2023-06-06T12:00:00.000Z'),
    expiryDate: new Date('2024-05-11T12:00:00.000Z'),
    scope: 'Dairy (Food Processor)',
    products: [],
    status: 'expired'
  },
  {
    certNo: 'L103-BT/MH-AN/QR0006',
    siteKey: 'bottesford',
    certType: 'Renewal Application',
    issueDate: new Date('2022-06-06T12:00:00.000Z'),
    expiryDate: new Date('2023-05-11T12:00:00.000Z'),
    scope: 'Dairy (Food Processor)',
    products: [],
    status: 'expired'
  },
  {
    certNo: 'L103-MM/MH-AN/QR0005',
    siteKey: 'melton',
    certType: 'Renewal Application',
    issueDate: new Date('2022-06-06T12:00:00.000Z'),
    expiryDate: new Date('2023-05-11T12:00:00.000Z'),
    scope: 'Dairy (Food Processor)',
    products: [],
    status: 'expired'
  },
  {
    certNo: 'L103-BT/MH-AN/QR0004',
    siteKey: 'bottesford',
    certType: 'Renewal Application',
    issueDate: new Date('2021-05-05T12:00:00.000Z'),
    expiryDate: new Date('2022-05-11T12:00:00.000Z'),
    scope: 'Dairy (Food Processor)',
    products: [],
    status: 'expired'
  },
  {
    certNo: 'L103-MM/MH-AN/QR0003',
    siteKey: 'melton',
    certType: 'Renewal Application',
    issueDate: new Date('2021-05-05T12:00:00.000Z'),
    expiryDate: new Date('2022-05-11T12:00:00.000Z'),
    scope: 'Dairy (Food Processor)',
    products: [],
    status: 'expired'
  },
  {
    certNo: 'L103-BT/MH-AN/QR0003',
    siteKey: 'bottesford',
    certType: 'Add On',
    issueDate: new Date('2021-04-20T12:00:00.000Z'),
    expiryDate: new Date('2021-05-11T12:00:00.000Z'),
    scope: 'Dairy (Food Processor)',
    products: [],
    status: 'expired'
  },
  {
    certNo: 'L103-BT/MH-AN/QR0002',
    siteKey: 'bottesford',
    certType: 'Renewal Application',
    issueDate: new Date('2020-06-11T12:00:00.000Z'),
    expiryDate: new Date('2021-05-11T12:00:00.000Z'),
    scope: 'Dairy (Food Processor)',
    products: [],
    status: 'expired'
  },
  {
    certNo: 'L103-MM/MH-AN/QR0002',
    siteKey: 'melton',
    certType: 'Renewal Application',
    issueDate: new Date('2020-06-11T12:00:00.000Z'),
    expiryDate: new Date('2021-05-11T12:00:00.000Z'),
    scope: 'Dairy (Food Processor)',
    products: [],
    status: 'expired'
  }
];

const TARGET_MAP = new Map(CERT_METADATA.map(c => [c.certNo.toLowerCase(), c]));

async function extractBlobs() {
  console.log('📂 Phase 1: Scanning dbo.RegCert.json for 11 Long Clawson certificate blobs...');
  const foundBlobs = new Map();

  const rl = readline.createInterface({
    input: fs.createReadStream(SOURCE, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let inRows = false;
  let rowBuffer = '';
  let rowCount = 0;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!inRows) {
      if (trimmed === '"rows": [') inRows = true;
      continue;
    }
    if (trimmed === ']' || trimmed === '}') break;

    rowBuffer += line + '\n';
    const isCompact = trimmed.startsWith('{') && (trimmed.endsWith('},') || trimmed.endsWith('}'));
    if (!isCompact) {
      const opens = (rowBuffer.match(/\{/g) || []).length;
      const closes = (rowBuffer.match(/\}/g) || []).length;
      if (opens === 0 || opens !== closes) continue;
    }

    let rowJson = rowBuffer.trim();
    rowBuffer = '';
    if (rowJson.endsWith(',')) rowJson = rowJson.slice(0, -1);

    let row;
    try { row = JSON.parse(rowJson); } catch (e) { rowCount++; continue; }
    rowCount++;

    const certRef = (row.CertificateRefNo || '').trim();
    const certKey = certRef.toLowerCase();

    if (TARGET_MAP.has(certKey) && row.Cerfile && row.Cerfile.data) {
      foundBlobs.set(certKey, {
        certRef,
        certName: row.CertName || `${certRef}.pdf`,
        IDColl: Number(row.IDColl) || 0,
        data: row.Cerfile.data,
        type: row.Cerfile.type || 'Buffer'
      });
      if (foundBlobs.size === TARGET_MAP.size) {
        rl.close();
        break;
      }
    }
  }

  console.log(`   ✓ Extracted ${foundBlobs.size} / ${TARGET_MAP.size} blobs.`);
  return foundBlobs;
}

async function uploadBlobToS3(certRef, blob) {
  const cleanFilename = `${certRef.replace(/[\/\\:*?"<>|]/g, '_')}.pdf`;
  const rand = Math.random().toString(36).slice(2, 8);
  const key = `${S3_FOLDER}/${Date.now()}_${rand}_${cleanFilename}`;
  const url = `/api/files/s3/${key}`;

  const buffer = Buffer.from(blob.data, 'base64');
  const uploadParams = {
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: 'application/pdf',
    ContentDisposition: `inline; filename="${cleanFilename}"`,
  };

  await s3.send(new PutObjectCommand(uploadParams));
  return { key, url };
}

async function main() {
  console.log('='.repeat(75));
  console.log('🚀 IMPORTING ALL LONG CLAWSON DAIRY LTD DATA TO MONGODB');
  console.log('='.repeat(75));

  // Connect MongoDB
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB\n');

  const User = (await import('../models/User.js')).default;
  const Site = (await import('../models/Site.js')).default;
  const Application = (await import('../models/Application.js')).default;
  const Certificate = (await import('../models/Certificate.js')).default;
  const ApplicationLogsheet = (await import('../models/ApplicationLogsheet.js')).default;

  // 1. Create or Update Client User
  console.log('👤 Step 1: Creating/Updating Client Account (carl.robinson@clawson.co.uk)...');
  const defaultPasswordHash = await bcrypt.hash('abc123', 10);

  let user = await User.findOne({
    $or: [
      { email: 'carl.robinson@clawson.co.uk' },
      { company_name: /Long Clawson Dairy/i }
    ]
  });

  const userData = {
    email: 'carl.robinson@clawson.co.uk',
    company_name: 'Long Clawson Dairy Ltd',
    full_name: 'Carl Robinson',
    contact_person: 'Carl Robinson',
    phone: '01664 822232',
    address: 'Melton Mowbray, Leicestershire, LE14 4PJ, United Kingdom',
    cr_number: '5419R',
    vat_number: '116999525',
    nature_of_business: 'Dairy (Food Processor)',
    role: 'client',
    client_role: 'admin',
    status: 'active',
    notes: 'Imported from legacy records. CID: 401',
    password: defaultPasswordHash,
    updated_at: new Date()
  };

  if (!user) {
    user = await User.create({
      ...userData,
      created_at: new Date('2020-05-05T12:00:00.000Z')
    });
    console.log(`   ✓ Created User: ${user.company_name} (${user.email}) [ID: ${user._id}]`);
  } else {
    Object.assign(user, userData);
    await user.save();
    console.log(`   ✓ Updated User: ${user.company_name} (${user.email}) [ID: ${user._id}]`);
  }

  // 2. Create or Update Sites
  console.log('\n📍 Step 2: Creating/Updating Sites...');
  let meltonSite = await Site.findOne({
    client_id: user._id,
    name: /Melton/i
  });
  if (!meltonSite) {
    meltonSite = await Site.create({
      client_id: user._id,
      name: 'Long Clawson Dairy Ltd - Melton Mowbray Site',
      est_name: 'Long Clawson Dairy Ltd',
      address: 'Melton Mowbray, Leicestershire, LE14 4PJ, United Kingdom',
      contact_name: 'Carl Robinson',
      contact_email: 'carl.robinson@clawson.co.uk',
      status: 'active',
      created_at: new Date('2020-05-05T12:00:00.000Z')
    });
    console.log(`   ✓ Created Melton Site [ID: ${meltonSite._id}]`);
  } else {
    meltonSite.client_id = user._id;
    meltonSite.address = 'Melton Mowbray, Leicestershire, LE14 4PJ, United Kingdom';
    meltonSite.contact_name = 'Carl Robinson';
    meltonSite.contact_email = 'carl.robinson@clawson.co.uk';
    await meltonSite.save();
    console.log(`   ✓ Updated Melton Site [ID: ${meltonSite._id}]`);
  }

  let bottesfordSite = await Site.findOne({
    client_id: user._id,
    name: /Bottesford/i
  });
  if (!bottesfordSite) {
    bottesfordSite = await Site.create({
      client_id: user._id,
      name: 'Long Clawson Dairy Ltd - Bottesford Site',
      est_name: 'Long Clawson Dairy Ltd',
      address: 'Normanton Lane, Bottesford, Nottingham, NG13 0EL, United Kingdom',
      contact_name: 'Paula Marshall',
      contact_email: 'paula.marshall@clawson.co.uk',
      status: 'active',
      created_at: new Date('2020-05-05T12:00:00.000Z')
    });
    console.log(`   ✓ Created Bottesford Site [ID: ${bottesfordSite._id}]`);
  } else {
    bottesfordSite.client_id = user._id;
    bottesfordSite.address = 'Normanton Lane, Bottesford, Nottingham, NG13 0EL, United Kingdom';
    bottesfordSite.contact_name = 'Paula Marshall';
    bottesfordSite.contact_email = 'paula.marshall@clawson.co.uk';
    await bottesfordSite.save();
    console.log(`   ✓ Updated Bottesford Site [ID: ${bottesfordSite._id}]`);
  }

  // 3. Create Applications
  console.log('\n📝 Step 3: Ensuring Applications exist...');
  const appConfigs = [
    {
      appNo: 'M2-0429/19000020298',
      site: meltonSite,
      date: new Date('2020-06-05T12:00:00.000Z')
    },
    {
      appNo: 'M2-0429/19000020306',
      site: bottesfordSite,
      date: new Date('2020-06-11T12:00:00.000Z')
    }
  ];

  for (const cfg of appConfigs) {
    let app = await Application.findOne({ application_number: cfg.appNo });
    if (!app) {
      app = await Application.create({
        application_number: cfg.appNo,
        client_id: user._id,
        site_id: cfg.site._id,
        company_name: 'Long Clawson Dairy Ltd',
        establishment_name: 'Long Clawson Dairy Ltd',
        application_type: 'renewal',
        status: 'certificate_issued',
        created_at: cfg.date,
        createdAt: cfg.date
      });
      console.log(`   ✓ Created Application ${cfg.appNo} [ID: ${app._id}]`);
    } else {
      app.client_id = user._id;
      app.site_id = cfg.site._id;
      await app.save();
      console.log(`   ✓ Linked Application ${cfg.appNo} [ID: ${app._id}]`);
    }
  }

  // 4. Link the 12 Application Logsheets
  console.log('\n📋 Step 4: Linking all 12 Logsheets to User and Sites...');
  const logsheets = await ApplicationLogsheet.find({ company_name: /clawson/i });
  let logsheetsUpdated = 0;
  for (const ls of logsheets) {
    const isBottesford = (ls.company_name + ' ' + (ls.site_name || '')).toLowerCase().includes('bottesford');
    const targetSite = isBottesford ? bottesfordSite : meltonSite;

    ls.client_id = user._id;
    ls.site_id = targetSite._id;
    ls.updated_at = new Date();
    await ls.save();
    logsheetsUpdated++;
  }
  console.log(`   ✓ Linked ${logsheetsUpdated} logsheets to client and sites.`);

  // 5. Extract Blobs and Upload Certificates to S3 & MongoDB
  console.log('\n📜 Step 5: Extracting PDF Blobs & Uploading Certificates to S3...');
  const blobs = await extractBlobs();

  let certsCreatedOrUpdated = 0;
  for (const meta of CERT_METADATA) {
    const certKey = meta.certNo.toLowerCase();
    const blob = blobs.get(certKey);
    const targetSite = meta.siteKey === 'bottesford' ? bottesfordSite : meltonSite;

    let certUrl = '';
    if (blob) {
      try {
        const { url } = await uploadBlobToS3(meta.certNo, blob);
        certUrl = url;
        console.log(`   ✓ Uploaded S3 PDF for [${meta.certNo}] -> ${certUrl}`);
      } catch (uploadErr) {
        console.error(`   ⚠️ Failed to upload S3 for [${meta.certNo}]:`, uploadErr.message);
      }
    } else {
      console.warn(`   ⚠️ No PDF blob found for [${meta.certNo}]`);
    }

    let certDoc = await Certificate.findOne({ certificate_number: meta.certNo });
    const certFields = {
      certificate_number: meta.certNo,
      client_id: user._id,
      site_id: targetSite._id,
      company_name: 'Long Clawson Dairy Ltd',
      company_address: targetSite.address,
      site_name: targetSite.name,
      certificate_type: meta.certType,
      scope: meta.scope,
      products_covered: meta.products,
      issue_date: meta.issueDate,
      expiry_date: meta.expiryDate,
      status: meta.status,
      updated_at: new Date()
    };

    if (certUrl) {
      certFields.certificate_url = certUrl;
    }

    if (!certDoc) {
      certDoc = await Certificate.create({
        ...certFields,
        created_at: meta.issueDate,
        createdAt: meta.issueDate
      });
      console.log(`   ✓ Created Certificate in MongoDB: ${meta.certNo} [ID: ${certDoc._id}]`);
    } else {
      Object.assign(certDoc, certFields);
      await certDoc.save();
      console.log(`   ✓ Updated Certificate in MongoDB: ${meta.certNo} [ID: ${certDoc._id}]`);
    }
    certsCreatedOrUpdated++;
  }

  console.log('\n=============================================================================');
  console.log('🎉 LONG CLAWSON DAIRY LTD DATA IMPORT COMPLETED SUCCESSFULLY!');
  console.log(`👤 Client Account : carl.robinson@clawson.co.uk`);
  console.log(`📍 Sites Created  : 2 (Melton Mowbray & Bottesford)`);
  console.log(`📋 Logsheets Linked: ${logsheetsUpdated}`);
  console.log(`📜 Certs Processed : ${certsCreatedOrUpdated} (11 certificates with PDFs in S3)`);
  console.log('=============================================================================\n');

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
