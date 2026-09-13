import mongoose from 'mongoose';

const applicationLogsheetSchema = new mongoose.Schema({
  // Source discriminator: 'application' (main cert flow), 'addon_application', 'initial_product_application', or 'direct' (direct logsheet studio)
  source_type: { type: String, enum: ['application', 'addon_application', 'initial_product_application', 'direct'], default: 'application' },
  // Specific Logsheet Sub-Type for Direct & Application Flows:
  logsheet_type: { 
    type: String, 
    enum: ['application', 'initial_product', 'addon', 'extension'], 
    default: 'application' 
  },
  direct_ref: String, // e.g. DL-2026-XXXX for direct logsheets
  certificate_standard: String, // GSO MEAT, GSO NON MEAT, SMIIC, HFA SCHEME, COSMETICS
  scope: String,
  
  // Extension Logsheet Specific Fields
  existing_certificate_number: String,
  extension_duration_type: String, // '30_days', '60_days', '90_days', '180_days', 'custom'
  extension_days: Number,
  extension_reason: String,
  extended_expiry_date: Date,
  
  // Add-on Logsheet Specific Fields
  addon_type: String, // 'New Products', 'New Production Line', 'Site Addition', 'Scope Amendment'
  raw_materials_approved: String, // 'Yes', 'No', 'N/A'
  cross_contamination_risk: String, // 'None', 'Low', 'Medium', 'High'
  
  // Initial Product Specific Fields
  formulation_checked: String, // 'Yes', 'No'
  lab_test_required: String, // 'Yes', 'No'
  initial_approval_stage: String, // 'Stage 1 - Desk Review', 'Stage 2 - Sample Testing', 'Stage 3 - Production Trial'
  decision_type: String,

  products_list: [{
    name: String,
    code: String,
    category: String,
    barcode: String,
    product_type: String,
    ingredients: String,
    e_numbers: String,
    halal_status: String
  }],
  // For main certification flow logsheets
  application_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' },
  // For add-on application logsheets (source_type = 'addon_application')
  addon_application_id: { type: mongoose.Schema.Types.ObjectId, ref: 'AddOnApplication' },
  // For initial product application logsheets (source_type = 'initial_product_application')
  initial_product_application_id: { type: mongoose.Schema.Types.ObjectId, ref: 'InitialProductApplication' },
  client_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  site_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Site' },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  
  // Tab 1: Company Details
  site_name: String,
  company_name: String,
  company_address: String,
  manufacturing_address: String,
  contact_person: String,
  contact_email: String,
  issue_date: Date,
  expiry_date: Date,
  nature_of_business: String,
  product_category: String,
  product_name: String,
  product_code: String,
  current_cycle_start: Date,
  original_cycle_start: Date,
  document_url: String, // from File upload
  document_urls: [{ name: String, url: String, uploaded_at: { type: Date, default: Date.now } }],
  audit_reports: [{ name: String, url: String, uploaded_at: { type: Date, default: Date.now } }],
  nc_reports_files: [{ name: String, url: String, uploaded_at: { type: Date, default: Date.now } }],

  // Tab 2: Review of Application
  audit_type: String,
  audit_date: Date,
  auditors: String,
  ncs_close: String,
  docs_satisfactory: String,
  pork_free_statement: String,
  reviewed_by: String,
  reviewer_name: String,
  review_date: Date,

  // Tab 3: Certificate Status
  annual_certificate: { type: String, enum: ['Yes', 'No'] },
  batch_certificate: { type: String, enum: ['Yes', 'No'] },
  new_products_only: { type: String, enum: ['Yes', 'No'] },
  new_site_line: { type: String, enum: ['Yes', 'No'] },
  new_client: { type: String, enum: ['Yes', 'No'] },
  agreement_signed: { type: String, enum: ['Yes', 'No'] },
  status_date: Date,

  // Tab 4: Comment
  comment: String,
  
  confirmed: { type: Boolean, default: false },

  status: { 
    type: String, 
    enum: ['Waiting for Signature', 'Signed', 'Completed', 'Waiting For Certificate'], 
    default: 'Waiting for Signature' 
  },

  // Role Signatures
  mufti_signature: String,
  mufti_sign_name: String,
  mufti_sign_date: Date,

  ceo_signature: String,
  ceo_sign_name: String,
  ceo_sign_date: Date,

  manager_signature: String,
  manager_sign_name: String,
  manager_sign_date: Date,

  mufti2_signature: String,
  mufti2_sign_name: String,
  mufti2_sign_date: Date,

  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});

applicationLogsheetSchema.pre('save', function(next) {
  this.updated_at = Date.now();
  next();
});

export default mongoose.model('ApplicationLogsheet', applicationLogsheetSchema);
