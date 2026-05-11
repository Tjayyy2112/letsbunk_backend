import pool from './index.js';

async function testMark() {
  const subjectId = 4;
  const user_id = 3;
  const date = '2026-05-11';
  const status = 'PRESENT';
  const reason = '';
  const periodIndex = 1;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Upsert log
    const { rows } = await client.query(
      `INSERT INTO attendance_logs (user_id, subject_id, date, status, reason, period_index)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id, date, period_index)
       DO UPDATE SET subject_id=$2, status=$4, reason=$5, updated_at=NOW()
       RETURNING id, subject_id AS "subjectId", TO_CHAR(date, 'YYYY-MM-DD') AS date, status, reason, period_index, created_at`,
      [user_id, subjectId, date, status, reason, periodIndex]
    );
    console.log('SUCCESS:', rows);
    await client.query('ROLLBACK');
  } catch (err) {
    console.error('ERROR:', err.message);
    await client.query('ROLLBACK');
  } finally {
    client.release();
    pool.end();
  }
}

testMark();
