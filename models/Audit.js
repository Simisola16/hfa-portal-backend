import mongoose from 'mongoose';

const auditorSchema = new mongoose.Schema({
  name: String,
  email: String,
  contact_number: String,
  purpose: String
});

const ncReportSchema = new mongoose.Schema({
  text: String,
  document_url: String,
  status: { type: String, enum: ['flagged', 'corrected'], default: 'flagged' },
  flagged_at: { type: Date, default: Date.now },
  corrected_at: Date
});

const auditSchema = new mongoose.Schema({
  application_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' },
  client_id: { type: String, required: true },

  // The 3 dates proposed by admin
  proposed_dates: [{ type: Date }],

  // If the client rejects the dates
  client_unavailable: { type: Boolean, default: false },

  // The 2 dates chosen by the client
  selected_dates: [{ type: Date }],

  // The 1 final date confirmed by admin from client's 2
  finalized_date: { type: Date },

  // The auditors assigned
  auditors: [auditorSchema],

  // NC reports
  nc_reports: [ncReportSchema],

  status: {
    type: String,
    enum: [
      'pending',
      'dates_proposed',
      'dates_rejected',
      'dates_accepted',
      'date_finalized',
      'auditors_assigned',
      'audit_completed'
    ],
    default: 'pending'
  },

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

export default mongoose.model('Audit', auditSchema);
