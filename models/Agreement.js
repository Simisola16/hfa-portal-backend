import mongoose from 'mongoose';

const agreementSchema = new mongoose.Schema({
  client_id: { type: String, required: true },
  application_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' },
  title: String,
  details: String,
  status: { type: String, enum: ['sent', 'signed', 'approved'], default: 'sent' },
  agreement_url: String, // uploaded by admin
  signed_agreement_url: String, // uploaded by client
  admin_comment: String,
  client_comment: String,
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

export default mongoose.model('Agreement', agreementSchema);
