import express from 'express';
import pool from '../db/index.js';

const router = express.Router();

// GET all logs
router.get('/', async (req, res) => {
  try {
    const { date, subjectId } = req.query;
    let q = `SELECT al.id, al.subject_id AS "subjectId", TO_CHAR(al.date, 'YYYY-MM-DD') AS date, al.status, al.reason, al.period_index, al.created_at
             FROM attendance_logs al
             JOIN subjects s ON s.id = al.subject_id
             WHERE al.user_id = $1`;
    const params = [req.user_id];
    if (date)      { params.push(date);      q += ` AND al.date=$${params.length}`; }
    if (subjectId) { params.push(subjectId); q += ` AND al.subject_id=$${params.length}`; }
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

    // Verify subject belongs to user
    const subCheck = await client.query('SELECT id FROM subjects WHERE id=$1 AND user_id=$2', [subjectId, req.user_id]);
    if (!subCheck.rows.length) throw new Error('Subject not found or unauthorized');

    // If adding a new class to a specific period, shift existing periods up
    if (isNewClass) {
      await client.query(
        `UPDATE attendance_logs SET period_index = -period_index WHERE user_id=$1 AND date=$2 AND period_index >= $3`,
        [req.user_id, date, periodIndex]
      );
      await client.query(
        `UPDATE attendance_logs SET period_index = -period_index + 1 WHERE user_id=$1 AND date=$2 AND period_index <= $3`,
        [req.user_id, date, -periodIndex]
      );
    }

    // Check existing log for this date+periodIndex
    const existing = await client.query(
      `SELECT status, subject_id FROM attendance_logs WHERE user_id=$1 AND date=$2 AND period_index=$3`,
      [req.user_id, date, periodIndex]
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
        .map(([col], i) => `${col} = GREATEST(0, ${col} + $${i + 3})`)
        .join(', ');

      if (setClausesOld) {
        await client.query(
          `UPDATE subjects SET ${setClausesOld}, updated_at=NOW() WHERE id=$1 AND user_id=$2`,
          [oldSubjectId, req.user_id, ...Object.values(changesOld).filter(v => v !== 0)]
        );
      }

      // Apply new subject
      const changesNew = {};
      for (const [k, v] of Object.entries(apply)) changesNew[k] = (changesNew[k] || 0) + v;
      if (status !== 'OFF') changesNew.total = 1;

      const setClausesNew = Object.entries(changesNew)
        .filter(([, v]) => v !== 0)
        .map(([col], i) => `${col} = GREATEST(0, ${col} + $${i + 3})`)
        .join(', ');

      if (setClausesNew) {
        await client.query(
          `UPDATE subjects SET ${setClausesNew}, updated_at=NOW() WHERE id=$1 AND user_id=$2`,
          [subjectId, req.user_id, ...Object.values(changesNew).filter(v => v !== 0)]
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
        .map(([col], i) => `${col} = GREATEST(0, ${col} + $${i + 3})`)
        .join(', ');

      if (setClauses) {
        await client.query(
          `UPDATE subjects SET ${setClauses}, updated_at=NOW() WHERE id=$1 AND user_id=$2`,
          [subjectId, req.user_id, ...Object.values(changes).filter(v => v !== 0)]
        );
      }
    }

    // Upsert log
    const { rows } = await client.query(
      `INSERT INTO attendance_logs (user_id, subject_id, date, status, reason, period_index)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id, date, period_index)
       DO UPDATE SET subject_id=$2, status=$4, reason=$5, updated_at=NOW()
       RETURNING id, subject_id AS "subjectId", TO_CHAR(date, 'YYYY-MM-DD') AS date, status, reason, period_index, created_at`,
      [req.user_id, subjectId, date, status, reason || '', periodIndex]
    );

    const subRes = await client.query(
      `SELECT id, name, faculty, color, icon, target,
              attended, absent, od, off_count AS "off", total
       FROM subjects WHERE id=$1 AND user_id=$2`,
      [subjectId, req.user_id]
    );

    let oldSubRes = null;
    if (oldSubjectId && oldSubjectId !== subjectId) {
      const os = await client.query(`SELECT id, name, attended, absent, od, off_count AS "off", total FROM subjects WHERE id=$1 AND user_id=$2`, [oldSubjectId, req.user_id]);
      oldSubRes = os.rows[0];
    }

    await client.query('COMMIT');
    res.json({ log: rows[0], subject: subRes.rows[0], oldSubject: oldSubRes });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    import('fs').then(fs => fs.appendFileSync('error.log', err.stack + '\\n'));
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
      `SELECT subject_id, status FROM attendance_logs WHERE user_id=$1 AND date=$2 AND period_index=$3`,
      [req.user_id, date, periodIndex]
    );
    if (!existing.rows.length) { await client.query('COMMIT'); return res.json({ ok: true }); }

    const { status, subject_id } = existing.rows[0];
    await client.query(
      `DELETE FROM attendance_logs WHERE user_id=$1 AND date=$2 AND period_index=$3`,
      [req.user_id, date, periodIndex]
    );

    // Shift periods back down
    await client.query(
      `UPDATE attendance_logs SET period_index = -period_index WHERE user_id=$1 AND date=$2 AND period_index > $3`,
      [req.user_id, date, periodIndex]
    );
    await client.query(
      `UPDATE attendance_logs SET period_index = -period_index - 1 WHERE user_id=$1 AND date=$2 AND period_index < $3`,
      [req.user_id, date, -periodIndex]
    );

    // Rollback counters
    const colMap = { PRESENT: 'attended', ABSENT: 'absent', OD: 'od', OFF: 'off_count' };
    const col = colMap[status];
    await client.query(
      `UPDATE subjects SET ${col}=GREATEST(0,${col}-1),
       total=GREATEST(0, total - $1), updated_at=NOW()
       WHERE id=$2 AND user_id=$3`,
      [status !== 'OFF' ? 1 : 0, subject_id, req.user_id]
    );

    const subRes = await client.query(
      `SELECT id, name, faculty, color, icon, target,
              attended, absent, od, off_count AS "off", total
       FROM subjects WHERE id=$1 AND user_id=$2`,
      [subject_id, req.user_id]
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
    await client.query('DELETE FROM attendance_logs WHERE user_id=$1', [req.user_id]);
    await client.query('UPDATE subjects SET attended=0, absent=0, od=0, off_count=0, total=0, updated_at=NOW() WHERE user_id=$1', [req.user_id]);
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
    await client.query('DELETE FROM attendance_logs WHERE user_id=$1', [req.user_id]);
    await client.query('DELETE FROM timetable_entries WHERE user_id=$1', [req.user_id]);
    await client.query('DELETE FROM subjects WHERE user_id=$1', [req.user_id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// DELETE clear all logs for a date
router.delete('/day', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const logs = await client.query(
      `SELECT subject_id, status FROM attendance_logs WHERE user_id=$1 AND date=$2`,
      [req.user_id, date]
    );

    for (const log of logs.rows) {
      const colMap = { PRESENT: 'attended', ABSENT: 'absent', OD: 'od', OFF: 'off_count' };
      const col = colMap[log.status];
      if (col) {
        await client.query(
          `UPDATE subjects SET ${col}=GREATEST(0,${col}-1),
           total=GREATEST(0, total - $1), updated_at=NOW()
           WHERE id=$2 AND user_id=$3`,
          [log.status !== 'OFF' ? 1 : 0, log.subject_id, req.user_id]
        );
      }
    }

    await client.query(
      `DELETE FROM attendance_logs WHERE user_id=$1 AND date=$2`,
      [req.user_id, date]
    );

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST mark whole day
router.post('/day', async (req, res) => {
  const { date, status, fillFromTimetable } = req.body;
  if (!date || !status) return res.status(400).json({ error: 'date and status required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Find existing logs
    const existing = await client.query(
      `SELECT subject_id, period_index, status FROM attendance_logs WHERE user_id=$1 AND date=$2`,
      [req.user_id, date]
    );

    let targets = [];
    if (existing.rows.length > 0) {
      targets = existing.rows.map(r => ({ subjectId: r.subject_id, periodIndex: r.period_index, oldStatus: r.status }));
    } else if (fillFromTimetable) {
      // Fetch from timetable (useful for Today screen)
      const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(date).getDay()];
      const tt = await client.query(
        `SELECT subject_id, time FROM timetable_entries WHERE user_id=$1 AND day=$2 ORDER BY time`,
        [req.user_id, dayName]
      );
      targets = tt.rows.map((r, i) => ({ subjectId: r.subject_id, periodIndex: i + 1, oldStatus: null }));
    } else {
      await client.query('COMMIT');
      return res.status(404).json({ error: 'No classes found for this date. Please mark at least one class manually first.' });
    }

    if (targets.length === 0) {
      await client.query('COMMIT');
      return res.json({ ok: true, message: 'No classes to mark' });
    }

    const delta = (s, sign) => {
      if (!s) return {};
      const map = { PRESENT: { attended: sign }, ABSENT: { absent: sign }, OD: { od: sign }, OFF: { off_count: sign } };
      return map[s] || {};
    };

    for (const t of targets) {
      const rollback = delta(t.oldStatus, -1);
      const apply    = delta(status, +1);

      const changes = {};
      for (const [k, v] of Object.entries(rollback)) changes[k] = (changes[k] || 0) + v;
      for (const [k, v] of Object.entries(apply))    changes[k] = (changes[k] || 0) + v;

      const oldAffectsTotal = t.oldStatus && t.oldStatus !== 'OFF';
      const newAffectsTotal = status !== 'OFF';
      if (!t.oldStatus && newAffectsTotal)          changes.total = 1;
      if (t.oldStatus && oldAffectsTotal && !newAffectsTotal) changes.total = -1;
      if (t.oldStatus && !oldAffectsTotal && newAffectsTotal) changes.total = 1;

      const setClauses = Object.entries(changes)
        .filter(([, v]) => v !== 0)
        .map(([col], i) => `${col} = GREATEST(0, ${col} + $${i + 3})`)
        .join(', ');

      if (setClauses) {
        await client.query(
          `UPDATE subjects SET ${setClauses}, updated_at=NOW() WHERE id=$1 AND user_id=$2`,
          [t.subjectId, req.user_id, ...Object.values(changes).filter(v => v !== 0)]
        );
      }

      await client.query(
        `INSERT INTO attendance_logs (user_id, subject_id, date, status, reason, period_index)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (user_id, date, period_index)
         DO UPDATE SET status=$4, updated_at=NOW()`,
        [req.user_id, t.subjectId, date, status, '', t.periodIndex]
      );
    }

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

