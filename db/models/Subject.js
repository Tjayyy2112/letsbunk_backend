import mongoose from 'mongoose';

const subjectSchema = new mongoose.Schema({
  user_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name:       { type: String, required: true, trim: true, maxlength: 120 },
  faculty:    { type: String, default: '', maxlength: 120 },
  color:      { type: String, default: '#8ED8CC', maxlength: 20 },
  icon:       { type: String, default: '📚', maxlength: 10 },
  target:     { type: Number, default: 75 },
  attended:   { type: Number, default: 0 },
  absent:     { type: Number, default: 0 },
  od:         { type: Number, default: 0 },
  off_count:  { type: Number, default: 0 },
  total:      { type: Number, default: 0 },
  deleted_at: { type: Date, default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

export default mongoose.model('Subject', subjectSchema);
