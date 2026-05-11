import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pool from './db/index.js';
import { authMiddleware } from './middleware/auth.js';
import authRouter          from './routes/auth.js';
import subjectsRouter      from './routes/subjects.js';
import attendanceRouter    from './routes/attendance.js';
import timetableRouter     from './routes/timetable.js';
import settingsRouter      from './routes/settings.js';

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: '*' }));
app.use(express.json());

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok', timestamp: new Date() }));

// DB Connection Test
app.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ message: 'Database connected!', time: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Database connection failed', details: err.message });
  }
});

// Auth Routes (unprotected)
app.use('/api/auth', authRouter);

// Protected API Routes
app.use('/api/subjects',   authMiddleware, subjectsRouter);
app.use('/api/attendance', authMiddleware, attendanceRouter);
app.use('/api/timetable',  authMiddleware, timetableRouter);
app.use('/api/settings',   authMiddleware, settingsRouter);

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`🚀 Let'sBunk API running on http://localhost:${PORT}`);
});
