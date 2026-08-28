import mongoose from 'mongoose';

const productResponseSchema = new mongoose.Schema({
  response_text: { type: String, default: '' },
  response_url: { type: String, default: '' },
  form_data: { type: mongoose.Schema.Types.Mixed, default: {} },
  is_saved: { type: Boolean, default: false },
  saved_at: { type: Date }
}, { _id: false });

const singleProductSchema = new mongoose.Schema({
  name: { type: String, required: true },
  code: { type: String, default: '' },
  category: { type: String, default: '' },
  ingredients: { type: String, default: '' },
  description: { type: String, default: '' }
}, { _id: false });

const initialProductApplicationSchema = new mongoose.Schema({
  client_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  application_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', required: true },
  site_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Site' },

  // Contact Person
  contact_name: { type: String, required: true },
  contact_email: { type: String, required: true },
  contact_phone: { type: String },

  // Optional message from the client
  message: { type: String },

  // Strictly ONE Initial Product
  product: { type: singleProductSchema, required: true },

  // Lifecycle status flow:
  // submitted -> ft_assigned -> product_approval_form_enabled -> all_forms_received -> logsheet_created -> waiting_sharia_signature -> initial_product_approved
  status: {
    type: String,
    enum: [
      'submitted',
      'ft_assigned',
      'product_approval_form_enabled',
      'all_forms_received',
      'logsheet_created',
      'waiting_sharia_signature',
      'initial_product_approved'
    ],
    default: 'submitted'
  },

  statusHistory: [{
    status: String,
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    note: String
  }],

  // Internal admin notes
  notes: String,

  // FT assignment (direct assignment without accept/reject)
  assigned_food_tech: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  assigned_food_techs: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  assigned_ft_details: String,
  assigned_ft_custom: {
    name: String,
    email: String,
    notes: String
  },

  // Product Approval Form authored by admin/FT and responded by client
  product_approval_form: {
    form_file_url: String,
    form_text: String,
    is_draft: { type: Boolean, default: false },
    sent_at: Date,
    product_response: { type: productResponseSchema, default: () => ({}) },
    submitted_at: Date,

    // More Information request & Client reply
    more_info_requested: { type: Boolean, default: false },
    more_info_message: String,
    more_info_file_url: String,
    more_info_requested_at: Date,
    client_reply_text: String,
    client_reply_file_url: String,
    client_replied_at: Date
  },

  // Linked logsheet
  logsheet_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ApplicationLogsheet' }

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

export default mongoose.model('InitialProductApplication', initialProductApplicationSchema);
