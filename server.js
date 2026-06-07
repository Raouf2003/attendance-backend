require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const compression = require('compression');
const bcrypt = require('bcryptjs');
const https = require('https');

const authRoutes = require('./routes/auth');
const attendanceRoutes = require('./routes/attendance');
const adminRoutes = require('./routes/admin');
const employeeReportsRoutes = require('./routes/employeeReports');
const { startAutoCheckoutScheduler } = require('./scheduler/autoCheckout');
const Employee = require('./models/Employee');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/api', authRoutes);
app.use('/api', attendanceRoutes);
app.use('/api', adminRoutes);
app.use('/api', employeeReportsRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  const status = err.status || 500;
  res.status(status).json({
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://raoufdb:raouf2003@raoufdb.k9zb2or.mongodb.net/attendance?appName=RaoufDB', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(async () => {
    console.log('Connected to MongoDB');

    // Sync database indexes
    try {
      await mongoose.syncIndexes();
      console.log('Database indexes synced');
    } catch (err) {
      console.error('Index sync error:', err);
    }

    const adminExists = await Employee.findOne({ role: 'admin' });
    if (!adminExists) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('admin123', salt);

      await Employee.create({
        employeeNumber: 'ADMIN001',
        fullName: 'System Admin',
        password: hashedPassword,
        role: 'admin',
        isActive: true,
      });
      console.log('Default admin created: ADMIN001 / admin123');
    }

    startAutoCheckoutScheduler();

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);

      // Keep alive - ping every 14 minutes
      setInterval(() => {
        https.get('https://attendance-backend-nds0.onrender.com/api/health', (res) => {
          console.log('Keep alive ping:', res.statusCode);
        }).on('error', (e) => {
          console.log('Keep alive error:', e.message);
        });
      }, 14 * 60 * 1000);
    });
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });