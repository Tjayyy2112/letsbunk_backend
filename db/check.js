import pool from './index.js';

async function check() {
  const client = await pool.connect();
  try {
    const res = await client.query("SELECT constraint_name, table_name FROM information_schema.table_constraints WHERE table_name = 'attendance_logs'");
    console.log("CONSTRAINTS:");
    console.table(res.rows);

    const res2 = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'attendance_logs'");
    console.log("COLUMNS:");
    console.table(res2.rows);

  } catch (err) {
    console.error(err);
  } finally {
    client.release();
    pool.end();
  }
}

check();
