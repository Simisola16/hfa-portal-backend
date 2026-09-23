import mongoose from 'mongoose';

const surveillanceScheduleSchema = new mongoose.Schema({
  application_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Application',
    required: true
  },
  client_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  company_name: {
    type: String,
    required: true,
    trim: true
  },
  site_id: {
    type: String,
    trim: true
  },
  site_name: {
    type: String,
    required: true,
    trim: true
  },
  application_number: {
    type: String,
    required: true,
    trim: true
  },
  application_type: {
    type: String,
    default: 'new'
  },
  category: {
    type: String,
    default: 'UAE/GSO Approved Halal Certification For Exporters To UAE'
  },
  next_surveillance_due_date: {
    type: Date,
    required: true
  },
  admin_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  admin_name: {
    type: String,
    required: true,
    trim: true
  },
  notes: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['scheduled', 'due_soon', 'overdue', 'completed'],
    default: 'scheduled'
  },
  last_reminded_at: {
    type: Date,
    default: null
  },
  reminder_count: {
    type: Number,
    default: 0
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  updated_at: {
    type: Date,
    default: Date.now
  }
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// Index for efficient sorting and filtering
surveillanceScheduleSchema.index({ next_surveillance_due_date: 1 });
surveillanceScheduleSchema.index({ company_name: 'text', site_name: 'text', application_number: 'text', admin_name: 'text' });

export default mongoose.model('SurveillanceSchedule', surveillanceScheduleSchema);
