/**
 * Migration: Petrol Pump / Creditor features
 * Adds: creditor fields (due_date, vehicle_number), items.min_sale_rate,
 *       nozzles, attendants, nozzle_readings, sale_transactions attendant/nozzle
 * Run: node server/database/migration-petrol-pump.js
 */
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
    console.log('Running petrol pump migration...');
    connection = await mysql.createConnection(config);

    // 1. seller_parties: add due_date, vehicle_number (for creditor)
    const [spCols] = await connection.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'seller_parties' AND COLUMN_NAME IN ('due_date','vehicle_number')
    `, [config.database]);
    const spHave = (spCols || []).map(c => c.COLUMN_NAME);
    if (!spHave.includes('due_date')) {
      await connection.query('ALTER TABLE seller_parties ADD COLUMN due_date DATE DEFAULT NULL');
      console.log('   ✓ seller_parties.due_date');
    }
    if (!spHave.includes('vehicle_number')) {
      await connection.query('ALTER TABLE seller_parties ADD COLUMN vehicle_number VARCHAR(50) DEFAULT NULL');
      console.log('   ✓ seller_parties.vehicle_number');
    }
    const [spArchived] = await connection.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'seller_parties' AND COLUMN_NAME = 'is_archived'
    `, [config.database]);
    if (!spArchived || spArchived.length === 0) {
      await connection.query('ALTER TABLE seller_parties ADD COLUMN is_archived TINYINT(1) DEFAULT 0');
      console.log('   ✓ seller_parties.is_archived');
    }

    // 2. items: add min_sale_rate
    try {
      const [c] = await connection.query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'items' AND COLUMN_NAME = 'min_sale_rate'
      `, [config.database]);
      if (!c || c.length === 0) {
        await connection.query('ALTER TABLE items ADD COLUMN min_sale_rate DECIMAL(10,2) DEFAULT NULL');
        console.log('   ✓ items.min_sale_rate');
      }
    } catch (e) {
      console.warn('   ⚠ items.min_sale_rate:', e.message);
    }
    const [imgUrl] = await connection.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'items' AND COLUMN_NAME = 'image_url'
    `, [config.database]);
    if (!imgUrl || imgUrl.length === 0) {
      await connection.query('ALTER TABLE items ADD COLUMN image_url VARCHAR(512) DEFAULT NULL');
      console.log('   ✓ items.image_url');
    }

    // 3. nozzles table (is_archived for soft delete)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS nozzles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        display_order INT DEFAULT 0,
        is_archived TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('   ✓ nozzles');
    const [nzArchived] = await connection.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'nozzles' AND COLUMN_NAME = 'is_archived'
    `, [config.database]);
    if (!nzArchived || nzArchived.length === 0) {
      await connection.query('ALTER TABLE nozzles ADD COLUMN is_archived TINYINT(1) NOT NULL DEFAULT 0');
      console.log('   ✓ nozzles.is_archived');
    }

    // 4. attendants table (attendance_id, name, mobile_number)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS attendants (
        id INT AUTO_INCREMENT PRIMARY KEY,
        attendance_id VARCHAR(50) DEFAULT NULL,
        name VARCHAR(255) NOT NULL,
        mobile_number VARCHAR(20) DEFAULT NULL,
        is_archived TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_attendance_id (attendance_id),
        UNIQUE KEY uq_mobile_number (mobile_number)
      )
    `);
    console.log('   ✓ attendants');
    // Add attendance_id and mobile_number to existing attendants if missing
    const [acCols] = await connection.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'attendants' AND COLUMN_NAME IN ('attendance_id','mobile_number')
    `, [config.database]);
    const acHave = (acCols || []).map(c => c.COLUMN_NAME);
    if (!acHave.includes('attendance_id')) {
      await connection.query('ALTER TABLE attendants ADD COLUMN attendance_id VARCHAR(50) DEFAULT NULL AFTER id');
      try { await connection.query('ALTER TABLE attendants ADD UNIQUE KEY uq_attendance_id (attendance_id)'); } catch (e) { /* may exist */ }
      console.log('   ✓ attendants.attendance_id');
    }
    if (!acHave.includes('mobile_number')) {
      await connection.query('ALTER TABLE attendants ADD COLUMN mobile_number VARCHAR(20) DEFAULT NULL AFTER name');
      console.log('   ✓ attendants.mobile_number');
    }
    try {
      const [ukMobile] = await connection.query(`
        SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'attendants' AND CONSTRAINT_NAME = 'uq_mobile_number'
      `, [config.database]);
      if (!ukMobile || ukMobile.length === 0) {
        await connection.query('ALTER TABLE attendants ADD UNIQUE KEY uq_mobile_number (mobile_number)');
        console.log('   ✓ attendants unique mobile_number');
      }
    } catch (e) { /* ignore if exists */ }
    const [archivedCol] = await connection.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'attendants' AND COLUMN_NAME = 'is_archived'
    `, [config.database]);
    if (!archivedCol || archivedCol.length === 0) {
      await connection.query('ALTER TABLE attendants ADD COLUMN is_archived TINYINT(1) NOT NULL DEFAULT 0');
      console.log('   ✓ attendants.is_archived');
    }
    // Drop nozzle_id from attendants if it exists (existing DBs)
    try {
      const [fk] = await connection.query(`
        SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'attendants' AND COLUMN_NAME = 'nozzle_id' AND REFERENCED_TABLE_NAME IS NOT NULL
      `, [config.database]);
      if (fk && fk.length > 0) {
        await connection.query(`ALTER TABLE attendants DROP FOREIGN KEY ${fk[0].CONSTRAINT_NAME}`);
      }
    } catch (e) { /* ignore */ }
    try {
      const [ac] = await connection.query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'attendants' AND COLUMN_NAME = 'nozzle_id'
      `, [config.database]);
      if (ac && ac.length > 0) {
        await connection.query('ALTER TABLE attendants DROP COLUMN nozzle_id');
        console.log('   ✓ attendants: removed nozzle_id');
      }
    } catch (e) {
      if (e.code !== 'ER_CANT_DROP_FIELD_OR_KEY') console.warn('   attendants nozzle_id:', e.message);
    }

    // 5. nozzle_readings table (daily opening/closing with timestamps; parcel reading supported)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS nozzle_readings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        attendant_id INT NOT NULL,
        nozzle_id INT NOT NULL,
        reading_date DATE NOT NULL,
        opening_reading DECIMAL(12,2) NOT NULL DEFAULT 0,
        closing_reading DECIMAL(12,2) DEFAULT NULL,
        opening_at DATETIME NOT NULL,
        closing_at DATETIME DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (attendant_id) REFERENCES attendants(id),
        FOREIGN KEY (nozzle_id) REFERENCES nozzles(id),
        UNIQUE KEY uq_attendant_nozzle_date (attendant_id, nozzle_id, reading_date)
      )
    `);
    console.log('   ✓ nozzle_readings');
    // Add opening_at, closing_at to existing nozzle_readings if missing
    const [nrCols] = await connection.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'nozzle_readings' AND COLUMN_NAME IN ('opening_at','closing_at')
    `, [config.database]);
    const nrHave = (nrCols || []).map(c => c.COLUMN_NAME);
    if (!nrHave.includes('opening_at')) {
      await connection.query('ALTER TABLE nozzle_readings ADD COLUMN opening_at DATETIME DEFAULT NULL AFTER closing_reading');
      await connection.query('UPDATE nozzle_readings SET opening_at = COALESCE(created_at, NOW()) WHERE opening_at IS NULL');
      await connection.query('ALTER TABLE nozzle_readings MODIFY COLUMN opening_at DATETIME NOT NULL');
      console.log('   ✓ nozzle_readings.opening_at');
    }
    if (!nrHave.includes('closing_at')) {
      await connection.query('ALTER TABLE nozzle_readings ADD COLUMN closing_at DATETIME DEFAULT NULL AFTER opening_at');
      await connection.query('UPDATE nozzle_readings SET closing_at = created_at WHERE closing_reading IS NOT NULL AND closing_reading > 0 AND closing_at IS NULL');
      console.log('   ✓ nozzle_readings.closing_at');
    }
    try {
      await connection.query('ALTER TABLE nozzle_readings MODIFY COLUMN closing_reading DECIMAL(12,2) DEFAULT NULL');
      console.log('   ✓ nozzle_readings.closing_reading nullable');
    } catch (e) { /* ignore */ }

    // 6. sale_transactions: add attendant_id, nozzle_id (no FK to avoid constraint issues)
    const [stCols] = await connection.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'sale_transactions' AND COLUMN_NAME IN ('attendant_id','nozzle_id')
    `, [config.database]);
    const stHave = (stCols || []).map(c => c.COLUMN_NAME);
    if (!stHave.includes('attendant_id')) {
      await connection.query('ALTER TABLE sale_transactions ADD COLUMN attendant_id INT DEFAULT NULL');
      console.log('   ✓ sale_transactions.attendant_id');
    }
    if (!stHave.includes('nozzle_id')) {
      await connection.query('ALTER TABLE sale_transactions ADD COLUMN nozzle_id INT DEFAULT NULL');
      console.log('   ✓ sale_transactions.nozzle_id');
    }

    // 7. unified_transactions table (for transaction history API)
    try {
      const [utExists] = await connection.query(`
        SELECT COUNT(*) as n FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'unified_transactions'
      `, [config.database]);
      if (utExists[0].n === 0) {
        await connection.query(`
          CREATE TABLE unified_transactions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            party_type ENUM('seller','buyer') NOT NULL,
            party_id INT NOT NULL,
            transaction_type ENUM('sale','purchase','sale_payment','purchase_payment','payment','return') NOT NULL,
            transaction_date DATE NOT NULL,
            previous_balance DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            transaction_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            paid_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            balance_after DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            reference_id INT DEFAULT NULL,
            bill_number VARCHAR(50) DEFAULT NULL,
            payment_method VARCHAR(50) DEFAULT NULL,
            payment_status ENUM('fully_paid','partially_paid','unpaid') DEFAULT NULL,
            notes TEXT DEFAULT NULL,
            created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            created_by INT DEFAULT NULL,
            KEY idx_party (party_type, party_id),
            KEY idx_transaction_date (transaction_date),
            KEY idx_transaction_type (transaction_type),
            KEY idx_reference_id (reference_id),
            KEY idx_bill_number (bill_number),
            KEY idx_created_at (created_at)
          )
        `);
        console.log('   ✓ unified_transactions table created');
      }
    } catch (e) {
      console.warn('   ⚠ unified_transactions:', e.message);
    }

    // 8. Default items: Petrol and Diesel (insert if not present)
    try {
      const [petrol] = await connection.query("SELECT id FROM items WHERE product_code = 'PETROL-001'");
      if (!petrol || petrol.length === 0) {
        await connection.query(
          `INSERT INTO items (product_name, product_code, brand, hsn_number, tax_rate, sale_rate, purchase_rate, quantity, alert_quantity, rack_number, remarks, created_by)
           VALUES ('Petrol', 'PETROL-001', 'Fuel', '27100000', 0, 100.00, 100.00, 0, 0, NULL, 'Petrol - sale rate can be updated daily or while selling', 'superadmin')`
        );
        console.log('   ✓ Default item: Petrol');
      }
      const [diesel] = await connection.query("SELECT id FROM items WHERE product_code = 'DIESEL-001'");
      if (!diesel || diesel.length === 0) {
        await connection.query(
          `INSERT INTO items (product_name, product_code, brand, hsn_number, tax_rate, sale_rate, purchase_rate, quantity, alert_quantity, rack_number, remarks, created_by)
           VALUES ('Diesel', 'DIESEL-001', 'Fuel', '27100000', 0, 100.00, 100.00, 0, 0, NULL, 'Diesel - sale rate can be updated daily or while selling', 'superadmin')`
        );
        console.log('   ✓ Default item: Diesel');
      }
    } catch (e) {
      console.warn('   ⚠ Default items Petrol/Diesel:', e.message);
    }

    console.log('Migration completed.');
  } catch (error) {
    console.error('Migration error:', error);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

runMigration();
