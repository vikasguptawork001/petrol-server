#!/usr/bin/env node
/**
 * Export all table structures (CREATE TABLE) from the current database.
 * Uses .env in server folder. Output: server/database/exported-schema-YYYY-MM-DD.sql
 * Run from project root: node server/scripts/export-schema.js
 * Or from server folder: node scripts/export-schema.js
 */

const path = require('path');
const fs = require('fs');
const { getLocalDateString, getLocalISOString } = require('../utils/dateUtils');

// Load .env from server directory
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

async function exportSchema() {
  let connection;
  try {
    connection = await mysql.createConnection(config);
    const dbName = config.database;

    console.log(`Connecting to database: ${dbName} @ ${config.host}`);
    await connection.query(`USE \`${dbName}\``);

    const [tables] = await connection.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' 
       ORDER BY TABLE_NAME`,
      [dbName]
    );

    if (tables.length === 0) {
      console.log('No tables found.');
      process.exit(0);
      return;
    }

    const lines = [
      '-- Exported table structure',
      `-- Database: ${dbName}`,
      `-- Date (IST): ${getLocalISOString()}`,
      '-- Run this on the new database (after creating it) to recreate table structures.',
      '',
      `USE \`${dbName}\`;`,
      ''
    ];

    for (const row of tables) {
      const tableName = row.TABLE_NAME;
      const [createRows] = await connection.query(`SHOW CREATE TABLE \`${tableName}\``);
      const createSql = createRows[0]['Create Table'];
      lines.push(`-- Table: ${tableName}`);
      lines.push(`DROP TABLE IF EXISTS \`${tableName}\`;`);
      lines.push(createSql + ';');
      lines.push('');
      console.log(`  Exported: ${tableName}`);
    }

    const outDir = path.join(__dirname, '..', 'database');
    const dateStr = getLocalDateString();
    const outPath = path.join(outDir, `exported-schema-${dateStr}.sql`);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, lines.join('\n'), 'utf8');

    console.log(`\nDone. Schema written to: ${outPath}`);
  } catch (err) {
    console.error('Export failed:', err.message);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

exportSchema();
