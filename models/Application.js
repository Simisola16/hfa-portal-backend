import mongoose from 'mongoose';

const applicationSchema = new mongoose.Schema({
  application_number: { type: String, required: true, unique: true },
  client_id: { type: String, required: true }, // Supabase Auth ID
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
    supporting_docs: [String]
  },
  inspector_id: String,
  audit_date: Date,
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

export default mongoose.model('Application', applicationSchema);
