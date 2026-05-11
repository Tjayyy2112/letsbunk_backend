import pool from './index.js';
import bcrypt from 'bcryptjs';

async function migrateAuth() {
  console.log('Starting migration for multi-user authentication...');
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // 1. Create users table
    console.log('Creating users table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255) DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // 2. Create a default legacy user
    // We will assign all existing orphaned data to this legacy user
    console.log('Ensuring default legacy user exists...');
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash('legacy123', salt);
    
    // Insert if not exists, and get the ID
    const userRes = await client.query(`
      INSERT INTO users (email, password_hash, name)
      VALUES ('legacy@letsbunk.app', $1, 'Legacy User')
      ON CONFLICT (email) DO UPDATE SET email=EXCLUDED.email
      RETURNING id;
    `, [hash]);
    const legacyUserId = userRes.rows[0].id;
    console.log(`Legacy user ID is ${legacyUserId}.`);

    // 3. Add user_id to existing tables
    const tables = ['settings', 'subjects', 'attendance_logs', 'timetable_entries'];
    for (const table of tables) {
      console.log(`Adding user_id to ${table}...`);
      await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`);
      
      // Assign orphaned rows to legacy user
      await client.query(`UPDATE ${table} SET user_id = $1 WHERE user_id IS NULL`, [legacyUserId]);
      
      // Make it NOT NULL
      await client.query(`ALTER TABLE ${table} ALTER COLUMN user_id SET NOT NULL`);
    }

    // 4. Update unique constraints
    // subjects: no unique constraints, but users can have identical subject names.
    
    // attendance_logs: current constraint is (date, period_index). We must drop it and add (user_id, date, period_index)
    console.log('Updating unique constraints for attendance_logs...');
    await client.query(`ALTER TABLE attendance_logs DROP CONSTRAINT IF EXISTS unique_date_period`);
    await client.query(`ALTER TABLE attendance_logs DROP CONSTRAINT IF EXISTS attendance_logs_subject_id_date_key`); // the very old one
    await client.query(`
      ALTER TABLE attendance_logs 
      ADD CONSTRAINT unique_user_date_period UNIQUE (user_id, date, period_index)
    `);

    // settings: current table has no unique constraint but is expected to be 1 row globally. Now 1 row per user.
    console.log('Updating unique constraints for settings...');
    // Clean up duplicate settings if any (keep the first one per user)
    await client.query(`
      DELETE FROM settings a USING settings b 
      WHERE a.id > b.id AND a.user_id = b.user_id
    `);
    await client.query(`ALTER TABLE settings DROP CONSTRAINT IF EXISTS unique_user_settings`);
    await client.query(`ALTER TABLE settings ADD CONSTRAINT unique_user_settings UNIQUE (user_id)`);

    await client.query('COMMIT');
    console.log('✅ Auth migration successful!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Auth migration failed:', err);
  } finally {
    client.release();
    pool.end();
  }
}

migrateAuth();
