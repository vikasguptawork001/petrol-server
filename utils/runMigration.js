const pool = require('../config/database');
const fs = require('fs');
const path = require('path');

/**
 * Run the is_archived migration
 * This can be called on server startup or manually
 */
async function runIsArchivedMigration() {
  try {
    // Check if column already exists
    const [columns] = await pool.execute(`
      SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'items' 
      AND COLUMN_NAME = 'is_archived'
    `);
    
    if (columns[0].count > 0) {
      console.log('✓ is_archived column already exists');
      return { success: true, message: 'Column already exists' };
    }
    
    // Add the column
    await pool.execute(`
      ALTER TABLE items ADD COLUMN is_archived BOOLEAN DEFAULT FALSE
    `);
    console.log('✓ Added is_archived column to items table');
    
    // Check if index exists
    const [indexes] = await pool.execute(`
      SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.STATISTICS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'items' 
      AND INDEX_NAME = 'idx_is_archived'
    `);
    
    if (indexes[0].count === 0) {
      // Create index
      await pool.execute(`
        CREATE INDEX idx_is_archived ON items(is_archived)
      `);
      console.log('✓ Created index idx_is_archived on items table');
    }
    
    return { success: true, message: 'Migration completed successfully' };
  } catch (error) {
    console.error('Migration error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Create expenses table if missing (day-to-day outflows: purpose, paid_to, reason).
 */
async function ensureExpensesTable() {
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS expenses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        expense_date DATE NOT NULL,
        amount DECIMAL(12,2) NOT NULL,
        purpose VARCHAR(255) NOT NULL,
        paid_to VARCHAR(255) NULL,
        reason TEXT NULL,
        notes TEXT NULL,
        created_by_user_id INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_expense_date (expense_date),
        INDEX idx_created_by (created_by_user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    return { success: true, message: 'Expenses table ready' };
  } catch (error) {
    console.error('ensureExpensesTable error:', error);
    return { success: false, error: error.message };
  }
}

module.exports = { runIsArchivedMigration, ensureExpensesTable };






