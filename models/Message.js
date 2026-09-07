import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  sender_id: { type: String, required: true },
  recipient_id: { type: String, required: true }, // User ID or 'admin' / 'support'
  subject: { type: String, required: true },
  body: { type: String, required: true },
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
