import mongoose from 'mongoose';

const attendanceLogSchema = new mongoose.Schema({
  user_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  subject_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  date:         { type: String, required: true }, // stored as 'YYYY-MM-DD' string, same format the frontend already uses
  status:       { type: String, required: true, enum: ['PRESENT', 'ABSENT', 'OD', 'OFF'] },
  reason:       { type: String, default: '' },
  period_index: { type: Number, required: true, default: 1 },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// Equivalent of your old UNIQUE(user_id, date, period_index) constraint
attendanceLogSchema.index({ user_id: 1, date: 1, period_index: 1 }, { unique: true });

export default mongoose.model('AttendanceLog', attendanceLogSchema);
