require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const https = require('https');

const authRoutes = require('./routes/auth');
const attendanceRoutes = require('./routes/attendance');
const adminRoutes = require('./routes/admin');
const employeeReportsRoutes = require('./routes/employeeReports');
const verificationRoutes = require('./routes/verification');
const notificationRoutes = require('./routes/notifications');
const settingsRoutes = require('./routes/settings');
const { startAutoCheckoutScheduler } = require('./scheduler/autoCheckout');
const { startShiftEndScheduler } = require('./scheduler/shiftEnd');
const { initFirebase } = require('./services/firebase');
const { initSocketIO } = require('./services/socketService');
const Employee = require('./models/Employee');

const app = express();
const PORT = process.env.PORT || 3000;

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('FATAL: MONGODB_URI environment variable is not set. Set it in Render dashboard (Environment Variables) or create a .env file.');
  process.exit(1);
}

app.use(helmet());
app.use(compression());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '10mb' }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { message: 'Too many requests, please try again later' },
});
app.use('/api', apiLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { message: 'Too many login attempts, please try again later' },
});
app.use('/api/login', authLimiter);

app.use('/api', authRoutes);
app.use('/api', attendanceRoutes);
app.use('/api', adminRoutes);
app.use('/api', employeeReportsRoutes);
app.use('/api', verificationRoutes);
app.use('/api', notificationRoutes);
app.use('/api', settingsRoutes);

app.get('/api/health', async (req, res) => {
  const dbState = mongoose.connection.readyState;
  res.json({
    status: dbState === 1 ? 'ok' : 'degraded',
    database: dbState === 1 ? 'connected' : 'disconnected',
  });
});

app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Request entity too large' });
  }
  console.error('Unhandled error:', err);
  const status = err.status || 500;
  res.status(status).json({
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

mongoose.connect(MONGODB_URI, {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 45000,
}).then(async () => {
  console.log('Connected to MongoDB');

  try {
    await mongoose.syncIndexes();
    console.log('Database indexes synced');
  } catch (err) {
    console.error('Index sync error:', err);
  }

  const adminExists = await Employee.findOne({ role: 'admin' });
  if (!adminExists) {
    const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(adminPassword, salt);

    await Employee.create({
      employeeNumber: 'ADMIN001',
      fullName: 'System Admin',
      password: hashedPassword,
      role: 'admin',
      isActive: true,
    });
    console.log(`Default admin created: ADMIN001 (password from DEFAULT_ADMIN_PASSWORD env var)`);
  }

  initFirebase();
  startAutoCheckoutScheduler();
  startShiftEndScheduler();

  server = app.listen(PORT, () => {
    initSocketIO(server);
    console.log(`Server running on port ${PORT}`);

    const keepAliveUrl = process.env.KEEPALIVE_URL;
    if (keepAliveUrl) {
      setInterval(() => {
        https.get(keepAliveUrl, (res) => {
          console.log('Keep alive ping:', res.statusCode);
        }).on('error', (e) => {
          console.log('Keep alive error:', e.message);
        });
      }, 14 * 60 * 1000);
    }
  });
})
.catch((err) => {
  console.error('MongoDB connection error:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

let server;
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

function gracefulShutdown(signal) {
  console.log(`Received ${signal}, shutting down gracefully...`);
  if (server) {
    server.close(() => {
      mongoose.connection.close(false).then(() => {
        console.log('MongoDB connection closed');
        process.exit(0);
      });
    });
  } else {
    process.exit(0);
  }
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000).unref();
}