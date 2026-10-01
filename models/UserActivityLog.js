import mongoose from 'mongoose';

const userActivityLogSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'user_model'
  },
  user_model: {
    type: String,
    required: true,
    enum: ['Admin', 'User']
  },
  name: { type: String, required: true },
  username: String,
  email: { type: String, required: true },
  role: String,
  user_type: {
    type: String,
    required: true,
    enum: ['admin', 'client']
  },
  action: {
    type: String,
    required: true,
    enum: ['sign_in', 'sign_out', 'connected', 'disconnected']
  },
  ip_address: String,
  user_agent: String,
  created_at: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: false },
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

userActivityLogSchema.index({ created_at: -1 });
userActivityLogSchema.index({ user_id: 1, created_at: -1 });
userActivityLogSchema.index({ user_type: 1, created_at: -1 });
userActivityLogSchema.index({ action: 1, created_at: -1 });

export default mongoose.model('UserActivityLog', userActivityLogSchema);
