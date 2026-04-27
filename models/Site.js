import mongoose from 'mongoose';

const siteSchema = new mongoose.Schema({
  client_id: { type: String, required: true },
  // Site Details
  name: { type: String, required: true },
  email: String,
  address_1: String,
  address_2: String,
  postcode: String,
  state: String,
  country: String,
  city: String,
  contact_name: String,
  contact_phone_code: String,
  contact_phone_number: String,
  
  // Manufacturer Details
  est_name: String,
  reg_number: String,
  vat_number: String,
  head_office_address: String,
  years_in_business: String,
  trading_name: String,
  website: String,
  mfg_email: String,
  operating_hours: String,
  num_employees: String,

  // Existing Client
  client_code: String,
  client_category: String,

  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

export default mongoose.model('Site', siteSchema);
