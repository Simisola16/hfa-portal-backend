import mongoose from 'mongoose';

const certificateSchema = new mongoose.Schema({
  certificate_number: { type: String, required: true, unique: true },
  client_id: { type: String, required: true },
  application_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' },
  site_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Site' },
  certificate_type: String,
  issue_date: Date,
  expiry_date: Date,
  products_covered: { type: [String], default: [] },
  certificate_url: String,
  status: { type: String, enum: ['active', 'expired', 'revoked'], default: 'active' },
  revocation_reason: String,
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

export default mongoose.model('Certificate', certificateSchema);
