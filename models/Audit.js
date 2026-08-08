import mongoose from 'mongoose';

const auditorSchema = new mongoose.Schema({
  name: String,
  email: String,
  contact_number: String,
  purpose: String,
  role: { 
    type: String, 
    enum: ['lead_auditor', 'sharia_board', 'audit_trainee'],
    default: 'lead_auditor'
  }
});

const ncReportSchema = new mongoose.Schema({
  text: String,
  document_url: String,
  client_response: String,
  correction_document_url: String,
  admin_reply: String,
  admin_reply_at: Date,
  admin_reply_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  admin_reply_document_url: String,
  status: { type: String, enum: ['flagged', 'corrected', 'client_responded', 'admin_replied', 'closed'], default: 'flagged' },
  flagged_at: { type: Date, default: Date.now },
  corrected_at: Date
});

const auditSchema = new mongoose.Schema({
  application_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' },
  client_id: { type: String, required: true },

  // Custom Scheduled Fields
  inspector_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Inspector' },
  site_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Site' },
  notes: { type: String },
  scheduled_date: { type: Date },
  audit_type: { type: String },

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
      'audit_completed',
      'scheduled',
      'in_progress',
      'completed',
      'cancelled'
    ],
    default: 'pending'
  },
  stage: { type: Number, default: 1 },

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

export default mongoose.model('Audit', auditSchema);
