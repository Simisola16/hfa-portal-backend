import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TRACKER_FILE = path.resolve(__dirname, '../scratch/import_tracker.json');

function renderTracker() {
  if (!fs.existsSync(TRACKER_FILE)) {
    console.clear();
    console.log('⏳ Waiting for import to initialize (scratch/import_tracker.json)...');
    return;
  }

  try {
    const data = JSON.parse(fs.readFileSync(TRACKER_FILE, 'utf8'));
    console.clear();
    const width = 80;
    console.log('╔' + '═'.repeat(width - 2) + '╗');
    console.log(`║ 🏢 HFA MONGODB COMPANY IMPORT LIVE MONITOR`.padEnd(width - 1) + '║');
    console.log('╠' + '═'.repeat(width - 2) + '╣');
    
    const pct = parseFloat(data.percent || 0);
    const barWidth = 30;
    const filled = Math.round((pct / 100) * barWidth);
    const bar = '█'.repeat(filled) + '░'.repeat(Math.max(0, barWidth - filled));

    console.log(`║ Status       : ${data.isComplete ? '✅ COMPLETED' : '⚡ IN PROGRESS'} (${data.percent})`.padEnd(width - 1) + '║');
    console.log(`║ Progress     : [${bar}] ${data.processedCompanies || 0} / ${data.totalCompanies || 1345}`.padEnd(width - 1) + '║');
    console.log(`║ Elapsed Time : ${data.elapsedMinutes || 0} mins | ETA: ${data.estimatedRemainingMinutes || 'N/A'} mins`.padEnd(width - 1) + '║');
    console.log(`║ Current Co.  : CID ${data.currentCid || 'N/A'} - ${(data.currentCompany || '').substring(0, 45)}`.padEnd(width - 1) + '║');
    console.log('╠' + '═'.repeat(width - 2) + '╣');
    console.log(`║ MONGODB ENTITIES CREATED / UPDATED:`.padEnd(width - 1) + '║');

    const s = data.stats || {};
    console.log(`║ • 👤 User Accounts       : ${s.usersCreated || 0} created, ${s.usersUpdated || 0} updated`.padEnd(width - 1) + '║');
    console.log(`║ • 📍 Manufacturing Sites : ${s.sitesCreated || 0} sites`.padEnd(width - 1) + '║');
    console.log(`║ • 📝 Applications        : ${s.appsCreated || 0} applications & renewals`.padEnd(width - 1) + '║');
    console.log(`║ • 📜 Halal Certificates  : ${s.certsCreated || 0} certificates`.padEnd(width - 1) + '║');
    console.log(`║ • 📦 Products Covered    : ${s.productsCreated || 0} products`.padEnd(width - 1) + '║');
    console.log(`║ • ➕ Add-On Applications : ${s.addOnsCreated || 0} add-on requests`.padEnd(width - 1) + '║');
    console.log(`║ • 🚢 Export Certificates : ${s.exportCertsCreated || 0} export certificates`.padEnd(width - 1) + '║');
    console.log(`║ • 📄 Proposals           : ${s.proposalsCreated || 0} proposals`.padEnd(width - 1) + '║');
    console.log(`║ • 🤝 Agreements          : ${s.agreementsCreated || 0} agreements`.padEnd(width - 1) + '║');
    console.log(`║ • 💳 Invoices            : ${s.invoicesCreated || 0} invoices`.padEnd(width - 1) + '║');
    console.log(`║ • ⚠️  Errors Encountered  : ${(s.errors && s.errors.length) || 0}`.padEnd(width - 1) + '║');
    console.log('╠' + '═'.repeat(width - 2) + '╣');
    console.log(`║ Web Dashboard: http://localhost:4040`.padEnd(width - 1) + '║');
    console.log('╚' + '═'.repeat(width - 2) + '╝');
    console.log('\n(Press Ctrl+C to exit monitor. Import will continue running in background.)\n');

    if (data.isComplete) {
      process.exit(0);
    }
  } catch (err) {
    // Read collision during JSON write, retry next cycle
  }
}

renderTracker();
setInterval(renderTracker, 1500);
