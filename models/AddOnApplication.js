import mongoose from 'mongoose';
import { generateHfaId } from '../lib/idGenerator.js';

const addOnProductSchema = new mongoose.Schema({
  sn: { type: Number }, // auto-numbered on save
  name: { type: String, required: true },
  code: { type: String },
  original_name: { type: String },
  new_name: { type: String },
  new_code: { type: String },
  description: { type: String },
  notes: { type: String },
  type: {
    type: String,
    enum: ['Add product', 'Remove product', 'Change name/code', 'Change ingredients', 'Change ingredient'],
    required: true
  }
}, { _id: false });

const productResponseSchema = new mongoose.Schema({
  product_index: { type: Number, required: true },
  product_name: { type: String },
  response_text: { type: String, default: '' },
  response_url: { type: String, default: '' },
  form_data: { type: mongoose.Schema.Types.Mixed, default: {} },
  is_saved: { type: Boolean, default: false },
  saved_at: { type: Date }
}, { _id: false });

const addOnApplicationSchema = new mongoose.Schema({
  application_number: { type: String },
  client_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  certificate_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Certificate', required: false },
  application_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' },
  site_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Site' },

  // Contact Person (receives email at every stage — may differ from the client account email)
  contact_name: { type: String, required: false, default: '' },
  contact_email: { type: String, required: true },
  contact_phone: { type: String },

  // Optional message from the client
  message: { type: String },

  // Add-on Application Type: 'add_product' | 'remove_product' | 'change_ingredients'
  addon_type: {
    type: String,
    enum: ['add_product', 'remove_product', 'change_ingredients'],
    default: 'add_product'
  },

  // Supporting document attachments uploaded by client
  supporting_documents: [{
    file_name: String,
    file_url: String,
    file_size: Number,
    uploaded_at: { type: Date, default: Date.now }
  }],

  // Multi-product table (one application can cover many products)
  products: { type: [addOnProductSchema], default: [] },

  // Submission and creation dates (synced from SQL database)
  submission_date: { type: Date },
  created_at: { type: Date },

  // Canonical 10-state status flow
  status: {
    type: String,
    enum: [
      'submitted',
      'accepted',
      'rejected',
      'ft_assigned',
      'product_approval_form_enabled',
      'all_forms_received',
      'logsheet_created',
      'waiting_sharia_signature',
      'product_form_approved',
      'ready_for_certificate',
      'completed',
      'done',
      'Done'
    ],
    default: 'submitted'
  },

  previous_status: { type: String, default: null },
  marked_done_at: { type: Date, default: null },
  marked_done_by: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
  restored_at: { type: Date, default: null },
  restored_by: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },

  statusHistory: [{
    status: String,
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    changedByName: String,
    changedByRole: String,
    note: String
  }],

  // Admin decision
  rejection_reason: String,
  notes: String, // internal admin notes

  // FT assignment — array supports multiple assigned FT staff or manual details
  assigned_food_tech:  { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' }, // legacy (kept for populate compat)
  assigned_food_techs: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Admin' }],
  assigned_ft_details: String,
  assigned_ft_custom: {
    name: String,
    email: String,
    notes: String
  },

  // Product Approval Form — ONE form per application authored by admin
  // Client responds per product in the product_responses array
  product_approval_form: {
    form_file_url: String,   // Admin uploads a PDF template/document
    form_text: String,       // Admin writes form text directly
    is_draft: { type: Boolean, default: false },
    sent_at: Date,
    product_responses: { type: [productResponseSchema], default: [] },
    submitted_at: Date,

    // More Information request & Client reply fields
    more_info_requested: { type: Boolean, default: false },
    more_info_message: String,
    more_info_file_url: String,
    more_info_requested_at: Date,
    client_reply_text: String,
    client_reply_file_url: String,
    client_replied_at: Date
  },

  // Document Requests for Remove Product & Change Ingredients flows
  document_requests: [{
    requested_at: { type: Date, default: Date.now },
    requested_by: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    note: { type: String, required: true },
    attachment_url: String,
    attachment_name: String,
    replied_at: Date,
    reply_note: String,
    reply_attachments: [{
      file_name: String,
      file_url: String,
      file_size: Number
    }],
    status: { type: String, enum: ['pending', 'replied'], default: 'pending' }
  }],

  // History of products removed via Remove Product flow
  removed_products_history: [{
    name: String,
    code: String,
    removed_at: { type: Date, default: Date.now },
    removed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' }
  }],

  // Change Ingredients completion tracking
  ingredients_accepted_at: Date,
  ingredients_accepted_by: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },

  // Linked logsheet (once admin creates it in the "Create Logsheet" step)
  logsheet_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ApplicationLogsheet' }

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Auto-number products and generate application_number on save
addOnApplicationSchema.pre('save', function(next) {
  if (this.products && this.products.length > 0) {
    this.products.forEach((p, i) => { p.sn = i + 1; });
  }
  if (!this.application_number) {
    const comp = this.contact_name || 'HFA';
    this.application_number = generateHfaId(comp, 'AD');
  }
  if (!this.created_at) {
    this.created_at = this.createdAt || new Date();
  }
  if (!this.submission_date) {
    this.submission_date = this.created_at;
  }
  next();
});

addOnApplicationSchema.index({ client_id: 1 });
addOnApplicationSchema.index({ status: 1 });
addOnApplicationSchema.index({ application_number: 1 });
addOnApplicationSchema.index({ site_id: 1 });
addOnApplicationSchema.index({ certificate_id: 1 });
addOnApplicationSchema.index({ logsheet_id: 1 });
addOnApplicationSchema.index({ client_id: 1, status: 1 });
addOnApplicationSchema.index({ created_at: -1 });
addOnApplicationSchema.index({ createdAt: -1 });
addOnApplicationSchema.index({ status: 1, created_at: -1 });

export default mongoose.model('AddOnApplication', addOnApplicationSchema);
