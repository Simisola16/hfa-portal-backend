import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const ADMIN_ROLES = [
  'admin',
  'superadmin',
  'scheme_manager',
  'certificate_officer',
  'accountant',
  'inspector',
  'audit_manager',
  'food_tech_manager',
  'food_tech',
  'support_manager',
];

const adminSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  // Username used for admin portal login (optional — email also accepted)
  username: { type: String, unique: true, sparse: true },
  password: { type: String, required: true },
  full_name: String,
  phone: String,
  avatar_url: String,
  role: {
    type: String,
    enum: ADMIN_ROLES,
    default: 'admin',
  },
  // Additional / secondary roles
  roles: [{ type: String, enum: ADMIN_ROLES }],
  // Granular permissions
  can_issue_direct_certificate: { type: Boolean, default: false },
  can_sign_logsheet:            { type: Boolean, default: false },
  can_review_certificate:       { type: Boolean, default: false },
  is_support_manager:           { type: Boolean, default: false },
  is_active:                    { type: Boolean, default: true },
  is_verified:                  { type: Boolean, default: true },
  // Password reset
  reset_password_token:  String,
  reset_password_expiry: Date,
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  toJSON:   { virtuals: true },
  toObject: { virtuals: true },
});

adminSchema.index({ role: 1 });

// Hash password before saving
adminSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 10);
});

// Method to compare passwords
adminSchema.methods.comparePassword = async function (candidatePassword) {
  if (!candidatePassword || !this.password) return false;
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch {
    return false;
  }
};

export const ADMIN_ROLE_LIST = ADMIN_ROLES;
export default mongoose.model('Admin', adminSchema);
