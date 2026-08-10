import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  client_id: { type: mongoose.Schema.Types.Mixed, ref: 'User', required: true },
  name: { type: String, required: true },
  description: String,
  category: String,
  product_type: String,
  barcode: String,
  code: String,
  site_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Site' },
  certificate_id: String,
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

export default mongoose.model('Product', productSchema);
