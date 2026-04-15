const express = require('express');
const cors = require('cors');
const { getLocalDateString, getLocalISOString } = require('./utils/dateUtils');

// Load and validate environment variables
require('dotenv').config();
require('./config/validateEnv');
const config =require('./config/config');

const authRoutes = require('./routes/auth');
const itemRoutes = require('./routes/items');
const partyRoutes = require('./routes/parties');
const transactionRoutes = require('./routes/transactions');
const unifiedTransactionRoutes = require('./routes/unified_transactions');
const reportRoutes = require('./routes/reports');
const orderRoutes = require('./routes/orders');
const billRoutes = require('./routes/bills');
const nozzleRoutes = require('./routes/nozzles');
const attendantRoutes = require('./routes/attendants');
const nozzleReadingsRoutes = require('./routes/nozzleReadings');
const expensesRoutes = require('./routes/expenses');
const { runIsArchivedMigration, ensureExpensesTable } = require('./utils/runMigration');

const app = express();

// Run is_archived migration on startup (non-blocking)
(async () => {
  try {
    console.log('Checking for is_archived column migration...');
    // Add a small delay to allow database pool to initialize
    await new Promise(resolve => setTimeout(resolve, 1000));
    const result = await runIsArchivedMigration();
    if (result.success) {
      console.log(`✓ ${result.message}`);
    } else {
      console.warn(`⚠ Migration warning: ${result.error}`);
      console.warn('⚠ Server will continue, but migration should be run manually if needed');
    }
    const exp = await ensureExpensesTable();
    if (exp.success) {
      console.log(`✓ ${exp.message}`);
    } else {
      console.warn(`⚠ Expenses table: ${exp.error}`);
    }
  } catch (error) {
    console.error('Migration check error:', error.message);
    console.warn('⚠ Server will continue, but migration should be run manually if needed');
    // Don't block server startup if migration fails
  }
})();

// Middleware
app.use(cors(config.cors));
app.use(express.json({ limit: config.upload.maxFileSize }));
app.use(express.urlencoded({ extended: true, limit: config.upload.maxFileSize }));

// Request logging middleware
if (config.logging.enableRequestLogging) {
  app.use((req, res, next) => {
    console.log(`${getLocalISOString()} - ${req.method} ${req.path}`);
    next();
  });
}

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/parties', partyRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/unified-transactions', unifiedTransactionRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/bills', billRoutes);
app.use('/api/nozzles', nozzleRoutes);
app.use('/api/attendants', attendantRoutes);
app.use('/api/nozzle-readings', nozzleReadingsRoutes);
app.use('/api/expenses', expensesRoutes);

// Health check (includes MySQL session TZ — must be +05:30 for IST business rules)
app.get('/api/health', async (req, res) => {
  try {
    const pool = require('./config/database');
    await pool.execute('SELECT 1');
    const [tzRows] = await pool.execute(
      "SELECT @@session.time_zone AS session_tz, @@global.time_zone AS global_tz, NOW() AS db_now"
    );
    const tz = tzRows[0] || {};
    res.json({
      status: 'OK',
      message: 'Server is running',
      database: 'connected',
      timestamp: getLocalISOString(),
      timezone: {
        app_business_calendar: 'Asia/Kolkata (IST)',
        mysql_session_time_zone: tz.session_tz,
        mysql_global_time_zone: tz.global_tz,
        mysql_now: tz.db_now,
        note: 'Pool sets session time_zone to +05:30; API timestamps use dateUtils (IST).',
      },
    });
  } catch (error) {
    res.status(503).json({
      status: 'ERROR',
      message: 'Server is running but database connection failed',
      database: 'disconnected',
      timestamp: getLocalISOString(),
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(config.nodeEnv === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.listen(config.port, () => {
  console.log(`Server running on port ${config.port} in ${config.nodeEnv} mode`);
});

