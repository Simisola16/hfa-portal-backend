import mongoose from 'mongoose';

const agreementSchema = new mongoose.Schema({
  client_id: { type: String, required: true },
  application_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' },
  title: String,
  details: String,
  status: { type: String, enum: ['sent', 'signed', 'approved', 'finalized'], default: 'sent' },
  agreement_url: String, // uploaded by admin
  signed_agreement_url: String, // uploaded by client
  final_agreement_url: String, // countersigned copy uploaded by admin
  final_agreement_sent_at: Date,
  admin_comment: String,
  client_comment: String,
  
  // Inline Client Signature details (Phase 9)
  client_signature_url: String,
  client_sign_name: String,
  client_sign_date: Date,
  client_signed: { type: Boolean, default: false },
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

export default mongoose.model('Agreement', agreementSchema);
