#!/usr/bin/env node
/**
 * Export users table: structure + data to a SQL file.
 * Uses .env in server folder. Output: server/database/exported-users-YYYY-MM-DD.sql
 * Run: node server/scripts/export-users.js   or  npm run export-users (from server folder)
 */

const path = require('path');
const fs = require('fs');
const { getLocalDateString, getLocalISOString } = require('../utils/dateUtils');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const config = {
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
};

function escapeSql(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return String(val);
  return "'" + String(val).replace(/'/g, "''").replace(/\\/g, '\\\\') + "'";
}

async function exportUsers() {
  let connection;
  try {
    connection = await mysql.createConnection(config);
    const dbName = config.database;

    console.log(`Connecting to database: ${dbName} @ ${config.host}`);

    const [createRows] = await connection.query('SHOW CREATE TABLE `users`');
    const createSql = createRows[0]['Create Table'];

    const [rows] = await connection.query('SELECT * FROM `users`');

    const lines = [
      '-- Exported users table (structure + data)',
      `-- Database: ${dbName}`,
      `-- Date (IST): ${getLocalISOString()}`,
      '',
      `USE \`${dbName}\`;`,
      '',
      'DROP TABLE IF EXISTS `users`;',
      createSql + ';',
      ''
    ];

    if (rows.length > 0) {
      const columns = Object.keys(rows[0]);
      const colList = columns.map(c => '`' + c + '`').join(', ');
      for (const row of rows) {
        const values = columns.map(c => escapeSql(row[c])).join(', ');
        lines.push(`INSERT INTO \`users\` (${colList}) VALUES (${values});`);
      }
      lines.push('');
      console.log(`  Exported ${rows.length} user(s).`);
    } else {
      console.log('  No users in table.');
    }

    const outDir = path.join(__dirname, '..', 'database');
    const dateStr = getLocalDateString();
    const outPath = path.join(outDir, `exported-users-${dateStr}.sql`);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, lines.join('\n'), 'utf8');

    console.log(`\nDone. Written to: ${outPath}`);
  } catch (err) {
    console.error('Export failed:', err.message);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

exportUsers();
