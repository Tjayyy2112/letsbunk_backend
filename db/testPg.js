import pool from './index.js';

async function testPg() {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT 1 WHERE $1 = $1', [1, 2]);
    console.log(res.rows);
  } catch (err) {
    console.error('ERROR:', err.message);
  } finally {
    client.release();
    pool.end();
  }
}
testPg();
