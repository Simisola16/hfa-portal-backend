import mongoose from 'mongoose';

const ticketResponseSchema = new mongoose.Schema({
  user_id: { type: String, required: true },
  user_name: String,
  user_role: String,
  message: { type: String, required: true },
  attachments: [{
    name: String,
    url: String,
    file_type: String
  }],
  created_at: { type: Date, default: Date.now }
});

const ticketSchema = new mongoose.Schema({
  ticket_number: { type: String, required: true, unique: true },
  user_id: { type: String, required: true },
  subject: { type: String, required: true },
  message: { type: String, required: true },
  department: { type: String, default: 'General' },
  priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
  status: { type: String, enum: ['open', 'in_progress', 'resolved', 'closed'], default: 'open' },
  application_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' },
  assigned_to: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  attachments: [{
    name: String,
    url: String,
    file_type: String
  }],
  responses: [ticketResponseSchema],
  resolved_at: Date,
  closed_at: Date,
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

export default mongoose.model('Ticket', ticketSchema);
