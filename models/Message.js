import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  sender_id: { type: String, required: true },
  recipient_id: { type: String, required: true }, // User ID or 'admin' / 'support' / 'all_clients' / 'selected_clients'
  recipient_ids: [{ type: String }], // For targeted broadcasts: array of specific client IDs
  subject: { type: String, required: true },
  body: { type: String, required: true },
  is_broadcast: { type: Boolean, default: false },
  is_targeted_broadcast: { type: Boolean, default: false }, // true when sent to selected companies
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

messageSchema.index({ recipient_id: 1, is_read: 1, created_at: -1 });
messageSchema.index({ recipient_id: 1, created_at: -1 });
messageSchema.index({ sender_id: 1, created_at: -1 });
messageSchema.index({ application_id: 1 });
messageSchema.index({ is_broadcast: 1, created_at: -1 });

export default mongoose.model('Message', messageSchema);
