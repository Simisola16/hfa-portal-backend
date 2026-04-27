import mongoose from 'mongoose';

const auditSchema = new mongoose.Schema({
  application_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' },
  inspector_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Inspector' },
  site_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Site' },
  client_id: { type: String, required: true },
  scheduled_date: Date,
  status: { type: String, enum: ['scheduled', 'completed', 'cancelled', 'pending'], default: 'pending' },
  report_url: String,
  notes: String,
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

export default mongoose.model('Audit', auditSchema);
