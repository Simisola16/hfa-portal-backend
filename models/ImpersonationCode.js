import mongoose from 'mongoose';

const impersonationCodeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  token: { type: String, required: true },
  admin_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  client_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now, expires: 60 } // Automatically expires after 60 seconds
});

export default mongoose.model('ImpersonationCode', impersonationCodeSchema);
