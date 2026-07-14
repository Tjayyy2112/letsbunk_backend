import express from 'express';
import Subject from '../db/models/Subject.js';
import TimetableEntry from '../db/models/TimetableEntry.js';

const router = express.Router();

const formatSubject = (s) => ({
  id: s._id,
  name: s.name,
  faculty: s.faculty,
  color: s.color,
  icon: s.icon,
  target: s.target,
  attended: s.attended,
  absent: s.absent,
  od: s.od,
  off: s.off_count,
  total: s.total,
});

// GET all subjects
router.get('/', async (req, res) => {
  try {
    const subjects = await Subject.find({ user_id: req.user_id, deleted_at: null }).sort({ created_at: 1 });
    res.json(subjects.map(formatSubject));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create subject
router.post('/', async (req, res) => {
  const { name, faculty, color, icon, target, attended = 0, absent = 0, od = 0, off = 0 } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Subject name required' });
  try {
    const dup = await Subject.findOne({
      user_id: req.user_id,
      deleted_at: null,
      name: { $regex: `^${name.trim()}$`, $options: 'i' },
    });
    if (dup) return res.status(409).json({ error: 'Subject already exists' });

    const total = parseInt(attended) + parseInt(absent) + parseInt(od);
    const subject = await Subject.create({
      user_id: req.user_id,
      name: name.trim(),
      faculty: faculty || '',
      color: color || '#8ED8CC',
      icon: icon || '📚',
      target: target || 75,
      attended, absent, od, off_count: off, total,
    });
    res.status(201).json(formatSubject(subject));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update subject
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, faculty, color, icon, target, attended, absent, od, off } = req.body;
  try {
    const subject = await Subject.findOne({ _id: id, user_id: req.user_id });
    if (!subject) return res.status(404).json({ error: 'Not found' });

    subject.name = name;
    subject.faculty = faculty;
    subject.color = color;
    subject.icon = icon;
    subject.target = target;
    if (attended !== undefined) subject.attended = attended;
    if (absent !== undefined) subject.absent = absent;
    if (od !== undefined) subject.od = od;
    if (off !== undefined) subject.off_count = off;
    subject.total = (subject.attended || 0) + (subject.absent || 0) + (subject.od || 0);
    subject.updated_at = new Date();

    await subject.save();
    res.json(formatSubject(subject));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE subject — safe=true keeps logs, safe=false hard-deletes
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const safe = req.query.safe === 'true';
  try {
    const subject = await Subject.findOne({ _id: id, user_id: req.user_id });
    if (!subject) return res.status(404).json({ error: 'Not found' });

    if (!safe) {
      await Subject.deleteOne({ _id: id });
    } else {
      await TimetableEntry.deleteMany({ subject_id: id, user_id: req.user_id });
      subject.deleted_at = new Date();
      await subject.save();
    }
    res.json({ ok: true, safe });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
