import mongoose from 'mongoose';

const invoiceSchema = new mongoose.Schema({
  client_id: { type: mongoose.Schema.Types.Mixed, required: true },
  application_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' },
  invoice_number: { type: String, required: true, unique: true },
  title: { type: String },
  description: { type: String },
  notes: { type: String },
  invoice_type: { type: String, enum: ['initial', 'final'], default: 'initial' },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'GBP' },
  status: { type: String, enum: ['unpaid', 'paid', 'client_paid', 'cancelled', 'overdue'], default: 'unpaid' },
  due_date: Date,
  paid_at: Date,
  payment_date: Date,
  confirmed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  confirmed_at: Date,
  invoice_url: String,
  payment_proof_url: String,
  version: { type: Number, default: 1 },
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

invoiceSchema.virtual('profiles', {
  ref: 'User',
  localField: 'client_id',
  foreignField: '_id',
  justOne: true
});

invoiceSchema.index({ client_id: 1 });
invoiceSchema.index({ status: 1 });
invoiceSchema.index({ invoice_type: 1 });
invoiceSchema.index({ application_id: 1 });
invoiceSchema.index({ client_id: 1, status: 1 });
invoiceSchema.index({ created_at: -1 });
invoiceSchema.index({ createdAt: -1 });
invoiceSchema.index({ status: 1, created_at: -1 });

export default mongoose.model('Invoice', invoiceSchema);
