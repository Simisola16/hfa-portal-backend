import mongoose from 'mongoose';
import { generateHfaId } from '../lib/idGenerator.js';

const extensionApplicationSchema = new mongoose.Schema({
  client_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  site_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Site' },
  site_name: { type: String, required: true },
  company_name: { type: String },

  // Contact details
  contact_person: { type: String, required: true },
  contact_email: { type: String, required: true },
  contact_phone: { type: String, required: true },

  // Client's reason/description for extension
  description: { type: String, required: true },

  // Unique application number (e.g. EXT-2026-0001)
  application_number: { type: String, unique: true },

  // 4-stage Canonical status:
  // submitted -> under_review -> waiting_signature -> extension_approved (or rejected)
  status: {
    type: String,
    enum: [
      'submitted',
      'under_review',
      'logsheet_created',
      'waiting_signature',
      'extension_approved',
      'rejected'
    ],
    default: 'submitted'
  },

  statusHistory: [{
    status: String,
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    note: String
  }],

  // Rejection reason if rejected
  rejection_reason: String,
  notes: String, // internal admin notes

  // Linked Extension Logsheet
  logsheet_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ExtensionLogsheet' },

  // Linked Certificate once approved/issued
  certificate_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Certificate' },
  certificate_number: String,
  certificate_url: String,
  expiry_date: Date,
  extended_until: Date,

}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Auto-generate application_number before save if not present
extensionApplicationSchema.pre('save', async function(next) {
  if (!this.application_number) {
    const comp = this.company_name || this.site_name || 'HFA';
    this.application_number = generateHfaId(comp, 'EX');
  }
  next();
});

export default mongoose.model('ExtensionApplication', extensionApplicationSchema);
