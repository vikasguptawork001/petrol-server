const mysql = require('mysql2/promise');
require('dotenv').config();

const config = {
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
};

async function migrate() {
  let connection;
  try {
    console.log('Connecting to database...');
    connection = await mysql.createConnection(config);
    console.log('Running migration...');
    
    // Add unit to items
    await connection.query('ALTER TABLE items ADD COLUMN unit VARCHAR(50) DEFAULT NULL AFTER product_name');
    console.log('Added unit to items table');
    
    // Add unit to items_history
    await connection.query('ALTER TABLE items_history ADD COLUMN unit VARCHAR(50) DEFAULT NULL AFTER product_name');
    console.log('Added unit to items_history table');
    
    console.log('Migration completed successfully');
  } catch (error) {
    if (error.code === 'ER_DUP_COLUMN_NAME') {
      console.log('Column unit already exists, skipping...');
    } else {
      console.error('Migration failed:', error);
    }
  } finally {
    if (connection) await connection.end();
  }
}

migrate();
