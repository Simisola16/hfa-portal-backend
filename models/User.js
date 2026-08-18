import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  // Admin-only username field — sparse so client accounts without it don't conflict
  username: { type: String, unique: true, sparse: true },
  password: { type: String, required: true },
  full_name: String,
  company_name: String,
  phone: String,
  address: String,
  postcode: String,
  country: String,
  role: { type: String, enum: ['client', 'admin', 'inspector', 'audit_manager', 'food_tech_manager', 'food_tech', 'superadmin'], default: 'client' },
  parent_client_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  client_role: { type: String, enum: ['admin', 'editor', 'viewer', 'owner'], default: 'viewer' },
  can_issue_direct_certificate: { type: Boolean, default: false },
  is_active: { type: Boolean, default: true },
  is_verified: { type: Boolean, default: false },
  verification_token: String,
  verification_token_expiry: Date,
  reset_password_token: String,
  reset_password_expiry: Date,
  avatar_url: String,
  suspension_reason: String,
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Hash password before saving
userSchema.pre('save', async function() {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 10);
});

// Method to compare passwords
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

export default mongoose.model('User', userSchema);
