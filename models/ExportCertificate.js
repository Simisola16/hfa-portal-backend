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

export default mongoose.model('ExportCertificate', exportCertificateSchema);
