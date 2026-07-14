import express from 'express';
import AttendanceLog from '../db/models/AttendanceLog.js';
import Subject from '../db/models/Subject.js';
import TimetableEntry from '../db/models/TimetableEntry.js';

const router = express.Router();

const COUNTER_MAP = { PRESENT: 'attended', ABSENT: 'absent', OD: 'od', OFF: 'off_count' };

const delta = (status, sign) => {
  if (!status) return {};
  const col = COUNTER_MAP[status];
  return col ? { [col]: sign } : {};
};

const formatLog = (log) => ({
  id: log._id,
  subjectId: log.subject_id,
  date: log.date,
  status: log.status,
  reason: log.reason,
  period_index: log.period_index,
  created_at: log.created_at,
});

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

async function applySubjectChanges(subjectId, userId, changes) {
  const filtered = Object.entries(changes).filter(([, v]) => v !== 0);
  if (!filtered.length) return;
  const subject = await Subject.findOne({ _id: subjectId, user_id: userId });
  if (!subject) return;
  for (const [col, v] of filtered) {
    subject[col] = Math.max(0, (subject[col] || 0) + v);
  }
  subject.updated_at = new Date();
  await subject.save();
}

// GET all logs
router.get('/', async (req, res) => {
  try {
    const { date, subjectId } = req.query;
    const query = { user_id: req.user_id };
    if (date) query.date = date;
    if (subjectId) query.subject_id = subjectId;

    const logs = await AttendanceLog.find(query).sort({ date: -1, period_index: 1, created_at: -1 });
    res.json(logs.map(formatLog));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST mark attendance
router.post('/', async (req, res) => {
  const { subjectId, date, status, reason, periodIndex, isNewClass } = req.body;
  if (!subjectId || !date || !status || !periodIndex) {
    return res.status(400).json({ error: 'subjectId, date, status, periodIndex required' });
  }

  try {
    const subCheck = await Subject.findOne({ _id: subjectId, user_id: req.user_id });
    if (!subCheck) throw new Error('Subject not found or unauthorized');

    // If adding a new class into a specific period, shift existing periods up.
    // Done in two passes (negate, then re-positive) to avoid transient unique-index collisions,
    // same trick the old Postgres migration used.
    if (isNewClass) {
      await AttendanceLog.updateMany(
        { user_id: req.user_id, date, period_index: { $gte: periodIndex } },
        [{ $set: { period_index: { $multiply: ['$period_index', -1] } } }]
      );
      await AttendanceLog.updateMany(
        { user_id: req.user_id, date, period_index: { $lte: -periodIndex } },
        [{ $set: { period_index: { $add: [{ $multiply: ['$period_index', -1] }, 1] } } }]
      );
    }

    // Check existing log for this date+periodIndex
    const existing = await AttendanceLog.findOne({ user_id: req.user_id, date, period_index: periodIndex });
    const oldStatus = existing?.status || null;
    const oldSubjectId = existing?.subject_id?.toString() || null;

    const rollback = delta(oldStatus, -1);
    const apply = delta(status, +1);

    if (oldSubjectId && oldSubjectId !== subjectId.toString()) {
      // Rollback old subject completely
      const changesOld = { ...rollback };
      if (oldStatus && oldStatus !== 'OFF') changesOld.total = (changesOld.total || 0) - 1;
      await applySubjectChanges(oldSubjectId, req.user_id, changesOld);

      // Apply new subject
      const changesNew = { ...apply };
      if (status !== 'OFF') changesNew.total = (changesNew.total || 0) + 1;
      await applySubjectChanges(subjectId, req.user_id, changesNew);
    } else {
      // Same subject
      const changes = {};
      for (const [k, v] of Object.entries(rollback)) changes[k] = (changes[k] || 0) + v;
      for (const [k, v] of Object.entries(apply)) changes[k] = (changes[k] || 0) + v;

      const oldAffectsTotal = oldStatus && oldStatus !== 'OFF';
      const newAffectsTotal = status !== 'OFF';
      if (!oldStatus && newAffectsTotal) changes.total = (changes.total || 0) + 1;
      if (oldStatus && oldAffectsTotal && !newAffectsTotal) changes.total = (changes.total || 0) - 1;
      if (oldStatus && !oldAffectsTotal && newAffectsTotal) changes.total = (changes.total || 0) + 1;

      await applySubjectChanges(subjectId, req.user_id, changes);
    }

    // Upsert log
    const log = await AttendanceLog.findOneAndUpdate(
      { user_id: req.user_id, date, period_index: periodIndex },
      { subject_id: subjectId, status, reason: reason || '', updated_at: new Date() },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const subject = await Subject.findOne({ _id: subjectId, user_id: req.user_id });

    let oldSubject = null;
    if (oldSubjectId && oldSubjectId !== subjectId.toString()) {
      oldSubject = await Subject.findOne({ _id: oldSubjectId, user_id: req.user_id });
    }

    res.json({
      log: formatLog(log),
      subject: subject ? formatSubject(subject) : null,
      oldSubject: oldSubject ? formatSubject(oldSubject) : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE clear a log
router.delete('/', async (req, res) => {
  const { date, periodIndex } = req.query;
  if (!date || !periodIndex) return res.status(400).json({ error: 'date and periodIndex required' });
  const pIndex = Number(periodIndex);

  try {
    const existing = await AttendanceLog.findOne({ user_id: req.user_id, date, period_index: pIndex });
    if (!existing) return res.json({ ok: true });

    const { status, subject_id } = existing;
    await AttendanceLog.deleteOne({ _id: existing._id });

    // Shift periods back down (same negate/re-apply trick)
    await AttendanceLog.updateMany(
      { user_id: req.user_id, date, period_index: { $gt: pIndex } },
      [{ $set: { period_index: { $multiply: ['$period_index', -1] } } }]
    );
    await AttendanceLog.updateMany(
      { user_id: req.user_id, date, period_index: { $lt: -pIndex } },
      [{ $set: { period_index: { $add: [{ $multiply: ['$period_index', -1] }, -1] } } }]
    );

    // Rollback counters
    const col = COUNTER_MAP[status];
    if (col) {
      const changes = { [col]: -1 };
      if (status !== 'OFF') changes.total = -1;
      await applySubjectChanges(subject_id, req.user_id, changes);
    }

    const subject = await Subject.findOne({ _id: subject_id, user_id: req.user_id });
    res.json({ ok: true, subject: subject ? formatSubject(subject) : null, deletedPeriod: pIndex });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE semester reset
router.delete('/reset', async (req, res) => {
  try {
    await AttendanceLog.deleteMany({ user_id: req.user_id });
    await Subject.updateMany(
      { user_id: req.user_id },
      { $set: { attended: 0, absent: 0, od: 0, off_count: 0, total: 0, updated_at: new Date() } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE clear all data
router.delete('/clear-all', async (req, res) => {
  try {
    await AttendanceLog.deleteMany({ user_id: req.user_id });
    await TimetableEntry.deleteMany({ user_id: req.user_id });
    await Subject.deleteMany({ user_id: req.user_id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE clear all logs for a date
router.delete('/day', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });

  try {
    const logs = await AttendanceLog.find({ user_id: req.user_id, date });

    for (const log of logs) {
      const col = COUNTER_MAP[log.status];
      if (col) {
        const changes = { [col]: -1 };
        if (log.status !== 'OFF') changes.total = -1;
        await applySubjectChanges(log.subject_id, req.user_id, changes);
      }
    }

    await AttendanceLog.deleteMany({ user_id: req.user_id, date });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST mark whole day
router.post('/day', async (req, res) => {
  const { date, status, reason } = req.body;
  if (!date || !status) return res.status(400).json({ error: 'date and status required' });

  try {
    const existing = await AttendanceLog.find({ user_id: req.user_id, date });

    let targets = [];
    if (existing.length > 0) {
      targets = existing.map(r => ({ subjectId: r.subject_id, periodIndex: r.period_index, oldStatus: r.status }));
    } else {
      const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(date).getDay()];
      const tt = await TimetableEntry.find({ user_id: req.user_id, day: dayName }).sort({ time: 1 });
      targets = tt.map((r, i) => ({ subjectId: r.subject_id, periodIndex: i + 1, oldStatus: null }));
    }

    if (targets.length === 0) {
      return res.status(404).json({ error: 'No classes found for this date in your timetable or logs.' });
    }

    for (const t of targets) {
      const rollback = delta(t.oldStatus, -1);
      const apply = delta(status, +1);

      const changes = {};
      for (const [k, v] of Object.entries(rollback)) changes[k] = (changes[k] || 0) + v;
      for (const [k, v] of Object.entries(apply)) changes[k] = (changes[k] || 0) + v;

      const oldAffectsTotal = t.oldStatus && t.oldStatus !== 'OFF';
      const newAffectsTotal = status !== 'OFF';
      if (!t.oldStatus && newAffectsTotal) changes.total = (changes.total || 0) + 1;
      if (t.oldStatus && oldAffectsTotal && !newAffectsTotal) changes.total = (changes.total || 0) - 1;
      if (t.oldStatus && !oldAffectsTotal && newAffectsTotal) changes.total = (changes.total || 0) + 1;

      await applySubjectChanges(t.subjectId, req.user_id, changes);

      await AttendanceLog.findOneAndUpdate(
        { user_id: req.user_id, date, period_index: t.periodIndex },
        { subject_id: t.subjectId, status, reason: reason || '', updated_at: new Date() },
        { upsert: true, setDefaultsOnInsert: true }
      );
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
