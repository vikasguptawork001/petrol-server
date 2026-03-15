const mysql = require('mysql2/promise');
require('dotenv').config();

const config = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'inventory_management',
  multipleStatements: true
};

async function runMigration() {
  let connection;
  try {
    console.log('Connecting to database...');
    connection = await mysql.createConnection(config);
    console.log('Connected successfully!');

    console.log('Running return migration...');
    
    // Add buyer_party_id and party_type
    try {
      await connection.execute(`
        ALTER TABLE return_transactions 
        ADD COLUMN buyer_party_id INT DEFAULT NULL
      `);
      console.log('  ✓ Added buyer_party_id column');
    } catch (error) {
      if (error.code === 'ER_DUP_FIELDNAME') {
        console.log('  ⚠ buyer_party_id column already exists');
      } else {
        throw error;
      }
    }

    try {
      await connection.execute(`
        ALTER TABLE return_transactions 
        ADD COLUMN party_type ENUM('seller', 'buyer') DEFAULT 'seller'
      `);
      console.log('  ✓ Added party_type column');
    } catch (error) {
      if (error.code === 'ER_DUP_FIELDNAME') {
        console.log('  ⚠ party_type column already exists');
      } else {
        throw error;
      }
    }

    // Make seller_party_id nullable
    try {
      await connection.execute(`
        ALTER TABLE return_transactions 
        MODIFY COLUMN seller_party_id INT NULL
      `);
      console.log('  ✓ Made seller_party_id nullable');
    } catch (error) {
      console.log('  ⚠ Could not modify seller_party_id:', error.message);
    }

    // Add foreign key for buyer_party_id
    try {
      await connection.execute(`
        ALTER TABLE return_transactions 
        ADD FOREIGN KEY (buyer_party_id) REFERENCES buyer_parties(id)
      `);
      console.log('  ✓ Added foreign key for buyer_party_id');
    } catch (error) {
      if (error.code === 'ER_DUP_KEY' || error.code === 'ER_DUP_FIELDNAME') {
        console.log('  ⚠ Foreign key for buyer_party_id may already exist');
      } else {
        console.log('  ⚠ Could not add foreign key:', error.message);
      }
    }

    // Update existing records
    try {
      await connection.execute(`
        UPDATE return_transactions SET party_type = 'seller' WHERE party_type IS NULL
      `);
      console.log('  ✓ Updated existing records');
    } catch (error) {
      console.log('  ⚠ Could not update existing records:', error.message);
    }

    console.log('\n✅ Migration completed successfully!');

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\nDatabase connection closed');
    }
  }
}

runMigration();







