import mongoose from 'mongoose';

const logsheetSchema = new mongoose.Schema({
  entity_type: { type: String, enum: ['account', 'product', 'application'], required: true },
  entity_id: { type: String, required: true },
  step_name: String,
  performed_by: String, // Admin/Staff ID
  action: String, // e.g. 'Approved', 'Commented', 'Flagged'
  details: String,
  status_after: String,
  created_at: { type: Date, default: Date.now }
}, { timestamps: true });

export default mongoose.model('Logsheet', logsheetSchema);
