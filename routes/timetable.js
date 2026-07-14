import express from 'express';
import TimetableEntry from '../db/models/TimetableEntry.js';

const router = express.Router();

// GET all timetable entries grouped by day
router.get('/', async (req, res) => {
  try {
    const entries = await TimetableEntry.find({ user_id: req.user_id }).sort({ day: 1, time: 1 });
    const grouped = { Mon:[], Tue:[], Wed:[], Thu:[], Fri:[], Sat:[], Sun:[] };
    entries.forEach(e => {
      if (grouped[e.day]) {
        grouped[e.day].push({ id: e._id, subjectId: e.subject_id, day: e.day, time: e.time, room: e.room });
      }
    });
    res.json(grouped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST add entry
router.post('/', async (req, res) => {
  const { subjectId, day, time, room } = req.body;
  if (!subjectId || !day) return res.status(400).json({ error: 'subjectId and day required' });
  try {
    const entry = await TimetableEntry.create({
      user_id: req.user_id, subject_id: subjectId, day, time: time || '', room: room || '',
    });
    res.status(201).json({ id: entry._id, subjectId: entry.subject_id, day: entry.day, time: entry.time, room: entry.room });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update entry
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { subjectId, time, room } = req.body;
  try {
    const entry = await TimetableEntry.findOneAndUpdate(
      { _id: id, user_id: req.user_id },
      { subject_id: subjectId, time, room },
      { new: true }
    );
    if (!entry) return res.status(404).json({ error: 'Not found' });
    res.json({ id: entry._id, subjectId: entry.subject_id, day: entry.day, time: entry.time, room: entry.room });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE entry
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await TimetableEntry.deleteOne({ _id: id, user_id: req.user_id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
