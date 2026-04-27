import mongoose from 'mongoose';

const siteSchema = new mongoose.Schema({
  client_id: { type: String, required: true },
  name: { type: String, required: true },
  address: String,
  postcode: String,
  country: String,
  contact_person: String,
  contact_email: String,
  contact_phone: String,
  manufacturer_name: String,
  manufacturer_address: String,
  manufacturer_contact: String,
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

export default mongoose.model('Site', siteSchema);
