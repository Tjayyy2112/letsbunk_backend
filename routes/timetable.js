import express from 'express';
import pool from '../db/index.js';

const router = express.Router();

// GET all timetable entries grouped by day
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT te.id, te.subject_id AS "subjectId", te.day, te.time, te.room
       FROM timetable_entries te
       JOIN subjects s ON s.id = te.subject_id
       WHERE te.user_id = $1
       ORDER BY te.day, te.time`,
      [req.user_id]
    );
    // Group by day
    const grouped = { Mon:[], Tue:[], Wed:[], Thu:[], Fri:[], Sat:[], Sun:[] };
    rows.forEach(r => { if (grouped[r.day]) grouped[r.day].push(r); });
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
    const { rows } = await pool.query(
      `INSERT INTO timetable_entries (user_id, subject_id, day, time, room)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, subject_id AS "subjectId", day, time, room`,
      [req.user_id, subjectId, day, time || '', room || '']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update entry
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { subjectId, time, room } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE timetable_entries
       SET subject_id=$1, time=$2, room=$3
       WHERE id=$4 AND user_id=$5
       RETURNING id, subject_id AS "subjectId", day, time, room`,
      [subjectId, time, room, id, req.user_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE entry
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM timetable_entries WHERE id=$1 AND user_id=$2', [id, req.user_id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
