import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  sender_id: { type: String, required: true },
  recipient_id: { type: String, required: true },
  subject: String,
  body: { type: String, required: true },
  application_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' },
  is_read: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now }
}, { timestamps: true });

export default mongoose.model('Message', messageSchema);
