import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import readline from 'readline';

dotenv.config();

function cleanStr(val) {
  if (val === null || val === undefined) return '';
  const s = String(val).trim();
  return s === 'NULL' || s === 'null' || s === 'undefined' ? '' : s;
}

// Robust date parsing for certificate and legacy records
function parseCertDate(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (!s || s === 'null' || s === 'undefined' || s === '-' || s === 'not set' || s === 'used to be HFA') return null;
  if (s.includes('0001')) return null;

  // Handle DD/MM/YYYY slash format
  const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const day = parseInt(slashMatch[1], 10);
    const month = parseInt(slashMatch[2], 10) - 1;
    const year = parseInt(slashMatch[3], 10);
    const d = new Date(Date.UTC(year, month, day));
    return isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(s);
  if (isNaN(d.getTime()) || d.getFullYear() < 1990) return null;
  return d;
}

// Extract date from QR code format in certificate number (e.g. "LE-BU/QR230504014749" -> 2023-05-04)
function extractDateFromCertNo(certNo) {
  if (!certNo) return null;
  const match = String(certNo).match(/QR(\d{2})(\d{2})(\d{2})/);
  if (match) {
    const year = 2000 + parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    const d = new Date(Date.UTC(year, month, day));
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

async function main() {
  console.log('🔄 Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const certCol = db.collection('certificates');

  const initialTotal = await certCol.countDocuments();
  console.log(`📊 Total certificates in MongoDB: ${initialTotal}`);

  // 1. Load tlbcertMas from SQL export into memory map
  const sqlFile = 'sql-server-export/export/HalalCert/tables/dbo.tlbcertMas.json';
  if (!fs.existsSync(sqlFile)) {
    console.error(`❌ SQL export file not found: ${sqlFile}`);
    process.exit(1);
  }

  console.log('📖 Reading dbo.tlbcertMas.json...');
  const sqlMap = new Map();
  const rl = readline.createInterface({ input: fs.createReadStream(sqlFile) });

  let sqlRows = 0;
  for await (const line of rl) {
    if (!line.trim().startsWith('{')) continue;
    try {
      const obj = JSON.parse(line.trim().replace(/,$/, ''));
      sqlRows++;
      const certNo = cleanStr(obj.CertificateNo);
      const altCertNo = cleanStr(obj.CertficatNo);
      const ider = cleanStr(obj.ider);

      if (certNo) sqlMap.set(certNo.toLowerCase(), obj);
      if (altCertNo) sqlMap.set(altCertNo.toLowerCase(), obj);
      if (ider) sqlMap.set(`cert-${ider}`.toLowerCase(), obj);
    } catch (e) {}
  }
  console.log(`✅ Loaded ${sqlRows} rows from tlbcertMas into lookup map (${sqlMap.size} keys).`);

  // 2. Fetch all certificates from MongoDB
  const allCerts = await certCol.find({}).toArray();
  const bulkOps = [];

  let countScopeCleaned = 0;
  let countNotesCleaned = 0;
  let countCategoryCleaned = 0;
  let countTypeUpdated = 0;
  let countDatesCorrected = 0;
  let countOrigDatesCleaned = 0;

  for (const cert of allCerts) {
    const certKey = cleanStr(cert.certificate_number).toLowerCase();
    const sqlRow = sqlMap.get(certKey);

    let newCategory = cert.product_category || '';
    let newScope = cert.scope || '';
    let newType = cert.certificate_type || '';
    let newNotes = cert.notes || '';

    // A. Determine clean category
    if (sqlRow) {
      newCategory = cleanStr(sqlRow.PRODUCTCATEGORY);
    } else if (newCategory === 'Food & Beverage') {
      newCategory = '';
    }

    // B. Determine clean scope (must match category, no "Halal certification of ", empty if no category)
    if (sqlRow) {
      newScope = cleanStr(sqlRow.PRODUCTCATEGORY);
    } else {
      newScope = (newScope || '')
        .replace(/^Halal certification of\s*/i, '')
        .replace(/^compliant products$/i, '')
        .trim();
      if (newScope === 'Food & Beverage') newScope = '';
    }

    // C. Determine clean certificate_type (from GFP if available)
    if (sqlRow && cleanStr(sqlRow.GFP)) {
      newType = cleanStr(sqlRow.GFP);
    }

    // D. Clean notes (strip synthetic legacy database note)
    if (newNotes && (
      newNotes.startsWith('Imported from legacy HFA database') ||
      newNotes.includes('Imported from legacy HFA database')
    )) {
      newNotes = '';
    }

    // E. Accurate Date Resolution
    let newIssue = cert.issue_date;
    let newExp = cert.expiry_date;
    let newCur = cert.current_cycle_start_date;
    let newOrig = cert.original_cycle_start_date;
    let newStatus = cert.status;

    if (sqlRow) {
      const parsedIssue = parseCertDate(sqlRow.IssueDate) || 
                          parseCertDate(sqlRow.Dateer) || 
                          parseCertDate(sqlRow.AproDate) || 
                          extractDateFromCertNo(cert.certificate_number);

      let parsedExp = parseCertDate(sqlRow.ExpiryDate);
      if (!parsedExp && parsedIssue) {
        parsedExp = new Date(parsedIssue.getTime() + 365 * 24 * 60 * 60 * 1000);
      }

      const parsedCur = parseCertDate(sqlRow.CurrentCyStartDate) || parsedIssue;
      const parsedOrig = parseCertDate(sqlRow.OriginalCyStartDate) || null;

      newIssue = parsedIssue || cert.issue_date;
      newExp = parsedExp || cert.expiry_date;
      newCur = parsedCur || cert.current_cycle_start_date;
      newOrig = parsedOrig; // strictly null if not provided in SQL!

      // Correct status if expired
      const isExpired = newExp ? newExp < new Date() : false;
      const rawStatus = cleanStr(sqlRow.Statuss).toLowerCase();
      if (rawStatus === 'submitted') {
        newStatus = 'under_review';
      } else if (isExpired) {
        newStatus = 'expired';
      } else {
        newStatus = 'active';
      }
    }

    // F. Clean product_details categories if they had fallback 'General' or 'Food & Beverage'
    let updatedProductDetails = cert.product_details;
    if (Array.isArray(cert.product_details) && cert.product_details.length > 0) {
      updatedProductDetails = cert.product_details.map(p => ({
        ...p,
        category: (p.category === 'General' || p.category === 'Food & Beverage' || !p.category) 
          ? newCategory 
          : p.category
      }));
    }

    // Track changes
    let hasChanges = false;
    const updateDoc = {};

    if (cert.product_category !== newCategory) {
      updateDoc.product_category = newCategory;
      countCategoryCleaned++;
      hasChanges = true;
    }

    if (cert.scope !== newScope) {
      updateDoc.scope = newScope;
      countScopeCleaned++;
      hasChanges = true;
    }

    if (cert.notes !== newNotes) {
      updateDoc.notes = newNotes;
      countNotesCleaned++;
      hasChanges = true;
    }

    if (cert.certificate_type !== newType) {
      updateDoc.certificate_type = newType;
      countTypeUpdated++;
      hasChanges = true;
    }

    // Date changes check
    const oldIssueStr = cert.issue_date ? new Date(cert.issue_date).toISOString() : '';
    const newIssueStr = newIssue ? new Date(newIssue).toISOString() : '';
    if (oldIssueStr !== newIssueStr) {
      updateDoc.issue_date = newIssue;
      countDatesCorrected++;
      hasChanges = true;
    }

    const oldExpStr = cert.expiry_date ? new Date(cert.expiry_date).toISOString() : '';
    const newExpStr = newExp ? new Date(newExp).toISOString() : '';
    if (oldExpStr !== newExpStr) {
      updateDoc.expiry_date = newExp;
      hasChanges = true;
    }

    const oldCurStr = cert.current_cycle_start_date ? new Date(cert.current_cycle_start_date).toISOString() : '';
    const newCurStr = newCur ? new Date(newCur).toISOString() : '';
    if (oldCurStr !== newCurStr) {
      updateDoc.current_cycle_start_date = newCur;
      hasChanges = true;
    }

    const oldOrigStr = cert.original_cycle_start_date ? new Date(cert.original_cycle_start_date).toISOString() : '';
    const newOrigStr = newOrig ? new Date(newOrig).toISOString() : '';
    if (oldOrigStr !== newOrigStr) {
      updateDoc.original_cycle_start_date = newOrig;
      countOrigDatesCleaned++;
      hasChanges = true;
    }

    if (cert.status !== newStatus) {
      updateDoc.status = newStatus;
      hasChanges = true;
    }

    if (hasChanges || JSON.stringify(cert.product_details) !== JSON.stringify(updatedProductDetails)) {
      updateDoc.product_details = updatedProductDetails;
      bulkOps.push({
        updateOne: {
          filter: { _id: cert._id },
          update: { $set: updateDoc }
        }
      });
    }
  }

  console.log('\n--- Planned Updates ---');
  console.log(`Issue dates corrected (repaired false "today" dates & slashes): ${countDatesCorrected}`);
  console.log(`Original cycle dates cleaned (removed false copy of issue_date): ${countOrigDatesCleaned}`);
  console.log(`Scopes to clean: ${countScopeCleaned}`);
  console.log(`Notes to clean: ${countNotesCleaned}`);
  console.log(`Categories to clean: ${countCategoryCleaned}`);
  console.log(`Certificate types to update: ${countTypeUpdated}`);
  console.log(`Total certificate records to update: ${bulkOps.length}`);

  if (bulkOps.length > 0) {
    const result = await certCol.bulkWrite(bulkOps);
    console.log(`\n🎉 Successfully executed bulkWrite! Modified: ${result.modifiedCount}`);
  } else {
    console.log('\n✅ All certificates are already completely up to date!');
  }

  // 3. Post-verification
  const sampleRepaired = await certCol.findOne({ certificate_number: 'PU-MU/QR240605074611' });
  if (sampleRepaired) {
    console.log('\nSample Repaired Certificate (PU-MU/QR240605074611):');
    console.log(JSON.stringify({
      certificate_number: sampleRepaired.certificate_number,
      issue_date: sampleRepaired.issue_date,
      expiry_date: sampleRepaired.expiry_date,
      current_cycle_start_date: sampleRepaired.current_cycle_start_date,
      original_cycle_start_date: sampleRepaired.original_cycle_start_date,
      status: sampleRepaired.status
    }, null, 2));
  }

  await mongoose.disconnect();
  console.log('\n✅ Done!');
}

main().catch(err => {
  console.error('Fatal error during certificate cleanup:', err);
  process.exit(1);
});
