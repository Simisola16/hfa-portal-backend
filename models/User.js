import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

// User model — CLIENT ACCOUNTS ONLY
// Staff / admin accounts are stored in the Admin model (models/Admin.js)
const userSchema = new mongoose.Schema({
  email:    { type: String, required: true, unique: true },
  password: { type: String, required: true },
  full_name:    String,
  company_name: String,
  phone:    String,
  address:  String,
  postcode: String,
  country:  String,
  // Always 'client' — role field kept for backward-compat with JWT payloads
  role: {
    type:    String,
    enum:    ['client'],
    default: 'client',
  },
  // Sub-user hierarchy
  parent_client_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  client_role: {
    type:    String,
    enum:    ['admin', 'editor', 'viewer', 'owner'],
    default: 'viewer',
  },
  // Lifecycle
  company_category: {
    type:    String,
    enum:    ['certified', 'processing', 'signup'],
    default: 'signup',
  },
  is_active:    { type: Boolean, default: true },
  is_verified:  { type: Boolean, default: false },
  suspension_reason: String,
  // Email verification
  verification_token:        String,
  verification_token_expiry: Date,
  // Password reset
  reset_password_token:  String,
  reset_password_expiry: Date,
  // Profile
  avatar_url:  String,
  created_at:  { type: Date, default: Date.now },
  updated_at:  { type: Date, default: Date.now },
}, {
  timestamps: true,
  toJSON:   { virtuals: true },
  toObject: { virtuals: true },
});

userSchema.index({ role: 1 });
userSchema.index({ is_verified: 1 });
userSchema.index({ company_category: 1 });

// Hash password before saving
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 10);
});

// Method to compare passwords
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!candidatePassword || !this.password) return false;
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch {
    return false;
  }
};

export default mongoose.model('User', userSchema);
