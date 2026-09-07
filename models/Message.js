import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  sender_id: { type: String, required: true },
  recipient_id: { type: String, required: true }, // User ID or 'admin' / 'support' / 'all_clients'
  subject: { type: String, required: true },
  body: { type: String, required: true },
  is_broadcast: { type: Boolean, default: false },
  broadcast_stats: {
    recipient_count: { type: Number, default: 0 },
    email_count: { type: Number, default: 0 }
  },
  application_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' },
  is_read: { type: Boolean, default: false },
  read_at: { type: Date },
  attachments: [{
    name: String,
    url: String,
    file_type: String,
    size: Number
  }],
  reply_to: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
  created_at: { type: Date, default: Date.now }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

export default mongoose.model('Message', messageSchema);
