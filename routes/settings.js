import express from 'express';
import Settings from '../db/models/Settings.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const settings = await Settings.findOne({ user_id: req.user_id });
    res.json(settings || { target_attendance: 75, notifications: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/', async (req, res) => {
  const { target_attendance, notifications } = req.body;
  try {
    const settings = await Settings.findOneAndUpdate(
      { user_id: req.user_id },
      { target_attendance, notifications, updated_at: new Date() },
      { new: true, upsert: true }
    );
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
