import mongoose from 'mongoose';

const invoiceSchema = new mongoose.Schema({
  client_id: { type: String, required: true },
  application_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' },
  invoice_number: { type: String, required: true, unique: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'GBP' },
  status: { type: String, enum: ['unpaid', 'paid', 'cancelled', 'overdue'], default: 'unpaid' },
  due_date: Date,
  paid_at: Date,
  invoice_url: String,
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

export default mongoose.model('Invoice', invoiceSchema);
