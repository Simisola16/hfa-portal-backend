import mongoose from 'mongoose';

const exportCertificateSchema = new mongoose.Schema({
  client_id: { type: String, required: true },
  application_number: String,
  consignment_details: String,
  destination_country: String,
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  certificate_url: String,
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

export default mongoose.model('ExportCertificate', exportCertificateSchema);
