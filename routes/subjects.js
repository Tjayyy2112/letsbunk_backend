import express from 'express';
import pool from '../db/index.js';

const router = express.Router();

// GET all subjects
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, faculty, color, icon, target,
              attended, absent, od, off_count AS "off", total
       FROM subjects ORDER BY created_at ASC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create subject
router.post('/', async (req, res) => {
  const { name, faculty, color, icon, target, attended = 0, absent = 0, od = 0, off = 0 } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Subject name required' });
  try {
    // Prevent duplicate names
    const dup = await pool.query('SELECT id FROM subjects WHERE LOWER(name)=LOWER($1)', [name.trim()]);
    if (dup.rows.length) return res.status(409).json({ error: 'Subject already exists' });

    const total = parseInt(attended) + parseInt(absent) + parseInt(od);
    const { rows } = await pool.query(
      `INSERT INTO subjects (name, faculty, color, icon, target, attended, absent, od, off_count, total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, name, faculty, color, icon, target,
                 attended, absent, od, off_count AS "off", total`,
      [name.trim(), faculty || '', color || '#8ED8CC', icon || '📚', target || 75, attended, absent, od, off, total]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update subject (name/faculty/color/icon/target/counters)
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, faculty, color, icon, target, attended, absent, od, off } = req.body;
  try {
    // We update total = attended + absent + od. If counters are undefined, we keep existing values.
    const { rows } = await pool.query(
      `UPDATE subjects
       SET name=$1, faculty=$2, color=$3, icon=$4, target=$5, 
           attended=COALESCE($7, attended),
           absent=COALESCE($8, absent),
           od=COALESCE($9, od),
           off_count=COALESCE($10, off_count),
           total=(COALESCE($7, attended) + COALESCE($8, absent) + COALESCE($9, od)),
           updated_at=NOW()
       WHERE id=$6
       RETURNING id, name, faculty, color, icon, target,
                 attended, absent, od, off_count AS "off", total`,
      [name, faculty, color, icon, target, id, attended, absent, od, off]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE subject — safe=true keeps logs, safe=false cascades everything
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const safe = req.query.safe === 'true';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!safe) {
      // Hard delete: cascade deletes logs + timetable via FK
      await client.query('DELETE FROM subjects WHERE id=$1', [id]);
    } else {
      // Safe delete: remove logs + timetable but keep subject row as "archived"
      await client.query('DELETE FROM timetable_entries WHERE subject_id=$1', [id]);
      await client.query(
        `ALTER TABLE subjects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`
      );
      await client.query(
        `UPDATE subjects SET deleted_at=NOW() WHERE id=$1`, [id]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true, safe });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

export default router;
