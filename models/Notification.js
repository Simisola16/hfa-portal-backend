import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  recipient_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: { type: String, enum: ['info', 'success', 'warning', 'error'], default: 'info' },
  link: String,
  is_read: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now }
}, {
  timestamps: true
});

export default mongoose.model('Notification', notificationSchema);
