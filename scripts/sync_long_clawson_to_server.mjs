/**
 * Sync / Import all Long Clawson Dairy Ltd data from local MongoDB to Ubuntu Server MongoDB
 * 
 * Synchronizes:
 * 1. User (carl.robinson@clawson.co.uk)
 * 2. Sites (Melton Mowbray & Bottesford)
 * 3. Products (13 products)
 * 4. Applications (15 applications: 2 initial, 12 renewals, 1 addon)
 * 5. Certificates (11 certificates with live S3 URLs)
 * 6. Invoices (4 invoices)
 * 7. Audits (3 audits)
 * 8. ApplicationLogsheets (links 12 existing logsheets on the server to the client & sites)
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { ensureMongoTunnel } = await import('../lib/tunnel.js');

async function syncClawsonToServer() {
  console.log('=============================================================================');
  console.log('🚀 IMPORTING LONG CLAWSON DAIRY LTD DATA TO UBUNTU SERVER MONGODB');
  console.log('=============================================================================\n');

  // 1. Connect to Local MongoDB
  console.log('1️⃣ Connecting to Local MongoDB...');
  const localConn = await mongoose.createConnection(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 20000
  }).asPromise();
  console.log('   ✓ Connected to Local MongoDB');

  // 2. Fetch all Long Clawson records from Local MongoDB
  const localUser = await localConn.db.collection('users').findOne({ email: 'carl.robinson@clawson.co.uk' });
  if (!localUser) {
    throw new Error('Long Clawson user (carl.robinson@clawson.co.uk) not found in local MongoDB!');
  }
  const userId = localUser._id;
  const userIdStr = String(userId);
  console.log(`   ✓ Found Local User: ${localUser.company_name} (${localUser.email}) [ID: ${userIdStr}]`);

  const localSites = await localConn.db.collection('sites').find({
    $or: [{ client_id: userId }, { client_id: userIdStr }]
  }).toArray();
  console.log(`   ✓ Found ${localSites.length} Sites locally`);

  const localProducts = await localConn.db.collection('products').find({
    $or: [{ client_id: userId }, { client_id: userIdStr }]
  }).toArray();
  console.log(`   ✓ Found ${localProducts.length} Products locally`);

  const localApps = await localConn.db.collection('applications').find({
    $or: [{ client_id: userId }, { client_id: userIdStr }]
  }).toArray();
  console.log(`   ✓ Found ${localApps.length} Applications locally`);

  const localCerts = await localConn.db.collection('certificates').find({
    $or: [{ client_id: userId }, { client_id: userIdStr }]
  }).toArray();
  console.log(`   ✓ Found ${localCerts.length} Certificates locally`);

  const localInvoices = await localConn.db.collection('invoices').find({
    $or: [{ client_id: userId }, { client_id: userIdStr }]
  }).toArray();
  console.log(`   ✓ Found ${localInvoices.length} Invoices locally`);

  const localAudits = await localConn.db.collection('audits').find({
    $or: [{ client_id: userId }, { client_id: userIdStr }]
  }).toArray();
  console.log(`   ✓ Found ${localAudits.length} Audits locally`);

  // 3. Connect to Remote MongoDB on Ubuntu Server via Tunnel
  console.log('\n2️⃣ Establishing SSH Tunnel to Ubuntu Server...');
  await ensureMongoTunnel();
  const remoteUri = 'mongodb://127.0.0.1:27018/hfa_portal_dev?directConnection=true';
  const remoteConn = await mongoose.createConnection(remoteUri, {
    serverSelectionTimeoutMS: 20000,
    socketTimeoutMS: 60000
  }).asPromise();
  console.log(`   ✓ Connected to Remote MongoDB: ${remoteConn.db.databaseName}`);

  // 4. Sync User
  console.log('\n3️⃣ Syncing User to Server...');
  const userPayload = {
    ...localUser,
    roles: ['client'],
    company_category: 'certified',
    is_active: true,
    is_verified: true,
    can_issue_direct_certificate: false,
    is_support_manager: false,
    can_sign_logsheet: false,
    can_review_certificate: false
  };
  await remoteConn.db.collection('users').updateOne(
    { _id: userId },
    { $set: userPayload },
    { upsert: true }
  );
  console.log(`   ✓ User synced: ${userPayload.email} [${userIdStr}]`);

  // 5. Sync Sites
  console.log('\n4️⃣ Syncing Sites to Server...');
  for (const site of localSites) {
    const isBottesford = site.name.toLowerCase().includes('bottesford');
    const sitePayload = {
      ...site,
      client_id: userId,
      client_code: isBottesford ? '20306' : '20298',
      address_1: isBottesford ? 'Orston Lane, Bottesford' : 'Long Clawson',
      city: isBottesford ? 'Nottingham' : 'Melton Mowbray',
      state: isBottesford ? 'Nottinghamshire' : 'Leicestershire',
      postcode: isBottesford ? 'NG13 0AU' : 'LE14 4PJ',
      country: 'United Kingdom',
      contact_name: isBottesford ? 'Paula Marshall' : 'Carl Robinson',
      contact_phone_number: isBottesford ? '01949 842323' : '01664 822232',
      email: isBottesford ? 'paula.marshall@clawson.co.uk' : 'carl.robinson@clawson.co.uk',
      reg_number: '5419R',
      vat_number: '116999525',
      est_name: 'Long Clawson Dairy Ltd',
      status: 'active'
    };
    await remoteConn.db.collection('sites').updateOne(
      { _id: site._id },
      { $set: sitePayload },
      { upsert: true }
    );
    console.log(`   ✓ Site synced: ${site.name} [${site._id}]`);
  }

  // Identify site IDs for linking
  const meltonSite = localSites.find(s => /melton/i.test(s.name)) || localSites[0];
  const bottesfordSite = localSites.find(s => /bottesford/i.test(s.name)) || localSites[1];

  // 6. Sync Products
  console.log('\n5️⃣ Syncing Products to Server...');
  let prodSynced = 0;
  for (const prod of localProducts) {
    const prodPayload = {
      ...prod,
      client_id: userId
    };
    await remoteConn.db.collection('products').updateOne(
      { _id: prod._id },
      { $set: prodPayload },
      { upsert: true }
    );
    prodSynced++;
  }
  console.log(`   ✓ ${prodSynced} Products synced successfully`);

  // 7. Sync Applications
  console.log('\n6️⃣ Syncing Applications to Server...');
  let appsSynced = 0;
  for (const app of localApps) {
    const appPayload = {
      ...app,
      client_id: userId
    };
    await remoteConn.db.collection('applications').updateOne(
      { _id: app._id },
      { $set: appPayload },
      { upsert: true }
    );
    appsSynced++;
  }
  console.log(`   ✓ ${appsSynced} Applications synced successfully`);

  // 8. Sync Certificates
  console.log('\n7️⃣ Syncing Certificates to Server...');
  let certsSynced = 0;
  for (const cert of localCerts) {
    const certPayload = {
      ...cert,
      client_id: userId
    };
    await remoteConn.db.collection('certificates').updateOne(
      { _id: cert._id },
      { $set: certPayload },
      { upsert: true }
    );
    certsSynced++;
  }
  console.log(`   ✓ ${certsSynced} Certificates synced successfully`);

  // 9. Sync Invoices
  console.log('\n8️⃣ Syncing Invoices to Server...');
  let invSynced = 0;
  for (const inv of localInvoices) {
    const invPayload = {
      ...inv,
      client_id: userId
    };
    await remoteConn.db.collection('invoices').updateOne(
      { _id: inv._id },
      { $set: invPayload },
      { upsert: true }
    );
    invSynced++;
  }
  console.log(`   ✓ ${invSynced} Invoices synced successfully`);

  // 10. Sync Audits
  console.log('\n9️⃣ Syncing Audits to Server...');
  let auditsSynced = 0;
  for (const audit of localAudits) {
    const auditPayload = {
      ...audit,
      client_id: userId
    };
    await remoteConn.db.collection('audits').updateOne(
      { _id: audit._id },
      { $set: auditPayload },
      { upsert: true }
    );
    auditsSynced++;
  }
  console.log(`   ✓ ${auditsSynced} Audits synced successfully`);

  // 11. Link ApplicationLogsheets on the Server
  console.log('\n🔟 Linking ApplicationLogsheets on the Server...');
  const serverLogsheets = await remoteConn.db.collection('applicationlogsheets').find({
    company_name: /clawson/i
  }).toArray();
  console.log(`   Found ${serverLogsheets.length} logsheets on the server matching Clawson`);

  let logsLinked = 0;
  for (const log of serverLogsheets) {
    const isBottesford = /bottesford/i.test(log.company_name || '') ||
      ['LOG-60305', 'LOG-171101', 'LOG-202157', 'LOG-243282', 'LOG-284486', 'LOG-284527', 'LOG-284538'].includes(log.logsheet_number);
    const assignedSite = isBottesford ? bottesfordSite : meltonSite;

    await remoteConn.db.collection('applicationlogsheets').updateOne(
      { _id: log._id },
      {
        $set: {
          client_id: userId,
          site_id: assignedSite._id,
          site_name: assignedSite.name
        }
      }
    );
    logsLinked++;
    console.log(`   ✓ Linked ${log.logsheet_number} -> Site: ${assignedSite.name}`);
  }

  // 12. Verification & Summary on Ubuntu Server
  console.log('\n=============================================================================');
  console.log('📊 VERIFYING IMPORTED DATA ON UBUNTU SERVER MONGODB');
  console.log('=============================================================================');

  const remoteUser = await remoteConn.db.collection('users').findOne({ email: 'carl.robinson@clawson.co.uk' });
  const remoteSitesCount = await remoteConn.db.collection('sites').countDocuments({ client_id: userId });
  const remoteProductsCount = await remoteConn.db.collection('products').countDocuments({ client_id: userId });
  const remoteAppsCount = await remoteConn.db.collection('applications').countDocuments({ client_id: userId });
  const remoteCertsCount = await remoteConn.db.collection('certificates').countDocuments({ client_id: userId });
  const remoteInvoicesCount = await remoteConn.db.collection('invoices').countDocuments({ client_id: userId });
  const remoteAuditsCount = await remoteConn.db.collection('audits').countDocuments({ client_id: userId });
  const remoteLogsCount = await remoteConn.db.collection('applicationlogsheets').countDocuments({ client_id: userId });

  console.log(`✓ User:                  ${remoteUser ? remoteUser.company_name + ' (' + remoteUser.email + ')' : 'MISSING'}`);
  console.log(`✓ Sites Count:           ${remoteSitesCount}`);
  console.log(`✓ Products Count:        ${remoteProductsCount}`);
  console.log(`✓ Applications Count:    ${remoteAppsCount}`);
  console.log(`✓ Certificates Count:    ${remoteCertsCount}`);
  console.log(`✓ Invoices Count:        ${remoteInvoicesCount}`);
  console.log(`✓ Audits Count:          ${remoteAuditsCount}`);
  console.log(`✓ Linked Logsheets:      ${remoteLogsCount}`);
  console.log('=============================================================================\n');

  await localConn.close();
  await remoteConn.close();
  console.log('🎉 SYNC COMPLETED SUCCESSFULLY!');
  process.exit(0);
}

syncClawsonToServer().catch(err => {
  console.error('❌ FATAL SYNC ERROR:', err);
  process.exit(1);
});
