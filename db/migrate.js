import './index.js';
import User from './models/User.js';
import Settings from './models/Settings.js';
import Subject from './models/Subject.js';
import AttendanceLog from './models/AttendanceLog.js';
import TimetableEntry from './models/TimetableEntry.js';
import mongoose from 'mongoose';

async function migrate() {
  try {
    console.log('Syncing indexes...');
    await User.syncIndexes();
    await Settings.syncIndexes();
    await Subject.syncIndexes();
    await AttendanceLog.syncIndexes();
    await TimetableEntry.syncIndexes();
    console.log('✅ Indexes synced — MongoDB is ready.');
  } catch (err) {
    console.error('❌ Migration failed:', err);
  } finally {
    await mongoose.connection.close();
  }
}

migrate();
