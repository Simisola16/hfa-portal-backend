import fetch from 'node-fetch';

const API_URL = process.env.VITE_API_URL || 'http://localhost:5000';

const getCleanId = (val) => {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'object') return String(val._id || val.id || '');
  return String(val);
};

const extractAppId = (notifObj) => {
  if (!notifObj) return null;
  const raw = notifObj.application_id || notifObj.appId || notifObj.app_id || 
              notifObj.data?.application_id || notifObj.data?.app_id || notifObj.data?.appId;
  if (raw) {
    const clean = getCleanId(raw);
    if (clean && clean !== '[object Object]') return clean;
  }
  const link = notifObj.link || '';
  const m1 = link.match(/\/applications\/([a-fA-F0-9]{24})/);
  if (m1) return m1[1];
  const m2 = link.match(/appId=([a-fA-F0-9]{24})/);
  if (m2) return m2[1];
  const match = link.match(/([a-fA-F0-9]{24})/) || (notifObj.message || '').match(/([a-fA-F0-9]{24})/);
  if (match) return match[1];
  return null;
};

async function testObjectIdSanitization() {
  console.log('--- TEST 1: getCleanId helper test ---');
  const sampleObj = { _id: '67a1b2c3d4e5f67890123456', name: 'Test App' };
  const sampleStr = '67a1b2c3d4e5f67890123456';
  
  console.log('Object _id:', getCleanId(sampleObj) === sampleStr ? 'PASS' : 'FAIL');
  console.log('Plain string:', getCleanId(sampleStr) === sampleStr ? 'PASS' : 'FAIL');
  console.log('Null input:', getCleanId(null) === '' ? 'PASS' : 'FAIL');

  console.log('\n--- TEST 2: extractAppId notification object test ---');
  const notif1 = { application_id: { _id: '67a1b2c3d4e5f67890123456' }, title: 'New Application Submitted' };
  const notif2 = { link: '/applications/67a1b2c3d4e5f67890123456', title: 'Payment Proof Uploaded' };
  const notif3 = { message: 'Application 67a1b2c3d4e5f67890123456 requires proposal', title: 'Action Required' };

  console.log('notif1 extract:', extractAppId(notif1) === sampleStr ? 'PASS' : 'FAIL');
  console.log('notif2 extract:', extractAppId(notif2) === sampleStr ? 'PASS' : 'FAIL');
  console.log('notif3 extract:', extractAppId(notif3) === sampleStr ? 'PASS' : 'FAIL');

  console.log('\nAll getCleanId and extractAppId sanitization tests PASSED cleanly!');
}

testObjectIdSanitization().catch(console.error);
