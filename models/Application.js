import mongoose from 'mongoose';

const applicationSchema = new mongoose.Schema({
  application_number: { type: String, required: true, unique: true },
  client_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  application_type: String,
  category: String,
  site_id: String,
  site_name: String,
  establishment_name: String,
  establishment_address: String,
  reg_number: String,
  vat_number: String,
  managing_director: String,
  
  manufacturer_name: String,
  manufacturer_address: String,
  
  finance_contact: String,
  production_contact: String,
  halal_coordinator: String,
  qa_contact: String,
  
  scope: String,
  employee_count: Number,
  products: [{
    name: String,
    brand: String,
    category: String
  }],
  
  production_schedule: String,
  has_porcine: { type: Boolean, default: false },
  has_intoxicants: { type: Boolean, default: false },
  porcine_details: String,
  intoxicants_details: String,
  declared_true: { type: Boolean, default: false },
  notes: String,
  admin_notes: String,
  status: { 
    type: String,
    enum: [
      'submitted', 'under_review', 'rejected', 'approved',
      'proposal_sent', 'proposal_rejected', 'proposal_approved',
      'invoice_sent', 'payment_received', 'initial_product_approved', 'dates_proposed',
      'dates_accepted', 'date_finalized', 'audit_assigned', 'audit_report_submitted',
      'on_hold', 'audit_successful', 'audit_completed', 'nc_flagged', 'nc_closed',
      'logsheet_created', 'logsheet_signed', 'application_successful',
      'agreement_sent', 'agreement_signed', 'agreement_finalised',
      'final_invoice_sent', 'final_invoice_paid', 'ready_for_certificate',
      'certificate_issued',
    ],
    default: 'submitted',
  },
  statusHistory: [{
    status: { type: String },
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    note: { type: String, default: '' },
  }],
  certificate_url: String,
  logsheet_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ApplicationLogsheet', default: null },
  surveillance_letter_data: { type: mongoose.Schema.Types.Mixed },
  renewed_certificate_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Certificate', default: null },
  documents: {
    halal_policy: String,
    ingredient_list: String,
    floor_plan: String,
    haccp_plan: String,
    surveillance_letter: String,
    supporting_docs: [String]
  },
  inspector_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Inspector' },
  audit_date: Date,
  audit_reports: [{
    name: String,
    url: String,
    uploaded_at: { type: Date, default: Date.now },
    uploaded_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }],
  nc_reports: [{
    text: String,
    url: String,
    client_response: String,
    client_response_url: String,
    client_responded_at: Date,
    admin_reply: String,
    admin_reply_at: Date,
    admin_reply_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['flagged', 'client_responded', 'admin_replied', 'closed'], default: 'flagged' },
    flagged_at: { type: Date, default: Date.now }
  }],
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

applicationSchema.virtual('profiles', {
  ref: 'User',
  localField: 'client_id',
  foreignField: '_id',
  justOne: true
});

applicationSchema.virtual('inspectors', {
  ref: 'Inspector',
  localField: 'inspector_id',
  foreignField: '_id',
  justOne: true
});

export default mongoose.model('Application', applicationSchema);
