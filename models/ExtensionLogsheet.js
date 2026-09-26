import mongoose from 'mongoose';

const extensionLogsheetSchema = new mongoose.Schema({
  extension_application_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'ExtensionApplication', 
    required: true 
  },
  client_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  site_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Site' },

  // Fields strictly matching the Extension Logsheet Form:
  company_name: { type: String, default: '' },
  facility_address: { type: String, default: '' }, // Address of certificated facility
  contact_person: { type: String, default: '' },   // Contact Person of the company
  product_category: { type: String, default: '' }, // Product category
  certificate_type: { type: String, default: '' }, // Auto-detected certificate type
  scheme: { 
    type: String, 
    enum: ['GSO', 'HFA', 'Both'], 
    default: 'HFA' 
  }, // Scheme: [ ] GSO  [ ] HFA
  certificate_expiry_date: { type: Date }, // Certificate expiry date
  justification: { type: String, default: '' }, // Justification for extension

  // Extension duration: 30 days vs more than 30 days
  extension_duration_type: { 
    type: String, 
    enum: ['30_days', 'more_than_30_days'], 
    default: '30_days' 
  },
  extension_days: { type: Number, default: 30 }, // Extension required for: _____ days

  // Signatures configuration (1 if 30 days, 4 if more than 30 days)
  signatures_required: { type: Number, default: 1 },

  // 1 Signature fields (for 30 days extension)
  single_signature: { type: String, default: null },
  single_sign_name: { type: String, default: '' },
  single_sign_role: { type: String, default: 'Authorized Officer / CEO' },
  single_sign_date: { type: Date },

  // 4 Signatures fields (for more than 30 days extension)
  mufti_signature: { type: String, default: null },
  mufti_sign_name: { type: String, default: '' },
  mufti_sign_date: { type: Date },

  ceo_signature: { type: String, default: null },
  ceo_sign_name: { type: String, default: '' },
  ceo_sign_date: { type: Date },

  manager_signature: { type: String, default: null },
  manager_sign_name: { type: String, default: '' },
  manager_sign_date: { type: Date },

  mufti2_signature: { type: String, default: null },
  mufti2_sign_name: { type: String, default: '' },
  mufti2_sign_date: { type: Date },

  status: {
    type: String,
    enum: ['Draft', 'Waiting for Signature', 'Signed', 'Approved'],
    default: 'Waiting for Signature'
  },

  comments: { type: String, default: '' }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

export default mongoose.model('ExtensionLogsheet', extensionLogsheetSchema);
