// const mysql = require('mysql2/promise');
// const config = require('./config');

// const poolConfig = {
//   host: config.database.host,
//   port: config.database.port,
//   user: config.database.user,
//   password: config.database.password,
//   database: config.database.database,
//   waitForConnections: true,
//   connectionLimit: config.database.connectionLimit,
//   queueLimit: config.database.queueLimit
// };

// // Add SSL configuration if enabled
// if (config.database.ssl) {
//   poolConfig.ssl = config.database.ssl;
// }

// const pool = mysql.createPool(poolConfig);

// // Test connection on startup
// pool.getConnection()
//   .then(connection => {
//     console.log('✅ Database connected successfully');
//     connection.release();
//   })
//   .catch(error => {
//     console.error('❌ Database connection error:', error.message);
//   });

// module.exports = pool;


const mysql = require('mysql2/promise');
const util = require('util');
const config = require('./config');
const dns = require('dns');

// Pool config: only use options valid for Connection (MySQL2 passes these to each new connection).
// Do NOT use acquireTimeout or timeout here - they are invalid for Connection and trigger warnings.
const poolConfig = {
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.database,
  waitForConnections: true,
  connectionLimit: config.database.connectionLimit,
  queueLimit: config.database.queueLimit,
  // Automatically return date/time types as strict strings instead of Date objects to preserve actual local time logic
  dateStrings: true,
  // IST: session and driver interpret DATETIME/TIMESTAMP in India Standard Time
  timezone: '+05:30',
  // Connection establishment timeout only (valid for Connection)
  connectTimeout: 100000, // 100 seconds
};

// Safe connection info logging (no secrets)
const sslEnabled = Boolean(config.database.ssl);
console.log(
  `[DB] target=${poolConfig.host}:${poolConfig.port}/${poolConfig.database} user=${poolConfig.user} ssl=${sslEnabled} connectTimeoutMs=${poolConfig.connectTimeout}`
);

// Optional DNS diagnostics (helps when host resolves to unexpected IP/IPv6)
// Enable by setting DEBUG_DB=1
if (process.env.DEBUG_DB === '1' || process.env.DEBUG_DB === 'true') {
  (async () => {
    try {
      const lookups = await Promise.allSettled([
        dns.promises.lookup(poolConfig.host, { family: 4 }),
        dns.promises.lookup(poolConfig.host, { family: 6 }),
      ]);
      const fmt = (r) =>
        r.status === 'fulfilled' ? `${r.value.address} (IPv${r.value.family})` : `err(${r.reason?.code || r.reason?.message})`;
      console.log(`[DB] dns lookup: v4=${fmt(lookups[0])} v6=${fmt(lookups[1])}`);
    } catch (e) {
      console.log('[DB] dns lookup failed:', e?.code || e?.message || e);
    }
  })();
}

// Add SSL configuration if enabled
if (config.database.ssl) {
  poolConfig.ssl = config.database.ssl;
}

// Create the pool
const pool = mysql.createPool(poolConfig);

// Every pooled connection must use IST (pool.execute/query does not use getConnection wrapper below)
pool.on('connection', (connection) => {
  connection.query("SET time_zone = '+05:30'", (err) => {
    if (err) console.error('[DB] SET time_zone on connection:', err.message);
  });
});

// Wrapper so explicit getConnection() also has IST (redundant with handler above, keeps same behavior)
const originalGetConnection = pool.getConnection.bind(pool);
pool.getConnection = async function() {
  const connection = await originalGetConnection();
  await connection.execute("SET time_zone = '+05:30'");
  return connection;
};

// Test connection on startup and verify timezone is set
pool.getConnection()
  .then(async (connection) => {
    try {
      // Verify timezone is set correctly
      const [rows] = await connection.execute("SELECT @@session.time_zone as timezone, @@global.time_zone as server_timezone");
      console.log('✅ Database connected successfully');
      console.log(`✅ Session timezone set to: ${rows[0].timezone} (expected +05:30 for IST)`);
      console.log(`ℹ️  Server timezone: ${rows[0].server_timezone}`);
      if (rows[0].timezone !== '+05:30') {
        console.warn('⚠️  WARNING: Session timezone is not IST (+05:30). Check MySQL time_zone tables.');
      }
    } catch (err) {
      console.error('Error verifying timezone:', err);
    } finally {
      connection.release();
    }
  })
  .catch(error => {
    // Unwrap AggregateError (e.g. Node trying IPv4 + IPv6, multiple failures)
    const first = Array.isArray(error?.errors) && error.errors.length > 0 ? error.errors[0] : error;
    const msg = first?.message ?? error?.message ?? '(no message)';
    const code = first?.code ?? error?.code ?? '(none)';

    console.error('❌ Database connection error (detailed):');
    console.error('  message:', msg);
    console.error('  code:', code);
    console.error('  errno:', first?.errno ?? error?.errno ?? '(none)');
    if (first?.address != null) console.error('  address:port:', `${first.address}:${first.port}`);
    console.error('  sqlState:', error?.sqlState ?? '(none)');
    console.error('  sqlMessage:', error?.sqlMessage ?? '(none)');
    if (Array.isArray(error?.errors) && error.errors.length > 1) {
      error.errors.forEach((e, i) => console.error(`  error[${i}]:`, e?.message ?? e?.code, e?.address ? ` ${e.address}:${e.port}` : ''));
    }
    if (error?.cause) console.error('  cause:', error.cause);

    if (code === 'ETIMEDOUT' || code === 'ENETUNREACH') {
      console.error('  → Network unreachable or timeout: DB host may not be reachable from this server (firewall, allowlist, or use a DB in the same cloud/region).');
    }
    if (code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('  → MySQL rejected login: allow THIS server\'s IP in your DB panel (Remote MySQL / Allowed hosts). The IP is shown in the message above (e.g. \'user\'@\'74.220.49.253\').');
    }
  });

module.exports = pool;