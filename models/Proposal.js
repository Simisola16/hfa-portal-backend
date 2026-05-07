import mongoose from 'mongoose';

const proposalSchema = new mongoose.Schema({
  client_id: { type: String, required: true },
  application_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' },
  title: String,
  subject: String,
  details: String,
  amount: Number,
  estimated_cost: { type: Number },
  currency: { type: String, default: 'GBP' },
  status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
  proposal_url: String,
  admin_comment: String,
  client_comment: String,
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

export default mongoose.model('Proposal', proposalSchema);
