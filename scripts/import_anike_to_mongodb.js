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
import AddOnApplication from '../models/AddOnApplication.js';
import { generateCertificate } from '../services/certificateGenerator.js';
import { uploadToGridFS } from '../lib/gridfs.js';
import { getClientUrl } from '../lib/urls.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const companyName = 'Anike International';
const email = 'anike@halalfoodauthority.com';
const plainPassword = 'abc123';

// 15 Manufacturing Sites from SQL Server (dbo.TlbSie where Kinopm = '133')
const siteDefs = [
  {
    "name": "Banbury",
    "client_code": "10006",
    "address_1": "2-couper house, croxley view,",
    "address_2": "",
    "city": "watford",
    "postcode": "wd18 6pg",
    "country": "Afghanistan",
    "est_name": "Anike International",
    "trading_name": "3vhjsbdhjsfjs",
    "reg_number": "34 kdfkjfkgdfg",
    "vat_number": "5555",
    "status": "active"
  },
  {
    "name": "OLOJUCOmpa",
    "client_code": "10038",
    "address_1": "ihkikhio",
    "address_2": "ihkikhio",
    "city": "london",
    "postcode": "234",
    "country": "Afghanistan",
    "est_name": "Anike International",
    "trading_name": "Anike International",
    "reg_number": "232",
    "vat_number": "2342",
    "status": "active"
  },
  {
    "name": "LOGO",
    "client_code": "10039",
    "address_1": "ihkikhio",
    "address_2": "ihkikhio",
    "city": "london",
    "postcode": "234",
    "country": "Afghanistan",
    "est_name": "Anike International",
    "trading_name": "Anike International",
    "reg_number": "232",
    "vat_number": "2342",
    "status": "active"
  },
  {
    "name": "XOMS",
    "client_code": "10040",
    "address_1": "ihkikhio",
    "address_2": "ihkikhio",
    "city": "london",
    "postcode": "234",
    "country": "Afghanistan",
    "est_name": "Anike International",
    "trading_name": "Anike International",
    "reg_number": "232",
    "vat_number": "2342",
    "status": "active"
  },
  {
    "name": "Aladoslkaj",
    "client_code": "10041",
    "address_1": "ihkikhio",
    "address_2": "ihkikhio",
    "city": "london",
    "postcode": "234",
    "country": "Afghanistan",
    "est_name": "Anike International",
    "trading_name": "Anike International",
    "reg_number": "232",
    "vat_number": "2342",
    "status": "active"
  },
  {
    "name": "gjuguih",
    "client_code": "10043",
    "address_1": "ihkikhio",
    "address_2": "ihkikhio",
    "city": "london",
    "postcode": "234",
    "country": "Afghanistan",
    "est_name": "Anike International",
    "trading_name": "Anike International",
    "reg_number": "232",
    "vat_number": "2342",
    "status": "active"
  },
  {
    "name": "Alamu",
    "client_code": "10068",
    "address_1": "1 dkfndgdfgd",
    "address_2": "",
    "city": "London",
    "postcode": "343rdf",
    "country": "Afghanistan",
    "est_name": "Anike International",
    "trading_name": "Anike International",
    "reg_number": "232",
    "vat_number": "2342",
    "status": "active"
  },
  {
    "name": "Hifza test",
    "client_code": "50661",
    "address_1": "Address on file",
    "address_2": "",
    "city": "London",
    "postcode": "SE15 2SW",
    "country": "Afghanistan",
    "est_name": "Anike International",
    "trading_name": "Anike International",
    "reg_number": "232",
    "vat_number": "2342",
    "status": "active"
  },
  {
    "name": "shehab test",
    "client_code": "50662",
    "address_1": "Address on file",
    "address_2": "",
    "city": "London",
    "postcode": "SE15 2SW",
    "country": "Afghanistan",
    "est_name": "Anike International",
    "trading_name": "Anike International",
    "reg_number": "232",
    "vat_number": "2342",
    "status": "active"
  },
  {
    "name": "Mushtaq",
    "client_code": "50663",
    "address_1": "Address on file",
    "address_2": "",
    "city": "London",
    "postcode": "SE15 2SW",
    "country": "Afghanistan",
    "est_name": "Anike International",
    "trading_name": "Anike International",
    "reg_number": "232",
    "vat_number": "2342",
    "status": "active"
  },
  {
    "name": "rashidnew",
    "client_code": "130785",
    "address_1": "28 Woods Road",
    "address_2": "",
    "city": "London",
    "postcode": "SE15 2SW",
    "country": "Algeria",
    "est_name": "Anike International",
    "trading_name": "Anike International",
    "reg_number": "232",
    "vat_number": "2342",
    "status": "active"
  },
  {
    "name": "Muhayad",
    "client_code": "130802",
    "address_1": "Address on file",
    "address_2": "",
    "city": "London",
    "postcode": "SE15 2SW",
    "country": "Afghanistan",
    "est_name": "Anike International",
    "trading_name": "Anike International",
    "reg_number": "232",
    "vat_number": "2342",
    "status": "active"
  },
  {
    "name": "Shirina",
    "client_code": "171001",
    "address_1": "Address on file",
    "address_2": "",
    "city": "London",
    "postcode": "SE15 2SW",
    "country": "Afghanistan",
    "est_name": "Anike International",
    "trading_name": "Anike International",
    "reg_number": "232",
    "vat_number": "2342",
    "status": "active"
  },
  {
    "name": "grandma Hifza",
    "client_code": "181073",
    "address_1": "Address on file",
    "address_2": "",
    "city": "London",
    "postcode": "SE15 2SW",
    "country": "Afghanistan",
    "est_name": "Anike International",
    "trading_name": "Anike International",
    "reg_number": "232",
    "vat_number": "2342",
    "status": "active"
  },
  {
    "name": "Awal",
    "client_code": "191110",
    "address_1": "28 Woods Road",
    "address_2": "",
    "city": "London",
    "postcode": "SE15 2SW",
    "country": "Afghanistan",
    "est_name": "Anike International",
    "trading_name": "Anike International",
    "reg_number": "232",
    "vat_number": "2342",
    "status": "active"
  }
];

// 9 Original Applications from SQL Server (dbo.AppleReg where CID = '133')
const applicationsData = [
  {
    "application_number": "M2-0429/190000076",
    "application_type": "New Application",
    "category": "Annual Certification – UAE/GSO approved halal certification for exporters to the UAE",
    "site_client_code": "10068",
    "site_name": "Alamu",
    "status": "certificate_issued",
    "submission_date": "2019-12-10T23:00:00.000Z",
    "employee_count": 4,
    "managing_director": "anike lekan",
    "products": []
  },
  {
    "application_number": "M2-0429/19000010041",
    "application_type": "New Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "10041",
    "site_name": "Aladoslkaj",
    "status": "certificate_issued",
    "submission_date": "2020-03-08T23:00:00.000Z",
    "employee_count": 4,
    "managing_director": "anike lekan",
    "products": []
  },
  {
    "application_number": "M2-0429/19000010043",
    "application_type": "New Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "10043",
    "site_name": "gjuguih",
    "status": "certificate_issued",
    "submission_date": "2020-03-08T23:00:00.000Z",
    "employee_count": 4,
    "managing_director": "anike lekan",
    "products": []
  },
  {
    "application_number": "M2-0429/19000010068",
    "application_type": "New Application",
    "category": "Annual Certification – UAE/GSO approved halal certification for exporters to the UAE",
    "site_client_code": "10068",
    "site_name": "Alamu",
    "status": "certificate_issued",
    "submission_date": "2020-03-10T23:00:00.000Z",
    "employee_count": 4,
    "managing_director": "anike lekan",
    "products": []
  },
  {
    "application_number": "M2-0429/190000030651",
    "application_type": "New Application",
    "category": "Annual Certification – UAE/GSO approved halal certification for exporters to the UAE",
    "site_client_code": "50661",
    "site_name": "Hifza test",
    "status": "under_review",
    "submission_date": "2021-11-02T23:00:00.000Z",
    "employee_count": 4,
    "managing_director": "anike lekan",
    "products": []
  },
  {
    "application_number": "M2-0429/190000030652",
    "application_type": "New Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "50662",
    "site_name": "shehab test",
    "status": "under_review",
    "submission_date": "2021-11-02T23:00:00.000Z",
    "employee_count": 4,
    "managing_director": "anike lekan",
    "products": []
  },
  {
    "application_number": "M2-0429/190000030653",
    "application_type": "New Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "50663",
    "site_name": "Mushtaq",
    "status": "under_review",
    "submission_date": "2021-11-02T23:00:00.000Z",
    "employee_count": 4,
    "managing_director": "anike lekan",
    "products": []
  },
  {
    "application_number": "M2-0429/1900000100775",
    "application_type": "New Application",
    "category": "Annual Certification – UAE/GSO approved halal certification for exporters to the UAE",
    "site_client_code": "130785",
    "site_name": "rashidnew",
    "status": "submitted",
    "submission_date": "2023-04-26T23:00:00.000Z",
    "employee_count": 5,
    "managing_director": "anike lekan",
    "products": []
  },
  {
    "application_number": "M2-0429/1900000181009",
    "application_type": "New Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "181073",
    "site_name": "grandma Hifza",
    "status": "submitted",
    "submission_date": "2025-08-25T23:00:00.000Z",
    "employee_count": 4,
    "managing_director": "anike lekan",
    "products": [
      {
        "name": "biscui",
        "brand": "Anike Foods",
        "category": "K"
      },
      {
        "name": "RICE",
        "brand": "Anike Foods",
        "category": "K"
      }
    ]
  }
];

// 2 Renewal Applications from SQL Server (dbo.REneApp where KingID = '133')
const renewalsData = [
  {
    "application_number": "RN-241202",
    "original_app_number": "M2-0429/19000010068",
    "application_type": "Renewal Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "10068",
    "site_name": "Alamu",
    "status": "certificate_issued",
    "submission_date": "2025-05-08T23:00:00.000Z",
    "managing_director": "anike lekan",
    "notes": "Renewal application #241202 for original application M2-0429/19000010068"
  },
  {
    "application_number": "RN-241205",
    "original_app_number": "M2-0429/19000010043",
    "application_type": "Renewal Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "10043",
    "site_name": "gjuguih",
    "status": "certificate_issued",
    "submission_date": "2025-05-13T23:00:00.000Z",
    "managing_director": "anike lekan",
    "notes": "Renewal application #241205 for original application M2-0429/19000010043"
  }
];

// 4 Approved Certificates from SQL Server (dbo.tlbcertMas where CName = '133')
const certificatesData = [
  {
    "certificate_number": "LE-BU/QR230504014749",
    "company_name": "Anike International",
    "trading_name": "Lekan Int",
    "company_address": "3 Watcombe Road",
    "manufacturing_address": "3 Watcombe Road 28 woods road knksdfhsf oshdfosjhd fsjhijfdh siodhj",
    "scope": "B",
    "certificate_type": "HFA Scheme",
    "issue_date": "2023-05-03T23:00:00.000Z",
    "expiry_date": "2023-06-07T23:00:00.000Z",
    "current_cycle_start_date": "2023-05-03T23:00:00.000Z",
    "site_client_code": "130785",
    "site_name": "rashidnew",
    "status": "expired",
    "products_covered": [
      "General Certified Products"
    ]
  },
  {
    "certificate_number": "LE-BU/QR230511145809",
    "company_name": "Anike International",
    "trading_name": "Lekan Int",
    "company_address": "28 Woods Road",
    "manufacturing_address": "27V IKJCNKXJCNKX",
    "scope": "L",
    "certificate_type": "HFA Scheme",
    "issue_date": "2023-05-10T23:00:00.000Z",
    "expiry_date": "2023-04-07T23:00:00.000Z",
    "current_cycle_start_date": "2023-05-10T23:00:00.000Z",
    "site_client_code": "10068",
    "site_name": "Alamu",
    "status": "expired",
    "products_covered": [
      "General Certified Products"
    ]
  },
  {
    "certificate_number": "AN-BU/QR251217134523",
    "company_name": "Anike International",
    "trading_name": "Anike International",
    "company_address": "28 Woods Road",
    "manufacturing_address": "3 Watcombe Road",
    "scope": "oiwieoiwe",
    "certificate_type": "GSO non-meat",
    "issue_date": "2025-12-16T23:00:00.000Z",
    "expiry_date": "2025-12-26T23:00:00.000Z",
    "current_cycle_start_date": "2025-12-23T23:00:00.000Z",
    "site_client_code": "10068",
    "site_name": "Alamu",
    "status": "expired",
    "products_covered": [
      "biscui",
      "RICE"
    ]
  },
  {
    "certificate_number": "AN-BU/QR260107111656",
    "company_name": "Anike International",
    "trading_name": "Talents",
    "company_address": "28 Wood's Road",
    "manufacturing_address": "sxvsdvcxc",
    "scope": "yeso",
    "certificate_type": "HFA Scheme",
    "issue_date": "2026-01-06T23:00:00.000Z",
    "expiry_date": "2026-01-30T23:00:00.000Z",
    "current_cycle_start_date": "2026-01-07T23:00:00.000Z",
    "site_client_code": "10006",
    "site_name": "Banbury",
    "status": "expired",
    "products_covered": [
      "General Certified Products"
    ]
  }
];

// 4 Products from SQL Server (dbo.tldbprotem where compid = '133')
const productsData = [
  {
    "name": "ola",
    "code": "001",
    "category": "hgasj",
    "site_client_code": "171001",
    "site_name": "Shirina",
    "certificate_number": "M2-0429/1900000161006"
  },
  {
    "name": "ola2",
    "code": "001",
    "category": "hgasj",
    "site_client_code": "171001",
    "site_name": "Shirina",
    "certificate_number": "M2-0429/1900000161006"
  },
  {
    "name": "biscui",
    "code": "8987899",
    "category": "K",
    "site_client_code": "181073",
    "site_name": "grandma Hifza",
    "certificate_number": "M2-0429/1900000181009"
  },
  {
    "name": "RICE",
    "code": "898754545",
    "category": "K",
    "site_client_code": "181073",
    "site_name": "grandma Hifza",
    "certificate_number": "M2-0429/1900000181009"
  }
];

// 17 Add-On Applications from SQL Server (dbo.ProAder where CompID = '133')
const addOnsData = [
  {
    "application_number": "ADD-20025",
    "legacy_record_id": "20025",
    "contact_name": "Taoheed testing",
    "contact_email": "anike@halalfoodauthority.com",
    "subject": "Product Add-on",
    "message": "",
    "site_client_code": "10068",
    "site_name": "Alamu",
    "status": "accepted",
    "created_at": "2019-12-10T23:00:00.000Z",
    "products": [
      {
        "sn": 1,
        "name": "Add-on Product Line",
        "code": "ADD-20025",
        "type": "Add product"
      }
    ]
  },
  {
    "application_number": "ADD-2912202227128",
    "legacy_record_id": "242113",
    "contact_name": "lekan",
    "contact_email": "anike@halalfoodauthority.com",
    "subject": "add on",
    "message": "yesy tes",
    "site_client_code": "10068",
    "site_name": "Alamu",
    "status": "completed",
    "created_at": "2022-12-28T23:00:00.000Z",
    "products": [
      {
        "sn": 1,
        "name": "add on",
        "code": "ADD-242113",
        "type": "Add product"
      }
    ]
  },
  {
    "application_number": "ADD-06022023111018",
    "legacy_record_id": "242277",
    "contact_name": "taoheed",
    "contact_email": "anike@halalfoodauthority.com",
    "subject": "add on test",
    "message": "testimg",
    "site_client_code": "10068",
    "site_name": "Alamu",
    "status": "completed",
    "created_at": "2023-02-05T23:00:00.000Z",
    "products": [
      {
        "sn": 1,
        "name": "add on test",
        "code": "ADD-242277",
        "type": "Add product"
      }
    ]
  },
  {
    "application_number": "ADD-090220234216",
    "legacy_record_id": "242291",
    "contact_name": "Taoheed Ogundapo",
    "contact_email": "anike@halalfoodauthority.com",
    "subject": "add on",
    "message": "test",
    "site_client_code": "10068",
    "site_name": "Alamu",
    "status": "completed",
    "created_at": "2023-02-08T23:00:00.000Z",
    "products": [
      {
        "sn": 1,
        "name": "add on",
        "code": "ADD-242291",
        "type": "Add product"
      }
    ]
  },
  {
    "application_number": "ADD-1502202333842",
    "legacy_record_id": "242302",
    "contact_name": "Taoheed Ogundapo",
    "contact_email": "anike@halalfoodauthority.com",
    "subject": "add on",
    "message": "new tesr",
    "site_client_code": "10068",
    "site_name": "Alamu",
    "status": "all_forms_received",
    "created_at": "2023-02-14T23:00:00.000Z",
    "products": [
      {
        "sn": 1,
        "name": "add on",
        "code": "ADD-242302",
        "type": "Add product"
      }
    ]
  },
  {
    "application_number": "ADD-0603202353339",
    "legacy_record_id": "242332",
    "contact_name": "Taoheed Ogundapo",
    "contact_email": "anike@halalfoodauthority.com",
    "subject": "add on",
    "message": "kjfdf\r\n\r\njdfjd",
    "site_client_code": "50662",
    "site_name": "shehab test",
    "status": "ready_for_certificate",
    "created_at": "2023-03-05T23:00:00.000Z",
    "products": [
      {
        "sn": 1,
        "name": "add on",
        "code": "ADD-242332",
        "type": "Add product"
      }
    ]
  },
  {
    "application_number": "ADD-09032023331050",
    "legacy_record_id": "242345",
    "contact_name": "lekan",
    "contact_email": "anike@halalfoodauthority.com",
    "subject": "add on",
    "message": "nksndks",
    "site_client_code": "10043",
    "site_name": "gjuguih",
    "status": "accepted",
    "created_at": "2023-03-08T23:00:00.000Z",
    "products": [
      {
        "sn": 1,
        "name": "add on",
        "code": "ADD-242345",
        "type": "Add product"
      }
    ]
  },
  {
    "application_number": "ADD-05042023481228",
    "legacy_record_id": "242416",
    "contact_name": "Taoheed Ogundapo",
    "contact_email": "anike@halalfoodauthority.com",
    "subject": "add on",
    "message": "j",
    "site_client_code": "10068",
    "site_name": "Alamu",
    "status": "accepted",
    "created_at": "2023-04-04T23:00:00.000Z",
    "products": [
      {
        "sn": 1,
        "name": "add on",
        "code": "ADD-242416",
        "type": "Add product"
      }
    ]
  },
  {
    "application_number": "ADD-0504202329226",
    "legacy_record_id": "242417",
    "contact_name": "Taoheed Ogundapo",
    "contact_email": "anike@halalfoodauthority.com",
    "subject": "add on",
    "message": "ljsfsdl",
    "site_client_code": "10068",
    "site_name": "Alamu",
    "status": "all_forms_received",
    "created_at": "2023-04-04T23:00:00.000Z",
    "products": [
      {
        "sn": 1,
        "name": "add on",
        "code": "ADD-242417",
        "type": "Add product"
      }
    ]
  },
  {
    "application_number": "ADD-0201202557331",
    "legacy_record_id": "323608",
    "contact_name": "Taoheed",
    "contact_email": "anike@halalfoodauthority.com",
    "subject": "test",
    "message": "test\r\n\r\n\r\n\r\ntest",
    "site_client_code": "10068",
    "site_name": "Alamu",
    "status": "accepted",
    "created_at": "2025-01-01T23:00:00.000Z",
    "products": [
      {
        "sn": 1,
        "name": "test",
        "code": "ADD-323608",
        "type": "Add product"
      }
    ]
  },
  {
    "application_number": "ADD-200220251495",
    "legacy_record_id": "323722",
    "contact_name": "Taoheed",
    "contact_email": "anike@halalfoodauthority.com",
    "subject": "testing",
    "message": "rrrt\r\nrtyry\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\nueryf",
    "site_client_code": "10068",
    "site_name": "Alamu",
    "status": "all_forms_received",
    "created_at": "2025-02-19T23:00:00.000Z",
    "products": [
      {
        "sn": 1,
        "name": "testing",
        "code": "ADD-323722",
        "type": "Add product"
      }
    ]
  },
  {
    "application_number": "ADD-1512202555314",
    "legacy_record_id": "344257",
    "contact_name": "Taoheed Olalekan Ogundapo",
    "contact_email": "anike@halalfoodauthority.com",
    "subject": "test",
    "message": "testing\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\ntesting\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\nsdfsdf\r\n\r\nsdsfdfdfsdf\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\ntesting",
    "site_client_code": "10068",
    "site_name": "Alamu",
    "status": "accepted",
    "created_at": "2025-12-14T23:00:00.000Z",
    "products": [
      {
        "sn": 1,
        "name": "test",
        "code": "ADD-344257",
        "type": "Add product"
      }
    ]
  },
  {
    "application_number": "ADD-1612202547230",
    "legacy_record_id": "344261",
    "contact_name": "Taoheed Ogundapo",
    "contact_email": "anike@halalfoodauthority.com",
    "subject": "test5454",
    "message": "fdfdf\r\nsfsf\r\n\r\n\r\n45454545",
    "site_client_code": "10068",
    "site_name": "Alamu",
    "status": "accepted",
    "created_at": "2025-12-15T23:00:00.000Z",
    "products": [
      {
        "sn": 1,
        "name": "test5454",
        "code": "ADD-344261",
        "type": "Add product"
      }
    ]
  },
  {
    "application_number": "ADD-0503202650128",
    "legacy_record_id": "344438",
    "contact_name": "alamu",
    "contact_email": "anike@halalfoodauthority.com",
    "subject": "testing343",
    "message": "erer\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\ndfdfd",
    "site_client_code": "10068",
    "site_name": "Alamu",
    "status": "submitted",
    "created_at": "2026-03-04T23:00:00.000Z",
    "products": [
      {
        "sn": 1,
        "name": "testing343",
        "code": "ADD-344438",
        "type": "Add product"
      }
    ]
  },
  {
    "application_number": "ADD-15032026521052",
    "legacy_record_id": "374307",
    "contact_name": "tope",
    "contact_email": "anike@halalfoodauthority.com",
    "subject": "test0001",
    "message": "342344sfgsrgffs\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\ndfdfg\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\nihudfhivudvf",
    "site_client_code": "10041",
    "site_name": "Aladoslkaj",
    "status": "accepted",
    "created_at": "2026-03-14T23:00:00.000Z",
    "products": [
      {
        "sn": 1,
        "name": "test0001",
        "code": "ADD-374307",
        "type": "Add product"
      }
    ]
  },
  {
    "application_number": "ADD-170320261540",
    "legacy_record_id": "374316",
    "contact_name": "alamu",
    "contact_email": "anike@halalfoodauthority.com",
    "subject": "testing343dgd",
    "message": "dfdfg",
    "site_client_code": "10041",
    "site_name": "Aladoslkaj",
    "status": "accepted",
    "created_at": "2026-03-16T23:00:00.000Z",
    "products": [
      {
        "sn": 1,
        "name": "testing343dgd",
        "code": "ADD-374316",
        "type": "Add product"
      }
    ]
  },
  {
    "application_number": "ADD-220620268102",
    "legacy_record_id": "374482",
    "contact_name": "Toaheed",
    "contact_email": "anike@halalfoodauthority.com",
    "subject": "Maths",
    "message": "",
    "site_client_code": "10068",
    "site_name": "Alamu",
    "status": "submitted",
    "created_at": "2026-06-21T23:00:00.000Z",
    "products": [
      {
        "sn": 1,
        "name": "Maths",
        "code": "ADD-374482",
        "type": "Add product"
      }
    ]
  }
];

// 5 Export Certificates with full line items from SQL Server (dbo.tlbhecmaster & dbo.tlbSubAccountHEC)
const exportCertsData = [
  {
    "reference_number": "EXP-08122024170808",
    "destination_country": "United Arab Emirates",
    "shipment_date": "2024-12-07T23:00:00.000Z",
    "consignee_name": "Hifza Grcery",
    "consignee_address": "28 woods road",
    "products": "rice chickenq (Code: 0001, Batch: 0044, Cases: 8, Wt: 50kg)",
    "consignment_details": "Facility: 15 Linen House, Flight/Freight: 0990",
    "status": "approved"
  },
  {
    "reference_number": "EXP-16122024210247",
    "destination_country": "United Arab Emirates",
    "shipment_date": "2024-12-15T23:00:00.000Z",
    "consignee_name": "smdns",
    "consignee_address": "sdksd",
    "products": "Order #ksdds - Consignor: alamu",
    "consignment_details": "Facility: kwnefd, Flight/Freight: msdn",
    "status": "approved"
  },
  {
    "reference_number": "EXP-16122024210247-2",
    "destination_country": "United Arab Emirates",
    "shipment_date": "2024-12-15T23:00:00.000Z",
    "consignee_name": "smdns",
    "consignee_address": "sdksd",
    "products": "Order #ksdds - Consignor: alamu",
    "consignment_details": "Facility: kwnefd, Flight/Freight: msdn",
    "status": "approved"
  },
  {
    "reference_number": "EXP-07042025153929",
    "destination_country": "United Arab Emirates",
    "shipment_date": "2025-04-06T23:00:00.000Z",
    "consignee_name": "ABC",
    "consignee_address": "Taoheed",
    "products": "Test (Code: 1234, Batch: 4, Cases: 20, Wt: 4000kg)",
    "consignment_details": "Facility: any, Flight/Freight: 07/04/2025",
    "status": "approved"
  },
  {
    "reference_number": "EXP-07042025154346",
    "destination_country": "United Arab Emirates",
    "shipment_date": "2025-04-06T23:00:00.000Z",
    "consignee_name": "any",
    "consignee_address": "Taoheed",
    "products": "Test (Code: 1234, Batch: 4, Cases: 20, Wt: 4000kg)",
    "consignment_details": "Facility: ddvodofkow, Flight/Freight: 07/04/2025",
    "status": "pending"
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

    // 2. Sites (15 sites)
    console.log(`\n2️⃣ Processing ${siteDefs.length} Sites...`);
    const siteMap = {};
    for (const sDef of siteDefs) {
      let site = await Site.findOne({ client_id: userIdStr, client_code: sDef.client_code });
      if (!site) {
        site = await Site.findOne({ client_id: userIdStr, name: sDef.name });
      }

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
        console.log(`   ℹ️ Updated Site: ${site.name} (Code: ${site.client_code})`);
      }
      siteMap[sDef.client_code] = site;
      siteMap[sDef.name] = site;
    }

    // Fallback site if mapping missing
    const defaultSite = siteMap['10068'] || Object.values(siteMap)[0];

    // 3. Applications (9 original + 2 renewals = 11 applications)
    console.log(`\n3️⃣ Processing Applications (9 original + 2 renewals)...`);
    const appMap = {};
    const allAppsToProcess = [
      ...applicationsData.map(a => ({ ...a, is_renewal: false })),
      ...renewalsData.map(r => ({ ...r, is_renewal: true }))
    ];

    for (const app of allAppsToProcess) {
      const site = siteMap[app.site_client_code] || siteMap[app.site_name] || defaultSite;
      const appDoc = {
        application_number: app.application_number,
        client_id: user._id,
        application_type: app.application_type,
        category: app.category,
        establishment_name: companyName,
        establishment_address: '28 Woods Road, Peckham, London SE15 2SW',
        site_name: site?.name || app.site_name,
        site_id: site ? site._id.toString() : null,
        reg_number: '232',
        vat_number: '2342',
        managing_director: app.managing_director || 'anike lekan',
        employee_count: app.employee_count || 4,
        products: app.products || [],
        status: app.status,
        created_at: app.submission_date || new Date(),
        notes: app.notes || 'Imported from legacy HFA database (CID: 133)',
      };

      const saved = await Application.findOneAndUpdate(
        { application_number: app.application_number },
        { $set: appDoc },
        { upsert: true, new: true }
      );
      appMap[app.application_number] = saved;
      console.log(`   ✅ Saved Application: ${app.application_number} (${app.status}) - Site: ${site?.name}`);
    }

    // 4. Halal Certificates (4 Certificates)
    console.log(`\n4️⃣ Processing ${certificatesData.length} Halal Certificates...`);
    const certMap = {};
    for (const c of certificatesData) {
      const site = siteMap[c.site_client_code] || siteMap[c.site_name] || defaultSite;
      let certificateUrl = null;

      try {
        console.log(`   📄 Generating PDF for Certificate ${c.certificate_number} (${c.certificate_type})...`);
        const pdfBuffer = await generateCertificate({
          businessName: companyName,
          businessAddress: c.company_address,
          manufacturerAddress: c.manufacturing_address,
          certificateNumber: c.certificate_number,
          scopeOfCertification: c.scope,
          scheme: c.certificate_type,
          productCategories: [
            { code: '8987899', name: 'biscui' },
            { code: '898754545', name: 'RICE' }
          ],
          issueDate: new Date(c.issue_date),
          expiryDate: new Date(c.expiry_date),
          cycleStartDate: new Date(c.current_cycle_start_date),
          verificationUrl: `${getClientUrl()}/verify/${encodeURIComponent(c.certificate_number)}`
        });

        const filename = `${c.certificate_number.replace(/[\/\\:]/g, '_')}.pdf`;
        certificateUrl = await uploadToGridFS(pdfBuffer, filename, 'application/pdf');
        console.log(`   ✅ Certificate PDF uploaded to GridFS: ${certificateUrl}`);
      } catch (pdfErr) {
        console.warn(`   ⚠️ Note on PDF generation for ${c.certificate_number}:`, pdfErr.message);
      }

      const existingCert = await Certificate.findOne({ certificate_number: c.certificate_number });
      if (!certificateUrl && existingCert?.certificate_url) {
        certificateUrl = existingCert.certificate_url;
      }

      const certDoc = {
        certificate_number: c.certificate_number,
        client_id: userIdStr,
        application_id: appMap['M2-0429/1900000181009']?._id || appMap['M2-0429/190000076']?._id || null,
        company_name: companyName,
        company_address: c.company_address,
        manufacturing_address: c.manufacturing_address,
        scope: c.scope,
        certificate_type: c.certificate_type,
        issue_date: new Date(c.issue_date),
        expiry_date: new Date(c.expiry_date),
        current_cycle_start_date: new Date(c.current_cycle_start_date),
        status: c.status,
        certificate_url: certificateUrl,
        products_covered: c.products_covered,
        product_details: [
          { name: 'biscui', code: '8987899', category: 'K' },
          { name: 'RICE', code: '898754545', category: 'K' }
        ],
        site_id: site ? site._id : null,
        notes: `Imported from legacy HFA database (CID: 133, Site: ${c.site_name})`
      };

      const savedCert = await Certificate.findOneAndUpdate(
        { certificate_number: c.certificate_number },
        { $set: certDoc },
        { upsert: true, new: true }
      );
      certMap[c.certificate_number] = savedCert;
      console.log(`   ✅ Saved Certificate: ${c.certificate_number} (${c.status}) - Site: ${site?.name}`);
    }

    // 5. Products (4 Products)
    console.log(`\n5️⃣ Processing ${productsData.length} Products...`);
    for (const p of productsData) {
      const site = siteMap[p.site_client_code] || siteMap[p.site_name] || defaultSite;
      const pDoc = {
        client_id: user._id,
        name: p.name,
        code: p.code,
        category: p.category,
        certificate_id: p.certificate_number,
        site_id: site ? site._id : null,
        status: 'active',
        notes: `Imported from legacy HFA database. Product code ${p.code}`
      };

      await Product.findOneAndUpdate(
        { client_id: user._id, name: p.name, code: p.code },
        { $set: pDoc },
        { upsert: true, new: true }
      );
      console.log(`   ✅ Saved Product: ${p.name} (Code: ${p.code}, Site: ${site?.name})`);
    }

    // 6. Add-On Applications (17 Add-Ons)
    console.log(`\n6️⃣ Processing ${addOnsData.length} Add-On Applications...`);
    for (const addOn of addOnsData) {
      const site = siteMap[addOn.site_client_code] || siteMap[addOn.site_name] || defaultSite;
      const primaryCert = certMap['AN-BU/QR251217134523'] || Object.values(certMap)[0];

      const addOnDoc = {
        application_number: addOn.application_number,
        client_id: user._id,
        certificate_id: primaryCert ? primaryCert._id : null,
        site_id: site ? site._id : null,
        contact_name: addOn.contact_name,
        contact_email: addOn.contact_email,
        message: addOn.message || addOn.subject,
        products: addOn.products,
        status: addOn.status,
        created_at: new Date(addOn.created_at)
      };

      await AddOnApplication.findOneAndUpdate(
        { application_number: addOn.application_number },
        { $set: addOnDoc },
        { upsert: true, new: true }
      );
      console.log(`   ✅ Saved Add-On: ${addOn.application_number} (${addOn.status}) - ${addOn.subject}`);
    }

    // 7. Export Certificates (5 Export Certificates)
    console.log(`\n7️⃣ Processing ${exportCertsData.length} Export Certificates...`);
    for (const exp of exportCertsData) {
      const expDoc = {
        client_id: userIdStr,
        reference_number: exp.reference_number,
        destination_country: exp.destination_country,
        shipment_date: new Date(exp.shipment_date),
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

    console.log('\n=============================================================================');
    console.log('🎉 ANIKE INTERNATIONAL (CID: 133) FULL MIGRATION COMPLETED SUCCESSFULLY!');
    console.log('=============================================================================');
    console.log(`👤 Email        : ${email}`);
    console.log(`🔑 Password     : ${plainPassword}`);
    console.log(`🏢 Company      : ${companyName}`);
    console.log(`📍 Sites        : ${siteDefs.length} (Banbury, Alamu, rashidnew, etc.)`);
    console.log(`📝 Applications : ${applicationsData.length + renewalsData.length} (9 New + 2 Renewals)`);
    console.log(`📜 Certificates : ${certificatesData.length} (All 4 schemes & active/expired states)`);
    console.log(`📦 Products     : ${productsData.length}`);
    console.log(`➕ Add-Ons      : ${addOnsData.length} (All 17 product adder requests)`);
    console.log(`🚢 Export Certs : ${exportCertsData.length} (With item lines)`);
    console.log('=============================================================================\n');

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('❌ Seeding failed:', err);
    process.exit(1);
  }
}

seedAnike();
