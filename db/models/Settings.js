import mongoose from 'mongoose';

const settingsSchema = new mongoose.Schema({
  user_id:            { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  target_attendance:  { type: Number, default: 75 },
  notifications:      { type: Boolean, default: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

export default mongoose.model('Settings', settingsSchema);
