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
    enum: ['submitted', 'under_review', 'on_hold', 'audit_scheduled', 'audit_completed', 'approved', 'rejected', 'certificate_issued'],
    default: 'submitted' 
  },
  documents: {
    halal_policy: String,
    ingredient_list: String,
    floor_plan: String,
    company_registration: String,
    haccp_plan: String,
    supporting_docs: [String]
  },
  inspector_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Inspector' },
  audit_date: Date,
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
