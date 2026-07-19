import mongoose from 'mongoose';

const addOnApplicationSchema = new mongoose.Schema({
  client_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  certificate_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Certificate', required: true },
  contact_name: { type: String, required: true },
  contact_email: { type: String, required: true },
  contact_phone: { type: String },
  action_type: { type: String, enum: ['add', 'remove', 'change_name'], required: true },
  product_name: { type: String }, // Required for 'remove' and 'change_name'
  new_product_name: { type: String }, // Required for 'add' and 'change_name'
  status: { 
    type: String, 
    enum: ['submitted', 'under_review', 'rejected', 'approved', 'inspection_assigned', 'inspection_completed', 'completed'], 
    default: 'submitted' 
  },
  statusHistory: [{
    status: String,
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    note: String
  }],
  assigned_food_tech: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  food_tech_manager_notes: String,
  rejection_reason: String,
  inspection_notes: String
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

export default mongoose.model('AddOnApplication', addOnApplicationSchema);
