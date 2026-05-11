import pool from './index.js';

async function simulate() {
  const req = { user_id: 3, body: { subjectId: 4, date: '2026-05-11', status: 'PRESENT', reason: '', periodIndex: 1, isNewClass: false } };
  const { subjectId, date, status, reason, periodIndex, isNewClass } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify subject belongs to user
    const subCheck = await client.query('SELECT id FROM subjects WHERE id=$1 AND user_id=$2', [subjectId, req.user_id]);
    if (!subCheck.rows.length) throw new Error('Subject not found or unauthorized');

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

    console.log('CHANGES:', changes);
    console.log('SET CLAUSES:', setClauses);
    console.log('VALUES:', [subjectId, req.user_id, ...Object.values(changes).filter(v => v !== 0)]);

    if (setClauses) {
      await client.query(
        `UPDATE subjects SET ${setClauses}, updated_at=NOW() WHERE id=$1 AND user_id=$2`,
        [subjectId, req.user_id, ...Object.values(changes).filter(v => v !== 0)]
      );
    }

    const { rows } = await client.query(
      `INSERT INTO attendance_logs (user_id, subject_id, date, status, reason, period_index)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id, date, period_index)
       DO UPDATE SET subject_id=$2, status=$4, reason=$5, updated_at=NOW()
       RETURNING id, subject_id AS "subjectId", TO_CHAR(date, 'YYYY-MM-DD') AS date, status, reason, period_index, created_at`,
      [req.user_id, subjectId, date, status, reason || '', periodIndex]
    );

    console.log('SUCCESS LOG:', rows[0]);
    await client.query('ROLLBACK');
  } catch (err) {
    console.error('SIMULATION ERROR:', err);
    await client.query('ROLLBACK');
  } finally {
    client.release();
    pool.end();
  }
}

simulate();
