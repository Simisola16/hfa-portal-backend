import mongoose from 'mongoose';

const exportCertificateSchema = new mongoose.Schema({
  client_id:          { type: String, required: true },
  reference_number:   { type: String },

  // Destination & Shipment
  destination_country: { type: String },
  shipment_date:       { type: Date },

  // Consignee details
  consignee_name:    { type: String },
  consignee_address: { type: String },

  // Products / goods being exported
  products:          { type: String },

  // Legacy / misc
  application_number:    { type: String },
  consignment_details:   { type: String },

  // Admin notes when approving/rejecting
  admin_notes:       { type: String },
  notes:             { type: String },

  // Certificate
  certificate_url:   { type: String },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'shipped'],
    default: 'pending'
  },

  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, {
  timestamps: true,
  toJSON:   { virtuals: true },
  toObject: { virtuals: true }
});

exportCertificateSchema.index({ client_id: 1 });
exportCertificateSchema.index({ status: 1 });
exportCertificateSchema.index({ reference_number: 1 });
exportCertificateSchema.index({ created_at: -1 });
exportCertificateSchema.index({ createdAt: -1 });
exportCertificateSchema.index({ status: 1, created_at: -1 });
exportCertificateSchema.index({ client_id: 1, created_at: -1 });

export default mongoose.model('ExportCertificate', exportCertificateSchema);
