const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  let connection;
  
  try {
    // Read database config
    const config = require('../config/config');
    const dbConfig = config.database;
    
    // Create connection
    connection = await mysql.createConnection({
      host: dbConfig.host || 'localhost',
      port: dbConfig.port || 3306,
      user: dbConfig.user || 'root',
      password: dbConfig.password || '',
      database: dbConfig.database || 'inventory_management',
      multipleStatements: true
    });

    console.log('Connected to database. Running migration...');

    // Read migration SQL file
    const migrationPath = path.join(__dirname, 'add_previous_balance_paid.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    // Execute migration
    await connection.query(migrationSQL);
    
    console.log('Migration completed successfully!');
    
    // Verify columns exist
    const [columns] = await connection.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? 
      AND TABLE_NAME = 'sale_transactions' 
      AND COLUMN_NAME IN ('previous_balance_paid', 'discount_type', 'discount_percentage')
    `, [dbConfig.database]);

    console.log('\nVerified columns:');
    columns.forEach(col => {
      console.log(`  ✓ ${col.COLUMN_NAME}`);
    });

  } catch (error) {
    console.error('Migration error:', error.message);
    if (error.code === 'ER_DUP_FIELDNAME') {
      console.log('Note: Some columns may already exist. This is okay.');
    } else {
      process.exit(1);
    }
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

runMigration();

