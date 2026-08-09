import { STATUS_ORDER } from '../../client/src/lib/applicationStatuses.js';

console.log('Testing ProcessingTimeline step logic for status = "logsheet_created"...\n');

const status = 'logsheet_created';
const isRejected = status === 'rejected';
const isRenewal = false;
const statusHistory = [
  { status: 'submitted', changedAt: '2026-08-08T10:00:00Z' },
  { status: 'under_review', changedAt: '2026-08-08T10:30:00Z' },
  { status: 'approved', changedAt: '2026-08-08T11:00:00Z' },
  { status: 'proposal_sent', changedAt: '2026-08-08T11:30:00Z' },
  { status: 'proposal_approved', changedAt: '2026-08-08T12:00:00Z' },
  { status: 'invoice_sent', changedAt: '2026-08-08T12:30:00Z' },
  { status: 'payment_received', changedAt: '2026-08-08T13:00:00Z' },
  { status: 'dates_proposed', changedAt: '2026-08-08T13:30:00Z' },
  { status: 'dates_accepted', changedAt: '2026-08-08T14:00:00Z' },
  { status: 'date_finalized', changedAt: '2026-08-08T14:30:00Z' },
  { status: 'audit_assigned', changedAt: '2026-08-08T15:00:00Z' },
  { status: 'audit_successful', changedAt: '2026-08-08T16:00:00Z' },
  { status: 'logsheet_created', changedAt: '2026-08-08T17:00:00Z' }
];

const stepsToShow = [];
stepsToShow.push('submitted');
stepsToShow.push('under_review');
stepsToShow.push('approved');
stepsToShow.push('proposal_sent');
stepsToShow.push('proposal_approved');

const restFlow = [
  'invoice_sent',
  'payment_received',
  'dates_proposed',
  'dates_accepted',
  'date_finalized',
  'audit_assigned',
  'audit_successful',
];
stepsToShow.push(...restFlow);

const downstreamSteps = [
  'application_successful',
  'agreement_sent',
  'agreement_signed',
  'agreement_finalised',
  'final_invoice_sent',
  'final_invoice_paid',
  'ready_for_certificate',
  'certificate_issued',
];
stepsToShow.push(...downstreamSteps);

const normStatus = (status || 'submitted').toLowerCase().replace(/ /g, '_');
const effectiveStatus = (normStatus === 'audit_completed') ? 'audit_successful' : normStatus;
const currentOrderIdx = STATUS_ORDER.indexOf(effectiveStatus);
const currentIndex = stepsToShow.indexOf(effectiveStatus);

console.log(`currentStatus: ${status}`);
console.log(`effectiveStatus: ${effectiveStatus}`);
console.log(`currentOrderIdx: ${currentOrderIdx}`);
console.log(`currentIndex: ${currentIndex}\n`);

const results = stepsToShow.map((s, idx) => {
  let isComplete = false;
  let isCurrent = false;
  let isPending = false;

  if (currentIndex !== -1) {
    isComplete = currentIndex > idx;
    isCurrent = currentIndex === idx;
    isPending = currentIndex < idx;
  } else {
    const stepOrderIdx = STATUS_ORDER.indexOf(s);
    if (currentOrderIdx !== -1 && stepOrderIdx !== -1) {
      if (stepOrderIdx <= currentOrderIdx) {
        isComplete = true;
      } else {
        isPending = true;
      }
    } else {
      isPending = idx > 0;
      isCurrent = idx === 0;
    }
  }

  return { step: s, isComplete, isCurrent, isPending };
});

console.table(results);

const auditCompleteStep = results.find(r => r.step === 'audit_successful');
const proposalStep = results.find(r => r.step === 'proposal_approved');
const agreementStep = results.find(r => r.step === 'agreement_sent');

if (auditCompleteStep.isComplete && proposalStep.isComplete && agreementStep.isPending) {
  console.log('✅ TEST PASSED: All steps up to audit_successful are marked as complete, and future steps are pending!');
} else {
  console.error('❌ TEST FAILED!');
  process.exit(1);
}
