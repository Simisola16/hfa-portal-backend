import mongoose from 'mongoose';

const signatureSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  username: { type: String, required: true, trim: true },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  signature_url: { type: String, default: null },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
});

signatureSchema.pre('save', function (next) {
  this.updated_at = new Date();
  next();
});

export default mongoose.model('Signature', signatureSchema);
