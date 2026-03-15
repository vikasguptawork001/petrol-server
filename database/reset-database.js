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

async function resetDatabase() {
  let connection;
  try {
    console.log('🔄 Starting database reset...');
    console.log(`📊 Database: ${config.database}`);
    console.log(`🔗 Host: ${config.host}:${config.port}`);
    
    // Connect without database first to create it if needed
    const adminConnection = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      multipleStatements: true
    });

    // Create database if it doesn't exist
    await adminConnection.query(`CREATE DATABASE IF NOT EXISTS \`${config.database}\``);
    await adminConnection.query(`USE \`${config.database}\``);
    console.log('✅ Database created/selected');

    // Disable foreign key checks
    await adminConnection.query('SET FOREIGN_KEY_CHECKS = 0');
    console.log('🔓 Foreign key checks disabled');

    // Get all tables
    const [tables] = await adminConnection.query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = '${config.database}'
    `);

    // Drop all tables
    console.log('🗑️  Dropping all tables...');
    for (const table of tables) {
      const tableName = table.TABLE_NAME;
      try {
        await adminConnection.query(`DROP TABLE IF EXISTS \`${tableName}\``);
        console.log(`   ✓ Dropped ${tableName}`);
      } catch (error) {
        console.log(`   ⚠ Error dropping ${tableName}: ${error.message}`);
      }
    }

    // Re-enable foreign key checks
    await adminConnection.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('🔒 Foreign key checks re-enabled');

    // Create all tables with complete schema
    console.log('📋 Creating tables with complete schema...');

    // Users Table
    await adminConnection.query(`
      CREATE TABLE users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role ENUM('super_admin', 'admin', 'sales') NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    console.log('   ✓ Created users table');

    // Items Table (with min_sale_rate for petrol pump)
    await adminConnection.query(`
      CREATE TABLE items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        product_name VARCHAR(255) NOT NULL,
        product_code VARCHAR(100) UNIQUE,
        brand VARCHAR(100),
        hsn_number VARCHAR(50),
        tax_rate DECIMAL(5,2) DEFAULT 0,
        sale_rate DECIMAL(10,2) NOT NULL,
        min_sale_rate DECIMAL(10,2) DEFAULT NULL,
        purchase_rate DECIMAL(10,2) NOT NULL,
        quantity INT DEFAULT 0,
        alert_quantity INT DEFAULT 0,
        rack_number VARCHAR(50),
        remarks VARCHAR(200) DEFAULT NULL,
        image LONGBLOB DEFAULT NULL,
        image_url VARCHAR(512) DEFAULT NULL,
        created_by VARCHAR(50) DEFAULT NULL,
        updated_by VARCHAR(50) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    console.log('   ✓ Created items table');

    // Items History Table
    await adminConnection.query(`
      CREATE TABLE items_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        item_id INT NOT NULL,
        product_name VARCHAR(255) NOT NULL,
        product_code VARCHAR(100),
        brand VARCHAR(100),
        hsn_number VARCHAR(50),
        tax_rate DECIMAL(5,2) DEFAULT 0,
        sale_rate DECIMAL(10,2) NOT NULL,
        purchase_rate DECIMAL(10,2) NOT NULL,
        quantity INT DEFAULT 0,
        alert_quantity INT DEFAULT 0,
        rack_number VARCHAR(50),
        remarks VARCHAR(200),
        action_type ENUM('created', 'updated', 'deleted') NOT NULL,
        changed_by VARCHAR(50) DEFAULT NULL,
        changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
        INDEX idx_item_id (item_id),
        INDEX idx_changed_at (changed_at)
      )
    `);
    console.log('   ✓ Created items_history table');

    // Buyer Parties Table (with GST number)
    await adminConnection.query(`
      CREATE TABLE buyer_parties (
        id INT AUTO_INCREMENT PRIMARY KEY,
        party_name VARCHAR(255) NOT NULL,
        mobile_number VARCHAR(20),
        email VARCHAR(100),
        address TEXT,
        gst_number VARCHAR(20) DEFAULT NULL,
        opening_balance DECIMAL(10,2) DEFAULT 0,
        closing_balance DECIMAL(10,2) DEFAULT 0,
        paid_amount DECIMAL(10,2) DEFAULT 0,
        balance_amount DECIMAL(10,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    console.log('   ✓ Created buyer_parties table');

    // Seller Parties Table (Creditor: with due_date, vehicle_number)
    await adminConnection.query(`
      CREATE TABLE seller_parties (
        id INT AUTO_INCREMENT PRIMARY KEY,
        party_name VARCHAR(255) NOT NULL,
        mobile_number VARCHAR(20),
        email VARCHAR(100),
        address TEXT,
        gst_number VARCHAR(20) DEFAULT NULL,
        opening_balance DECIMAL(10,2) DEFAULT 0,
        closing_balance DECIMAL(10,2) DEFAULT 0,
        paid_amount DECIMAL(10,2) DEFAULT 0,
        balance_amount DECIMAL(10,2) DEFAULT 0,
        due_date DATE DEFAULT NULL,
        vehicle_number VARCHAR(50) DEFAULT NULL,
        is_archived TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    console.log('   ✓ Created seller_parties (creditor) table');

    // Purchase Transactions Table
    await adminConnection.query(`
      CREATE TABLE purchase_transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        buyer_party_id INT NOT NULL,
        item_id INT NOT NULL,
        quantity INT NOT NULL,
        purchase_rate DECIMAL(10,2) NOT NULL,
        total_amount DECIMAL(10,2) NOT NULL,
        transaction_date DATE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (buyer_party_id) REFERENCES buyer_parties(id),
        FOREIGN KEY (item_id) REFERENCES items(id)
      )
    `);
    console.log('   ✓ Created purchase_transactions table');

    // Nozzles table (petrol pump nozzles, is_archived for soft delete)
    await adminConnection.query(`
      CREATE TABLE nozzles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        display_order INT DEFAULT 0,
        is_archived TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('   ✓ Created nozzles table');

    // Attendants table (attendance_id, name, mobile_number, is_archived)
    await adminConnection.query(`
      CREATE TABLE attendants (
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
    console.log('   ✓ Created attendants table');

    // Sale Transactions Table (with attendant_id, nozzle_id)
    await adminConnection.query(`
      CREATE TABLE sale_transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        seller_party_id INT NOT NULL,
        attendant_id INT DEFAULT NULL,
        nozzle_id INT DEFAULT NULL,
        transaction_date DATE NOT NULL,
        subtotal DECIMAL(10,2) DEFAULT 0,
        discount DECIMAL(10,2) DEFAULT 0,
        discount_type ENUM('amount', 'percentage') DEFAULT 'amount',
        discount_percentage DECIMAL(5,2) DEFAULT NULL,
        tax_amount DECIMAL(10,2) DEFAULT 0,
        total_amount DECIMAL(10,2) NOT NULL,
        paid_amount DECIMAL(10,2) DEFAULT 0,
        balance_amount DECIMAL(10,2) DEFAULT 0,
        payment_status ENUM('fully_paid', 'partially_paid') DEFAULT 'fully_paid',
        bill_number VARCHAR(50) UNIQUE,
        with_gst BOOLEAN DEFAULT FALSE,
        previous_balance_paid DECIMAL(10,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (seller_party_id) REFERENCES seller_parties(id),
        FOREIGN KEY (attendant_id) REFERENCES attendants(id) ON DELETE SET NULL,
        FOREIGN KEY (nozzle_id) REFERENCES nozzles(id) ON DELETE SET NULL,
        INDEX idx_with_gst (with_gst)
      )
    `);
    console.log('   ✓ Created sale_transactions table');

    // Nozzle readings (daily meter opening/closing; parcel: opening first, closing later)
    await adminConnection.query(`
      CREATE TABLE nozzle_readings (
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
    console.log('   ✓ Created nozzle_readings table');

    // Sale Items Table (with discount columns)
    await adminConnection.query(`
      CREATE TABLE sale_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sale_transaction_id INT NOT NULL,
        item_id INT NOT NULL,
        quantity INT NOT NULL,
        sale_rate DECIMAL(10,2) NOT NULL,
        total_amount DECIMAL(10,2) NOT NULL,
        discount DECIMAL(10,2) DEFAULT 0,
        discount_type ENUM('amount', 'percentage') DEFAULT 'amount',
        discount_percentage DECIMAL(5,2) DEFAULT NULL,
        FOREIGN KEY (sale_transaction_id) REFERENCES sale_transactions(id) ON DELETE CASCADE,
        FOREIGN KEY (item_id) REFERENCES items(id)
      )
    `);
    console.log('   ✓ Created sale_items table');

    // Return Transactions Table (with buyer support)
    await adminConnection.query(`
      CREATE TABLE return_transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        seller_party_id INT NULL,
        buyer_party_id INT DEFAULT NULL,
        party_type ENUM('seller', 'buyer') DEFAULT 'seller',
        item_id INT NOT NULL,
        quantity INT NOT NULL,
        return_amount DECIMAL(10,2) NOT NULL,
        return_date DATE NOT NULL,
        reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (seller_party_id) REFERENCES seller_parties(id),
        FOREIGN KEY (buyer_party_id) REFERENCES buyer_parties(id),
        FOREIGN KEY (item_id) REFERENCES items(id)
      )
    `);
    console.log('   ✓ Created return_transactions table');

    // Order Sheet Table
    await adminConnection.query(`
      CREATE TABLE order_sheet (
        id INT AUTO_INCREMENT PRIMARY KEY,
        item_id INT NOT NULL UNIQUE,
        required_quantity INT NOT NULL,
        current_quantity INT NOT NULL,
        status ENUM('pending', 'ordered', 'completed') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (item_id) REFERENCES items(id)
      )
    `);
    console.log('   ✓ Created order_sheet table');

    console.log('✅ All tables created successfully!');

    // Insert default super admin user
    console.log('👤 Creating default super admin user...');
    await adminConnection.query(`
      INSERT INTO users (user_id, password, role) 
      VALUES ('superadmin', '$2a$10$SmudmB9qhS2GiCBxCIcjFOk1Hnvmdbijoz7Ea41NSE68a24LbYc5W', 'super_admin')
      ON DUPLICATE KEY UPDATE user_id=user_id
    `);
    console.log('   ✓ Default user created (user_id: superadmin, password: admin123)');
    console.log('   ⚠️  NOTE: Run "node server/fix-password.js" to ensure password works correctly');

    // Add default Retail Buyer and Retail Seller parties
    console.log('🏢 Adding default parties...');
    await adminConnection.query(`
      INSERT INTO buyer_parties (party_name, mobile_number, email, address, opening_balance, closing_balance, balance_amount)
      VALUES ('Retail Buyer', '0000000000', 'retail@default.com', 'Default Retail Buyer', 0, 0, 0)
      ON DUPLICATE KEY UPDATE party_name=party_name
    `);
    await adminConnection.query(`
      INSERT INTO seller_parties (party_name, mobile_number, email, address, opening_balance, closing_balance, balance_amount)
      VALUES ('Retail Seller', '0000000000', 'retail@default.com', 'Default Retail Seller', 0, 0, 0)
      ON DUPLICATE KEY UPDATE party_name=party_name
    `);
    console.log('   ✓ Default parties created');

    // Add sample products
    console.log('📦 Adding sample products...');
    const products = [
      ['Petrol', 'PETROL-001', 'Fuel', '27100000', 0, 100.00, 100.00, 0, 0, null, 'Petrol - sale rate can be updated daily or while selling', 'superadmin'],
      ['Diesel', 'DIESEL-001', 'Fuel', '27100000', 0, 100.00, 100.00, 0, 0, null, 'Diesel - sale rate can be updated daily or while selling', 'superadmin'],
      ['Laptop Dell Inspiron 15', 'LAP-DELL-001', 'Dell', '84713000', 18.00, 45000.00, 38000.00, 25, 5, 'RACK-A1', 'High performance laptop for office use', 'superadmin'],
      ['Wireless Mouse Logitech', 'MSE-LOG-001', 'Logitech', '84716070', 18.00, 850.00, 600.00, 150, 20, 'RACK-A2', 'Ergonomic wireless mouse', 'superadmin'],
      ['Keyboard Mechanical RGB', 'KBD-MEC-001', 'Mechanical', '84716070', 18.00, 2500.00, 1800.00, 80, 10, 'RACK-A3', 'RGB backlit mechanical keyboard', 'superadmin'],
      ['Monitor 24 inch Full HD', 'MON-24FHD-001', 'Samsung', '85285210', 18.00, 12000.00, 9500.00, 40, 5, 'RACK-B1', 'IPS panel with HDMI and VGA ports', 'superadmin'],
      ['Webcam HD 1080p', 'CAM-HD-001', 'Logitech', '85258020', 18.00, 3500.00, 2500.00, 60, 10, 'RACK-B2', 'Full HD webcam with microphone', 'superadmin'],
      ['USB Cable Type-C', 'CBL-USB-C-001', 'Generic', '85444220', 18.00, 250.00, 150.00, 200, 30, 'RACK-C1', 'Fast charging USB-C cable', 'superadmin'],
      ['Power Bank 20000mAh', 'PWR-20K-001', 'Mi', '85076000', 18.00, 1500.00, 1100.00, 35, 5, 'RACK-C2', 'Fast charging power bank', 'superadmin'],
      ['Headphones Wireless', 'HP-WLS-001', 'Sony', '85183000', 18.00, 4500.00, 3200.00, 45, 8, 'RACK-D1', 'Noise cancelling wireless headphones', 'superadmin'],
      ['SSD 500GB SATA', 'SSD-500-001', 'Samsung', '84717010', 18.00, 3500.00, 2500.00, 70, 10, 'RACK-D2', 'Fast read/write SSD drive', 'superadmin'],
      ['RAM 8GB DDR4', 'RAM-8GB-001', 'Corsair', '84733020', 18.00, 2800.00, 2000.00, 90, 15, 'RACK-D3', 'High speed DDR4 RAM module', 'superadmin'],
      ['Graphics Card RTX 3060', 'GPU-RTX3060-001', 'NVIDIA', '84715020', 18.00, 35000.00, 28000.00, 15, 3, 'RACK-E1', 'Gaming graphics card', 'superadmin'],
      ['Motherboard B450', 'MB-B450-001', 'ASUS', '84715020', 18.00, 8500.00, 6500.00, 20, 5, 'RACK-E2', 'AMD compatible motherboard', 'superadmin'],
      ['CPU Cooler Liquid', 'CPU-LIQ-001', 'Cooler Master', '84715020', 18.00, 5500.00, 4000.00, 25, 5, 'RACK-E3', 'AIO liquid CPU cooler', 'superadmin'],
      ['Case ATX Mid Tower', 'CASE-ATX-001', 'Corsair', '84715020', 18.00, 4500.00, 3200.00, 30, 5, 'RACK-F1', 'Tempered glass side panel', 'superadmin'],
      ['PSU 650W 80+ Gold', 'PSU-650-001', 'Corsair', '85044090', 18.00, 6000.00, 4500.00, 18, 3, 'RACK-F2', 'Modular power supply unit', 'superadmin'],
      ['Network Switch 8 Port', 'NET-SW-8-001', 'TP-Link', '85176200', 18.00, 2500.00, 1800.00, 40, 8, 'RACK-F3', 'Gigabit Ethernet switch', 'superadmin'],
      ['Router WiFi 6', 'NET-RTR-6-001', 'TP-Link', '85176200', 18.00, 4500.00, 3200.00, 22, 5, 'RACK-G1', 'Dual band WiFi 6 router', 'superadmin'],
      ['HDD 1TB 7200RPM', 'HDD-1TB-001', 'Seagate', '84717010', 18.00, 3500.00, 2500.00, 50, 10, 'RACK-G2', 'Internal hard disk drive', 'superadmin'],
      ['External SSD 1TB', 'SSD-EXT-1TB-001', 'Samsung', '84717010', 18.00, 8500.00, 6500.00, 28, 5, 'RACK-G3', 'Portable external SSD', 'superadmin'],
      ['USB Hub 4 Port', 'USB-HUB-4-001', 'Generic', '84716070', 18.00, 450.00, 300.00, 120, 20, 'RACK-H1', 'USB 3.0 hub with power adapter', 'superadmin'],
      ['HDMI Cable 2m', 'CBL-HDMI-2M-001', 'Generic', '85444220', 18.00, 350.00, 200.00, 150, 25, 'RACK-H2', 'High speed HDMI cable', 'superadmin'],
      ['VGA to HDMI Adapter', 'ADP-VGA-HDMI-001', 'Generic', '85444220', 18.00, 550.00, 350.00, 80, 15, 'RACK-H3', 'Video converter adapter', 'superadmin'],
      ['Laptop Stand Aluminum', 'ACC-STAND-001', 'Generic', '84716070', 18.00, 1200.00, 800.00, 55, 10, 'RACK-I1', 'Adjustable laptop stand', 'superadmin'],
      ['Mouse Pad Large', 'ACC-PAD-001', 'Generic', '84716070', 18.00, 250.00, 150.00, 200, 30, 'RACK-I2', 'Gaming mouse pad', 'superadmin'],
      ['Keyboard Wrist Rest', 'ACC-WRIST-001', 'Generic', '84716070', 18.00, 450.00, 300.00, 100, 20, 'RACK-I3', 'Ergonomic wrist support', 'superadmin'],
      ['Screen Protector 15.6"', 'ACC-PROT-15-001', 'Generic', '84716070', 18.00, 350.00, 200.00, 75, 15, 'RACK-J1', 'Anti-glare screen protector', 'superadmin'],
      ['Laptop Sleeve 15.6"', 'ACC-SLEEVE-15-001', 'Generic', '42021200', 18.00, 650.00, 400.00, 60, 10, 'RACK-J2', 'Padded laptop protection', 'superadmin'],
      ['USB Flash Drive 64GB', 'USB-64GB-001', 'SanDisk', '85235100', 18.00, 550.00, 350.00, 180, 30, 'RACK-J3', 'High speed USB 3.0 drive', 'superadmin'],
      ['SD Card 128GB', 'SD-128GB-001', 'SanDisk', '85235100', 18.00, 1200.00, 800.00, 95, 15, 'RACK-K1', 'Class 10 SD card', 'superadmin'],
      ['MicroSD 256GB', 'MSD-256GB-001', 'SanDisk', '85235100', 18.00, 2500.00, 1800.00, 65, 10, 'RACK-K2', 'High capacity microSD card', 'superadmin']
    ];

    for (const product of products) {
      await adminConnection.query(
        `INSERT INTO items (product_name, product_code, brand, hsn_number, tax_rate, sale_rate, purchase_rate, quantity, alert_quantity, rack_number, remarks, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        product
      );
    }
    console.log(`   ✓ Added ${products.length} products`);

    // Add buyer parties
    console.log('👥 Adding buyer parties...');
    const buyers = [
      ['ABC Wholesale Ltd', '9876543210', 'abc@wholesale.com', '123 Main Street, Mumbai', 50000.00, 50000.00, 50000.00, '27AABCU1234A1Z5'],
      ['XYZ Distributors', '9876543211', 'xyz@dist.com', '456 Commerce Road, Delhi', 30000.00, 30000.00, 30000.00, '07AAECX5678B2Z6'],
      ['Prime Suppliers', '9876543212', 'prime@suppliers.com', '789 Trade Avenue, Bangalore', 75000.00, 75000.00, 75000.00, '29AAPMP9012C3Z7'],
      ['Global Imports', '9876543213', 'global@imports.com', '321 Export Street, Chennai', 40000.00, 40000.00, 40000.00, '33AAGLG3456D4Z8'],
      ['Mega Traders', '9876543214', 'mega@traders.com', '654 Business Park, Pune', 60000.00, 60000.00, 60000.00, '27AAMGT7890E5Z9']
    ];

    for (const buyer of buyers) {
      await adminConnection.query(
        `INSERT INTO buyer_parties (party_name, mobile_number, email, address, opening_balance, closing_balance, balance_amount, gst_number)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        buyer
      );
    }
    console.log(`   ✓ Added ${buyers.length} buyer parties`);

    // Add seller parties
    console.log('👥 Adding seller parties...');
    const sellers = [
      ['Tech Solutions Inc', '9876543220', 'tech@sol.com', '100 Tech Park, Mumbai', 0.00, 0.00, 0.00, '27AATSI1234F1Z1'],
      ['Digital Store', '9876543221', 'digital@store.com', '200 Digital Plaza, Delhi', 0.00, 0.00, 0.00, '07AADGS5678G2Z2'],
      ['Computer World', '9876543222', 'comp@world.com', '300 Computer Street, Bangalore', 0.00, 0.00, 0.00, '29AACWX9012H3Z3'],
      ['Electronics Hub', '9876543223', 'elec@hub.com', '400 Electronics Avenue, Chennai', 0.00, 0.00, 0.00, '33AAEHB3456I4Z4'],
      ['Gadget Zone', '9876543224', 'gadget@zone.com', '500 Gadget Road, Pune', 0.00, 0.00, 0.00, '27AAGZN7890J5Z5']
    ];

    for (const seller of sellers) {
      await adminConnection.query(
        `INSERT INTO seller_parties (party_name, mobile_number, email, address, opening_balance, closing_balance, balance_amount, gst_number)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        seller
      );
    }
    console.log(`   ✓ Added ${sellers.length} seller parties`);

    await adminConnection.end();

    console.log('\n✅ Database reset completed successfully!');
    console.log(`\n📊 Summary:`);
    console.log(`   - Database: ${config.database}`);
    console.log(`   - Tables: 10 tables created`);
    console.log(`   - Users: 1 (superadmin)`);
    console.log(`   - Products: ${products.length}`);
    console.log(`   - Buyer Parties: ${buyers.length + 1} (including Retail Buyer)`);
    console.log(`   - Seller Parties: ${sellers.length + 1} (including Retail Seller)`);
    console.log(`\n⚠️  IMPORTANT: Run "node server/fix-password.js" to ensure the superadmin password works correctly!`);

  } catch (error) {
    console.error('\n❌ Error resetting database:', error);
    console.error('   Message:', error.message);
    if (error.sql) {
      console.error('   SQL:', error.sql);
    }
    process.exit(1);
  }
}

resetDatabase();

