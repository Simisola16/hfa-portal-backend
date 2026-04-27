import mongoose from 'mongoose';

const ticketSchema = new mongoose.Schema({
  ticket_number: { type: String, required: true, unique: true },
  user_id: { type: String, required: true },
  subject: { type: String, required: true },
  message: { type: String, required: true },
  department: { type: String, default: 'General' },
  priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  status: { type: String, enum: ['open', 'in_progress', 'resolved', 'closed'], default: 'open' },
  responses: [{
    user_id: String,
    user_name: String,
    message: String,
    created_at: { type: Date, default: Date.now }
  }],
  created_at: { type: Date, default: Date.now }
}, { timestamps: true });

export default mongoose.model('Ticket', ticketSchema);
