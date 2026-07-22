import Application from '../models/Application.js';
import { STATUS_ORDER as adminStatusOrder, STATUS_LABELS as adminStatusLabels, STATUS_BADGE as adminStatusBadge } from '../../admin/src/lib/applicationStatuses.js';
import { STATUS_ORDER as clientStatusOrder, STATUS_LABELS as clientStatusLabels, STATUS_BADGE as clientStatusBadge } from '../../client/src/lib/applicationStatuses.js';

console.log('=== UNIT TEST: ENUM & STATUS ORDER VERIFICATION ===');

const modelEnumValues = Application.schema.path('status').enumValues;

console.log('\n1. Backend Application.js Model status enumValues:');
console.log(modelEnumValues);

console.log('\n2. Admin applicationStatuses.js STATUS_ORDER:');
console.log(adminStatusOrder);

console.log('\n3. Client applicationStatuses.js STATUS_ORDER:');
console.log(clientStatusOrder);

// Assertions
const expectedSequence = [
  'agreement_signed',
  'final_invoice_sent',
  'final_invoice_paid',
  'certificate_issued'
];

function verifySequence(arr, name) {
  const indices = expectedSequence.map(s => arr.indexOf(s));
  const isOrdered = indices.every((val, i, a) => !i || a[i - 1] < val);
  if (isOrdered && indices.every(idx => idx !== -1)) {
    console.log(`✅ ${name}: Sequence order correct! (indices: ${indices.join(' < ')})`);
  } else {
    console.error(`❌ ${name}: Sequence order INCORRECT! (indices: ${indices.join(', ')})`);
    process.exit(1);
  }
}

verifySequence(modelEnumValues, 'Backend Application.js enum');
verifySequence(adminStatusOrder, 'Admin STATUS_ORDER');
verifySequence(clientStatusOrder, 'Client STATUS_ORDER');

// Check Labels and Badges
if (adminStatusLabels.final_invoice_sent === 'Final Invoice Sent' && adminStatusLabels.final_invoice_paid === 'Final Invoice Paid') {
  console.log('✅ Admin STATUS_LABELS contains final_invoice_sent and final_invoice_paid');
} else {
  console.error('❌ Admin STATUS_LABELS missing or incorrect labels');
  process.exit(1);
}

if (clientStatusLabels.final_invoice_sent === 'Final Invoice Sent' && clientStatusLabels.final_invoice_paid === 'Final Invoice Paid') {
  console.log('✅ Client STATUS_LABELS contains final_invoice_sent and final_invoice_paid');
} else {
  console.error('❌ Client STATUS_LABELS missing or incorrect labels');
  process.exit(1);
}

if (adminStatusBadge.final_invoice_sent && adminStatusBadge.final_invoice_paid) {
  console.log('✅ Admin STATUS_BADGE contains final_invoice_sent and final_invoice_paid');
}

if (clientStatusBadge.final_invoice_sent && clientStatusBadge.final_invoice_paid) {
  console.log('✅ Client STATUS_BADGE contains final_invoice_sent and final_invoice_paid');
}

console.log('\n🎉 ALL ENUM AND STATUS ORDERING TESTS PASSED PERFECTLY!');
