const mysql = require('mysql2/promise');
require('dotenv').config();

async function fixConstraints() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'inventory_management',
    port: parseInt(process.env.DB_PORT) || 3306,
  });

  try {
    console.log('Fixing purchase_transactions constraints...');
    
    // First, check if columns exist and their current state if needed, 
    // but ALTER TABLE MODIFY should be safe if the columns exist.
    await connection.execute('ALTER TABLE purchase_transactions MODIFY buyer_party_id INT NULL');
    console.log('✓ buyer_party_id modified to NULL');

    // Also modify item_id to be NULL since it's used as a header in the new structure
    await connection.execute('ALTER TABLE purchase_transactions MODIFY item_id INT NULL');
    console.log('✓ item_id modified to NULL');

    console.log('Success!');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await connection.end();
  }
}

fixConstraints();
