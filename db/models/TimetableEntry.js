import mongoose from 'mongoose';

const timetableEntrySchema = new mongoose.Schema({
  user_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  subject_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  day:        { type: String, required: true, enum: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
  time:       { type: String, default: '' },
  room:       { type: String, default: '' },
  faculty:    { type: String, default: '' },
}, { timestamps: { createdAt: 'created_at' } });

export default mongoose.model('TimetableEntry', timetableEntrySchema);
