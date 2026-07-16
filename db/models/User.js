import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  email:         { type: String, required: true, unique: true, lowercase: true, trim: true },
  password_hash: { type: String, required: true },
  name:          { type: String, default: '' },
  reset_otp:          { type: String, default: null },
  reset_otp_expires:  { type: Date, default: null },
  reset_otp_attempts: { type: Number, default: 0 },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

export default mongoose.model('User', userSchema);
