import pool from './index.js';

const migrate = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Settings
    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id SERIAL PRIMARY KEY,
        target_attendance INTEGER NOT NULL DEFAULT 75,
        notifications BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Insert default settings row if not exists
    await client.query(`
      INSERT INTO settings (target_attendance, notifications)
      SELECT 75, true
      WHERE NOT EXISTS (SELECT 1 FROM settings LIMIT 1);
    `);

    // Subjects
    await client.query(`
      CREATE TABLE IF NOT EXISTS subjects (
        id SERIAL PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        faculty VARCHAR(120) NOT NULL DEFAULT '',
        color VARCHAR(20) NOT NULL DEFAULT '#8ED8CC',
        icon VARCHAR(10) NOT NULL DEFAULT '📚',
        target INTEGER NOT NULL DEFAULT 75,
        attended INTEGER NOT NULL DEFAULT 0,
        absent INTEGER NOT NULL DEFAULT 0,
        od INTEGER NOT NULL DEFAULT 0,
        off_count INTEGER NOT NULL DEFAULT 0,
        total INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
    `);

    // Attendance logs
    await client.query(`
      CREATE TABLE IF NOT EXISTS attendance_logs (
        id SERIAL PRIMARY KEY,
        subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        status VARCHAR(10) NOT NULL CHECK (status IN ('PRESENT','ABSENT','OD','OFF')),
        reason TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(subject_id, date)
      );
    `);

    // Timetable entries
    await client.query(`
      CREATE TABLE IF NOT EXISTS timetable_entries (
        id SERIAL PRIMARY KEY,
        subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        day VARCHAR(3) NOT NULL CHECK (day IN ('Mon','Tue','Wed','Thu','Fri','Sat','Sun')),
        time VARCHAR(20) NOT NULL DEFAULT '',
        room VARCHAR(30) NOT NULL DEFAULT '',
        faculty VARCHAR(120) NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query('COMMIT');
    console.log('✅ Migration complete — all tables ready.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
};

migrate();
