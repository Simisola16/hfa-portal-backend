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
import AddOnApplication from '../models/AddOnApplication.js';
import { generateCertificate } from '../services/certificateGenerator.js';
import { uploadToGridFS } from '../lib/gridfs.js';
import { getClientUrl } from '../lib/urls.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const companyName = 'McCain Foods';
const email = 'shane.green@mccain.co.uk';
const plainPassword = '';

// 5 Manufacturing Sites from SQL Server (dbo.TlbSie where Kinopm = '185')
const siteDefs = [
  {
    "name": "Whittlesey",
    "client_code": "10009",
    "address_1": "Funthams Lane",
    "address_2": "Whittlesey",
    "city": "Peterborough",
    "state": "Cambridgeshire",
    "postcode": "PE7 2PG",
    "country": "United Kingdom (UK)",
    "est_name": "McCain Foods",
    "trading_name": "McCain Foods Ltd",
    "contact_name": "Shane Green",
    "contact_phone_number": "01723580213",
    "email": "shane.green@mccain.co.uk",
    "cid": "185",
    "status": "active"
  },
  {
    "name": "Scarborough",
    "client_code": "20220",
    "address_1": "Havers Hill",
    "address_2": "",
    "city": "Scarborough",
    "state": "",
    "postcode": "YO11 3BS",
    "country": "United Kingdom (UK)",
    "est_name": "McCain Foods",
    "trading_name": "McCain Foods Ltd",
    "contact_name": "Shane Green",
    "contact_phone_number": "01723580213",
    "email": "shane.green@mccain.co.uk",
    "cid": "185",
    "status": "active"
  },
  {
    "name": "Grantham",
    "client_code": "20221",
    "address_1": "Easton",
    "address_2": "North Yorkshire",
    "city": "Scarborough",
    "state": "",
    "postcode": "NG33 5AY",
    "country": "United Kingdom (UK)",
    "est_name": "McCain Foods",
    "trading_name": "McCain Foods Ltd",
    "contact_name": "Shane Green",
    "contact_phone_number": "01723580213",
    "email": "shane.green@mccain.co.uk",
    "cid": "185",
    "status": "active"
  },
  {
    "name": "Lutosa",
    "client_code": "30378",
    "address_1": "ZI du Vieux Pont 5",
    "address_2": "7900 Leuze-en-Hainaut",
    "city": "Hainuat",
    "state": "Leuze-en-Hainaut",
    "postcode": "YO11 3BS",
    "country": "Belgium",
    "est_name": "McCain Foods",
    "trading_name": "McCain Foods Ltd",
    "contact_name": "Shane Green",
    "contact_phone_number": "01723580213",
    "email": "shane.green@mccain.co.uk",
    "cid": "185",
    "status": "active"
  },
  {
    "name": "Albert Bartlett",
    "client_code": "120752",
    "address_1": "Station Road",
    "address_2": "Warstead",
    "city": "Norfolk",
    "state": "Norfolk",
    "postcode": "NR28 9RX",
    "country": "United Kingdom (UK)",
    "est_name": "McCain Foods",
    "trading_name": "McCain Foods Ltd",
    "contact_name": "Shane Green",
    "contact_phone_number": "01723580213",
    "email": "shane.green@mccain.co.uk",
    "cid": "185",
    "status": "active"
  }
];

// 7 Original New Applications from SQL Server (dbo.AppleReg where CID = '185')
const applicationsData = [
  {
    "application_number": "M2-0429/1900000101",
    "application_type": "New Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "under_review",
    "submission_date": "2020-01-07T00:00:00.000Z",
    "employee_count": 1800,
    "managing_director": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "notes": "Imported new application from legacy HFA database (ID: 102)"
  },
  {
    "application_number": "M2-0429/19000020220",
    "application_type": "New Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "under_review",
    "submission_date": "2020-01-07T00:00:00.000Z",
    "employee_count": 1800,
    "managing_director": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "notes": "Imported new application from legacy HFA database (ID: 247)"
  },
  {
    "application_number": "M2-0429/19000020221",
    "application_type": "New Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "20221",
    "site_name": "Grantham",
    "status": "under_review",
    "submission_date": "2020-01-07T00:00:00.000Z",
    "employee_count": 1800,
    "managing_director": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "notes": "Imported new application from legacy HFA database (ID: 248)"
  },
  {
    "application_number": "M2-0429/19000030371",
    "application_type": "New Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "30371",
    "site_name": "Harnes",
    "status": "under_review",
    "submission_date": "2020-01-07T00:00:00.000Z",
    "employee_count": 1800,
    "managing_director": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "notes": "Imported new application from legacy HFA database (ID: 10381)"
  },
  {
    "application_number": "M2-0429/19000030378",
    "application_type": "New Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "30378",
    "site_name": "Lutosa",
    "status": "under_review",
    "submission_date": "2020-01-07T00:00:00.000Z",
    "employee_count": 1800,
    "managing_director": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "notes": "Imported new application from legacy HFA database (ID: 10383)"
  },
  {
    "application_number": "M2-0429/190000030533",
    "application_type": "New Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "50565",
    "site_name": "Lleystad",
    "status": "certificate_issued",
    "submission_date": "2021-05-23T23:00:00.000Z",
    "employee_count": 1800,
    "managing_director": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "notes": "Imported new application from legacy HFA database (ID: 30534)"
  },
  {
    "application_number": "M2-0429/190000090750",
    "application_type": "New Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "120752",
    "site_name": "Albert Bartlett",
    "status": "certificate_issued",
    "submission_date": "2023-03-09T23:00:00.000Z",
    "employee_count": 440,
    "managing_director": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "notes": "Imported new application from legacy HFA database (ID: 90751)"
  }
];

// 22 Renewal Applications from SQL Server (dbo.REneApp where KingID = '185')
const renewalsData = [
  {
    "application_number": "M2-0429/1900000101-RN40042",
    "original_app_number": "M2-0429/1900000101",
    "application_type": "Renewal Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "certificate_issued",
    "submission_date": "2020-01-19T23:00:00.000Z",
    "managing_director": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "notes": "Renewal application #40042 for original application McCain Foods"
  },
  {
    "application_number": "M2-0429/1900000101-RN40177",
    "original_app_number": "M2-0429/1900000101",
    "application_type": "Renewal Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "certificate_issued",
    "submission_date": "2020-11-10T23:00:00.000Z",
    "managing_director": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "notes": "Renewal application #40177 for original application McCain Foods"
  },
  {
    "application_number": "M2-0429/19000020220-RN40178",
    "original_app_number": "M2-0429/19000020220",
    "application_type": "Renewal Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "certificate_issued",
    "submission_date": "2020-09-10T23:00:00.000Z",
    "managing_director": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "notes": "Renewal application #40178 for original application McCain Foods"
  },
  {
    "application_number": "M2-0429/19000020221-RN40179",
    "original_app_number": "M2-0429/19000020221",
    "application_type": "Renewal Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "20221",
    "site_name": "Grantham",
    "status": "certificate_issued",
    "submission_date": "2020-11-16T23:00:00.000Z",
    "managing_director": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "notes": "Renewal application #40179 for original application McCain Foods"
  },
  {
    "application_number": "M2-0429/19000030371-RN40180",
    "original_app_number": "M2-0429/19000030371",
    "application_type": "Renewal Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "30371",
    "site_name": "Harnes",
    "status": "certificate_issued",
    "submission_date": "2020-12-03T23:00:00.000Z",
    "managing_director": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "notes": "Renewal application #40180 for original application McCain Foods"
  },
  {
    "application_number": "M2-0429/19000030378-RN40188",
    "original_app_number": "M2-0429/19000030378",
    "application_type": "Renewal Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "30378",
    "site_name": "Lutosa",
    "status": "certificate_issued",
    "submission_date": "2020-10-21T23:00:00.000Z",
    "managing_director": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "notes": "Renewal application #40188 for original application McCain Foods"
  },
  {
    "application_number": "M2-0429/1900000101-RN40433",
    "original_app_number": "M2-0429/1900000101",
    "application_type": "Renewal Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "certificate_issued",
    "submission_date": "2021-11-23T23:00:00.000Z",
    "managing_director": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "notes": "Renewal application #40433 for original application McCain Foods"
  },
  {
    "application_number": "M2-0429/19000020220-RN40434",
    "original_app_number": "M2-0429/19000020220",
    "application_type": "Renewal Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "certificate_issued",
    "submission_date": "2021-11-23T23:00:00.000Z",
    "managing_director": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "notes": "Renewal application #40434 for original application McCain Foods"
  },
  {
    "application_number": "M2-0429/19000020221-RN40435",
    "original_app_number": "M2-0429/19000020221",
    "application_type": "Renewal Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "20221",
    "site_name": "Grantham",
    "status": "certificate_issued",
    "submission_date": "2021-12-06T23:00:00.000Z",
    "managing_director": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "notes": "Renewal application #40435 for original application McCain Foods"
  },
  {
    "application_number": "M2-0429/19000030371-RN50478",
    "original_app_number": "M2-0429/19000030371",
    "application_type": "Renewal Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "30371",
    "site_name": "Harnes",
    "status": "certificate_issued",
    "submission_date": "2021-11-30T23:00:00.000Z",
    "managing_director": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "notes": "Renewal application #50478 for original application McCain Foods"
  },
  {
    "application_number": "M2-0429/19000030378-RN50515",
    "original_app_number": "M2-0429/19000030378",
    "application_type": "Renewal Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "30378",
    "site_name": "Lutosa",
    "status": "certificate_issued",
    "submission_date": "2020-01-07T00:00:00.000Z",
    "managing_director": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "notes": "Renewal application #50515 for original application McCain Foods"
  },
  {
    "application_number": "M2-0429/1900000101-RN150691",
    "original_app_number": "M2-0429/1900000101",
    "application_type": "Renewal Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "certificate_issued",
    "submission_date": "2022-11-29T23:00:00.000Z",
    "managing_director": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "notes": "Renewal application #150691 for original application McCain Foods"
  },
  {
    "application_number": "M2-0429/19000020220-RN150692",
    "original_app_number": "M2-0429/19000020220",
    "application_type": "Renewal Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "certificate_issued",
    "submission_date": "2022-11-29T23:00:00.000Z",
    "managing_director": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "notes": "Renewal application #150692 for original application McCain Foods"
  },
  {
    "application_number": "M2-0429/19000020221-RN150693",
    "original_app_number": "M2-0429/19000020221",
    "application_type": "Renewal Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "20221",
    "site_name": "Grantham",
    "status": "certificate_issued",
    "submission_date": "2022-11-28T23:00:00.000Z",
    "managing_director": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "notes": "Renewal application #150693 for original application McCain Foods"
  },
  {
    "application_number": "M2-0429/1900000101-RN200976",
    "original_app_number": "M2-0429/1900000101",
    "application_type": "Renewal Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "certificate_issued",
    "submission_date": "2023-12-11T23:00:00.000Z",
    "managing_director": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "notes": "Renewal application #200976 for original application McCain Foods"
  },
  {
    "application_number": "M2-0429/19000020220-RN200979",
    "original_app_number": "M2-0429/19000020220",
    "application_type": "Renewal Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "certificate_issued",
    "submission_date": "2023-12-08T23:00:00.000Z",
    "managing_director": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "notes": "Renewal application #200979 for original application McCain Foods"
  },
  {
    "application_number": "M2-0429/1900000101-RN231074",
    "original_app_number": "M2-0429/1900000101",
    "application_type": "Renewal Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "under_review",
    "submission_date": "2024-09-01T23:00:00.000Z",
    "managing_director": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "notes": "Renewal application #231074 for original application McCain Foods"
  },
  {
    "application_number": "M2-0429/19000020220-RN231075",
    "original_app_number": "M2-0429/19000020220",
    "application_type": "Renewal Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "under_review",
    "submission_date": "2024-11-24T23:00:00.000Z",
    "managing_director": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "notes": "Renewal application #231075 for original application McCain Foods"
  },
  {
    "application_number": "M2-0429/1900000101-RN231133",
    "original_app_number": "M2-0429/1900000101",
    "application_type": "Renewal Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "certificate_issued",
    "submission_date": "2024-11-20T23:00:00.000Z",
    "managing_director": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "notes": "Renewal application #231133 for original application McCain Foods"
  },
  {
    "application_number": "M2-0429/19000020220-RN231139",
    "original_app_number": "M2-0429/19000020220",
    "application_type": "Renewal Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "certificate_issued",
    "submission_date": "2024-11-24T23:00:00.000Z",
    "managing_director": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "notes": "Renewal application #231139 for original application M2-0429/19000020220"
  },
  {
    "application_number": "M2-0429/19000020220-RN251305",
    "original_app_number": "M2-0429/19000020220",
    "application_type": "Renewal Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "certificate_issued",
    "submission_date": "2025-11-18T23:00:00.000Z",
    "managing_director": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "notes": "Renewal application #251305 for original application M2-0429/19000020220"
  },
  {
    "application_number": "M2-0429/1900000101-RN251309",
    "original_app_number": "M2-0429/1900000101",
    "application_type": "Renewal Application",
    "category": "Annual Certification – Food and General processing",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "certificate_issued",
    "submission_date": "2025-11-22T23:00:00.000Z",
    "managing_director": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "notes": "Renewal application #251309 for original application McCain Foods"
  }
];

// Surveillance Applications (0 for CID 185)
const surveillanceData = [];

// 28 Halal Certificates from SQL Server (dbo.tlbcertMas where CName = '185') with line items
const certificatesData = [
  {
    "certificate_number": "MC-MU/QR231113101947",
    "company_name": "McCain Foods",
    "trading_name": "McCain Foods Ltd",
    "company_address": "Havers Hill, Scarborough, North Yorkshire YO11 3BS, UK",
    "manufacturing_address": "Grantham, Easton NG33 5AY, UK",
    "scope": "Snacks (CIV)",
    "certificate_type": "HFA Scheme",
    "issue_date": "2023-11-12T23:00:00.000Z",
    "expiry_date": "2024-11-29T23:00:00.000Z",
    "current_cycle_start_date": "2023-11-30T23:00:00.000Z",
    "site_client_code": "20221",
    "site_name": "Grantham",
    "status": "active",
    "products_covered": [
      "Certified McCain Potato & Appetizer Products"
    ],
    "product_details": []
  },
  {
    "certificate_number": "LE-MU/QR231206095742",
    "company_name": "McCain Foods",
    "trading_name": "McCain Foods Ltd",
    "company_address": "Havers Hill, Scarborough, North Yorkshire YO11 3BS, UK",
    "manufacturing_address": "Funthams Lane, Whittlesey, Peterborough PE7 2PG, UK",
    "scope": "Snacks (CIV)",
    "certificate_type": "HFA Scheme",
    "issue_date": "2023-12-03T23:00:00.000Z",
    "expiry_date": "2023-12-29T23:00:00.000Z",
    "current_cycle_start_date": "2022-11-30T23:00:00.000Z",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active",
    "products_covered": [
      "Certified McCain Potato & Appetizer Products"
    ],
    "product_details": []
  },
  {
    "certificate_number": "LE-MU/QR231206100638",
    "company_name": "McCain Foods",
    "trading_name": "McCain Foods Ltd",
    "company_address": "Havers Hill, Scarborough, North Yorkshire YO11 3BS, UK",
    "manufacturing_address": "Scarborough Facility, UK",
    "scope": "Snacks (CIV)",
    "certificate_type": "HFA Scheme",
    "issue_date": "2023-12-05T23:00:00.000Z",
    "expiry_date": "2023-12-29T23:00:00.000Z",
    "current_cycle_start_date": "2022-11-30T23:00:00.000Z",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active",
    "products_covered": [
      "Certified McCain Potato & Appetizer Products"
    ],
    "product_details": []
  },
  {
    "certificate_number": "MC-MU/QR231222100430",
    "company_name": "McCain Foods",
    "trading_name": "McCain Foods Ltd",
    "company_address": "Havers Hill, Scarborough, North Yorkshire YO11 3BS, UK",
    "manufacturing_address": "Funthams Lane, Whittlesey, Peterborough PE7 2PG, UK",
    "scope": "Snacks (CIV)",
    "certificate_type": "HFA Scheme",
    "issue_date": "2023-12-21T23:00:00.000Z",
    "expiry_date": "2024-11-29T23:00:00.000Z",
    "current_cycle_start_date": "2023-11-30T23:00:00.000Z",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active",
    "products_covered": [
      "Certified McCain Potato & Appetizer Products"
    ],
    "product_details": []
  },
  {
    "certificate_number": "MC-MU/QR231228062723",
    "company_name": "McCain Foods",
    "trading_name": "McCain Foods Ltd",
    "company_address": "Havers Hill, Scarborough, North Yorkshire YO11 3BS, UK",
    "manufacturing_address": "Scarborough Facility, UK",
    "scope": "Snacks (CIV)",
    "certificate_type": "HFA Scheme",
    "issue_date": "2023-12-27T23:00:00.000Z",
    "expiry_date": "2024-11-29T23:00:00.000Z",
    "current_cycle_start_date": "2023-11-30T23:00:00.000Z",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active",
    "products_covered": [
      "Certified McCain Potato & Appetizer Products"
    ],
    "product_details": []
  },
  {
    "certificate_number": "MC-MU/QR240502120741",
    "company_name": "McCain Foods",
    "trading_name": "McCain Foods Ltd",
    "company_address": "Havers Hill, Scarborough, North Yorkshire YO11 3BS, UK",
    "manufacturing_address": "Funthams Lane, Whittlesey, Peterborough PE7 2PG, UK",
    "scope": "Snacks (CIV)",
    "certificate_type": "HFA Scheme",
    "issue_date": "2024-05-01T23:00:00.000Z",
    "expiry_date": "2024-11-29T23:00:00.000Z",
    "current_cycle_start_date": "2023-11-30T23:00:00.000Z",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active",
    "products_covered": [
      "Certified McCain Potato & Appetizer Products"
    ],
    "product_details": []
  },
  {
    "certificate_number": "MC-MU/QR241123115833",
    "company_name": "McCain Foods",
    "trading_name": "McCain Foods Ltd",
    "company_address": "Havers Hill, Scarborough, North Yorkshire YO11 3BS, UK",
    "manufacturing_address": "Funthams Lane, Whittlesey, Peterborough PE7 2PG, UK",
    "scope": "Snacks (CIV)",
    "certificate_type": "HFA Scheme",
    "issue_date": "2024-11-22T23:00:00.000Z",
    "expiry_date": "2025-11-29T23:00:00.000Z",
    "current_cycle_start_date": "2024-11-30T23:00:00.000Z",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active",
    "products_covered": [
      "Certified McCain Potato & Appetizer Products"
    ],
    "product_details": []
  },
  {
    "certificate_number": "MC-MU/QR241205094133",
    "company_name": "McCain Foods",
    "trading_name": "McCain Foods Ltd",
    "company_address": "Havers Hill, Scarborough, North Yorkshire YO11 3BS, UK",
    "manufacturing_address": "Funthams Lane, Whittlesey, Peterborough PE7 2PG, UK",
    "scope": "Snacks (CIV)",
    "certificate_type": "HFA Scheme",
    "issue_date": "2024-12-04T23:00:00.000Z",
    "expiry_date": "2025-11-29T23:00:00.000Z",
    "current_cycle_start_date": "2024-11-30T23:00:00.000Z",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active",
    "products_covered": [
      "Certified McCain Potato & Appetizer Products"
    ],
    "product_details": []
  },
  {
    "certificate_number": "LE-BU/QR241212104323",
    "company_name": "McCain Foods",
    "trading_name": "McCain Foods Ltd",
    "company_address": "Havers Hill, Scarborough, North Yorkshire YO11 3BS, UK",
    "manufacturing_address": "Scarborough Facility, UK",
    "scope": "Snacks (CIV)",
    "certificate_type": "HFA Scheme",
    "issue_date": "2024-11-30T23:00:00.000Z",
    "expiry_date": "2025-11-28T23:00:00.000Z",
    "current_cycle_start_date": "2023-11-30T23:00:00.000Z",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "expired",
    "products_covered": [
      "Certified McCain Potato & Appetizer Products"
    ],
    "product_details": []
  },
  {
    "certificate_number": "LE-BU/QR241212112229",
    "company_name": "McCain Foods",
    "trading_name": "McCain Foods Ltd",
    "company_address": "Havers Hill, Scarborough, North Yorkshire YO11 3BS, UK",
    "manufacturing_address": "Scarborough Facility, UK",
    "scope": "Snacks (CIV)",
    "certificate_type": "HFA Scheme",
    "issue_date": "2024-11-30T23:00:00.000Z",
    "expiry_date": "2025-11-28T23:00:00.000Z",
    "current_cycle_start_date": "2023-11-30T23:00:00.000Z",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active",
    "products_covered": [
      "Certified McCain Potato & Appetizer Products"
    ],
    "product_details": []
  },
  {
    "certificate_number": "MC-SA/QR250226164209",
    "company_name": "McCain Foods",
    "trading_name": "McCain Foods Ltd",
    "company_address": "Havers Hill, Scarborough, North Yorkshire, YO11 3BS, UK",
    "manufacturing_address": "Funthams Lane, Whittlesey, Peterborough, PE7 2PG, UK",
    "scope": "Snacks (CIV)",
    "certificate_type": "HFA Scheme",
    "issue_date": "2025-02-25T23:00:00.000Z",
    "expiry_date": "2025-11-29T23:00:00.000Z",
    "current_cycle_start_date": "2024-11-30T23:00:00.000Z",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active",
    "products_covered": [
      "Certified McCain Potato & Appetizer Products"
    ],
    "product_details": []
  },
  {
    "certificate_number": "MC-SA/QR250227110722",
    "company_name": "McCain Foods",
    "trading_name": "McCain Foods Ltd",
    "company_address": "Havers Hill, Scarborough, North Yorkshire, YO11 3BS, UK",
    "manufacturing_address": "Same as above",
    "scope": "Snacks (CIV)",
    "certificate_type": "HFA Scheme",
    "issue_date": "2025-02-26T23:00:00.000Z",
    "expiry_date": "2025-11-28T23:00:00.000Z",
    "current_cycle_start_date": "2023-11-30T23:00:00.000Z",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active",
    "products_covered": [
      "Certified McCain Potato & Appetizer Products"
    ],
    "product_details": []
  },
  {
    "certificate_number": "MC-SA/QR250617155753",
    "company_name": "McCain Foods",
    "trading_name": "McCain Foods Ltd",
    "company_address": "Havers Hill, Scarborough, North Yorkshire, YO11 3BS, UK",
    "manufacturing_address": "Funthams Lane, Whittlesey, Peterborough, PE7 2PG, UK",
    "scope": "Snacks (CIV)",
    "certificate_type": "HFA Scheme",
    "issue_date": "2025-06-16T23:00:00.000Z",
    "expiry_date": "2025-11-29T23:00:00.000Z",
    "current_cycle_start_date": "2024-11-30T23:00:00.000Z",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "expired",
    "products_covered": [
      "Certified McCain Potato & Appetizer Products"
    ],
    "product_details": []
  },
  {
    "certificate_number": "MC-SA/QR250617161029",
    "company_name": "McCain Foods",
    "trading_name": "McCain Foods Ltd",
    "company_address": "Havers Hill, Scarborough, North Yorkshire, YO11 3BS, UK",
    "manufacturing_address": "Funthams Lane, Whittlesey, Peterborough, PE7 2PG, UK",
    "scope": "Snacks (CIV)",
    "certificate_type": "HFA Scheme",
    "issue_date": "2025-06-16T23:00:00.000Z",
    "expiry_date": "2025-11-29T23:00:00.000Z",
    "current_cycle_start_date": "2024-11-30T23:00:00.000Z",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active",
    "products_covered": [
      "Certified McCain Potato & Appetizer Products"
    ],
    "product_details": []
  },
  {
    "certificate_number": "MC-SA/QR250617162228",
    "company_name": "McCain Foods",
    "trading_name": "McCain Foods Ltd",
    "company_address": "Havers Hill, Scarborough, North Yorkshire, YO11 3BS, UK",
    "manufacturing_address": "Scarborough Facility, UK",
    "scope": "Snacks (CIV)",
    "certificate_type": "HFA Scheme",
    "issue_date": "2025-06-16T23:00:00.000Z",
    "expiry_date": "2025-11-28T23:00:00.000Z",
    "current_cycle_start_date": "2023-11-30T23:00:00.000Z",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active",
    "products_covered": [
      "Certified McCain Potato & Appetizer Products"
    ],
    "product_details": []
  },
  {
    "certificate_number": "MC-KH/QR250901130307",
    "company_name": "McCain Foods",
    "trading_name": "McCain Foods Ltd",
    "company_address": "Havers Hill, Scarborough, North Yorkshire, YO11 3BS, UK",
    "manufacturing_address": "Same as above",
    "scope": "Frozen Potato & Food Products",
    "certificate_type": "HFA Scheme",
    "issue_date": "2025-08-31T23:00:00.000Z",
    "expiry_date": "2025-11-29T23:00:00.000Z",
    "current_cycle_start_date": "2024-11-30T23:00:00.000Z",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "expired",
    "products_covered": [
      "Certified McCain Potato & Appetizer Products"
    ],
    "product_details": []
  },
  {
    "certificate_number": "MC-KH/QR250901132218",
    "company_name": "McCain Foods",
    "trading_name": "McCain Foods Ltd",
    "company_address": "Havers Hill, Scarborough, North Yorkshire, YO11 3BS, UK",
    "manufacturing_address": "Same as above",
    "scope": "Snacks (CIV)",
    "certificate_type": "HFA Scheme",
    "issue_date": "2025-08-31T23:00:00.000Z",
    "expiry_date": "2025-11-29T23:00:00.000Z",
    "current_cycle_start_date": "2024-11-30T23:00:00.000Z",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "expired",
    "products_covered": [
      "Certified McCain Potato & Appetizer Products"
    ],
    "product_details": []
  },
  {
    "certificate_number": "MC-KH/QR250901140954",
    "company_name": "McCain Foods",
    "trading_name": "McCain Foods Ltd",
    "company_address": "Havers Hill, Scarborough, North Yorkshire, YO11 3BS, UK",
    "manufacturing_address": "Scarborough Facility, UK",
    "scope": "Snacks (CIV)",
    "certificate_type": "HFA Scheme",
    "issue_date": "2025-08-31T23:00:00.000Z",
    "expiry_date": "2025-11-29T23:00:00.000Z",
    "current_cycle_start_date": "2024-11-30T23:00:00.000Z",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active",
    "products_covered": [
      "Certified McCain Potato & Appetizer Products"
    ],
    "product_details": []
  },
  {
    "certificate_number": "MC-KH/QR251114130915",
    "company_name": "McCain Foods",
    "trading_name": "McCain Foods Ltd",
    "company_address": "Havers Hill, Scarborough, North Yorkshire YO11 3BS, UK",
    "manufacturing_address": "Funthams Lane, Whittlesey, Peterborough PE7 2PG, UK",
    "scope": "Snacks (CIV)",
    "certificate_type": "HFA Scheme",
    "issue_date": "2025-11-13T23:00:00.000Z",
    "expiry_date": "2025-11-29T23:00:00.000Z",
    "current_cycle_start_date": "2025-11-13T23:00:00.000Z",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "expired",
    "products_covered": [
      "Certified McCain Potato & Appetizer Products"
    ],
    "product_details": []
  },
  {
    "certificate_number": "MC-KH/QR251114145515",
    "company_name": "McCain Foods",
    "trading_name": "McCain Foods Ltd",
    "company_address": "Havers Hill, Scarborough, North Yorkshire YO11 3BS, UK",
    "manufacturing_address": "Funthams Lane, Whittlesey, Peterborough PE7 2PG, UK",
    "scope": "Snacks (CIV)",
    "certificate_type": "HFA Scheme",
    "issue_date": "2025-11-13T23:00:00.000Z",
    "expiry_date": "2025-11-29T23:00:00.000Z",
    "current_cycle_start_date": "2024-11-30T23:00:00.000Z",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active",
    "products_covered": [
      "Certified McCain Potato & Appetizer Products"
    ],
    "product_details": []
  },
  {
    "certificate_number": "MC-KH/QR251121113344",
    "company_name": "McCain Foods",
    "trading_name": "McCain Foods Ltd",
    "company_address": "Havers Hill, Scarborough, North Yorkshire, YO11 3BS, UK",
    "manufacturing_address": "Scarborough Facility, UK",
    "scope": "Snacks (CIV)",
    "certificate_type": "HFA Scheme",
    "issue_date": "2025-11-20T23:00:00.000Z",
    "expiry_date": "2026-11-29T23:00:00.000Z",
    "current_cycle_start_date": "2025-11-30T23:00:00.000Z",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active",
    "products_covered": [
      "Certified McCain Potato & Appetizer Products"
    ],
    "product_details": []
  },
  {
    "certificate_number": "MC-KH/QR251126132125",
    "company_name": "McCain Foods",
    "trading_name": "McCain Foods Ltd",
    "company_address": "Havers Hill, Scarborough, North Yorkshire, YO11 3BS, UK",
    "manufacturing_address": "Funthams Lane, Whittlesey, Peterborough  PE7 2PG, UK",
    "scope": "Snacks (CIV)",
    "certificate_type": "HFA Scheme",
    "issue_date": "2025-11-25T23:00:00.000Z",
    "expiry_date": "2026-11-29T23:00:00.000Z",
    "current_cycle_start_date": "2025-11-30T23:00:00.000Z",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active",
    "products_covered": [
      "McCain Original Choice Thick Cut",
      "McCain Original Choice Thick Cut"
    ],
    "product_details": [
      {
        "name": "McCain Original Choice Thick Cut",
        "code": "45110",
        "size": ""
      },
      {
        "name": "McCain Original Choice Thick Cut",
        "code": "45056",
        "size": ""
      }
    ]
  },
  {
    "certificate_number": "MC-KH/QR260514134400",
    "company_name": "McCain Foods",
    "trading_name": "McCain Foods Ltd",
    "company_address": "Havers Hill, Scarborough, North Yorkshire YO11 3BS, UK",
    "manufacturing_address": "Funthams Lane, Whittlesey, Peterborough PE7 2PG, UK",
    "scope": "Snacks (CIV)",
    "certificate_type": "HFA Scheme",
    "issue_date": "2026-05-13T23:00:00.000Z",
    "expiry_date": "2026-11-29T23:00:00.000Z",
    "current_cycle_start_date": "2025-11-30T23:00:00.000Z",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active",
    "products_covered": [
      "Certified McCain Potato & Appetizer Products"
    ],
    "product_details": []
  },
  {
    "certificate_number": "MC-KH/QR260603112621",
    "company_name": "McCain Foods",
    "trading_name": "McCain Foods Ltd",
    "company_address": "Havers Hill, Scarborough, North Yorkshire YO11 3BS, UK",
    "manufacturing_address": "Funthams Lane, Whittlesey, Peterborough PE7 2PG, UK",
    "scope": "Snacks (CIV)",
    "certificate_type": "HFA Scheme",
    "issue_date": "2026-06-02T23:00:00.000Z",
    "expiry_date": "2026-11-29T23:00:00.000Z",
    "current_cycle_start_date": "2025-11-30T23:00:00.000Z",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active",
    "products_covered": [
      "Certified McCain Potato & Appetizer Products"
    ],
    "product_details": []
  },
  {
    "certificate_number": "MC-KH/QR260603114136",
    "company_name": "McCain Foods",
    "trading_name": "McCain Foods Ltd",
    "company_address": "Havers Hill, Scarborough, North Yorkshire, YO11 3BS, UK",
    "manufacturing_address": "Scarborough Facility, UK",
    "scope": "Snacks (CIV)",
    "certificate_type": "HFA Scheme",
    "issue_date": "2026-06-02T23:00:00.000Z",
    "expiry_date": "2026-11-29T23:00:00.000Z",
    "current_cycle_start_date": "2025-11-30T23:00:00.000Z",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active",
    "products_covered": [
      "Certified McCain Potato & Appetizer Products"
    ],
    "product_details": []
  },
  {
    "certificate_number": "MC-KH/QR260727124408",
    "company_name": "McCain Foods",
    "trading_name": "McCain Foods Ltd",
    "company_address": "Havers Hill, Scarborough, North Yorkshire, YO11 3BS, UK",
    "manufacturing_address": "Scarborough Facility, UK",
    "scope": "Snacks (CIV)",
    "certificate_type": "HFA Scheme",
    "issue_date": "2026-07-26T23:00:00.000Z",
    "expiry_date": "2026-11-29T23:00:00.000Z",
    "current_cycle_start_date": "2025-11-30T23:00:00.000Z",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active",
    "products_covered": [
      "Certified McCain Potato & Appetizer Products"
    ],
    "product_details": []
  },
  {
    "certificate_number": "MC-KH/QR260727125850",
    "company_name": "McCain Foods",
    "trading_name": "McCain Foods Ltd",
    "company_address": "Havers Hill, Scarborough, North Yorkshire YO11 3BS, UK",
    "manufacturing_address": "Funthams Lane, Whittlesey, Peterborough PE7 2PG, UK",
    "scope": "Snacks (CIV)",
    "certificate_type": "HFA Scheme",
    "issue_date": "2026-07-26T23:00:00.000Z",
    "expiry_date": "2026-11-29T23:00:00.000Z",
    "current_cycle_start_date": "2025-11-30T23:00:00.000Z",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active",
    "products_covered": [
      "Certified McCain Potato & Appetizer Products"
    ],
    "product_details": []
  },
  {
    "certificate_number": "MC-KH/QR260812130347",
    "company_name": "McCain Foods",
    "trading_name": "McCain Foods Ltd",
    "company_address": "Havers Hill, Scarborough, North Yorkshire YO11 3BS, UK",
    "manufacturing_address": "Funthams Lane, Whittlesey, Peterborough PE7 2PG, UK",
    "scope": "Snacks (CIV)",
    "certificate_type": "HFA Scheme",
    "issue_date": "2026-08-11T23:00:00.000Z",
    "expiry_date": "2026-11-29T23:00:00.000Z",
    "current_cycle_start_date": "2025-11-30T23:00:00.000Z",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active",
    "products_covered": [
      "Certified McCain Potato & Appetizer Products"
    ],
    "product_details": []
  }
];

// 225 Products from SQL Server (dbo.Prolister where AppComp = '185')
const productsData = [
  {
    "name": "Macfries",
    "code": "49010, 49011, 49012, 49013",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Julienne",
    "code": "41103",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Fast Food Originals Julienne",
    "code": "1000000254",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Fast Food Originals Thin Fries",
    "code": "1000008147, 41346",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Fast Food Originals Medium Fries",
    "code": "1000008156, 41347",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Fast Food Prime Staycrisp Thin",
    "code": "41345",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Our Menu Signatures Staycrisp",
    "code": "41130",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Quick Cook French Fries",
    "code": "1000000816, 1000006172, 1000006937",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Roasted Garlic Wedges",
    "code": "1000001143, 1000008788, 1000010063",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Our Menu Signatures Southern Fried Wedges",
    "code": "47650, 1000008163",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Home Chips S/C",
    "code": "1000008667, 1000008670, 1000008671, 1000008975, 1000005580, 1000005653, 1000006940, 1000006942, 1000006960, 1000008689, 1000009415, 1000009897, 1000010785, 1000010808, 1000011401 1000010055, 1000008036, 1000010690",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Our Menu Signature Traditional GF",
    "code": "1000004194, 1000002008",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Skin on Fries (Retail)",
    "code": "1000005102, 1000005102, 1000005907, 1000009403, 1000009414",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Our Menu Signatures Staycrisp Medium Skin-on Fries",
    "code": "1000006164",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Home Chips C/C",
    "code": "1000008686, 1000008672, 1000006963, 1000008681, 1000009895, 1000010654",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Home Chips Chunky",
    "code": "47785, 45539, 1000006845, 1000006956, 1000009877",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Potato Flake",
    "code": "64518, 64521, 64522, 64523, 64541, 64544, 64565, 1000000487",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Naked Skin on Chunky Chips",
    "code": "1000009038",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Crispy French Fries",
    "code": "1000006924, 47801, 49302, 1000006924, 1000001519, 1000007058, 1000008973, 1000009426, 1000009896, 1000011402",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Southern Fries",
    "code": "1000006185, 1000004193",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Chippy Chips (Retail)",
    "code": "42201, 42204, 1000008833, 1000000655, 1000005726",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain French Fries for Frying",
    "code": "41272, 1000000318, 1000000654, 1000005731, 1000009190",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Our Menu Signature Skin on Fries",
    "code": "1000004748",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Home Chips S/C Gluten Free",
    "code": "1000004803, 1000008688",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Our Menu Signature Staycrisp Julienne Skin on Fries",
    "code": "1000006163",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Quick Chips C/C",
    "code": "1000004296, 1000007993",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Quick Chips S/C",
    "code": "1000004269, 1000004277, 1000004280, 1000004282, 1000003916, 1000008847, 1000008974, 1000011232",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Lightly Spiced Wedges",
    "code": "1000008715, 47895, 1000000215, 1000006936, 1000000650, 1000003001, 1000009416, 1000010064",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "Nando 7/16",
    "code": "1000000671",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Peri Peri Fries",
    "code": "1000002360, 1000005045, 1000005919, 1000009042",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Our Fast Food Prime Staycrisp 6mm",
    "code": "1000004210",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Menu Signatures Staycrisp Gourmet GF",
    "code": "1000004249, 1000005809",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Our Menu Signature Staycrisp Thin Fries",
    "code": "1000004749",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Smoky Paprika Ridge Wedges",
    "code": "1000004584",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Sweet Potato Wedges",
    "code": "1000006747",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Our Menu Signatures Sweet Potato Rustics",
    "code": "1000006819, 1000008164",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "KFC 11 x 11 Skin on Fries",
    "code": "1000007139",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Our Chef Solutions Slices",
    "code": "44661",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Jacket Wedges (Retail)",
    "code": "1000008793, 1000007437",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Surecrisp Julienne",
    "code": "1000007650",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Surecrisp Thin Fries",
    "code": "1000007651, 1000009204, 1000010622, 1000010637, 1000011661",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Surecrisp Traditional Thick Cut",
    "code": "1000007852",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Home Chips Light (Retail)",
    "code": "1000009425, 1000007525, 1000008685, 1000008684, 1000010708",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Surecrisp Skin on chips Thin Cut",
    "code": "1000007853",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Surecrisp Skin on Chips Medium Cut",
    "code": "1000007854",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Surecrisp Skin on Julienne",
    "code": "1000007855",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Surecrisp Skin off Fries Thin Cut",
    "code": "1000007856",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Surecrisp Gourmet Chunky Cut",
    "code": "1000007857",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain CD Southern Fried Wedges",
    "code": "1000007918",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain CD Surecrisp Thin Skin on",
    "code": "1000008083",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain CD Surecrisp Thin",
    "code": "1000008082",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Surecrisp Traditional Gold",
    "code": "1000008220",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Naked Oven Chips C/C",
    "code": "1000008566, 1000001672, 1000008610, 39310, 1000000804 1000006869",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Naked Oven Chips S/C",
    "code": "1000008567, 1000009420, 1000008568, 1000008841, 49321, 1000001675, 1000002311, 1000005727, 1000008623, 39309, 67774, 49322, 49325, 1000011398 1000000350, 1000000669, 1000001526, 1000003003, 1000005725, 1000006868, 1000014419",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "JJ Fast Food Julienne",
    "code": "1000008895",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Fast Food Fries",
    "code": "1000008881",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Super Value American Fries",
    "code": "1000008882",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Crispers",
    "code": "1000006691",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "MCCain Menu Signature Wedges",
    "code": "1000008557",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "Brakes Thick Cut 9/16",
    "code": "1000009226",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Firecracker Wedges (Retail)",
    "code": "1000009058",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Flavour Maker Fries Smokey BBQ",
    "code": "1000009343",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Flavour Maker Fries Deep Ridge Spicy Chipotle Chips",
    "code": "1000009345",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Flavour Maker Fries Garlic & Herb Chimichurri",
    "code": "1000009344",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Signature Traditional",
    "code": "1000000050",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "Brakes Medium Cut",
    "code": "1000009205",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Favourite Fried Chicken Supercrisp Thin Cut",
    "code": "1000009594",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Our Chef Solutions Simply Wedges",
    "code": "44662",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Our Chef Solutions Simply Mash",
    "code": "1000000202",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Our Chef Solutions Simply Roasts",
    "code": "44663",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Our Menu Signature Roasts",
    "code": "1000000537",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "MacFries",
    "code": "1000007920, 1000007921, 1000010754",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Surecrisp Gourmet Chips CD",
    "code": "1000010121",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "Home Chips S/C",
    "code": "1000010462, 1000010467",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "Flavour Maker Takeaway Style Salt and Pepper Fries",
    "code": "1000010489",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Chef Solutions Oven Chips",
    "code": "41088",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Original Choice Medium Cut",
    "code": "45108",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Original Choice Thick Cut",
    "code": "45110",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Original Choice Thick Cut",
    "code": "45056",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Original Choice Roasts",
    "code": "1000008165",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Original Choice Thin Cut",
    "code": "45106",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Original Choice Chippy Chips",
    "code": "1000000041",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Original Choice Steak Cut Chip",
    "code": "45101",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Original Choice Saute",
    "code": "44731",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Fast Food Originals 15/32 Medium Fries",
    "code": "1000011195",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Our Chef Solutions Simply Skin on Wedges",
    "code": "1000011437",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Season & Bake Takeaway Salt And Pepper Fries",
    "code": "1000011659",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Season & Bake Smokeshack BBQ Fries",
    "code": "1000011658",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Season & Bake Chicken Salt",
    "code": "1000011612",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain SureCrisp Impingement Fries",
    "code": "1000007854",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "Home Chips 1.3kg",
    "code": "1000011841",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "Popeye Cajun Fries",
    "code": "1000011921",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "Macfries",
    "code": "49010, 49011, 49012, 49013",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Julienne",
    "code": "41103",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Fast Food Originals Julienne",
    "code": "1000000254",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Fast Food Originals Thin Fries",
    "code": "1000008147, 41346",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Fast Food Originals Medium Fries",
    "code": "1000008156, 41347",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Fast Food Prime Staycrisp Thin",
    "code": "41345",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Our Menu Signatures Staycrisp",
    "code": "41130",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Quick Cook French Fries",
    "code": "1000000816, 1000006172, 1000006937",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Roasted Garlic Wedges",
    "code": "1000001143, 1000008788, 1000010063",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Our Menu Signatures Southern Fried Wedges",
    "code": "47650, 1000008163",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Home Chips S/C",
    "code": "1000008667, 1000008670, 1000008671, 1000008975, 1000005580, 1000005653, 1000006940, 1000006942, 1000006960, 1000008689, 1000009897, 1000010055, 1000008036, 1000010690, 1000010785, 1000010808 , 1000011401",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Our Fast Food Prime Staycrisp 6mm",
    "code": "1000004210",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Quick Chips S/C",
    "code": "1000004269, 1000004277, 1000004280, 1000004282, 1000003916, 1000008847, 1000008974, 1000011232",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Our Menu Signature Skin on Fries",
    "code": "1000004748",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Potato Flake",
    "code": "64518, 64521, 64522, 64523, 64541, 64544, 64565, 1000000487",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Smoky Paprika Wedges",
    "code": "1000004584",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Home Chips Chunky",
    "code": "47785, 45539, 1000006845, 1000006956, 1000009877",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Naked Skin on Chunky Chips",
    "code": "1000009038",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Crispy French Fries",
    "code": "1000006924, 47801, 49302, 1000006924, 1000001519, 1000007058, 1000008973, 1000009426 1000009896, 1000011402",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Southern Fries",
    "code": "1000006185, 1000004193",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain French Fries for Frying",
    "code": "41272, 1000000318, 1000000654, 1000005731, 1000009190",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Quick Chips C/C",
    "code": "1000004296, 1000007993",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "Menu Signature Staycrisp Traditional GF",
    "code": "1000004194, 1000002008",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Skin on Fries (Retail)",
    "code": "1000005102, 1000005102, 1000005907, 1000009403, 1000009414",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Our Menu Staycrisp Medium Skin-on Fries",
    "code": "1000006164",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Lightly Spiced Wedges",
    "code": "1000008715, 47895, 1000000215, 1000006936, 1000000650, 1000003001, 1000009416, 1000010064",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Chippy Chips (Retail)",
    "code": "42201, 42204, 1000008833, 1000000655, 1000005726",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Our Chef Solutions Signature Jackets",
    "code": "1000001176",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Menu Signture Staycrisp Gourmet GF",
    "code": "1000004249, 1000005809",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "Nando’s 7/16",
    "code": "1000000671",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Peri Peri Fries",
    "code": "1000002360, 1000005045, 1000005919, 1000009042",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Our Menu Signature Staycrisp Thin Fries",
    "code": "1000004749",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Sweet Potato Fries (Retail)",
    "code": "1000002857",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain CD Coated Thin Cut",
    "code": "1000004948",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Home Chips C/C",
    "code": "1000008686, 1000008672, 1000006963, 1000008681, 1000009895, 1000010654",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Home Chips S/C Gluten Free",
    "code": "1000004803, 1000008688",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Our Menu Signatures Staycrisp Julienne Skin-on Fries",
    "code": "1000006163",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Sweet Potato Wedges",
    "code": "1000006747",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Our Menu Signatures Sweet Potato Rustics",
    "code": "1000006819",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "KFC 11 x 11 Skin on Fries",
    "code": "1000007139",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Home Chips Lighter (Retail)",
    "code": "1000009425, 1000007525, 1000008685, 1000008684, 1000010708",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Jacket Wedges (Retail)",
    "code": "1000008793, 1000007437",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Surecrisp Julienne",
    "code": "1000007650",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Surecrisp Thin Fries",
    "code": "1000007651, 1000009204, 1000010622, 1000010637, 1000011661",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Surecrisp Traditional Thick Cut",
    "code": "1000007852",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Surecrisp Skin on Chips Thin Cut",
    "code": "1000007853",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Surecrisp Skin on Chips Medium Cut",
    "code": "1000007854",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Surecrisp Skin on Julienne",
    "code": "1000007855",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Surecrisp Skin off Fries Thin Cut",
    "code": "1000007856",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Surecrisp Gourmet Chunky Cut",
    "code": "1000007857",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain CD Southern Fried Wedges",
    "code": "1000007918",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain CD Surecrisp Thin Skin on",
    "code": "1000008083, 1000009550",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain CD Surecrisp Thin",
    "code": "1000008082",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Surecrisp Traditional Gold",
    "code": "1000008220",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Naked Oven Chips C/C",
    "code": "1000008566, 1000001672, 1000008610, 39310, 1000000804, 1000006869",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Naked Oven Chips S/C",
    "code": "1000008567, 1000009420, 1000008568, 1000008841, 49321, 1000001675, 1000002311, 1000005727, 1000008623, 39309, 67774, 49322, 49325, 1000011398, 1000000350, 1000000669, 1000001526, 1000003003, 1000005725, 1000006868, 1000014419",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "JJ Fast Food Julienne Chips",
    "code": "1000008895",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "Fast Food Fries",
    "code": "1000008881",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "Super Value American Fries",
    "code": "1000008882",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "Crispers",
    "code": "1000006691, 1000008219",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Menu Signature Wedges",
    "code": "1000008557",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Firecracker Wedges",
    "code": "1000009058",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Flavour Maker Fries Smokey BBQ",
    "code": "1000009343",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Flavour Maker Fries Deep Ridge Spicy Chipotle Chips",
    "code": "1000009345",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Signature Traditional",
    "code": "1000000050",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "Brakes Medium Cut",
    "code": "1000009205",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "Brakes Thick Cut 9/16",
    "code": "1000009226",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Favourite Fried Chicken Supercrisp Thin Cut",
    "code": "1000009594",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Our Chef Solutions Simply Dice",
    "code": "44660",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Our Chef Solutions Simply Wedges",
    "code": "44662",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Our Chef Solutions Simply Mash",
    "code": "1000000202",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Our Chef Solutions Simply Roasts",
    "code": "44663",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Our Menu Signature Roasts",
    "code": "1000000537",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "MacFries",
    "code": "1000007920, 1000007921, 1000010754",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Jacket Potatoes",
    "code": "47300, 1000009314, 1000008972, 1000008028, 1000001899, 47301, 1000010056, 1000010639, 1000011400",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Surecrisp Gourmet Chips CD",
    "code": "1000010121",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "Home Chips S/C",
    "code": "1000010462, 1000010467",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "Flavour Maker Takeaway Style Salt and Pepper Fries",
    "code": "1000010489",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Chef Solutions Oven Chips",
    "code": "41088",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Original Choice Medium Cut",
    "code": "45108",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Original Choice Thick Cut",
    "code": "45110",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Original Choice Thick Cut",
    "code": "45056",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Original Choice Roasts",
    "code": "1000008165",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Original Choice Thin Cut",
    "code": "45106",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Original Choice Chippy Chips",
    "code": "1000000041",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Original Choice Steak Cut Chip",
    "code": "45101",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Original Choice Saute",
    "code": "44731",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Fast Food Originals 15/32 Medium Fries",
    "code": "1000011195",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Our Chef Solutions Simply Skin on Wedges",
    "code": "1000011437",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Baby Hasselbacks",
    "code": "1000011426",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Season & Bake Takeaway Salt And Pepper Fries",
    "code": "1000011659",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Season & Bake SmokeShack BBQ Fries",
    "code": "1000011658",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Season & Bake Chicken Salt",
    "code": "1000011612",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain SureCrisp Impingement Fries",
    "code": "1000007854",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "Home Chips 1.3kg",
    "code": "1000011841",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "Jacket Potatoes 1.2kg",
    "code": "1000011848",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "Popeye Cajun Fries",
    "code": "1000011921",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "Fries to Go",
    "code": "48430, 48431, 148101, 1000000146, 1000009946",
    "category": "CIV",
    "site_client_code": "20221",
    "site_name": "Grantham",
    "status": "active"
  },
  {
    "name": "McCain Hash Browns (Retail)",
    "code": "1000008366, 1000008840, 1000010445",
    "category": "CIV",
    "site_client_code": "30378",
    "site_name": "Lutosa",
    "status": "active"
  },
  {
    "name": "McCain Hash Browns (Foodservice)",
    "code": "1000008687",
    "category": "CIV",
    "site_client_code": "30378",
    "site_name": "Lutosa",
    "status": "active"
  },
  {
    "name": "McCain Surecrisp Thin cut Fries",
    "code": "1000007651",
    "category": "CIV",
    "site_client_code": "120752",
    "site_name": "Albert Bartlett",
    "status": "active"
  },
  {
    "name": "McCain Foodservice Baby Hasslebacks",
    "code": "1000011853",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Air Fryer French Fries",
    "code": "1000012066",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Air Fryer Crinkle Cut",
    "code": "1000012067",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Surecrisp Deep Ridge Slices",
    "code": "1000012400, 1000012411",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "Quick Chips S/C",
    "code": "1000012954",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "Quick Chips C/C",
    "code": "1000012955",
    "category": "Snacks (CIV)",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain RT Air Fryer Crinkle Cut Fries",
    "code": "1000012067",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain RT Air Fryer French Fries",
    "code": "1000012066",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "Home Chips (Regen) Straight Cut",
    "code": "1000012982",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "Home Chips (Regen) Straight Cut",
    "code": "1000012983",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "Home Chips (Regen) Straight Cut 1kg",
    "code": "1000012982",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "Home Chips (Regen) Straight Cut 1.6kg",
    "code": "1000012983",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Air Fryer Crispy Dippers",
    "code": "1000013242",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Air Fryer Crispy Dippers",
    "code": "1000013242",
    "category": "Snacks (CIV)",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Surecrisp Impingement Fries",
    "code": "1000013431",
    "category": "Snacks (CIV)",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Surecrisp Impingement Fries",
    "code": "1000013431",
    "category": "Snacks (CIV)",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "Homechips Straight Cut 1.3kg",
    "code": "1000013497",
    "category": "Snacks (CIV)",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "Homechips Straight Cut 1.3kg",
    "code": "1000013497",
    "category": "Snacks (CIV)",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "MCCAIN CHEF JACKETS 5PK 8X1.35KG",
    "code": "1000013460",
    "category": "Snacks (CIV)",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "Crispy Fries",
    "code": "1000012916",
    "category": "Snacks (CIV)",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "Crispy Fries",
    "code": "1000012916",
    "category": "Snacks (CIV)",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "Strong Roots Sweet Potato Rustics",
    "code": "1000013726",
    "category": "Snacks (CIV)",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "Home Chips Crinkle Cut 2.5kg",
    "code": "1000014296",
    "category": "Snacks (CIV)",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Surecrisp chips medium cut",
    "code": "1000014213",
    "category": "Snacks (CIV)",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Surecrisp chips medium cut",
    "code": "1000014213",
    "category": "Snacks (CIV)",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Surecrisp Crinkle Cut",
    "code": "1000008022, 1000007740, 1000013493,1000014487",
    "category": "Snacks (CIV)",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Surecrisp Julienne",
    "code": "1000014441",
    "category": "Snacks (CIV)",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Surecrisp Skin on Chips Thin Cut",
    "code": "1000014448",
    "category": "Snacks (CIV)",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Max Crunch Original SC",
    "code": "1000014626",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Max Crunch Wavy",
    "code": "1000014627",
    "category": "CIV",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "status": "active"
  },
  {
    "name": "McCain Max Crunch Original SC",
    "code": "1000014626",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  },
  {
    "name": "McCain Max Crunch Wavy",
    "code": "1000014627",
    "category": "CIV",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "status": "active"
  }
];

// 151 Add-On Applications from SQL Server (dbo.ProAder where CompID = '185')
const addOnsData = [
  {
    "application_number": "ADD-20061-185",
    "legacy_record_id": "20061",
    "subject": "Naked Oven Chips",
    "message": "Remarketing of McCain Oven Chips to be called \"Naked Oven Chips\". it is the same recipe as current oven chips for Scarborough, Whittlesey and Grantham. Please add this as a new product",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Naked Oven Chips",
        "code": "ADD-20061",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2020-01-06T23:00:00.000Z"
  },
  {
    "application_number": "ADD-20075-185",
    "legacy_record_id": "20075",
    "subject": "Product Addition Request",
    "message": "adding 2 products (Taoheed)",
    "contact_name": "Shane",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Product Variation",
        "code": "ADD-20075",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2020-01-09T23:00:00.000Z"
  },
  {
    "application_number": "ADD-20077-185",
    "legacy_record_id": "20077",
    "subject": "Naked Oven Chips",
    "message": "Approval for 2 products\r\n\r\nMcCain Naked Oven Chips C/C\r\nMcCain Naked Oven Chips S/C\r\n\r\nmade at scarborough, Grantham and Whittlesey.",
    "contact_name": "shane green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Naked Oven Chips",
        "code": "ADD-20077",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2020-01-09T23:00:00.000Z"
  },
  {
    "application_number": "ADD-20087-185",
    "legacy_record_id": "20087",
    "subject": "2 batter changes",
    "message": "Hi,\r\n\r\nWe are changing 2 of our batters which will affect 25 products we currently have approved by HFA at Scarborough, Whittlesey and Wombourne",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10011",
    "site_name": "Grantham",
    "products": [
      {
        "sn": 1,
        "name": "2 batter changes",
        "code": "ADD-20087",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2020-01-12T23:00:00.000Z"
  },
  {
    "application_number": "ADD-20186-185",
    "legacy_record_id": "20186",
    "subject": "Extra Thin Fries",
    "message": "I'm wanting to get these 2 products approved for HFA. one is foodservice and called \"JJ Fast Food Julienne Chips\" and one is retail called Thin Cut Fast Food Fries\". they are produced at Scarborough and Whittlesey. They are an exact copy of of Macfries which is already approved.",
    "contact_name": "shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10010",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Extra Thin Fries",
        "code": "ADD-20186",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2020-03-05T23:00:00.000Z"
  },
  {
    "application_number": "ADD-20245-185",
    "legacy_record_id": "20245",
    "subject": "2 new retail extra thin fries",
    "message": "Hi,\r\n\r\nI'm applying for 2 new retail products to be produced at Scarborough and Whittlesey. \r\n\r\nFast Food Fries\r\nSupervalue American Fries",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "2 new retail extra thin fries",
        "code": "ADD-20245",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2020-04-05T23:00:00.000Z"
  },
  {
    "application_number": "ADD-20324-185",
    "legacy_record_id": "20324",
    "subject": "Rustic Oven Chips",
    "message": "Hi,\r\n\r\nWe are rebranding Rustic Oven Chips to be called Naked Skin on Chunky Chips.\r\n\r\nPlease could you update the certificates for Scarborough and Whittlesey?",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Rustic Oven Chips",
        "code": "ADD-20324",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2020-05-14T23:00:00.000Z"
  },
  {
    "application_number": "ADD-20335-185",
    "legacy_record_id": "20335",
    "subject": "McCain Crispers",
    "message": "Bespoke Crispers product that is going into Subway. Product is a V cut potato wedge coated in a batter.\r\n\r\nSites to be approved for are Scarborough and Whittlesey",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "McCain Crispers",
        "code": "ADD-20335",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2020-05-17T23:00:00.000Z"
  },
  {
    "application_number": "ADD-20336-185",
    "legacy_record_id": "20336",
    "subject": "Menu Signature Wedges",
    "message": "Hi,\r\n\r\nMenu signature wedges product which is a coated Wedge that we are going to be supplying into Dominoes.\r\n\r\nSites produced at are Scarborough and Whittlesey",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Menu Signature Wedges",
        "code": "ADD-20336",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2020-05-17T23:00:00.000Z"
  },
  {
    "application_number": "ADD-30439-185",
    "legacy_record_id": "30439",
    "subject": "Surecrisp Thin",
    "message": "Good Afternoon,\r\n\r\nWe already have a product coded 1000007651 approved by HFA and we want to bring out a new code for an new customer. It is exactly the same product but we want to raise a new code so we can ship this product bespoke to them. The code is 1000009204 Surecrisp Thin Fries. I will send on the product approval form and the spec to the approval address.\r\n\r\nIt is for Whittlesey and Scarborough.\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Surecrisp Thin",
        "code": "ADD-30439",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2020-07-26T23:00:00.000Z"
  },
  {
    "application_number": "ADD-30441-185",
    "legacy_record_id": "30441",
    "subject": "Brakes Thick cut chips",
    "message": "Hi,\r\n\r\nWe are making a new product for Brakes which we need to rush through. it is called Thick cut chips 9/16 code is 1000009226 and I will send the form through to the product approval and spec.it is only sunflower and potato which is being produced at Scarborough and Whittlesey.",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Brakes Thick cut chips",
        "code": "ADD-30441",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2020-07-27T23:00:00.000Z"
  },
  {
    "application_number": "ADD-40483-185",
    "legacy_record_id": "40483",
    "subject": "Firecracker Wedges",
    "message": "Hi,\r\n\r\nWe are looking at launching a new product called firecracker wedges which will be made at Whittlesey and Scarborough. It is a spicy wedge",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Firecracker Wedges",
        "code": "ADD-40483",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2020-08-25T23:00:00.000Z"
  },
  {
    "application_number": "ADD-40531-185",
    "legacy_record_id": "40531",
    "subject": "Southern fried Wedges dual supply",
    "message": "Hi,\r\n\r\nAfter a successful trial in Feb/March we have decided to go dual supply on a batter and predust for Southern Fried Wedges and CD southern Fried Wedges. this is for product made at Scarborough and Whittlesey. I will send details through to the products approval address.\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Southern fried Wedges dual supply",
        "code": "ADD-40531",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2020-09-20T23:00:00.000Z"
  },
  {
    "application_number": "ADD-40567-185",
    "legacy_record_id": "40567",
    "subject": "Flavour makers",
    "message": "Hi,\r\n\r\nWe are launching three new retail products that are fries which you add a seasoning to then cook. These are to be made at Scarborough and Whittlesey. I will send product forms through seperately.\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Flavour makers",
        "code": "ADD-40567",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2020-10-06T23:00:00.000Z"
  },
  {
    "application_number": "ADD-40638-185",
    "legacy_record_id": "40638",
    "subject": "1000006691 Crispers",
    "message": "Good Evening,\r\n\r\nWe have changed the salt content of the batter on 1000006691 Crispers for Scarborough and Whittlesey. This means the batter code has changed. Nothing else has changed on the product apart from the mccain code and the salt content. I will send the change through.\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "1000006691 Crispers",
        "code": "ADD-40638",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2020-11-10T23:00:00.000Z"
  },
  {
    "application_number": "ADD-40680-185",
    "legacy_record_id": "40680",
    "subject": "Signature Traditional",
    "message": "Good Afternoon,\r\n\r\nWe used to have a product called Signature traditional on the HFA certificate for Scarborough and Whittlesey, but I cant see it. I wish to add this back on so please can it be added. I will send the product approval form through along with the batter spec. \r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Signature Traditional",
        "code": "ADD-40680",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2020-11-30T23:00:00.000Z"
  },
  {
    "application_number": "ADD-40704-185",
    "legacy_record_id": "40704",
    "subject": "Fries to Go",
    "message": "Hi,\r\n\r\nthe fries to go product that we product at Grantham contains potato flake. We usually use GB potato flake, but we have the chance to use some French flake so the flake will be coming from GB and from France for a while. It is made at McCain site in France that doesnt handle pork. I will send through the french flake spec.\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20221",
    "site_name": "Grantham",
    "products": [
      {
        "sn": 1,
        "name": "Fries to Go",
        "code": "ADD-40704",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2020-12-10T23:00:00.000Z"
  },
  {
    "application_number": "ADD-40750-185",
    "legacy_record_id": "40750",
    "subject": "Brakes",
    "message": "Good Afternoon,\r\n\r\nPlease could I extend one product already on the Whittlesey certificate to Scarborough and also can I add another product. The Brakes Thick that is on Whittlesey I want to extent it to be put on the Scarborough certificate. i want to also add a medium cut Brakes chip. it is exactly the same recipe as the thick just a different cut size. I will send through the product approval form for the medium. both products need to be on the scarborough and the whittlesey certs.\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Brakes",
        "code": "ADD-40750",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2021-01-06T23:00:00.000Z"
  },
  {
    "application_number": "ADD-40770-185",
    "legacy_record_id": "40770",
    "subject": "Favorite Fried Chicken Thin Cut Fries",
    "message": "Good afternoon,\r\n\r\nWe are doing a new product called Favourite fried chicken Surecrisp Thin Fries. it is exactly the same recipe as the surecrisp thin skin on fries already certified. I need it to go on the Whittlesey and Scarborough certificates please.\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Favorite Fried Chicken Thin Cut Fries",
        "code": "ADD-40770",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2021-01-14T23:00:00.000Z"
  },
  {
    "application_number": "ADD-40808-185",
    "legacy_record_id": "40808",
    "subject": "Additional",
    "message": "McCain Favourite Fried Chicken Surecrisp Thin Cut-1000009594\r\nTo be added to Both Scarborough and Whittlesey",
    "contact_name": "Shane",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Additional",
        "code": "ADD-40808",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2021-02-01T23:00:00.000Z"
  },
  {
    "application_number": "ADD-40814-185",
    "legacy_record_id": "40814",
    "subject": "Codes",
    "message": "Good Morning,\r\n\r\nAs requested the codes for the products that apply to all sites are to be provided so they can go on the site certificates.",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Codes",
        "code": "ADD-40814",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2021-02-07T23:00:00.000Z"
  },
  {
    "application_number": "ADD-40850-185",
    "legacy_record_id": "40850",
    "subject": "Home Chips",
    "message": "Good afternoon. \r\n\r\nWe are removing the Shea and coconut from the Home chips batter so there will be a new recipe in use from March.\r\n\r\nPlease could you take a look at the recipe update IU send through to the approval mail address.\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Home Chips",
        "code": "ADD-40850",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2021-02-14T23:00:00.000Z"
  },
  {
    "application_number": "ADD-41080-185",
    "legacy_record_id": "41080",
    "subject": "1000009896 Crispy French Fries new code",
    "message": "Hi,\r\n\r\nWe are bringing out a new pack size of a already approved crispy french fries product. no recipe change just a new code to add to the whittlesey certificate\r\n\r\nregards\r\n\r\nshane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "1000009896 Crispy French Fries new code",
        "code": "ADD-41080",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2021-05-16T23:00:00.000Z"
  },
  {
    "application_number": "ADD-41081-185",
    "legacy_record_id": "41081",
    "subject": "1000009896 Crispy french fries",
    "message": "Hi,\r\n\r\nWe are bringing out a new pack size of a already approved crispy french fries product. no recipe change just a new code to add to the Scarborough certificate\r\n\r\nregards\r\n\r\nshane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "1000009896 Crispy french fries",
        "code": "ADD-41081",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2021-05-16T23:00:00.000Z"
  },
  {
    "application_number": "ADD-41082-185",
    "legacy_record_id": "41082",
    "subject": "1000009895 Home chips CC",
    "message": "Hi,\r\n\r\nPlease could you add this code to the certificate. its a different pack size.\r\n\r\nregards\r\n\r\nShane",
    "contact_name": "shane green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "1000009895 Home chips CC",
        "code": "ADD-41082",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2021-05-16T23:00:00.000Z"
  },
  {
    "application_number": "ADD-41085-185",
    "legacy_record_id": "41085",
    "subject": "1000009897 Home chips SC",
    "message": "Hi,\r\n\r\nNew code to be added to the Home Chips SC whittlesey certificate",
    "contact_name": "shane green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "1000009897 Home chips SC",
        "code": "ADD-41085",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2021-05-16T23:00:00.000Z"
  },
  {
    "application_number": "ADD-41087-185",
    "legacy_record_id": "41087",
    "subject": "1000009897 Home Chips SC",
    "message": "Hi,\r\n\r\nnew code to be added to the certificate for Scarborough for Home Chips SC",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "1000009897 Home Chips SC",
        "code": "ADD-41087",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2021-05-16T23:00:00.000Z"
  },
  {
    "application_number": "ADD-41105-185",
    "legacy_record_id": "41105",
    "subject": "1000009895 McCain Home chips CC",
    "message": "Hi,\r\n\r\nPlease could you add code 1000009895 to the home chips CC codes you already have on the certificate.\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "1000009895 McCain Home chips CC",
        "code": "ADD-41105",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2021-05-23T23:00:00.000Z"
  },
  {
    "application_number": "ADD-41112-185",
    "legacy_record_id": "41112",
    "subject": "McCain Quick Chips Straight Cut",
    "message": "Hi,\r\n\r\nWe are going to be changing the  oil on this product. we are going to be using either sunflower or a blend. I will send the new raw material form through.",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "McCain Quick Chips Straight Cut",
        "code": "ADD-41112",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2021-05-24T23:00:00.000Z"
  },
  {
    "application_number": "ADD-41113-185",
    "legacy_record_id": "41113",
    "subject": "McCain Quick Chips S/C",
    "message": "Hi,\r\n\r\nwe are changing the oil that we use on the Quick chips S/C product. we are going to use either sunflower or the new oil blend. I will send the necessary forms through.",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "McCain Quick Chips S/C",
        "code": "ADD-41113",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2021-05-24T23:00:00.000Z"
  },
  {
    "application_number": "ADD-41137-185",
    "legacy_record_id": "41137",
    "subject": "Home Chips Chunky 1000009877",
    "message": "hi,\r\n\r\nplease can you add code 1000009877 to the certificate for Home chips Chunky that already exists",
    "contact_name": "shane green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Home Chips Chunky 1000009877",
        "code": "ADD-41137",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2021-05-27T23:00:00.000Z"
  },
  {
    "application_number": "ADD-41138-185",
    "legacy_record_id": "41138",
    "subject": "Home chips Chunky 1000009877",
    "message": "hi,\r\n\r\nplease can you add code 1000009877 to the certificate for Home chips Chunky that already exists",
    "contact_name": "shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Home chips Chunky 1000009877",
        "code": "ADD-41138",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2021-05-27T23:00:00.000Z"
  },
  {
    "application_number": "ADD-41158-185",
    "legacy_record_id": "41158",
    "subject": "Fries to go 1000009946",
    "message": "hi,\r\n\r\nPlease can you add the code 100009946 to the list of Fries to go products on the grantham certificate",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20221",
    "site_name": "Grantham",
    "products": [
      {
        "sn": 1,
        "name": "Fries to go 1000009946",
        "code": "ADD-41158",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2021-06-08T23:00:00.000Z"
  },
  {
    "application_number": "ADD-41308-185",
    "legacy_record_id": "41308",
    "subject": "Simply and OMS Roasts",
    "message": "Hi,\r\n\r\nNew products to approve",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Simply and OMS Roasts",
        "code": "ADD-41308",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2021-08-03T23:00:00.000Z"
  },
  {
    "application_number": "ADD-41314-185",
    "legacy_record_id": "41314",
    "subject": "Simply potato and OMS roasts",
    "message": "Hi,\r\n\r\nSome new products to approve for whittlesey please",
    "contact_name": "shane green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Simply potato and OMS roasts",
        "code": "ADD-41314",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2021-08-03T23:00:00.000Z"
  },
  {
    "application_number": "ADD-41351-185",
    "legacy_record_id": "41351",
    "subject": "Oil change",
    "message": "Good afternoon,\r\n\r\nWe are changing the oil we use on the Macdonalds fries to the oiul we used on the Mcdonalds Hash Browns. this also affects some McCain products. No new ingredients. I will send the form through.",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Oil change",
        "code": "ADD-41351",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2021-08-23T23:00:00.000Z"
  },
  {
    "application_number": "ADD-41352-185",
    "legacy_record_id": "41352",
    "subject": "Oil change",
    "message": "Good afternoon,\r\n\r\nWe are changing the oil we use on the Macdonalds fries to the oiul we used on the Mcdonalds Hash Browns. this also affects some McCain products. No new ingredients. I will send the form through.",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Oil change",
        "code": "ADD-41352",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2021-08-23T23:00:00.000Z"
  },
  {
    "application_number": "ADD-41375-185",
    "legacy_record_id": "41375",
    "subject": "removal of duplicate products",
    "message": "Hi,\r\n\r\ni applied for some products to be added to the whittlesey certificate but I didn't realise they were already on. products numbered 76/77/78/79//80 need removing as they are already present as numbers 41-46",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "removal of duplicate products",
        "code": "ADD-41375",
        "type": "Remove product"
      }
    ],
    "status": "completed",
    "created_at": "2021-09-05T23:00:00.000Z"
  },
  {
    "application_number": "ADD-41388-185",
    "legacy_record_id": "41388",
    "subject": "Retail Jackets",
    "message": "Morning,\r\n\r\nI want to add the HFA logo to our retail jacket potato range as we are updating the pack. If I can get a quick response there is a chance I can add the logo right away as we are updating our packs.\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Retail Jackets",
        "code": "ADD-41388",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2021-09-09T23:00:00.000Z"
  },
  {
    "application_number": "ADD-41400-185",
    "legacy_record_id": "41400",
    "subject": "Jackets",
    "message": "Hi,  \r\nPlease add this jacket code to the one that I submitted last week.",
    "contact_name": "shane.green@mccain.co.uk",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Jackets",
        "code": "ADD-41400",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2021-09-15T23:00:00.000Z"
  },
  {
    "application_number": "ADD-41403-185",
    "legacy_record_id": "41403",
    "subject": "New codes",
    "message": "Hi,\r\n\r\nplease could you approve these new codes for currently approved products",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "New codes",
        "code": "ADD-41403",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2021-09-15T23:00:00.000Z"
  },
  {
    "application_number": "ADD-41404-185",
    "legacy_record_id": "41404",
    "subject": "New codes",
    "message": "Hi,\r\n\r\nplease could we get these new codes of existing SKU's approved?\r\n\r\nRegrads\r\n\r\nShane",
    "contact_name": "shane green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "New codes",
        "code": "ADD-41404",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2021-09-15T23:00:00.000Z"
  },
  {
    "application_number": "ADD-51464-185",
    "legacy_record_id": "51464",
    "subject": "Lightly spiced wedges",
    "message": "Good afternoon,\r\n\r\nWe are looking to do a trial where we remove the predust we use and only use a batter on the lightly spiced wedges. there is no addition of ingredients just the removal of the predust as before it was batter and predust. if the trail is successful we will move over to this recipe",
    "contact_name": "shane green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Lightly spiced wedges",
        "code": "ADD-51464",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2021-11-01T23:00:00.000Z"
  },
  {
    "application_number": "ADD-51465-185",
    "legacy_record_id": "51465",
    "subject": "Lightly spiced Wedges",
    "message": "Good afternoon,\r\n\r\nWe are looking to do a trial where we remove the predust we use and only use a batter on the lightly spiced wedges. there is no addition of ingredients just the removal of the predust as before it was batter and predust. if the trail is successful we will move over to this recipe",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Lightly spiced Wedges",
        "code": "ADD-51465",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2021-11-01T23:00:00.000Z"
  },
  {
    "application_number": "ADD-51495-185",
    "legacy_record_id": "51495",
    "subject": "McCain Surecrisp Gourmet CD",
    "message": "Hello,\r\n\r\nPlease could you look at this product for approval. it uses existing ingredients already seen and approved by HFA but it is a new product for central distribution hence the word CD",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "McCain Surecrisp Gourmet CD",
        "code": "ADD-51495",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2021-11-17T23:00:00.000Z"
  },
  {
    "application_number": "ADD-51554-185",
    "legacy_record_id": "51554",
    "subject": "Grantham Certificate",
    "message": "Good afternoon, \r\n\r\nPlease could you remove all the products off the grantham certificate with exception of the Fries to Go. The codes for Fries to go are 1000009946, 48430, 48431, 148101, 1000000146",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20221",
    "site_name": "Grantham",
    "products": [
      {
        "sn": 1,
        "name": "Grantham Certificate",
        "code": "ADD-51554",
        "type": "Remove product"
      }
    ],
    "status": "completed",
    "created_at": "2022-01-09T23:00:00.000Z"
  },
  {
    "application_number": "ADD-51592-185",
    "legacy_record_id": "51592",
    "subject": "Hash Browns",
    "message": "Good Morning,\r\n\r\nUpdated recipe for the retail hash browns made at Lutosa.\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "30378",
    "site_name": "Lutosa",
    "products": [
      {
        "sn": 1,
        "name": "Hash Browns",
        "code": "ADD-51592",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2022-01-31T23:00:00.000Z"
  },
  {
    "application_number": "ADD-51593-185",
    "legacy_record_id": "51593",
    "subject": "Hash Browns Foodservice",
    "message": "Good Morning,\r\n\r\nUpdated recipe for the retail hash browns made at Lutosa.\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "30378",
    "site_name": "Lutosa",
    "products": [
      {
        "sn": 1,
        "name": "Hash Browns Foodservice",
        "code": "ADD-51593",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2022-01-31T23:00:00.000Z"
  },
  {
    "application_number": "ADD-61650-185",
    "legacy_record_id": "61650",
    "subject": "Home chips SC",
    "message": "Hello,\r\n\r\nwe want to add a new Home chips SC code so I thought I would go through the old codes at the same time and remove any old ones. No info has changed.\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Home chips SC",
        "code": "ADD-61650",
        "type": "Remove product"
      }
    ],
    "status": "completed",
    "created_at": "2022-02-28T23:00:00.000Z"
  },
  {
    "application_number": "ADD-61651-185",
    "legacy_record_id": "61651",
    "subject": "Home chips SC",
    "message": "Hello,\r\n\r\nthis is the same as the scarborough submission with  new codes and some old removed",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Home chips SC",
        "code": "ADD-61651",
        "type": "Remove product"
      }
    ],
    "status": "completed",
    "created_at": "2022-02-28T23:00:00.000Z"
  },
  {
    "application_number": "ADD-81720-185",
    "legacy_record_id": "81720",
    "subject": "Flavour Makers",
    "message": "Hi,\r\n\r\ncould you have a look at this product please?\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Flavour Makers",
        "code": "ADD-81720",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2022-04-26T23:00:00.000Z"
  },
  {
    "application_number": "ADD-121723-185",
    "legacy_record_id": "121723",
    "subject": "Hash browns",
    "message": "Hi, \r\n\r\nPlease could you add the new hash browns code to the already retail codes",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "30378",
    "site_name": "Lutosa",
    "products": [
      {
        "sn": 1,
        "name": "Hash browns",
        "code": "ADD-121723",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2022-05-09T23:00:00.000Z"
  },
  {
    "application_number": "ADD-181754-185",
    "legacy_record_id": "181754",
    "subject": "Surecrisp thin",
    "message": "Hello,\r\n\r\nPlease could you add these 2 codes to the already approved surecrisp thin codes",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Surecrisp thin",
        "code": "ADD-181754",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2022-06-13T23:00:00.000Z"
  },
  {
    "application_number": "ADD-181755-185",
    "legacy_record_id": "181755",
    "subject": "McCain Surecrisp Thin",
    "message": "Please add this to the already current approved Surecrisp thin list",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "McCain Surecrisp Thin",
        "code": "ADD-181755",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2022-06-13T23:00:00.000Z"
  },
  {
    "application_number": "ADD-181756-185",
    "legacy_record_id": "181756",
    "subject": "McCain Jackets",
    "message": "Hello,\r\n\r\nPlease could you add this code to the already approved Jackets product list",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "McCain Jackets",
        "code": "ADD-181756",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2022-06-13T23:00:00.000Z"
  },
  {
    "application_number": "ADD-221836-185",
    "legacy_record_id": "221836",
    "subject": "McCain Home Chips Light (Retail)",
    "message": "Hi,\r\n\r\nPlease could we get a new code of an already exsiting product added as well as removing some codes\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "McCain Home Chips Light (Retail)",
        "code": "ADD-221836",
        "type": "Remove product"
      }
    ],
    "status": "completed",
    "created_at": "2022-07-25T23:00:00.000Z"
  },
  {
    "application_number": "ADD-221837-185",
    "legacy_record_id": "221837",
    "subject": "McCain Home Chips Light (Retail)",
    "message": "Hi,\r\n\r\nPlease could we get a new code of an already exsiting product added as well as removing some codes\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "McCain Home Chips Light (Retail)",
        "code": "ADD-221837",
        "type": "Remove product"
      }
    ],
    "status": "completed",
    "created_at": "2022-07-25T23:00:00.000Z"
  },
  {
    "application_number": "ADD-221839-185",
    "legacy_record_id": "221839",
    "subject": "McCain Home Chips Thin & Crispy",
    "message": "Hi,\r\n\r\nPlease remove this product from the certificate.\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "McCain Home Chips Thin & Crispy",
        "code": "ADD-221839",
        "type": "Remove product"
      }
    ],
    "status": "completed",
    "created_at": "2022-07-25T23:00:00.000Z"
  },
  {
    "application_number": "ADD-221840-185",
    "legacy_record_id": "221840",
    "subject": "McCain Home Chips Thin & Crispy",
    "message": "Hi,\r\n\r\nPlease can you remove this product\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "McCain Home Chips Thin & Crispy",
        "code": "ADD-221840",
        "type": "Remove product"
      }
    ],
    "status": "completed",
    "created_at": "2022-07-25T23:00:00.000Z"
  },
  {
    "application_number": "ADD-221841-185",
    "legacy_record_id": "221841",
    "subject": "McCain Home Chips S/C",
    "message": "Hi,\r\n\r\nPlease can I add a code and also remove some obsolete ones?\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "McCain Home Chips S/C",
        "code": "ADD-221841",
        "type": "Remove product"
      }
    ],
    "status": "completed",
    "created_at": "2022-07-25T23:00:00.000Z"
  },
  {
    "application_number": "ADD-221842-185",
    "legacy_record_id": "221842",
    "subject": "McCain Home Chips S/C",
    "message": "Hi,\r\n\r\nPlease can we have a code added to this product and some obsolete codes removed.\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "McCain Home Chips S/C",
        "code": "ADD-221842",
        "type": "Remove product"
      }
    ],
    "status": "completed",
    "created_at": "2022-07-25T23:00:00.000Z"
  },
  {
    "application_number": "ADD-221843-185",
    "legacy_record_id": "221843",
    "subject": "McCain Home Chips C/C",
    "message": "Hi,\r\n\r\nPlease can we add a new code to the product and remove some obsolete ones.\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "McCain Home Chips C/C",
        "code": "ADD-221843",
        "type": "Remove product"
      }
    ],
    "status": "completed",
    "created_at": "2022-07-25T23:00:00.000Z"
  },
  {
    "application_number": "ADD-221844-185",
    "legacy_record_id": "221844",
    "subject": "McCain Home Chips C/C",
    "message": "Hi,\r\n\r\nPlease can we add a code and delete some obsolete ones.\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "McCain Home Chips C/C",
        "code": "ADD-221844",
        "type": "Remove product"
      }
    ],
    "status": "completed",
    "created_at": "2022-07-25T23:00:00.000Z"
  },
  {
    "application_number": "ADD-221866-185",
    "legacy_record_id": "221866",
    "subject": "Macfries",
    "message": "Please can we add a new code to the already existing approved macfries codes please?",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Macfries",
        "code": "ADD-221866",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2022-08-09T23:00:00.000Z"
  },
  {
    "application_number": "ADD-221867-185",
    "legacy_record_id": "221867",
    "subject": "Macfries",
    "message": "Please can we add a new code to the already existing approved macfries codes please?",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Macfries",
        "code": "ADD-221867",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2022-08-09T23:00:00.000Z"
  },
  {
    "application_number": "ADD-221891-185",
    "legacy_record_id": "221891",
    "subject": "Crispers",
    "message": "Hi,\r\n\r\nPlease could you add this code to the already approved crispers on the whittlesey certificate.",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Crispers",
        "code": "ADD-221891",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2022-08-21T23:00:00.000Z"
  },
  {
    "application_number": "ADD-221892-185",
    "legacy_record_id": "221892",
    "subject": "Crispers",
    "message": "Hi,\r\n\r\nPlease could you add this code to the already approved crispers on the Scarborough certificate.",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Crispers",
        "code": "ADD-221892",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2022-08-21T23:00:00.000Z"
  },
  {
    "application_number": "ADD-221900-185",
    "legacy_record_id": "221900",
    "subject": "41088 McCain Chef Solutions Oven Chips",
    "message": "Good Morning,\r\n\r\nPlease could we get 41088 added to the whittlesey certificate as a new product. it is a food service oven chip so its different from the retail version already approved.",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "41088 McCain Chef Solutions Oven Chips",
        "code": "ADD-221900",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2022-08-30T23:00:00.000Z"
  },
  {
    "application_number": "ADD-221901-185",
    "legacy_record_id": "221901",
    "subject": "41088 Chef Solution Oven chips",
    "message": "Hi,\r\n\r\nPlease could you add this new product to the Scarborough certificate?\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "41088 Chef Solution Oven chips",
        "code": "ADD-221901",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2022-08-30T23:00:00.000Z"
  },
  {
    "application_number": "ADD-221910-185",
    "legacy_record_id": "221910",
    "subject": "Original Choice",
    "message": "Please can you add these to the whittlesey certificate. they are existing mccain products just new to the certificate.",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Original Choice",
        "code": "ADD-221910",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2022-09-01T23:00:00.000Z"
  },
  {
    "application_number": "ADD-221911-185",
    "legacy_record_id": "221911",
    "subject": "Original Choice",
    "message": "Please can you add these to the scarborough certificate",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Original Choice",
        "code": "ADD-221911",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2022-09-01T23:00:00.000Z"
  },
  {
    "application_number": "ADD-242089-185",
    "legacy_record_id": "242089",
    "subject": "Fast Food Fries",
    "message": "Hi,\r\n\r\nPlease could we add this product to the certificate?\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Fast Food Fries",
        "code": "ADD-242089",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2022-12-14T23:00:00.000Z"
  },
  {
    "application_number": "ADD-242090-185",
    "legacy_record_id": "242090",
    "subject": "Fast Food Fries",
    "message": "Hi,\r\n\r\nPlease could I get this new product approved",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Fast Food Fries",
        "code": "ADD-242090",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2022-12-14T23:00:00.000Z"
  },
  {
    "application_number": "ADD-242091-185",
    "legacy_record_id": "242091",
    "subject": "Sweet Potato Rustics",
    "message": "Hi,\r\n\r\nPlease can we get this product updated for a recipe change plus a code deleting",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Sweet Potato Rustics",
        "code": "ADD-242091",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2022-12-14T23:00:00.000Z"
  },
  {
    "application_number": "ADD-242092-185",
    "legacy_record_id": "242092",
    "subject": "Sweet Potato Rustics",
    "message": "Hi,\r\n\r\nPlease could you update the recipe for this product and remove one of the codes",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Sweet Potato Rustics",
        "code": "ADD-242092",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2022-12-14T23:00:00.000Z"
  },
  {
    "application_number": "ADD-242279-185",
    "legacy_record_id": "242279",
    "subject": "New home chips SC codes",
    "message": "Good Afternoon,\r\n\r\nPlease can we get the 2 new codes added to the already approved Home Chips SC product list\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "New home chips SC codes",
        "code": "ADD-242279",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2023-02-05T23:00:00.000Z"
  },
  {
    "application_number": "ADD-242280-185",
    "legacy_record_id": "242280",
    "subject": "New Home Chips SC codes",
    "message": "Good Afternoon,\r\n\r\nPlease can we get the 2 new codes added to the already approved Home Chips SC product list\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "New Home Chips SC codes",
        "code": "ADD-242280",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2023-02-05T23:00:00.000Z"
  },
  {
    "application_number": "ADD-242314-185",
    "legacy_record_id": "242314",
    "subject": "Albert Bartlett",
    "message": "Good Afternoon,\r\n\r\nPlease can you review this product for suitability to claim halal for the AB site.\r\n\r\nPlease not this recipe is not going to be exactly the same as the already approved recipe at McCain sites.",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "120752",
    "site_name": "Albert Bartlett",
    "products": [
      {
        "sn": 1,
        "name": "Albert Bartlett",
        "code": "ADD-242314",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2023-02-21T23:00:00.000Z"
  },
  {
    "application_number": "ADD-242328-185",
    "legacy_record_id": "242328",
    "subject": "New Home Chips SC code",
    "message": "Hi,\r\n\r\nPlease add this code to the already approved Home Chips S/C product codes.",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "New Home Chips SC code",
        "code": "ADD-242328",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2023-03-05T23:00:00.000Z"
  },
  {
    "application_number": "ADD-242329-185",
    "legacy_record_id": "242329",
    "subject": "McCain Home Chips SC",
    "message": "Hi,\r\n\r\nplease add this code to the current list of codes for Home Chips SC\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "McCain Home Chips SC",
        "code": "ADD-242329",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2023-03-05T23:00:00.000Z"
  },
  {
    "application_number": "ADD-242330-185",
    "legacy_record_id": "242330",
    "subject": "Crispy French Fries",
    "message": "Hi,\r\n\r\nPlease could you add a new code to the existing Crispy French Fries product. there is also some codes to be removed.",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Crispy French Fries",
        "code": "ADD-242330",
        "type": "Remove product"
      }
    ],
    "status": "completed",
    "created_at": "2023-03-05T23:00:00.000Z"
  },
  {
    "application_number": "ADD-242331-185",
    "legacy_record_id": "242331",
    "subject": "Crispy French Fries",
    "message": "Hi, \r\n\r\nPlease can you add this to the already approved list of codes for Crispy French Fries. Some codes are also to be removed.",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Crispy French Fries",
        "code": "ADD-242331",
        "type": "Remove product"
      }
    ],
    "status": "completed",
    "created_at": "2023-03-05T23:00:00.000Z"
  },
  {
    "application_number": "ADD-242333-185",
    "legacy_record_id": "242333",
    "subject": "McCain Jackets",
    "message": "Hi,\r\n\r\nPlease could we add this code to the already approved Jackets product",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "McCain Jackets",
        "code": "ADD-242333",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2023-03-05T23:00:00.000Z"
  },
  {
    "application_number": "ADD-242335-185",
    "legacy_record_id": "242335",
    "subject": "McCain Naked Oven Chips SC",
    "message": "Hi,\r\n\r\nPlease can we add this code to the already approved Naked Oven chips SC list of codes.",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "McCain Naked Oven Chips SC",
        "code": "ADD-242335",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2023-03-05T23:00:00.000Z"
  },
  {
    "application_number": "ADD-242336-185",
    "legacy_record_id": "242336",
    "subject": "McCain Naked Oven Chips SC",
    "message": "Please can we add a new code to the already approved Naked Oven Chips SC",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "McCain Naked Oven Chips SC",
        "code": "ADD-242336",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2023-03-05T23:00:00.000Z"
  },
  {
    "application_number": "ADD-242337-185",
    "legacy_record_id": "242337",
    "subject": "Quick Chips",
    "message": "Hi,\r\n\r\nPlease can we add a new code to McCain Quick chips SC.",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Quick Chips",
        "code": "ADD-242337",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2023-03-05T23:00:00.000Z"
  },
  {
    "application_number": "ADD-242338-185",
    "legacy_record_id": "242338",
    "subject": "Quick chips SC",
    "message": "Please can we add in a new code to the already approved Quick Chips SC",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Quick chips SC",
        "code": "ADD-242338",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2023-03-05T23:00:00.000Z"
  },
  {
    "application_number": "ADD-242423-185",
    "legacy_record_id": "242423",
    "subject": "Simply skin on Wedges",
    "message": "Hello,\r\n\r\nWe have a new skin on wedge that we want to add to the current certificate. it is just potato and some process aids and doesnt go through the frying process.\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Simply skin on Wedges",
        "code": "ADD-242423",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2023-04-10T23:00:00.000Z"
  },
  {
    "application_number": "ADD-242424-185",
    "legacy_record_id": "242424",
    "subject": "Simply Skin on Wedges",
    "message": "Hello,\r\n\r\nWe have a new skin on wedge that we want to add to the current certificate. it is just potato and some process aids and doesnt go through the frying process.\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Simply Skin on Wedges",
        "code": "ADD-242424",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2023-04-10T23:00:00.000Z"
  },
  {
    "application_number": "ADD-252462-185",
    "legacy_record_id": "252462",
    "subject": "Baby Hasselbacks",
    "message": "Good afternoon,\r\n\r\nWe have a new product launching and we want to add the Halal logo to this. please can you assess the recipe for me?\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Baby Hasselbacks",
        "code": "ADD-252462",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2023-04-24T23:00:00.000Z"
  },
  {
    "application_number": "ADD-262501-185",
    "legacy_record_id": "262501",
    "subject": "Flavour makers name change",
    "message": "Good Afternoon,\r\n\r\nWe are changing the name of our flavour makers brand. the recipe is staying the same but just the code and name is different for this already approved product",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Flavour makers name change",
        "code": "ADD-262501",
        "type": "Change name/code"
      }
    ],
    "status": "completed",
    "created_at": "2023-05-22T23:00:00.000Z"
  },
  {
    "application_number": "ADD-262502-185",
    "legacy_record_id": "262502",
    "subject": "McCain Flavour Makers",
    "message": "Hi,\r\n\r\nWe are rebranding flavour makers product and now going to call them season and bake. same recipe as current flavour makers just new codes and name",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "McCain Flavour Makers",
        "code": "ADD-262502",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2023-05-22T23:00:00.000Z"
  },
  {
    "application_number": "ADD-262533-185",
    "legacy_record_id": "262533",
    "subject": "Sure crisp thin Code addition",
    "message": "Good Afternoon,\r\n\r\nI need to add a code and correct one of the code I had supplied previously for Surecrisp thin",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Sure crisp thin Code addition",
        "code": "ADD-262533",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2023-05-24T23:00:00.000Z"
  },
  {
    "application_number": "ADD-262534-185",
    "legacy_record_id": "262534",
    "subject": "McCain Surecrisp Thin code update",
    "message": "Good Afternoon,\r\n\r\nI need to add a code and correct one of the code I had supplied previously for Surecrisp thin",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "McCain Surecrisp Thin code update",
        "code": "ADD-262534",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2023-05-24T23:00:00.000Z"
  },
  {
    "application_number": "ADD-262582-185",
    "legacy_record_id": "262582",
    "subject": "Impingment Fries",
    "message": "Hi,\r\n\r\nCan we add this new product to the list please",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Impingment Fries",
        "code": "ADD-262582",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2023-06-21T23:00:00.000Z"
  },
  {
    "application_number": "ADD-262583-185",
    "legacy_record_id": "262583",
    "subject": "Impingement Fries",
    "message": "Hi,\r\n\r\nCan we add this new product please",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Impingement Fries",
        "code": "ADD-262583",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2023-06-21T23:00:00.000Z"
  },
  {
    "application_number": "ADD-262702-185",
    "legacy_record_id": "262702",
    "subject": "New Product Code approval",
    "message": "Hi\r\n\r\nPlease can you approve the new pack size codes for existing product types and add to the certificate?\r\n\r\nThanks.",
    "contact_name": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "New Product Code approval",
        "code": "ADD-262702",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2023-08-09T23:00:00.000Z"
  },
  {
    "application_number": "ADD-262705-185",
    "legacy_record_id": "262705",
    "subject": "New pack size & product code",
    "message": "Hi\r\n\r\nPlease can you approve a new pack size for an existing product type?\r\n\r\n(Apologies if you got this twice - the site box went blank after I had filled the rest in, so I was unsure if it has been assigned to Whittlesey.)\r\n\r\nThank you.",
    "contact_name": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "New pack size & product code",
        "code": "ADD-262705",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2023-08-09T23:00:00.000Z"
  },
  {
    "application_number": "ADD-262744-185",
    "legacy_record_id": "262744",
    "subject": "Popeye Cajun Fries",
    "message": "Good Afternoon,\r\n\r\nWe are going to be making a new battered fry for Popeye's in the UK which we would like to get approved.\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Popeye Cajun Fries",
        "code": "ADD-262744",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2023-09-10T23:00:00.000Z"
  },
  {
    "application_number": "ADD-262745-185",
    "legacy_record_id": "262745",
    "subject": "Popeye Cajun Fries",
    "message": "Good Afternoon,\r\n\r\nWe are going to be making a new battered fry for Popeye's in the UK which we would like to get approved.\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Popeye Cajun Fries",
        "code": "ADD-262745",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2023-09-10T23:00:00.000Z"
  },
  {
    "application_number": "ADD-272820-185",
    "legacy_record_id": "272820",
    "subject": "McCain FS Hasslebacks",
    "message": "Good Afternoon,\r\n\r\nWe are launching Hasslebacks into the foodsevice market, but unlike the retail version it will not have the seasoning sachet.",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "McCain FS Hasslebacks",
        "code": "ADD-272820",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2023-10-24T23:00:00.000Z"
  },
  {
    "application_number": "ADD-272849-185",
    "legacy_record_id": "272849",
    "subject": "Air fryer products",
    "message": "Hi,\r\n\r\nPlease could we add these 2 new products to the certificate for whittlesey?\r\n\r\nThe products are potato and oil",
    "contact_name": "shane.green@mccain.co.uk",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Air fryer products",
        "code": "ADD-272849",
        "type": "Add product"
      }
    ],
    "status": "submitted",
    "created_at": "2023-11-14T23:00:00.000Z"
  },
  {
    "application_number": "ADD-272850-185",
    "legacy_record_id": "272850",
    "subject": "Air Fryer",
    "message": "Hi,\r\n\r\nPlease could we add these 2 new products to the certificate for whittlesey?\r\n\r\nThe products are potato and oil",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Air Fryer",
        "code": "ADD-272850",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2023-11-14T23:00:00.000Z"
  },
  {
    "application_number": "ADD-272858-185",
    "legacy_record_id": "272858",
    "subject": "New Naked Oven Chips Codes",
    "message": "Hi, please can these ew codes of Naked Oven Chips be approved? They are identical to the existing approved products, but use potatoes sourced from sustainable regenerative agriculture farms.\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\nHi. These are some new codes of Naked Oven Chips made with potatoes from regenerative farming. The product is already certified.",
    "contact_name": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "New Naked Oven Chips Codes",
        "code": "ADD-272858",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2023-11-21T23:00:00.000Z"
  },
  {
    "application_number": "ADD-293084-185",
    "legacy_record_id": "293084",
    "subject": "McCain Zig Zags",
    "message": "Hi, please could you look at this FS product we are looking to launch. \r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "McCain Zig Zags",
        "code": "ADD-293084",
        "type": "Add product"
      }
    ],
    "status": "submitted",
    "created_at": "2024-04-10T23:00:00.000Z"
  },
  {
    "application_number": "ADD-293102-185",
    "legacy_record_id": "293102",
    "subject": "McCain Surecrisp Deep Ridge",
    "message": "Hi, Please can you add this code to the already approved zig zag product.",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "McCain Surecrisp Deep Ridge",
        "code": "ADD-293102",
        "type": "Add product"
      }
    ],
    "status": "submitted",
    "created_at": "2024-04-18T23:00:00.000Z"
  },
  {
    "application_number": "ADD-323382-185",
    "legacy_record_id": "323382",
    "subject": "New product codes",
    "message": "Please can the following produts be approved? They are code extensions to existing product: Season & Bake S&P - 1000011659, Crispy Fries - 47801. Thanks.",
    "contact_name": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "New product codes",
        "code": "ADD-323382",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2024-09-16T23:00:00.000Z"
  },
  {
    "application_number": "ADD-323509-185",
    "legacy_record_id": "323509",
    "subject": "Additional Products",
    "message": "Please can the following products be approved. These are identical to the current approved products in a different pallet configuration",
    "contact_name": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Additional Products",
        "code": "ADD-323509",
        "type": "Add product"
      }
    ],
    "status": "submitted",
    "created_at": "2024-11-13T23:00:00.000Z"
  },
  {
    "application_number": "ADD-323618-185",
    "legacy_record_id": "323618",
    "subject": "New Product Code - Homechips",
    "message": "Please can these codes be added to the Scarborough and Whittlesey certificates. Product formulation s the same as current but made using potatoes gown using regenerative agricultural practices\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\nPlease can the new codes be added to the Scarborough and Whittlesey certificates",
    "contact_name": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "New Product Code - Homechips",
        "code": "ADD-323618",
        "type": "Add product"
      }
    ],
    "status": "submitted",
    "created_at": "2025-01-08T23:00:00.000Z"
  },
  {
    "application_number": "ADD-323632-185",
    "legacy_record_id": "323632",
    "subject": "Additional product code",
    "message": "Please can the following new codes be added to the certificate. Product formulation is identical to product already approved, this just uses potatoes exclusively from sustainable agriculture. Thanks.",
    "contact_name": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Additional product code",
        "code": "ADD-323632",
        "type": "Add product"
      }
    ],
    "status": "submitted",
    "created_at": "2025-01-12T23:00:00.000Z"
  },
  {
    "application_number": "ADD-333684-185",
    "legacy_record_id": "333684",
    "subject": "Air Fryer new products",
    "message": "Hi,\r\n\r\nPlease could you assess the suitablility for these 2 new retail products to bear the HFA logo.\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Air Fryer new products",
        "code": "ADD-333684",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2025-03-23T23:00:00.000Z"
  },
  {
    "application_number": "ADD-333685-185",
    "legacy_record_id": "333685",
    "subject": "Air Fryer",
    "message": "Please can you assess this product to bear the HFA logo",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Air Fryer",
        "code": "ADD-333685",
        "type": "Add product"
      }
    ],
    "status": "submitted",
    "created_at": "2025-03-23T23:00:00.000Z"
  },
  {
    "application_number": "ADD-333692-185",
    "legacy_record_id": "333692",
    "subject": "Air Fryer Crispy Dippers",
    "message": "Hi, Please could you assess the suitability to bear the HFA logo on this product please.\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Air Fryer Crispy Dippers",
        "code": "ADD-333692",
        "type": "Add product"
      }
    ],
    "status": "submitted",
    "created_at": "2025-03-25T23:00:00.000Z"
  },
  {
    "application_number": "ADD-333738-185",
    "legacy_record_id": "333738",
    "subject": "Surecrisp thin",
    "message": "Hi, \r\nSurecrisp thin is having its batter changed. please could you assess the change for already approved products",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Surecrisp thin",
        "code": "ADD-333738",
        "type": "Change ingredients"
      }
    ],
    "status": "submitted",
    "created_at": "2025-04-21T23:00:00.000Z"
  },
  {
    "application_number": "ADD-333739-185",
    "legacy_record_id": "333739",
    "subject": "Surecrisp Thin",
    "message": "Hi,\r\n\r\nSurecrisp Thin is changing batters. Please could you assess the change for an already approved product.",
    "contact_name": "shane green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Surecrisp Thin",
        "code": "ADD-333739",
        "type": "Change ingredients"
      }
    ],
    "status": "submitted",
    "created_at": "2025-04-21T23:00:00.000Z"
  },
  {
    "application_number": "ADD-333834-185",
    "legacy_record_id": "333834",
    "subject": "Surecrisp Impingement",
    "message": "Hi, \r\n\r\nPlease could you assess this product to claim Halal. it is the same as the existing impingement apart from the batter has been changed very slightly.",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Surecrisp Impingement",
        "code": "ADD-333834",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2025-06-02T23:00:00.000Z"
  },
  {
    "application_number": "ADD-333835-185",
    "legacy_record_id": "333835",
    "subject": "Surecrisp impingement fries",
    "message": "Hi, \r\n\r\nPlease could you assess this product to claim Halal. it is the same as the existing impingement apart from the batter has been changed very slightly.",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Surecrisp impingement fries",
        "code": "ADD-333835",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2025-06-02T23:00:00.000Z"
  },
  {
    "application_number": "ADD-333901-185",
    "legacy_record_id": "333901",
    "subject": "New Homechips code",
    "message": "Hi. \r\n\r\nAll ingredients and packaging same as currently approved product, new pallet format only.\r\n\r\nThanks.",
    "contact_name": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "New Homechips code",
        "code": "ADD-333901",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2025-06-24T23:00:00.000Z"
  },
  {
    "application_number": "ADD-333902-185",
    "legacy_record_id": "333902",
    "subject": "New Homechips code",
    "message": "Hi. \r\n\r\nAll ingredients and packaging same as currently approved product, new pallet format only.\r\n\r\nThanks.",
    "contact_name": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "New Homechips code",
        "code": "ADD-333902",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2025-06-24T23:00:00.000Z"
  },
  {
    "application_number": "ADD-333903-185",
    "legacy_record_id": "333903",
    "subject": "New Homechips Code",
    "message": "Hi\r\n\r\nProduct ingredients and packaging are same as currently approved product, this is for a new pallet format only.\r\n\r\nThanks.",
    "contact_name": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "New Homechips Code",
        "code": "ADD-333903",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2025-06-24T23:00:00.000Z"
  },
  {
    "application_number": "ADD-333915-185",
    "legacy_record_id": "333915",
    "subject": "Surecrisp Medium and Julienne Part 1",
    "message": "Hi, surecrisp batter is being updated, therefore could you assess the products. there will be some more products to follow today. \r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Surecrisp Medium and Julienne Part 1",
        "code": "ADD-333915",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2025-06-29T23:00:00.000Z"
  },
  {
    "application_number": "ADD-333916-185",
    "legacy_record_id": "333916",
    "subject": "Surecrisp Medium & Julienne",
    "message": "Hi, \r\n\r\nWe are changing the batter on some Surecrisp medium and julienne codes. please can you assess the batter change.\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Surecrisp Medium & Julienne",
        "code": "ADD-333916",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2025-06-29T23:00:00.000Z"
  },
  {
    "application_number": "ADD-333917-185",
    "legacy_record_id": "333917",
    "subject": "Surecrisp Gourmet and Traditional",
    "message": "Hi,\r\n\r\nSurecrisp Gourmet and Traditional are changing batters. please could you assess for Halal please.\r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Surecrisp Gourmet and Traditional",
        "code": "ADD-333917",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2025-06-29T23:00:00.000Z"
  },
  {
    "application_number": "ADD-333928-185",
    "legacy_record_id": "333928",
    "subject": "Surecrisp Gourmet and Traditional",
    "message": "Hi, \r\nTraditional and Gourmet are changing the batter. please could you assess it for Halal.",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Surecrisp Gourmet and Traditional",
        "code": "ADD-333928",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2025-06-29T23:00:00.000Z"
  },
  {
    "application_number": "ADD-333936-185",
    "legacy_record_id": "333936",
    "subject": "New Jacket Potato Code",
    "message": "Please can the code be added. This is a new 5 pack of an existing product.",
    "contact_name": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "New Jacket Potato Code",
        "code": "ADD-333936",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2025-07-01T23:00:00.000Z"
  },
  {
    "application_number": "ADD-333956-185",
    "legacy_record_id": "333956",
    "subject": "Staycrisp thin additions",
    "message": "Hello, \r\n\r\nI've been given an additional 2 codes to add to an already approved change to surecrisp thin",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Staycrisp thin additions",
        "code": "ADD-333956",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2025-07-09T23:00:00.000Z"
  },
  {
    "application_number": "ADD-333957-185",
    "legacy_record_id": "333957",
    "subject": "Surecrisp Thin additions",
    "message": "Hello, \r\n\r\nI've been given an additional 2 codes to add to an already approved change to surecrisp thin",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Surecrisp Thin additions",
        "code": "ADD-333957",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2025-07-09T23:00:00.000Z"
  },
  {
    "application_number": "ADD-343982-185",
    "legacy_record_id": "343982",
    "subject": "Crispy French Fries Trial",
    "message": "Hello,\r\n\r\nWe are looking to do a trial on a new batter which has a increased salt content on crispy french fries at scarborough. all that is different is the salt% but we hope to sell this stock. can you assess if we can pack this into sellable stock from a halal point of view.",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Crispy French Fries Trial",
        "code": "ADD-343982",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2025-08-10T23:00:00.000Z"
  },
  {
    "application_number": "ADD-343989-185",
    "legacy_record_id": "343989",
    "subject": "New codes",
    "message": "Application to support the submission from Shane Green",
    "contact_name": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "New codes",
        "code": "ADD-343989",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2025-08-12T23:00:00.000Z"
  },
  {
    "application_number": "ADD-343990-185",
    "legacy_record_id": "343990",
    "subject": "New codes",
    "message": "Application to support the submission from Shane Green",
    "contact_name": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "New codes",
        "code": "ADD-343990",
        "type": "Add product"
      }
    ],
    "status": "submitted",
    "created_at": "2025-08-12T23:00:00.000Z"
  },
  {
    "application_number": "ADD-343991-185",
    "legacy_record_id": "343991",
    "subject": "New Crispy Fries Codes",
    "message": "New codes for the previously approved product - all ingredients and packaging are the same suppliers.",
    "contact_name": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "New Crispy Fries Codes",
        "code": "ADD-343991",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2025-08-12T23:00:00.000Z"
  },
  {
    "application_number": "ADD-344090-185",
    "legacy_record_id": "344090",
    "subject": "Product name change",
    "message": "Hi. Please can this product be added to our certificate. The current certified McCain product is being rebranded to be sold under the Strong Roots name.",
    "contact_name": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Product name change",
        "code": "ADD-344090",
        "type": "Change name/code"
      }
    ],
    "status": "completed",
    "created_at": "2025-09-29T23:00:00.000Z"
  },
  {
    "application_number": "ADD-374398-185",
    "legacy_record_id": "374398",
    "subject": "New Home Chips Code",
    "message": "Hi. \r\n\r\nPlease can this product be approved, it is the same formulation as one already approved - just a new bag size.",
    "contact_name": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "New Home Chips Code",
        "code": "ADD-374398",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2026-05-07T23:00:00.000Z"
  },
  {
    "application_number": "ADD-374399-185",
    "legacy_record_id": "374399",
    "subject": "New Home Chips Code",
    "message": "Hi. \r\n\r\nPlease can this product be approved, it is the same formulation as one already approved - just a new bag size.",
    "contact_name": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "New Home Chips Code",
        "code": "ADD-374399",
        "type": "Add product"
      }
    ],
    "status": "submitted",
    "created_at": "2026-05-07T23:00:00.000Z"
  },
  {
    "application_number": "ADD-374400-185",
    "legacy_record_id": "374400",
    "subject": "Home Chips Crinkle",
    "message": "Hi. Please can this product be approved, it is the same formulation as an existing approved product in a new bag size.\r\n\r\nThanks.",
    "contact_name": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Home Chips Crinkle",
        "code": "ADD-374400",
        "type": "Add product"
      }
    ],
    "status": "submitted",
    "created_at": "2026-05-07T23:00:00.000Z"
  },
  {
    "application_number": "ADD-374418-185",
    "legacy_record_id": "374418",
    "subject": "Medium Cut Surecrisp",
    "message": "Please can you review this new product for its suitability to claim Halal? It is the same recipe as our other surecrisp products just the only difference is the cut size",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Medium Cut Surecrisp",
        "code": "ADD-374418",
        "type": "Change ingredients"
      }
    ],
    "status": "submitted",
    "created_at": "2026-05-18T23:00:00.000Z"
  },
  {
    "application_number": "ADD-374419-185",
    "legacy_record_id": "374419",
    "subject": "McCain Surecrisp Medium Cut",
    "message": "Hi,\r\n\r\nPlease can you assess this product top claim Halal. it is the same as the other surecrisp but a new medium cut product",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "McCain Surecrisp Medium Cut",
        "code": "ADD-374419",
        "type": "Add product"
      }
    ],
    "status": "submitted",
    "created_at": "2026-05-18T23:00:00.000Z"
  },
  {
    "application_number": "ADD-374535-185",
    "legacy_record_id": "374535",
    "subject": "Additional Product",
    "message": "Hi\r\n\r\nPlease can a new code of Naked Oven Chips be approved?\r\n\r\nThanks.\r\n\r\n\r\nPlease can a new code of Naked Oven Chips be approved? It is the same recipe as the product already approved.\r\n\r\nThanks.",
    "contact_name": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Additional Product",
        "code": "ADD-374535",
        "type": "Change ingredients"
      }
    ],
    "status": "completed",
    "created_at": "2026-07-09T23:00:00.000Z"
  },
  {
    "application_number": "ADD-374536-185",
    "legacy_record_id": "374536",
    "subject": "Add Product",
    "message": "Hi,\r\n\r\nCould this code be approved for McCain Oven Chips 550g?\r\nThanks",
    "contact_name": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Add Product",
        "code": "ADD-374536",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2026-07-09T23:00:00.000Z"
  },
  {
    "application_number": "ADD-374537-185",
    "legacy_record_id": "374537",
    "subject": "Add Product",
    "message": "Hi,\r\n\r\nCould this code be approved for McCain Oven Chips 550g?\r\nThanks",
    "contact_name": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Add Product",
        "code": "ADD-374537",
        "type": "Add product"
      }
    ],
    "status": "submitted",
    "created_at": "2026-07-09T23:00:00.000Z"
  },
  {
    "application_number": "ADD-374538-185",
    "legacy_record_id": "374538",
    "subject": "Add Product",
    "message": "Hi,\r\n\r\nCould this code be approved for McCain Oven Chips 550g?\r\nThanks",
    "contact_name": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Add Product",
        "code": "ADD-374538",
        "type": "Add product"
      }
    ],
    "status": "submitted",
    "created_at": "2026-07-09T23:00:00.000Z"
  },
  {
    "application_number": "ADD-374539-185",
    "legacy_record_id": "374539",
    "subject": "Add Product",
    "message": "Hi,\r\n\r\nCould this code be approved for McCain Oven Chips 550g?\r\nThanks",
    "contact_name": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Add Product",
        "code": "ADD-374539",
        "type": "Add product"
      }
    ],
    "status": "submitted",
    "created_at": "2026-07-09T23:00:00.000Z"
  },
  {
    "application_number": "ADD-374540-185",
    "legacy_record_id": "374540",
    "subject": "Additional Product",
    "message": "Hi\r\n\r\nPlease can this new code (same recipe) of Oven Chips be approved?\r\n\r\nThanks.",
    "contact_name": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Additional Product",
        "code": "ADD-374540",
        "type": "Change ingredients"
      }
    ],
    "status": "submitted",
    "created_at": "2026-07-09T23:00:00.000Z"
  },
  {
    "application_number": "ADD-374541-185",
    "legacy_record_id": "374541",
    "subject": "Removal of Products",
    "message": "Hi,\r\nCould you remove the codes and references from Whittlesey certification please?\r\nMcCain Oven Chips C/C (19):\r\n39310, 1000000804, 1000006869\r\nMcCain Oven Chips S/C (18):\r\n39309, 67774, 49322, 49325, 1000000350, 1000000669, 1000001526, 1000003003, 1000005725, 1000006868\r\nThanks",
    "contact_name": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Removal of Products",
        "code": "ADD-374541",
        "type": "Remove product"
      }
    ],
    "status": "completed",
    "created_at": "2026-07-14T23:00:00.000Z"
  },
  {
    "application_number": "ADD-374542-185",
    "legacy_record_id": "374542",
    "subject": "Removal of Products",
    "message": "Hi,\r\nCould you removed these products from Scarborough cert please?\r\nMcCain Oven Chips C/C (19):\r\n39310, 1000000804, 1000006869\r\nMcCain Oven Chips S/C (18):\r\n39309, 67774, 49322, 49325, 1000000350, 1000000669, 1000001526, 1000003003, 1000005725, 1000006868\r\n\r\nThanks",
    "contact_name": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Removal of Products",
        "code": "ADD-374542",
        "type": "Remove product"
      }
    ],
    "status": "completed",
    "created_at": "2026-07-14T23:00:00.000Z"
  },
  {
    "application_number": "ADD-374574-185",
    "legacy_record_id": "374574",
    "subject": "New Product: McCain Surecrisp Crinkle Cut",
    "message": "Hi,\r\nCould you approve new product McCain Surecrisp Crinkle Cut please?\r\nKind regards,\r\nOlcay\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\nHi,\r\nCould you approve new product McCain Surecrisp Crinkle Cut please?\r\nKind regards,\r\nOlcay",
    "contact_name": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "New Product: McCain Surecrisp Crinkle Cut",
        "code": "ADD-374574",
        "type": "Add product"
      }
    ],
    "status": "submitted",
    "created_at": "2026-07-22T23:00:00.000Z"
  },
  {
    "application_number": "ADD-374588-185",
    "legacy_record_id": "374588",
    "subject": "Products additional codes approval request",
    "message": "Hi,\r\nCould you approved McCain Surecrisp Julienne 1000014441 & McCain Surecrisp Skin on Chips Thin Cut 1000014448 please?\r\nThank you.",
    "contact_name": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "Products additional codes approval request",
        "code": "ADD-374588",
        "type": "Add product"
      }
    ],
    "status": "submitted",
    "created_at": "2026-07-28T23:00:00.000Z"
  },
  {
    "application_number": "ADD-374589-185",
    "legacy_record_id": "374589",
    "subject": "Product additional codes approval request",
    "message": "Hi,\r\n\r\nCould you approve McCain Surecrisp Julienne 1000014441 & McCain Surecrisp Skin on Chips Thin Cut 1000014448 please?\r\nThanks",
    "contact_name": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Product additional codes approval request",
        "code": "ADD-374589",
        "type": "Add product"
      }
    ],
    "status": "completed",
    "created_at": "2026-07-28T23:00:00.000Z"
  },
  {
    "application_number": "ADD-374690-185",
    "legacy_record_id": "374690",
    "subject": "McCain Surecrisp Crinkle Cut code addition",
    "message": "Good afternoon,\r\nCould you approve new code 1000014487 for McCain Surecrisp Crinkle Cut please?\r\nKind regards,\r\nOlcay",
    "contact_name": "David Snell",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "McCain Surecrisp Crinkle Cut code addition",
        "code": "ADD-374690",
        "type": "Add product"
      }
    ],
    "status": "submitted",
    "created_at": "2026-09-01T23:00:00.000Z"
  },
  {
    "application_number": "ADD-374728-185",
    "legacy_record_id": "374728",
    "subject": "McCain Max Crunch Products",
    "message": "Hi, \r\n\r\nPlease can you assess these 2 products we are looking to launch so we can add the HFA Logo to the artwork? \r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "10009",
    "site_name": "Whittlesey",
    "products": [
      {
        "sn": 1,
        "name": "McCain Max Crunch Products",
        "code": "ADD-374728",
        "type": "Add product"
      }
    ],
    "status": "submitted",
    "created_at": "2026-09-20T23:00:00.000Z"
  },
  {
    "application_number": "ADD-374729-185",
    "legacy_record_id": "374729",
    "subject": "Max Crunch",
    "message": "Hi, \r\n\r\nPlease can you assess these 2 products we are looking to launch so we can add the HFA Logo to the artwork? \r\n\r\nRegards\r\n\r\nShane",
    "contact_name": "Shane Green",
    "contact_email": "shane.green@mccain.co.uk",
    "site_client_code": "20220",
    "site_name": "Scarborough",
    "products": [
      {
        "sn": 1,
        "name": "Max Crunch",
        "code": "ADD-374729",
        "type": "Add product"
      }
    ],
    "status": "submitted",
    "created_at": "2026-09-20T23:00:00.000Z"
  }
];

async function seedMcCain() {
  try {
    console.log('Connecting to MongoDB...');
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI is not set in environment or .env file');
    }
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB:', mongoose.connection.name);

    // 1. User Account
    console.log('\n1️⃣ Processing User (' + email + ')...');
    let user = await User.findOne({
      $or: [
        { email },
        { company_name: companyName }
      ]
    });

    const userProfileData = {
      email,
      full_name: 'Shane Green',
      company_name: companyName,
      phone: '01723580213',
      address: 'Havers Hill, Scarborough, YO11 3BS',
      city: 'Scarborough',
      postcode: 'YO11 3BS',
      country: 'United Kingdom',
      role: 'client',
      client_role: 'owner',
      roles: ['client'],
      company_category: 'certified',
      is_active: true,
      is_verified: true,
      notes: 'Imported from legacy HFA portal (CID: 185 - McCain Foods)'
    };

    if (!user) {
      user = new User({
        ...userProfileData,
        password: plainPassword,
      });
      await user.save();
      console.log('   ✅ Created client user: ' + user.email + ' (ID: ' + user._id + ')');
    } else {
      Object.assign(user, userProfileData);
      user.password = plainPassword;
      await user.save();
      console.log('   ℹ️ User ' + user.email + ' updated with password ' + plainPassword + ' (ID: ' + user._id + ')');
    }

    const userIdStr = user._id.toString();

    // Clean up any extraneous sites for McCain Foods (e.g. Wombourne or Hull from GSO scheme CID 186)
    const validClientCodes = siteDefs.map(s => s.client_code);
    const removedSites = await Site.deleteMany({ client_id: userIdStr, client_code: { $nin: validClientCodes } });
    if (removedSites.deletedCount > 0) {
      console.log('   🧹 Cleaned up ' + removedSites.deletedCount + ' non-CID-185 sites');
    }

    // 2. Sites (5 Sites)
    console.log('\n2️⃣ Processing ' + siteDefs.length + ' Sites...');
    const siteMap = {};
    for (const sDef of siteDefs) {
      let site = await Site.findOne({ client_id: userIdStr, client_code: sDef.client_code });
      if (!site) {
        site = await Site.findOne({ client_id: userIdStr, name: sDef.name });
      }

      const sitePayload = {
        client_id: userIdStr,
        name: sDef.name,
        est_name: sDef.est_name,
        trading_name: sDef.trading_name,
        address_1: sDef.address_1,
        address_2: sDef.address_2,
        city: sDef.city,
        state: sDef.state,
        postcode: sDef.postcode,
        country: sDef.country,
        contact_name: sDef.contact_name,
        contact_phone_number: sDef.contact_phone_number,
        email: sDef.email,
        client_code: sDef.client_code,
        status: sDef.status
      };

      if (!site) {
        site = new Site(sitePayload);
        await site.save();
        console.log('   ✅ Created Site: ' + site.name + ' (Code: ' + site.client_code + ')');
      } else {
        Object.assign(site, sitePayload);
        await site.save();
        console.log('   ℹ️ Updated Site: ' + site.name + ' (Code: ' + site.client_code + ')');
      }
      siteMap[sDef.client_code] = site;
      siteMap[sDef.name] = site;
    }

    const defaultSite = siteMap['10009'] || Object.values(siteMap)[0];

    // Clean up any extraneous applications for McCain Foods (e.g. from GSO scheme CID 186)
    const allAppsToProcess = [
      ...applicationsData.map(a => ({ ...a, is_renewal: false, is_surveillance: false })),
      ...renewalsData.map(r => ({ ...r, is_renewal: true, is_surveillance: false }))
    ];
    const validAppNumbers = allAppsToProcess.map(a => a.application_number);
    const removedApps = await Application.deleteMany({ client_id: user._id, application_number: { $nin: validAppNumbers } });
    if (removedApps.deletedCount > 0) {
      console.log('   🧹 Cleaned up ' + removedApps.deletedCount + ' non-CID-185 applications');
    }

    // 3. Applications (7 New + 22 Renewals = 29 Applications)
    console.log('\n3️⃣ Processing ' + allAppsToProcess.length + ' Applications (7 New + 22 Renewals)...');
    const appMap = {};
    for (const app of allAppsToProcess) {
      const site = siteMap[app.site_client_code] || siteMap[app.site_name] || defaultSite;
      const appDoc = {
        application_number: app.application_number,
        client_id: user._id,
        application_type: app.application_type,
        category: app.category,
        establishment_name: companyName,
        establishment_address: 'Havers Hill, Scarborough, YO11 3BS, United Kingdom',
        site_name: site?.name || app.site_name,
        site_id: site ? site._id.toString() : null,
        reg_number: '733218 England',
        vat_number: 'GB 167 323 854',
        managing_director: app.managing_director || 'Shane Green',
        employee_count: app.employee_count || 1800,
        status: app.status,
        created_at: app.submission_date || new Date(),
        notes: app.notes || 'Imported from legacy HFA database (CID: 185)',
      };

      const saved = await Application.findOneAndUpdate(
        { application_number: app.application_number },
        { $set: appDoc },
        { upsert: true, new: true }
      );
      appMap[app.application_number] = saved;
      console.log('   ✅ Saved Application: ' + app.application_number + ' (' + app.status + ') - Site: ' + site?.name);
    }

    // Clean up any extraneous certificates for McCain Foods (e.g. from GSO scheme CID 186)
    const validCertNumbers = certificatesData.map(c => c.certificate_number);
    const removedCerts = await Certificate.deleteMany({ client_id: userIdStr, certificate_number: { $nin: validCertNumbers } });
    if (removedCerts.deletedCount > 0) {
      console.log('   🧹 Cleaned up ' + removedCerts.deletedCount + ' non-CID-185 certificates');
    }

    // 4. Halal Certificates (28 Certificates)
    console.log('\n4️⃣ Processing ' + certificatesData.length + ' Halal Certificates...');
    const certMap = {};
    for (const c of certificatesData) {
      const site = siteMap[c.site_client_code] || siteMap[c.site_name] || defaultSite;
      let certificateUrl = null;

      try {
        const existingCert = await Certificate.findOne({ certificate_number: c.certificate_number });
        if (existingCert?.certificate_url) {
          certificateUrl = existingCert.certificate_url;
        } else {
          console.log('   📄 Generating PDF for Certificate ' + c.certificate_number + ' (' + c.certificate_type + ')...');
          const pdfBuffer = await generateCertificate({
            businessName: companyName,
            businessAddress: c.company_address,
            manufacturerAddress: c.manufacturing_address,
            certificateNumber: c.certificate_number,
            scopeOfCertification: c.scope,
            scheme: c.certificate_type,
            productCategories: c.product_details && c.product_details.length > 0 ? c.product_details : [{ code: 'CIV', name: 'Frozen Potato Products' }],
            issueDate: new Date(c.issue_date),
            expiryDate: new Date(c.expiry_date),
            cycleStartDate: new Date(c.current_cycle_start_date),
            verificationUrl: getClientUrl() + '/verify/' + encodeURIComponent(c.certificate_number)
          });

          const filename = c.certificate_number.replace(/[\/\\:]/g, '_') + '.pdf';
          certificateUrl = await uploadToGridFS(pdfBuffer, filename, 'application/pdf');
          console.log('   ✅ Certificate PDF uploaded to GridFS: ' + certificateUrl);
        }
      } catch (pdfErr) {
        console.warn('   ⚠️ Note on PDF generation for ' + c.certificate_number + ':', pdfErr.message);
      }

      const linkedApp = Object.values(appMap).find(a => (a.site_name === site?.name) || (a.category === c.certificate_type)) || Object.values(appMap)[0];

      const certDoc = {
        certificate_number: c.certificate_number,
        client_id: userIdStr,
        application_id: linkedApp ? linkedApp._id : null,
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
        product_details: c.product_details,
        site_id: site ? site._id : null,
        notes: 'Imported from legacy HFA database (CID: 185, Site: ' + c.site_name + ')'
      };

      const savedCert = await Certificate.findOneAndUpdate(
        { certificate_number: c.certificate_number },
        { $set: certDoc },
        { upsert: true, new: true }
      );
      certMap[c.certificate_number] = savedCert;
      console.log('   ✅ Saved Certificate: ' + c.certificate_number + ' (' + c.status + ') - Site: ' + site?.name);
    }

    // Clean up any extraneous products for McCain Foods (e.g. from GSO scheme CID 186)
    const validSiteCodes = siteDefs.map(s => s.client_code);
    const validSites = await Site.find({ client_id: userIdStr, client_code: { $in: validSiteCodes } });
    const validSiteIds = validSites.map(s => s._id);
    const removedProds = await Product.deleteMany({ client_id: user._id, site_id: { $nin: validSiteIds } });
    if (removedProds.deletedCount > 0) {
      console.log('   🧹 Cleaned up ' + removedProds.deletedCount + ' non-CID-185 products');
    }

    // 5. Products (225 Products)
    console.log('\n5️⃣ Processing ' + productsData.length + ' Products...');
    for (const p of productsData) {
      const site = siteMap[p.site_client_code] || siteMap[p.site_name] || defaultSite;
      const pDoc = {
        client_id: user._id,
        name: p.name,
        code: p.code,
        category: p.category,
        site_id: site ? site._id : null,
        status: 'active',
        notes: 'Imported from legacy HFA database (CID: 185). Product code ' + p.code
      };

      await Product.findOneAndUpdate(
        { client_id: user._id, name: p.name, code: p.code, site_id: site ? site._id : null },
        { $set: pDoc },
        { upsert: true, new: true }
      );
    }
    console.log('   ✅ Successfully processed all ' + productsData.length + ' products!');

    // Clean up any extraneous add-ons for McCain Foods (e.g. from GSO scheme CID 186 or stale ADDON-)
    const validAddOnNumbers = addOnsData.map(a => a.application_number);
    const removedAddOns = await AddOnApplication.deleteMany({ client_id: user._id, application_number: { $nin: validAddOnNumbers } });
    if (removedAddOns.deletedCount > 0) {
      console.log('   🧹 Cleaned up ' + removedAddOns.deletedCount + ' non-CID-185 add-ons');
    }

    // 6. Add-On Applications (151 Add-Ons)
    console.log('\n6️⃣ Processing ' + addOnsData.length + ' Add-On Applications...');
    const primaryCert = Object.values(certMap)[0];
    let addOnCount = 0;
    for (const addOn of addOnsData) {
      const site = siteMap[addOn.site_client_code] || siteMap[addOn.site_name] || defaultSite;

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
      addOnCount++;
      if (addOnCount % 25 === 0 || addOnCount === addOnsData.length) {
        console.log('   ✅ Processed ' + addOnCount + '/' + addOnsData.length + ' Add-On Applications');
      }
    }
    console.log('   ✅ Successfully processed all ' + addOnsData.length + ' Add-On Applications!');

    console.log('\n=============================================================================');
    console.log('🎉 MCCAIN FOODS (CID: 185) FULL MIGRATION COMPLETED SUCCESSFULLY!');
    console.log('=============================================================================');
    console.log('👤 Email        : ' + email);
    console.log('🔑 Password     : ' + plainPassword);
    console.log('🏢 Company      : ' + companyName);
    console.log('📍 Sites        : ' + siteDefs.length + ' (Whittlesey, Scarborough, Grantham, Lutosa, Albert Bartlett)');
    console.log('📝 Applications : ' + allAppsToProcess.length + ' (7 New + 22 Renewals)');
    console.log('📜 Certificates : ' + certificatesData.length + ' (All HFA Scheme)');
    console.log('📦 Products     : ' + productsData.length);
    console.log('➕ Add-Ons      : ' + addOnsData.length + ' (All 151 variation requests with specific types)');
    console.log('=============================================================================\n');

    await mongoose.disconnect();
    console.log('🚀 All operations finished successfully.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Seeding failed:', err);
    process.exit(1);
  }
}

seedMcCain();
