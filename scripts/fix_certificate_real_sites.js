import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Certificate from '../models/Certificate.js';
import Site from '../models/Site.js';
import User from '../models/User.js';

dotenv.config();

// Exact targeted mapping for the 13 certificates displaying "Main Site"
const CERTIFICATE_FIXES = [
  // Basildon Chemical Company Ltd (4 certs)
  {
    certNumbers: [
      'BA-SA/QR250310134024',
      'BA-BU/QR250325114130',
      'BA-SA/QR250801164025',
      'BA-SA/QR250801164633'
    ],
    siteName: 'Basildon Chemical Company Ltd.',
    address: '7 Kimber Road, Abingdon, Oxon OX14 1RZ, United Kingdom',
    city: 'Abingdon',
    country: 'United Kingdom',
    postcode: 'OX14 1RZ'
  },
  // Westbridge Foods Thailand (1 cert)
  {
    certNumbers: ['CP-KH/QR250910143606'],
    siteName: 'CP Foods',
    address: 'TH139: 333, 333/1-2 Moo 9, Sikhiu – Detudom Road, Thayiem, Chok Chai, Nakhonratchasima 30190, Thailand',
    city: 'Nakhonratchasima',
    country: 'Thailand',
    postcode: '30190'
  },
  // Kitchen Range Foods Ltd (2 certs)
  {
    certNumbers: [
      'KI-KH/QR250903135109',
      'PI-KH/QR260730135908'
    ],
    siteName: 'Kitchen Range Foods - Huntingdon',
    address: 'Kingfisher Way, Huntingdon, Cambridgeshire PE29 6FJ, United Kingdom',
    city: 'Huntingdon',
    country: 'United Kingdom',
    postcode: 'PE29 6FJ'
  },
  // Dunbia Dungannon Primary (1 cert)
  {
    certNumbers: ['DU-KH/QR251127102647'],
    siteName: 'Dungannon - Dunbia',
    address: 'Granville Industrial Estate, Dungannon, Co. Tyrone BT70 1NJ, United Kingdom',
    city: 'Dungannon',
    country: 'United Kingdom',
    postcode: 'BT70 1NJ'
  },
  // Cotteswold Dairy Ltd (1 cert)
  {
    certNumbers: ['CO-KH/QR251022133043'],
    siteName: 'Cotteswold Dairy Ltd',
    address: 'Dairy Way, Northway Lane, Tewkesbury, Gloucestershire GL20 8JE, United Kingdom',
    city: 'Tewkesbury',
    country: 'United Kingdom',
    postcode: 'GL20 8JE'
  },
  // Mars Polska (1 cert)
  {
    certNumbers: ['MA-KH/QR250912112911'],
    siteName: 'Mars Polska S.P',
    address: 'Kozuski Parcel 42, 96-500 Sochaczew, Poland',
    city: 'Sochaczew',
    country: 'Poland',
    postcode: '96-500'
  },
  // Guenther Bakeries (1 cert)
  {
    certNumbers: ['GU-BU/QR250625140057'],
    siteName: 'Guenther Bakeries',
    address: 'Hareshill Road, Heywood, Lancashire OL10 2TN, United Kingdom',
    city: 'Heywood',
    country: 'United Kingdom',
    postcode: 'OL10 2TN'
  },
  // Holiferm (2 certs)
  {
    certNumbers: [
      'HO-KH/QR250911104205',
      'HO-KH/QR260911154000'
    ],
    siteName: 'Holiferm Manufacturing Limited',
    address: 'Units 7-14 Dock Road, Ocean Park, Wallasey CH41 1HW, United Kingdom',
    city: 'Wallasey',
    country: 'United Kingdom',
    postcode: 'CH41 1HW'
  }
];

async function applyTargetedFix(dryRun = true) {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`=== RUNNING PRECISE SITE FIX (dryRun: ${dryRun}) ===\n`);

  for (const group of CERTIFICATE_FIXES) {
    for (const certNo of group.certNumbers) {
      const cert = await Certificate.findOne({ certificate_number: certNo }).populate('site_id');
      if (!cert) {
        console.log(`Certificate ${certNo} not found in database!`);
        continue;
      }

      console.log(`\nCert [${certNo}] - Company: "${cert.company_name}"`);
      console.log(`  Current Site Name: "${cert.site_name || cert.site_id?.name || 'N/A'}"`);
      console.log(`  -> Setting Real Site Name: "${group.siteName}"`);
      console.log(`  -> Setting Real Manufacturing Address: "${group.address}"`);

      if (!dryRun) {
        cert.site_name = group.siteName;
        cert.manufacturing_address = group.address;
        await cert.save();

        // If the linked site has "Main Site" in its name, rename the site record directly
        if (cert.site_id && cert.site_id._id) {
          const siteDoc = await Site.findById(cert.site_id._id);
          if (siteDoc && siteDoc.name && siteDoc.name.toLowerCase().includes('main site')) {
            console.log(`  Renaming linked Site [${siteDoc._id}] from "${siteDoc.name}" to "${group.siteName}"`);
            siteDoc.name = group.siteName;
            siteDoc.est_name = group.siteName;
            siteDoc.address_1 = group.address;
            siteDoc.city = group.city;
            siteDoc.country = group.country;
            siteDoc.postcode = group.postcode;
            await siteDoc.save();
          }
        }
      }
    }
  }

  // Also clean up Afghanistan legacy bug on Basildon primary site & client
  const basildonSites = await Site.find({
    $or: [
      { name: /Basildon/i },
      { est_name: /Basildon/i }
    ]
  });

  for (const s of basildonSites) {
    if (s.address_1 && s.address_1.includes('Afghanistan')) {
      console.log(`\nCleaning address on Basildon Site [${s._id}]`);
      if (!dryRun) {
        s.address_1 = '7 Kimber Road, Abingdon, Oxon OX14 1RZ, United Kingdom';
        s.country = 'United Kingdom';
        s.postcode = 'OX14 1RZ';
        s.city = 'Abingdon';
        await s.save();
      }
    }
    if (s.name && s.name.toLowerCase().includes('main site')) {
      console.log(`\nRenaming Basildon fallback site [${s._id}] to "Basildon Chemical Company Ltd."`);
      if (!dryRun) {
        s.name = 'Basildon Chemical Company Ltd.';
        s.est_name = 'Basildon Chemical Company Ltd.';
        s.address_1 = '7 Kimber Road, Abingdon, Oxon OX14 1RZ, United Kingdom';
        s.country = 'United Kingdom';
        s.postcode = 'OX14 1RZ';
        s.city = 'Abingdon';
        await s.save();
      }
    }
  }

  // Also fix all certificates of Basildon (e.g. BA-KH/QR251024144337) that had 'Afghanistan' in manufacturing_address
  const allBasildonCerts = await Certificate.find({ company_name: /Basildon/i });
  for (const c of allBasildonCerts) {
    if (c.manufacturing_address && c.manufacturing_address.includes('Afghanistan')) {
      console.log(`Cleaning manufacturing_address on Basildon Cert [${c.certificate_number}]`);
      if (!dryRun) {
        c.manufacturing_address = '7 Kimber Road, Abingdon, Oxon OX14 1RZ, United Kingdom';
        c.site_name = 'Basildon Chemical Company Ltd.';
        await c.save();
      }
    }
  }

  // Clean country for Basildon user profile
  const basildonUsers = await User.find({ company_name: /Basildon/i });
  for (const u of basildonUsers) {
    if (u.country === 'Afghanistan' || (u.address && u.address.includes('Afghanistan'))) {
      console.log(`Cleaning user country [${u.email}] to United Kingdom`);
      if (!dryRun) {
        u.country = 'United Kingdom';
        if (u.address) {
          u.address = u.address.replace(/Afghanistan/g, 'United Kingdom');
        }
        await u.save();
      }
    }
  }

  console.log('\n✓ Targeted site fix completed successfully.');
  await mongoose.disconnect();
}

const isDry = process.argv.includes('--dry');
applyTargetedFix(isDry).catch(console.error);
