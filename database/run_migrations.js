const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function runAllMigrations() {
  let connection;
  
  try {
    // Read database config
    const config = require('../config/config');
    const dbConfig = config.database;
    
    console.log('Connecting to database...');
    console.log(`Host: ${dbConfig.host}`);
    console.log(`Database: ${dbConfig.database}`);
    
    // Create connection
    connection = await mysql.createConnection({
      host: dbConfig.host || 'localhost',
      port: dbConfig.port || 3306,
      user: dbConfig.user || 'root',
      password: dbConfig.password || '',
      database: dbConfig.database || 'inventory_management',
      multipleStatements: true
    });

    console.log('✅ Connected to database. Running all migrations...\n');

    // Read migration SQL file
    const migrationPath = path.join(__dirname, 'run_all_migrations.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    // Execute migration
    const [results] = await connection.query(migrationSQL);
    
    console.log('✅ All migrations completed successfully!\n');
    
    // Verify critical columns exist
    console.log('Verifying critical columns...');
    const [columns] = await connection.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? 
      AND TABLE_NAME = 'sale_transactions' 
      AND COLUMN_NAME IN ('previous_balance_paid', 'discount_type', 'discount_percentage', 'with_gst', 'subtotal', 'tax_amount')
      ORDER BY COLUMN_NAME
    `, [dbConfig.database]);

    console.log('\n✅ Verified sale_transactions columns:');
    columns.forEach(col => {
      console.log(`   ✓ ${col.COLUMN_NAME}`);
    });

    // Verify sale_items columns
    const [saleItemsColumns] = await connection.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? 
      AND TABLE_NAME = 'sale_items' 
      AND COLUMN_NAME IN ('discount', 'discount_type', 'discount_percentage')
      ORDER BY COLUMN_NAME
    `, [dbConfig.database]);

    console.log('\n✅ Verified sale_items columns:');
    saleItemsColumns.forEach(col => {
      console.log(`   ✓ ${col.COLUMN_NAME}`);
    });

    console.log('\n🎉 All migrations completed successfully!');
    console.log('You can now use all features including previous balance payment.');

  } catch (error) {
    console.error('\n❌ Migration error:', error.message);
    if (error.code === 'ER_DUP_FIELDNAME') {
      console.log('Note: Some columns may already exist. This is okay.');
    } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.log('\n⚠️  Database access denied. Please check your database credentials in .env file.');
      console.log('You can also run the SQL file directly:');
      console.log('   mysql -u root -p inventory_management < server/database/run_all_migrations.sql');
    } else {
      console.error('\nFull error:', error);
      process.exit(1);
    }
  } finally {
    if (connection) {
      await connection.end();
      console.log('\nDatabase connection closed.');
    }
  }
}

// Run migrations
runAllMigrations();



