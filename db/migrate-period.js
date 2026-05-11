import pool from './index.js';

async function migrate() {
  console.log('Starting migration to add period_index...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Drop the unique constraint
    console.log('Dropping unique constraint on attendance_logs...');
    await client.query('ALTER TABLE attendance_logs DROP CONSTRAINT IF EXISTS attendance_logs_subject_id_date_key');

    // 2. Add the period_index column
    console.log('Adding period_index column...');
    await client.query('ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS period_index INTEGER DEFAULT 1');

    // 3. Create a new unique constraint including period_index
    // Actually, we don't strictly *need* a unique constraint on (subject_id, date, period_index) because
    // it's possible the user wants to add multiple classes. But (date, period_index) should ideally be unique per user.
    // However, Letsbunk doesn't have a multi-user model right now.
    // So UNIQUE (date, period_index) is safe.
    console.log('Adding new unique constraint on (date, period_index)...');
    await client.query('ALTER TABLE attendance_logs ADD CONSTRAINT unique_date_period UNIQUE (date, period_index)');

    // 4. Assign sequential period_index to existing logs so they don't violate the constraint
    console.log('Assigning period_index to existing logs...');
    await client.query(`
      WITH numbered AS (
        SELECT id, ROW_NUMBER() OVER(PARTITION BY date ORDER BY created_at) as rn
        FROM attendance_logs
      )
      UPDATE attendance_logs al
      SET period_index = n.rn
      FROM numbered n
      WHERE al.id = n.id
    `);

    await client.query('COMMIT');
    console.log('Migration successful!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
