import pool from './index.js';

async function checkData() {
  const client = await pool.connect();
  try {
    const res = await client.query("SELECT * FROM attendance_logs ORDER BY created_at DESC LIMIT 5");
    console.log("Recent logs:");
    console.table(res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    client.release();
    pool.end();
  }
}

checkData();
