import mongoose from 'mongoose';

const proposalSchema = new mongoose.Schema({
  client_id: { type: String, required: true },
  application_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' },
  subject: String,
  details: String,
  amount: Number,
  currency: { type: String, default: 'GBP' },
  status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
  proposal_url: String,
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

export default mongoose.model('Proposal', proposalSchema);
