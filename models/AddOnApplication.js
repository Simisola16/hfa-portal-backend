import mongoose from 'mongoose';

const addOnProductSchema = new mongoose.Schema({
  sn: { type: Number }, // auto-numbered on save
  name: { type: String, required: true },
  code: { type: String },
  type: {
    type: String,
    enum: ['Add product', 'Remove product', 'Change name/code', 'Change ingredients'],
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
  client_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  certificate_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Certificate', required: false },
  application_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' },
  site_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Site' },

  // Contact Person (receives email at every stage — may differ from the client account email)
  contact_name: { type: String, required: true },
  contact_email: { type: String, required: true },
  contact_phone: { type: String },

  // Optional message from the client
  message: { type: String },

  // Multi-product table (one application can cover many products)
  products: { type: [addOnProductSchema], default: [] },

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
      'completed'
    ],
    default: 'submitted'
  },

  statusHistory: [{
    status: String,
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    note: String
  }],

  // Admin decision
  rejection_reason: String,
  notes: String, // internal admin notes

  // FT assignment — array supports multiple assigned FT staff
  assigned_food_tech: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // legacy (kept for populate compat)
  assigned_food_techs: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  // Product Approval Form — ONE form per application authored by admin
  // Client responds per product in the product_responses array
  product_approval_form: {
    form_file_url: String,   // Admin uploads a PDF template/document
    form_text: String,       // Admin writes form text directly
    is_draft: { type: Boolean, default: false },
    sent_at: Date,
    product_responses: { type: [productResponseSchema], default: [] },
    submitted_at: Date
  },

  // Linked logsheet (once admin creates it in the "Create Logsheet" step)
  logsheet_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ApplicationLogsheet' }

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Auto-number products on save
addOnApplicationSchema.pre('save', function(next) {
  if (this.products && this.products.length > 0) {
    this.products.forEach((p, i) => { p.sn = i + 1; });
  }
  next();
});

export default mongoose.model('AddOnApplication', addOnApplicationSchema);
