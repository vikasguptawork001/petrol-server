const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function fixPassword() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'inventory_management',
    });

    console.log('Connecting to database...');
    
    // Generate new hash for admin123
    const newHash = await bcrypt.hash('admin123', 10);
    console.log('Generated new hash:', newHash);
    
    // Update the password in database
    await connection.execute(
      'UPDATE users SET password = ? WHERE user_id = ?',
      [newHash, 'superadmin']
    );
    
    console.log('✓ Password updated successfully!');
    console.log('You can now login with:');
    console.log('  User ID: superadmin');
    console.log('  Password: admin123');
    
  } catch (error) {
    console.error('✗ Error:', error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

fixPassword();













