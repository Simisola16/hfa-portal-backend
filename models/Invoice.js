import mongoose from 'mongoose';

const invoiceSchema = new mongoose.Schema({
  client_id: { type: String, required: true },
  application_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' },
  invoice_number: { type: String, required: true, unique: true },
  title: { type: String },
  description: { type: String },
  notes: { type: String },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'GBP' },
  status: { type: String, enum: ['unpaid', 'paid', 'client_paid', 'cancelled', 'overdue'], default: 'unpaid' },
  due_date: Date,
  paid_at: Date,
  invoice_url: String,
  payment_proof_url: String,
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

export default mongoose.model('Invoice', invoiceSchema);
