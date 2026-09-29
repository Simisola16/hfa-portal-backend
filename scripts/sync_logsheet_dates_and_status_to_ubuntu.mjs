import fs from 'fs';
import readline from 'readline';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureMongoTunnel } from '../lib/tunnel.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const filePath = path.resolve(__dirname, '../sql-server-export/export/HalalTick/tables/dbo.tlblogsit.json');

const monthMap = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};

function parseSqlDate(val, fallbackYear = null) {
  if (!val) return null;
  let s = String(val).trim();
  if (!s || s === '-' || s === 'NA' || s === 'None' || s === 'null' || s === 'N/A') return null;

  if (s.includes('0001') || s.startsWith('01-Jan-0001') || s.startsWith('0001-01-01')) return null;

  // 1. Direct ISO match: YYYY-MM-DD
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10);
    const d = parseInt(isoMatch[3], 10);
    if (y >= 1990 && y <= 2050 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    }
  }

  // 2. Handle truncated year like '12-Jan-202' or '12-Nov-202'
  if (/^\d{1,2}-[A-Za-z]{3}-20\d\s*$/.test(s)) {
    if (fallbackYear) {
      const m = s.match(/^(\d{1,2}-[A-Za-z]{3}-)(20\d)$/);
      if (m) {
        const lastDigit = String(fallbackYear).slice(-1);
        s = `${m[1]}${m[2]}${lastDigit}`;
      }
    }
  }

  // 3. Handle DD-Mon-YYYY or DD-Mon-YY e.g. 19-Feb-2025 or 24 jUNE 2021
  const dMonYMatch = s.match(/^(\d{1,2})[\s\-]+([A-Za-z]{3,9})[\s\-]+(\d{2,4})/);
  if (dMonYMatch) {
    const day = parseInt(dMonYMatch[1], 10);
    const monStr = dMonYMatch[2].toLowerCase().slice(0, 3);
    let yr = parseInt(dMonYMatch[3], 10);
    if (yr < 100) yr += 2000;
    const mo = monthMap[monStr];
    if (mo && yr >= 1990 && yr <= 2050 && day >= 1 && day <= 31) {
      return new Date(Date.UTC(yr, mo - 1, day, 12, 0, 0));
    }
  }

  // 4. Handle DD/MM/YYYY or DD.MM.YYYY
  const dmyMatch = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const mo = parseInt(dmyMatch[2], 10);
    let yr = parseInt(dmyMatch[3], 10);
    if (yr < 100) yr += 2000;
    if (yr >= 1990 && yr <= 2050 && mo >= 1 && mo <= 12 && day >= 1 && day <= 31) {
      return new Date(Date.UTC(yr, mo - 1, day, 12, 0, 0));
    }
  }

  // 5. Handle M/D/YYYY H:M:S AM/PM (US format like CurrentCycleStartDate)
  const usMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (usMatch) {
    const mo = parseInt(usMatch[1], 10);
    const day = parseInt(usMatch[2], 10);
    const yr = parseInt(usMatch[3], 10);
    if (yr >= 1990 && yr <= 2050 && mo >= 1 && mo <= 12 && day >= 1 && day <= 31) {
      return new Date(Date.UTC(yr, mo - 1, day, 12, 0, 0));
    }
  }

  // Fallback generic parse using local day/month/year components
  const generic = new Date(s);
  if (!isNaN(generic.getTime())) {
    const yr = generic.getFullYear();
    const mo = generic.getMonth();
    const day = generic.getDate();
    if (yr >= 1990 && yr <= 2050) {
      return new Date(Date.UTC(yr, mo, day, 12, 0, 0));
    }
  }

  return null;
}

function cleanStr(val, defaultVal = '') {
  if (val === null || val === undefined) return defaultVal;
  const s = String(val).trim();
  return s === '' || s === '-' || s === 'None' || s === 'null' ? defaultVal : s;
}

async function run() {
  console.log('=============================================================================');
  console.log('🚀 SYNCING LOGSHEET DATES & STATUSES TO UBUNTU PRODUCTION SERVER');
  console.log('=============================================================================');

  console.log('1. Opening SSH tunnel to Ubuntu Server...');
  await ensureMongoTunnel();

  console.log('2. Connecting to Remote MongoDB on Ubuntu (hfa_portal_dev)...');
  const remoteUri = 'mongodb://127.0.0.1:27018/hfa_portal_dev?directConnection=true';
  const remoteConn = await mongoose.createConnection(remoteUri, {
    serverSelectionTimeoutMS: 20000,
    socketTimeoutMS: 120000
  }).asPromise();
  console.log(`✅ Connected to Remote MongoDB: ${remoteConn.db.databaseName}\n`);

  const col = remoteConn.db.collection('applicationlogsheets');

  // Pre-sync counts
  const beforeTotal = await col.countDocuments();
  const beforeCounts = await col.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ]).toArray();
  console.log(`📊 Current Ubuntu Logsheet Counts (Total: ${beforeTotal}):`);
  beforeCounts.forEach(c => console.log(`   • ${String(c._id).padEnd(25)}: ${c.count}`));

  console.log('\n⏳ Streaming SQL export from dbo.tlblogsit.json...');
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 256 * 1024 });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let inRows = false;
  let totalParsed = 0;
  let binExcluded = 0;
  let readyForCertPeriodCount = 0;
  const bulkOps = [];

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!inRows) {
      if (trimmed.startsWith('"rows": [')) inRows = true;
      continue;
    }
    if (trimmed.startsWith('{') && (trimmed.endsWith('},') || trimmed.endsWith('}'))) {
      totalParsed++;
      const cleanJson = trimmed.endsWith(',') ? trimmed.slice(0, -1) : trimmed;
      try {
        const row = JSON.parse(cleanJson);
        const rawStatus = cleanStr(row.Statuss);

        // Exclude Bin
        if (rawStatus.toLowerCase() === 'bin') {
          binExcluded++;
          continue;
        }

        const ider = cleanStr(row.ider);
        if (!ider) continue;

        let fbYear = null;
        if (row.dayy) {
          const m = String(row.dayy).match(/^(\d{4})/);
          if (m) fbYear = parseInt(m[1], 10);
        }

        const dayyDate = parseSqlDate(row.dayy) || parseSqlDate(row.Datee, fbYear);

        const setDoc = {};

        if (dayyDate) {
          setDoc.createdAt = dayyDate;
          setDoc.created_at = dayyDate;
        }

        // Only update status to 'Completed' for the 103 'Ready for Certificate.' rows
        if (rawStatus === 'Ready for Certificate.') {
          readyForCertPeriodCount++;
          setDoc.status = 'Completed';
        }

        // Remaining dates mapped correctly with system records
        const auditDate = parseSqlDate(row.Audidate, fbYear);
        if (auditDate) setDoc.audit_date = auditDate;

        const issueDate = parseSqlDate(row.IssDateOCert, fbYear);
        if (issueDate) setDoc.issue_date = issueDate;

        const expiryDate = parseSqlDate(row.ExPiryDatCert, fbYear);
        if (expiryDate) setDoc.expiry_date = expiryDate;

        const reviewDate = parseSqlDate(row.ReDate, fbYear);
        if (reviewDate) setDoc.review_date = reviewDate;

        const statusDate = parseSqlDate(row.Datee, fbYear) || parseSqlDate(row.daOAgree, fbYear) || dayyDate;
        if (statusDate) setDoc.status_date = statusDate;

        const curCycle = parseSqlDate(row.CurrentCycleStartDate, fbYear);
        if (curCycle) setDoc.current_cycle_start = curCycle;

        const origCycle = parseSqlDate(row.OriginalCycleStartDate, fbYear);
        if (origCycle) setDoc.original_cycle_start = origCycle;

        // Signatures
        const hasMuftiSig = Boolean(cleanStr(row.MufityBy) || cleanStr(row.NameC) || row.Mufitysinf || row.Singnaturee);
        if (hasMuftiSig) {
          const mDate = parseSqlDate(row.Mufitydate, fbYear) || parseSqlDate(row.Datee, fbYear) || dayyDate;
          if (mDate) setDoc.mufti_sign_date = mDate;
        } else {
          setDoc.mufti_sign_date = null;
        }

        const hasCeoSig = Boolean(cleanStr(row.ceoby) || cleanStr(row.NameC2) || row.cebsing);
        if (hasCeoSig) {
          const cDate = parseSqlDate(row.ceodateby, fbYear) || parseSqlDate(row.Datee, fbYear) || dayyDate;
          if (cDate) setDoc.ceo_sign_date = cDate;
        } else {
          setDoc.ceo_sign_date = null;
        }

        const hasMgrSig = Boolean(cleanStr(row.SchemBy) || cleanStr(row.NameC3) || row.SchemSing);
        if (hasMgrSig) {
          const sDate = parseSqlDate(row.SchemDate, fbYear) || parseSqlDate(row.Datee, fbYear) || dayyDate;
          if (sDate) setDoc.manager_sign_date = sDate;
        } else {
          setDoc.manager_sign_date = null;
        }

        if (row.Mufitysinf1 || cleanStr(row.MufityBy1) || cleanStr(row.NameC4)) {
          const m2Date = parseSqlDate(row.Mufitydate1, fbYear) || parseSqlDate(row.Datee, fbYear) || dayyDate;
          if (m2Date) setDoc.mufti2_sign_date = m2Date;
        } else {
          setDoc.mufti2_sign_date = null;
        }

        bulkOps.push({
          updateOne: {
            filter: { legacy_id: ider },
            update: { $set: setDoc }
          }
        });

      } catch (err) {}
    }
  }

  console.log(`\n📦 Readline parsing complete:`);
  console.log(`   • Total SQL Rows Processed: ${totalParsed}`);
  console.log(`   • Bin Rows Excluded: ${binExcluded}`);
  console.log(`   • 'Ready for Certificate.' Rows: ${readyForCertPeriodCount}`);
  console.log(`   • Total Bulk Operations Prepared: ${bulkOps.length}\n`);

  console.log('⚡ Executing bulk updates to Ubuntu MongoDB in batches of 500...');
  let totalMatched = 0;
  let totalModified = 0;
  const batchSize = 500;

  for (let i = 0; i < bulkOps.length; i += batchSize) {
    const batch = bulkOps.slice(i, i + batchSize);
    const res = await col.bulkWrite(batch, { ordered: false });
    totalMatched += (res.matchedCount || 0);
    totalModified += (res.modifiedCount || 0);
    process.stdout.write(`   ✓ Processed ${Math.min(i + batchSize, bulkOps.length)} / ${bulkOps.length} operations...\r`);
  }

  console.log(`\n\n✅ Remote bulk update complete:`);
  console.log(`   • Documents Matched: ${totalMatched}`);
  console.log(`   • Documents Modified: ${totalModified}\n`);

  // Post-sync counts
  const afterCounts = await col.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ]).toArray();
  console.log(`📊 Updated Ubuntu Logsheet Status Counts:`);
  afterCounts.forEach(c => console.log(`   • ${String(c._id).padEnd(25)}: ${c.count}`));

  // Check for any remaining year 0202 or < 1900 dates
  const weirdCeo = await col.countDocuments({ ceo_sign_date: { $lt: new Date('1900-01-01') } });
  const weirdMgr = await col.countDocuments({ manager_sign_date: { $lt: new Date('1900-01-01') } });
  console.log(`\n🔍 Sanity Checks on Ubuntu:`);
  console.log(`   • Documents with ceo_sign_date < 1900: ${weirdCeo}`);
  console.log(`   • Documents with manager_sign_date < 1900: ${weirdMgr}`);

  // Sample check on updated document
  const sample = await col.findOne({ legacy_id: '232943' });
  console.log(`\n📋 Sample Logsheet (legacy_id 232943 - was 'Ready for Certificate.'):`);
  console.log({
    legacy_id: sample?.legacy_id,
    company_name: sample?.company_name,
    status: sample?.status,
    createdAt: sample?.createdAt,
    created_at: sample?.created_at,
    audit_date: sample?.audit_date,
    issue_date: sample?.issue_date,
    current_cycle_start: sample?.current_cycle_start,
    original_cycle_start: sample?.original_cycle_start,
    ceo_sign_date: sample?.ceo_sign_date,
    mufti_sign_date: sample?.mufti_sign_date,
    manager_sign_date: sample?.manager_sign_date
  });

  await remoteConn.close();
  console.log('\n🏁 Ubuntu sync completed successfully.');
  process.exit(0);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
