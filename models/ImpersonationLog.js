import mongoose from 'mongoose';

const impersonationLogSchema = new mongoose.Schema({
  admin_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  client_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  started_at: { type: Date, default: Date.now, required: true },
  ended_at: { type: Date }
}, {
  timestamps: true
});

export default mongoose.model('ImpersonationLog', impersonationLogSchema);
