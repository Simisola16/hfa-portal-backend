import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  recipient_id: { type: mongoose.Schema.Types.ObjectId, required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: { type: String, enum: ['info', 'success', 'warning', 'error'], default: 'info' },
  link: String,
  is_read: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now }
}, {
  timestamps: true
});

notificationSchema.index({ recipient_id: 1, is_read: 1, created_at: -1 });
notificationSchema.index({ recipient_id: 1, created_at: -1 });
notificationSchema.index({ recipient_id: 1, createdAt: -1 });

export default mongoose.model('Notification', notificationSchema);
