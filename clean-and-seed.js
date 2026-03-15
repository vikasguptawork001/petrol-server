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

async function cleanAndSeed() {
  let connection;
  try {
    console.log('Connecting to database...');
    connection = await mysql.createConnection(config);
    console.log('Connected successfully!');

    // Disable foreign key checks
    await connection.execute('SET FOREIGN_KEY_CHECKS = 0');
    console.log('Foreign key checks disabled');

    // Truncate tables (handle missing tables gracefully)
    console.log('Cleaning tables...');
    const tables = [
      'items_history',
      'sale_items',
      'sale_transactions',
      'return_transactions',
      'purchase_transactions',
      'order_sheet',
      'items',
      'buyer_parties',
      'seller_parties'
    ];

    for (const table of tables) {
      try {
        await connection.execute(`TRUNCATE TABLE ${table}`);
        console.log(`  ✓ Cleaned ${table}`);
      } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') {
          console.log(`  ⚠ Table ${table} does not exist, skipping...`);
        } else {
          throw error;
        }
      }
    }
    console.log('Tables cleaned successfully');

    // Re-enable foreign key checks
    await connection.execute('SET FOREIGN_KEY_CHECKS = 1');

    // Run migration to add new columns
    console.log('Running migration to add new columns...');
    try {
      // Add remarks column if it doesn't exist
      await connection.execute(`
        ALTER TABLE items 
        ADD COLUMN IF NOT EXISTS remarks VARCHAR(200) DEFAULT NULL
      `).catch(() => {
        // Column might already exist, try without IF NOT EXISTS
        return connection.execute(`
          ALTER TABLE items 
          ADD COLUMN remarks VARCHAR(200) DEFAULT NULL
        `).catch(() => {
          console.log('  ⚠ Remarks column may already exist');
        });
      });

      // Add image column if it doesn't exist
      await connection.execute(`
        ALTER TABLE items 
        ADD COLUMN IF NOT EXISTS image LONGBLOB DEFAULT NULL
      `).catch(() => {
        return connection.execute(`
          ALTER TABLE items 
          ADD COLUMN image LONGBLOB DEFAULT NULL
        `).catch(() => {
          console.log('  ⚠ Image column may already exist');
        });
      });

      // Add created_by and updated_by columns
      await connection.execute(`
        ALTER TABLE items 
        ADD COLUMN IF NOT EXISTS created_by VARCHAR(50) DEFAULT NULL
      `).catch(() => {
        return connection.execute(`
          ALTER TABLE items 
          ADD COLUMN created_by VARCHAR(50) DEFAULT NULL
        `).catch(() => {});
      });

      await connection.execute(`
        ALTER TABLE items 
        ADD COLUMN IF NOT EXISTS updated_by VARCHAR(50) DEFAULT NULL
      `).catch(() => {
        return connection.execute(`
          ALTER TABLE items 
          ADD COLUMN updated_by VARCHAR(50) DEFAULT NULL
        `).catch(() => {});
      });

      // Add GST number to parties
      await connection.execute(`
        ALTER TABLE buyer_parties 
        ADD COLUMN IF NOT EXISTS gst_number VARCHAR(20) DEFAULT NULL
      `).catch(() => {
        return connection.execute(`
          ALTER TABLE buyer_parties 
          ADD COLUMN gst_number VARCHAR(20) DEFAULT NULL
        `).catch(() => {});
      });

      await connection.execute(`
        ALTER TABLE seller_parties 
        ADD COLUMN IF NOT EXISTS gst_number VARCHAR(20) DEFAULT NULL
      `).catch(() => {
        return connection.execute(`
          ALTER TABLE seller_parties 
          ADD COLUMN gst_number VARCHAR(20) DEFAULT NULL
        `).catch(() => {});
      });

      // Add discount and GST fields to sale_transactions
      await connection.execute(`
        ALTER TABLE sale_transactions 
        ADD COLUMN IF NOT EXISTS discount DECIMAL(10,2) DEFAULT 0
      `).catch(() => {
        return connection.execute(`
          ALTER TABLE sale_transactions 
          ADD COLUMN discount DECIMAL(10,2) DEFAULT 0
        `).catch(() => {});
      });

      await connection.execute(`
        ALTER TABLE sale_transactions 
        ADD COLUMN IF NOT EXISTS with_gst BOOLEAN DEFAULT FALSE
      `).catch(() => {
        return connection.execute(`
          ALTER TABLE sale_transactions 
          ADD COLUMN with_gst BOOLEAN DEFAULT FALSE
        `).catch(() => {});
      });

      await connection.execute(`
        ALTER TABLE sale_transactions 
        ADD COLUMN IF NOT EXISTS tax_amount DECIMAL(10,2) DEFAULT 0
      `).catch(() => {
        return connection.execute(`
          ALTER TABLE sale_transactions 
          ADD COLUMN tax_amount DECIMAL(10,2) DEFAULT 0
        `).catch(() => {});
      });

      await connection.execute(`
        ALTER TABLE sale_transactions 
        ADD COLUMN IF NOT EXISTS subtotal DECIMAL(10,2) DEFAULT 0
      `).catch(() => {
        return connection.execute(`
          ALTER TABLE sale_transactions 
          ADD COLUMN subtotal DECIMAL(10,2) DEFAULT 0
        `).catch(() => {});
      });

      // Create items_history table if it doesn't exist
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS items_history (
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
      `).catch(() => {
        console.log('  ⚠ Items history table may already exist');
      });

      console.log('Migration completed');
    } catch (error) {
      console.log('Migration warning:', error.message);
    }

    // Add default Retail Buyer and Retail Seller parties
    console.log('Adding default parties...');
    await connection.execute(
      `INSERT INTO buyer_parties (party_name, mobile_number, email, address, opening_balance, closing_balance, balance_amount)
       VALUES ('Retail Buyer', '0000000000', 'retail@default.com', 'Default Retail Buyer', 0, 0, 0)
       ON DUPLICATE KEY UPDATE party_name=party_name`
    );
    await connection.execute(
      `INSERT INTO seller_parties (party_name, mobile_number, email, address, opening_balance, closing_balance, balance_amount)
       VALUES ('Retail Seller', '0000000000', 'retail@default.com', 'Default Retail Seller', 0, 0, 0)
       ON DUPLICATE KEY UPDATE party_name=party_name`
    );

    // Add sample products
    console.log('Adding sample products...');
    const products = [
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
      await connection.execute(
        `INSERT INTO items (product_name, product_code, brand, hsn_number, tax_rate, sale_rate, purchase_rate, quantity, alert_quantity, rack_number, remarks, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        product
      );
    }
    console.log(`Added ${products.length} products`);

    // Add buyer parties
    console.log('Adding buyer parties...');
    const buyers = [
      ['ABC Wholesale Ltd', '9876543210', 'abc@wholesale.com', '123 Main Street, Mumbai', 50000.00, 50000.00, 50000.00, '27AABCU1234A1Z5'],
      ['XYZ Distributors', '9876543211', 'xyz@dist.com', '456 Commerce Road, Delhi', 30000.00, 30000.00, 30000.00, '07AAECX5678B2Z6'],
      ['Prime Suppliers', '9876543212', 'prime@suppliers.com', '789 Trade Avenue, Bangalore', 75000.00, 75000.00, 75000.00, '29AAPMP9012C3Z7'],
      ['Global Imports', '9876543213', 'global@imports.com', '321 Export Street, Chennai', 40000.00, 40000.00, 40000.00, '33AAGLG3456D4Z8'],
      ['Mega Traders', '9876543214', 'mega@traders.com', '654 Business Park, Pune', 60000.00, 60000.00, 60000.00, '27AAMGT7890E5Z9']
    ];

    for (const buyer of buyers) {
      await connection.execute(
        `INSERT INTO buyer_parties (party_name, mobile_number, email, address, opening_balance, closing_balance, balance_amount, gst_number)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        buyer
      );
    }
    console.log(`Added ${buyers.length} buyer parties`);

    // Add seller parties
    console.log('Adding seller parties...');
    const sellers = [
      ['Tech Solutions Inc', '9876543220', 'tech@sol.com', '100 Tech Park, Mumbai', 0.00, 0.00, 0.00, '27AATSI1234F1Z1'],
      ['Digital Store', '9876543221', 'digital@store.com', '200 Digital Plaza, Delhi', 0.00, 0.00, 0.00, '07AADGS5678G2Z2'],
      ['Computer World', '9876543222', 'comp@world.com', '300 Computer Street, Bangalore', 0.00, 0.00, 0.00, '29AACWX9012H3Z3'],
      ['Electronics Hub', '9876543223', 'elec@hub.com', '400 Electronics Avenue, Chennai', 0.00, 0.00, 0.00, '33AAEHB3456I4Z4'],
      ['Gadget Zone', '9876543224', 'gadget@zone.com', '500 Gadget Road, Pune', 0.00, 0.00, 0.00, '27AAGZN7890J5Z5']
    ];

    for (const seller of sellers) {
      await connection.execute(
        `INSERT INTO seller_parties (party_name, mobile_number, email, address, opening_balance, closing_balance, balance_amount, gst_number)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        seller
      );
    }
    console.log(`Added ${sellers.length} seller parties`);

    console.log('\n✅ Database cleaned and seeded successfully!');
    console.log(`   - ${products.length} products added`);
    console.log(`   - ${buyers.length} buyer parties added`);
    console.log(`   - ${sellers.length} seller parties added`);
    console.log('   - Default Retail Buyer and Retail Seller parties created');

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

cleanAndSeed();

