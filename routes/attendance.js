import express from 'express';
import pool from '../db/index.js';

const router = express.Router();

// GET all logs
router.get('/', async (req, res) => {
  try {
    const { date, subjectId } = req.query;
    let q = `SELECT al.id, al.subject_id AS "subjectId", TO_CHAR(al.date, 'YYYY-MM-DD') AS date, al.status, al.reason, al.period_index, al.created_at
             FROM attendance_logs al`;
    const params = [];
    const wheres = [];
    if (date)      { params.push(date);      wheres.push(`al.date=$${params.length}`); }
    if (subjectId) { params.push(subjectId); wheres.push(`al.subject_id=$${params.length}`); }
    if (wheres.length) q += ' WHERE ' + wheres.join(' AND ');
    q += ' ORDER BY al.date DESC, al.period_index ASC, al.created_at DESC';
    const { rows } = await pool.query(q, params);
    res.json(rows);
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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // If adding a new class to a specific period, shift existing periods up
    if (isNewClass) {
      await client.query(
        `UPDATE attendance_logs SET period_index = -period_index WHERE date=$1 AND period_index >= $2`,
        [date, periodIndex]
      );
      await client.query(
        `UPDATE attendance_logs SET period_index = -period_index + 1 WHERE date=$1 AND period_index <= $2`,
        [date, -periodIndex]
      );
    }

    // Check existing log for this date+periodIndex
    const existing = await client.query(
      `SELECT status, subject_id FROM attendance_logs WHERE date=$1 AND period_index=$2`,
      [date, periodIndex]
    );
    const oldStatus = existing.rows[0]?.status || null;
    const oldSubjectId = existing.rows[0]?.subject_id || null;

    // Build counter delta
    const delta = (s, sign) => {
      if (!s) return {};
      const map = {
        PRESENT: { attended: sign },
        ABSENT:  { absent:    sign },
        OD:      { od:        sign },
        OFF:     { off_count: sign },
      };
      return map[s] || {};
    };

    const rollback = delta(oldStatus, -1);
    const apply    = delta(status, +1);

    // If subject changes, we need to rollback old subject counters and apply new subject counters
    if (oldSubjectId && oldSubjectId !== subjectId) {
      // Rollback old subject completely
      const changesOld = {};
      for (const [k, v] of Object.entries(rollback)) changesOld[k] = (changesOld[k] || 0) + v;
      if (oldStatus && oldStatus !== 'OFF') changesOld.total = -1;

      const setClausesOld = Object.entries(changesOld)
        .filter(([, v]) => v !== 0)
        .map(([col], i) => `${col} = GREATEST(0, ${col} + $${i + 2})`)
        .join(', ');

      if (setClausesOld) {
        await client.query(
          `UPDATE subjects SET ${setClausesOld}, updated_at=NOW() WHERE id=$1`,
          [oldSubjectId, ...Object.values(changesOld).filter(v => v !== 0)]
        );
      }

      // Apply new subject
      const changesNew = {};
      for (const [k, v] of Object.entries(apply)) changesNew[k] = (changesNew[k] || 0) + v;
      if (status !== 'OFF') changesNew.total = 1;

      const setClausesNew = Object.entries(changesNew)
        .filter(([, v]) => v !== 0)
        .map(([col], i) => `${col} = GREATEST(0, ${col} + $${i + 2})`)
        .join(', ');

      if (setClausesNew) {
        await client.query(
          `UPDATE subjects SET ${setClausesNew}, updated_at=NOW() WHERE id=$1`,
          [subjectId, ...Object.values(changesNew).filter(v => v !== 0)]
        );
      }
    } else {
      // Same subject
      const changes = {};
      for (const [k, v] of Object.entries(rollback)) changes[k] = (changes[k] || 0) + v;
      for (const [k, v] of Object.entries(apply))    changes[k] = (changes[k] || 0) + v;

      const oldAffectsTotal = oldStatus && oldStatus !== 'OFF';
      const newAffectsTotal = status !== 'OFF';
      if (!oldStatus && newAffectsTotal)          changes.total = 1;
      if (oldStatus && oldAffectsTotal && !newAffectsTotal) changes.total = -1;
      if (oldStatus && !oldAffectsTotal && newAffectsTotal) changes.total = 1;

      const setClauses = Object.entries(changes)
        .filter(([, v]) => v !== 0)
        .map(([col], i) => `${col} = GREATEST(0, ${col} + $${i + 2})`)
        .join(', ');

      if (setClauses) {
        await client.query(
          `UPDATE subjects SET ${setClauses}, updated_at=NOW() WHERE id=$1`,
          [subjectId, ...Object.values(changes).filter(v => v !== 0)]
        );
      }
    }

    // Upsert log
    const { rows } = await client.query(
      `INSERT INTO attendance_logs (subject_id, date, status, reason, period_index)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (date, period_index)
       DO UPDATE SET subject_id=$1, status=$3, reason=$4, updated_at=NOW()
       RETURNING id, subject_id AS "subjectId", TO_CHAR(date, 'YYYY-MM-DD') AS date, status, reason, period_index, created_at`,
      [subjectId, date, status, reason || '', periodIndex]
    );

    const subRes = await client.query(
      `SELECT id, name, faculty, color, icon, target,
              attended, absent, od, off_count AS "off", total
       FROM subjects WHERE id=$1`,
      [subjectId]
    );

    let oldSubRes = null;
    if (oldSubjectId && oldSubjectId !== subjectId) {
      const os = await client.query(`SELECT id, name, attended, absent, od, off_count AS "off", total FROM subjects WHERE id=$1`, [oldSubjectId]);
      oldSubRes = os.rows[0];
    }

    await client.query('COMMIT');
    res.json({ log: rows[0], subject: subRes.rows[0], oldSubject: oldSubRes });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// DELETE clear a log
router.delete('/', async (req, res) => {
  const { date, periodIndex } = req.query;
  if (!date || !periodIndex) return res.status(400).json({ error: 'date and periodIndex required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT subject_id, status FROM attendance_logs WHERE date=$1 AND period_index=$2`,
      [date, periodIndex]
    );
    if (!existing.rows.length) { await client.query('COMMIT'); return res.json({ ok: true }); }

    const { status, subject_id } = existing.rows[0];
    await client.query(
      `DELETE FROM attendance_logs WHERE date=$1 AND period_index=$2`,
      [date, periodIndex]
    );

    // Shift periods back down
    await client.query(
      `UPDATE attendance_logs SET period_index = -period_index WHERE date=$1 AND period_index > $2`,
      [date, periodIndex]
    );
    await client.query(
      `UPDATE attendance_logs SET period_index = -period_index - 1 WHERE date=$1 AND period_index < $2`,
      [date, -periodIndex]
    );

    // Rollback counters
    const colMap = { PRESENT: 'attended', ABSENT: 'absent', OD: 'od', OFF: 'off_count' };
    const col = colMap[status];
    await client.query(
      `UPDATE subjects SET ${col}=GREATEST(0,${col}-1),
       total=GREATEST(0, total - $1), updated_at=NOW()
       WHERE id=$2`,
      [status !== 'OFF' ? 1 : 0, subject_id]
    );

    const subRes = await client.query(
      `SELECT id, name, faculty, color, icon, target,
              attended, absent, od, off_count AS "off", total
       FROM subjects WHERE id=$1`,
      [subject_id]
    );

    await client.query('COMMIT');
    res.json({ ok: true, subject: subRes.rows[0], deletedPeriod: parseInt(periodIndex) });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// DELETE semester reset
router.delete('/reset', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM attendance_logs');
    await client.query('UPDATE subjects SET attended=0, absent=0, od=0, off_count=0, total=0, updated_at=NOW()');
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// DELETE clear all data
router.delete('/clear-all', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM attendance_logs');
    await client.query('DELETE FROM timetable');
    await client.query('DELETE FROM subjects');
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

export default router;
