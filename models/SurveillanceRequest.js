import mongoose from 'mongoose';

const surveillanceRequestSchema = new mongoose.Schema({
  client_id: { type: String, required: true },
  certificate_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Certificate', required: true },
  requested_at: { type: Date, default: Date.now },
  status: {
    type: String,
    enum: ['requested', 'fulfilled'],
    default: 'requested'
  },
  // Path to the uploaded surveillance letter
  letter_file_url: { type: String },
  fulfilled_at: { type: Date },
  notes: { type: String }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

export default mongoose.model('SurveillanceRequest', surveillanceRequestSchema);
