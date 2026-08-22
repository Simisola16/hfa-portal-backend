import mongoose from 'mongoose';

const certificateSchema = new mongoose.Schema({
  certificate_number: { type: String, required: true, unique: true },
  client_id: { type: String, required: true },
  application_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' },
  site_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Site' },
  certificate_type: String,
  company_name: String,
  company_address: String,
  manufacturing_address: String,
  scope: String,
  issue_date: Date,
  expiry_date: Date,
  products_covered: { type: [String], default: [] },
  product_details: [{
    name: String,
    code: String,
    category: String,
    barcode: String
  }],
  certificate_url: String,
  status: { 
    type: String, 
    enum: ['under_review', 'draft', 'active', 'expired', 'revoked', 'renewed', 'outdated', 'superseded'], 
    default: 'under_review' 
  },
  is_renewed: { type: Boolean, default: false },
  renewed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'Certificate' },
  superseded_by: { type: mongoose.Schema.Types.ObjectId, ref: 'Certificate' },
  revocation_reason: String,
  is_direct_issuance: { type: Boolean, default: false },
  issued_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewed_at: Date,
  review_notes: String,
  notes: String,
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

export default mongoose.model('Certificate', certificateSchema);
