import express from 'express';
import pool from '../db/index.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM settings ORDER BY id LIMIT 1');
    res.json(rows[0] || { target_attendance: 75, notifications: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/', async (req, res) => {
  const { target_attendance, notifications } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE settings SET target_attendance=$1, notifications=$2, updated_at=NOW()
       WHERE id=(SELECT id FROM settings LIMIT 1)
       RETURNING *`,
      [target_attendance, notifications]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
