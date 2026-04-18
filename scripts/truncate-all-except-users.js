/**
 * Truncate every base table in the configured MySQL database except `users`.
 * All application data is removed; login accounts in `users` are kept.
 *
 * Run from project root (with .env loaded):
 *   node server/scripts/truncate-all-except-users.js --yes
 *
 * Requires --yes (or -y) to avoid accidental runs.
 */
const mysql = require('mysql2/promise');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const config = require('../config/config');

/** Tables that must never be truncated by this script */
const SKIP_TABLES = new Set(['users']);

function assertSafeTableName(name) {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    throw new Error(`Refusing unsafe table name: ${name}`);
  }
}

async function main() {
  const confirmed =
    process.argv.includes('--yes') ||
    process.argv.includes('-y') ||
    process.env.TRUNCATE_CONFIRM === '1' ||
    process.env.TRUNCATE_CONFIRM === 'true';

  if (!confirmed) {
    console.error('Aborted: this will DELETE all data in every table except `users`.');
    console.error('Run again with: node server/scripts/truncate-all-except-users.js --yes');
    process.exit(1);
  }

  const db = config.database;
  const conn = await mysql.createConnection({
    host: db.host,
    port: db.port,
    user: db.user,
    password: db.password,
    database: db.database,
    ssl: db.ssl || undefined,
    multipleStatements: false
  });

  console.log(`Database: ${db.database} @ ${db.host}:${db.port}`);
  console.log('Skipping tables:', [...SKIP_TABLES].join(', '));

  try {
    const [rows] = await conn.execute(
      `
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = ?
        AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
      `,
      [db.database]
    );

    const toTruncate = rows
      .map((r) => r.TABLE_NAME)
      .filter((name) => !SKIP_TABLES.has(name));

    if (toTruncate.length === 0) {
      console.log('No tables to truncate (only skipped tables exist).');
      return;
    }

    await conn.query('SET FOREIGN_KEY_CHECKS = 0');

    for (const table of toTruncate) {
      assertSafeTableName(table);
      await conn.query(`TRUNCATE TABLE \`${table}\``);
      console.log(`  Truncated: ${table}`);
    }

    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log(`Done. Truncated ${toTruncate.length} table(s). \`users\` was not modified.`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
