import pool from './index.js';

async function check() {
  const client = await pool.connect();
  try {
    const res = await client.query("SELECT * FROM information_schema.key_column_usage WHERE constraint_name = 'unique_user_date_period'");
    console.table(res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    client.release();
    pool.end();
  }
}

check();
