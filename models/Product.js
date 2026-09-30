import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  client_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  description: String,
  category: String,
  product_type: String,
  barcode: String,
  code: String,
  site_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Site' },
  certificate_id: String,
  source: { type: String, enum: ['admin', 'client'], default: 'client' },
  application_type: { type: String, default: 'Direct' },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  created_by_name: { type: String },
  last_modified_by: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  last_modified_by_name: { type: String },
  last_modified_at: { type: Date },
  status: { type: String, enum: ['active', 'inactive', 'pending', 'approved', 'rejected'], default: 'pending' },
  ingredients: [String],
  notes: String,
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

productSchema.index({ client_id: 1 });
productSchema.index({ site_id: 1 });
productSchema.index({ status: 1 });
productSchema.index({ client_id: 1, site_id: 1 });
productSchema.index({ certificate_id: 1 });
productSchema.index({ client_id: 1, certificate_id: 1 });
productSchema.index({ created_at: -1 });
productSchema.index({ status: 1, created_at: -1 });
productSchema.index({ name: 1 });

export default mongoose.model('Product', productSchema);

