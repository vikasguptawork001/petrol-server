const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function seedData() {
  let connection;
  let adminConnection;
  try {
    const dbConfig = {
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      port: parseInt(process.env.DB_PORT) || 3306,
    };
    const dbName = process.env.DB_NAME || 'inventory_management';

    // First, connect without database to create it if needed
    console.log('Connecting to MySQL server...');
    adminConnection = await mysql.createConnection(dbConfig);
    console.log('✓ Connected to MySQL server');

    // Create database if it doesn't exist
    await adminConnection.execute(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
    console.log(`✓ Database '${dbName}' ready`);

    // Now connect to the specific database
    connection = await mysql.createConnection({
      ...dbConfig,
      database: dbName,
    });
    console.log(`✓ Connected to database '${dbName}'`);

    // Check if tables exist, if not, create them
    const [tables] = await connection.execute(
      "SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = ?",
      [dbName]
    );

    if (tables[0].count === 0) {
      console.log('\nCreating database tables...');
      const schemaPath = path.join(__dirname, 'database', 'schema.sql');
      if (fs.existsSync(schemaPath)) {
        const schema = fs.readFileSync(schemaPath, 'utf8');
        // Split by semicolons and execute each statement
        const statements = schema
          .split(';')
          .map(s => s.trim())
          .filter(s => s.length > 0 && !s.startsWith('--'));

        for (const statement of statements) {
          if (statement.toLowerCase().includes('create database')) continue;
          if (statement.toLowerCase().includes('use ')) continue;
          try {
            await connection.execute(statement);
          } catch (err) {
            // Ignore errors for duplicate inserts
            if (!err.message.includes('Duplicate entry')) {
              console.warn(`Warning executing statement: ${err.message}`);
            }
          }
        }
        console.log('✓ Database tables created');
      } else {
        console.log('⚠ Schema file not found, assuming tables exist');
      }
    } else {
      console.log('✓ Database tables already exist');
    }

    console.log('\nStarting to seed data...\n');

    // 1. Add users (admin and sales)
    console.log('1. Adding users...');
    const adminPassword = await bcrypt.hash('admin123', 10);
    const salesPassword = await bcrypt.hash('sales123', 10);

    await connection.execute(
      'INSERT INTO users (user_id, password, role) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE user_id=user_id',
      ['admin1', adminPassword, 'admin']
    );
    console.log('   ✓ Added admin user: admin1 (password: admin123)');

    await connection.execute(
      'INSERT INTO users (user_id, password, role) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE user_id=user_id',
      ['sales1', salesPassword, 'sales']
    );
    console.log('   ✓ Added sales user: sales1 (password: sales123)');

    // 2. Add 5 buyer parties
    console.log('\n2. Adding buyer parties...');
    const buyerParties = [
      { name: 'ABC Wholesale Ltd', mobile: '9876543210', email: 'abc@wholesale.com', address: '123 Main Street, Mumbai', opening: 50000 },
      { name: 'XYZ Distributors', mobile: '9876543211', email: 'xyz@dist.com', address: '456 Commerce Road, Delhi', opening: 30000 },
      { name: 'Prime Suppliers', mobile: '9876543212', email: 'prime@suppliers.com', address: '789 Trade Avenue, Bangalore', opening: 75000 },
      { name: 'Global Imports', mobile: '9876543213', email: 'global@imports.com', address: '321 Export Street, Chennai', opening: 40000 },
      { name: 'Mega Traders', mobile: '9876543214', email: 'mega@traders.com', address: '654 Business Park, Pune', opening: 60000 }
    ];

    const buyerIds = [];
    for (const party of buyerParties) {
      const [result] = await connection.execute(
        'INSERT INTO buyer_parties (party_name, mobile_number, email, address, opening_balance, balance_amount) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE party_name=party_name',
        [party.name, party.mobile, party.email, party.address, party.opening, party.opening]
      );
      const [existing] = await connection.execute('SELECT id FROM buyer_parties WHERE party_name = ?', [party.name]);
      buyerIds.push(existing[0].id);
      console.log(`   ✓ Added buyer: ${party.name}`);
    }

    // 3. Add 5 seller parties
    console.log('\n3. Adding seller parties...');
    const sellerParties = [
      { name: 'Retail Mart', mobile: '9876543220', email: 'retail@mart.com', address: '111 Shop Street, Mumbai', opening: 0 },
      { name: 'Super Store', mobile: '9876543221', email: 'super@store.com', address: '222 Market Road, Delhi', opening: 0 },
      { name: 'City Center', mobile: '9876543222', email: 'city@center.com', address: '333 Plaza Avenue, Bangalore', opening: 0 },
      { name: 'Mega Mall', mobile: '9876543223', email: 'mega@mall.com', address: '444 Mall Street, Chennai', opening: 0 },
      { name: 'Trade Hub', mobile: '9876543224', email: 'trade@hub.com', address: '555 Hub Road, Pune', opening: 0 }
    ];

    const sellerIds = [];
    for (const party of sellerParties) {
      const [result] = await connection.execute(
        'INSERT INTO seller_parties (party_name, mobile_number, email, address, opening_balance, balance_amount) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE party_name=party_name',
        [party.name, party.mobile, party.email, party.address, party.opening, party.opening]
      );
      const [existing] = await connection.execute('SELECT id FROM seller_parties WHERE party_name = ?', [party.name]);
      sellerIds.push(existing[0].id);
      console.log(`   ✓ Added seller: ${party.name}`);
    }

    // 4. Add products
    console.log('\n4. Adding products...');
    const products = [
      { name: 'Laptop Dell XPS 15', code: 'LAP-DELL-XPS15', brand: 'Dell', hsn: '84713000', tax: 18, sale: 85000, purchase: 70000, qty: 50, alert: 10, rack: 'A1' },
      { name: 'Wireless Mouse Logitech', code: 'MSE-LOG-MX3', brand: 'Logitech', hsn: '84716050', tax: 18, sale: 2500, purchase: 1800, qty: 100, alert: 20, rack: 'A2' },
      { name: 'Mechanical Keyboard', code: 'KB-MECH-RGB', brand: 'Corsair', hsn: '84716050', tax: 18, sale: 12000, purchase: 9000, qty: 75, alert: 15, rack: 'A3' },
      { name: 'Monitor 27 inch 4K', code: 'MON-27-4K', brand: 'LG', hsn: '85285200', tax: 18, sale: 35000, purchase: 28000, qty: 40, alert: 8, rack: 'B1' },
      { name: 'USB-C Cable 2m', code: 'CBL-USB-C-2M', brand: 'Anker', hsn: '85444290', tax: 18, sale: 800, purchase: 500, qty: 200, alert: 50, rack: 'B2' },
      { name: 'Webcam HD 1080p', code: 'CAM-HD-1080', brand: 'Logitech', hsn: '85258032', tax: 18, sale: 4500, purchase: 3200, qty: 60, alert: 12, rack: 'B3' },
      { name: 'External SSD 1TB', code: 'SSD-EXT-1TB', brand: 'Samsung', hsn: '84717010', tax: 18, sale: 8500, purchase: 6500, qty: 80, alert: 16, rack: 'C1' },
      { name: 'Gaming Headset', code: 'HS-GAME-7.1', brand: 'SteelSeries', hsn: '85183000', tax: 18, sale: 15000, purchase: 11000, qty: 45, alert: 9, rack: 'C2' },
      { name: 'Laptop Stand Aluminum', code: 'STD-LAP-AL', brand: 'Rain Design', hsn: '84733090', tax: 18, sale: 3500, purchase: 2500, qty: 90, alert: 18, rack: 'C3' },
      { name: 'Power Bank 20000mAh', code: 'PB-20K', brand: 'Anker', hsn: '85044000', tax: 18, sale: 2800, purchase: 2000, qty: 120, alert: 25, rack: 'D1' },
      { name: 'Laptop HP Pavilion 15', code: 'LAP-HP-PAV15', brand: 'HP', hsn: '84713000', tax: 18, sale: 55000, purchase: 45000, qty: 35, alert: 7, rack: 'A4' },
      { name: 'Wireless Keyboard Logitech', code: 'KB-WIRE-LOG', brand: 'Logitech', hsn: '84716050', tax: 18, sale: 3500, purchase: 2500, qty: 85, alert: 17, rack: 'A5' },
      { name: 'Monitor 24 inch Full HD', code: 'MON-24-FHD', brand: 'Samsung', hsn: '85285200', tax: 18, sale: 18000, purchase: 14000, qty: 55, alert: 11, rack: 'B4' },
      { name: 'USB Hub 4 Port', code: 'USB-HUB-4P', brand: 'Anker', hsn: '85444290', tax: 18, sale: 1200, purchase: 800, qty: 150, alert: 30, rack: 'B5' },
      { name: 'Bluetooth Speaker', code: 'SPK-BT-JBL', brand: 'JBL', hsn: '85183000', tax: 18, sale: 5500, purchase: 4000, qty: 70, alert: 14, rack: 'C4' },
      { name: 'Tablet iPad Air', code: 'TAB-IPAD-AIR', brand: 'Apple', hsn: '84713000', tax: 18, sale: 65000, purchase: 55000, qty: 25, alert: 5, rack: 'D2' },
      { name: 'Smartphone Samsung Galaxy', code: 'PHN-SAM-GAL', brand: 'Samsung', hsn: '85171200', tax: 18, sale: 45000, purchase: 35000, qty: 30, alert: 6, rack: 'D3' },
      { name: 'Router WiFi 6', code: 'RTR-WIFI-6', brand: 'TP-Link', hsn: '85176200', tax: 18, sale: 8500, purchase: 6500, qty: 50, alert: 10, rack: 'E1' },
      { name: 'Printer Laser Multifunction', code: 'PRT-LAS-MF', brand: 'HP', hsn: '84433100', tax: 18, sale: 25000, purchase: 20000, qty: 20, alert: 4, rack: 'E2' },
      { name: 'Scanner Document A4', code: 'SCN-DOC-A4', brand: 'Canon', hsn: '84716050', tax: 18, sale: 12000, purchase: 9000, qty: 40, alert: 8, rack: 'E3' },
      { name: 'HDMI Cable 2m', code: 'CBL-HDMI-2M', brand: 'Amazon Basics', hsn: '85444290', tax: 18, sale: 600, purchase: 400, qty: 180, alert: 36, rack: 'F1' },
      { name: 'Ethernet Cable Cat6 5m', code: 'CBL-ETH-CAT6', brand: 'TP-Link', hsn: '85444290', tax: 18, sale: 450, purchase: 300, qty: 200, alert: 40, rack: 'F2' },
      { name: 'Laptop Bag 15.6 inch', code: 'BAG-LAP-15', brand: 'Amazon Basics', hsn: '42021200', tax: 18, sale: 2500, purchase: 1800, qty: 65, alert: 13, rack: 'F3' },
      { name: 'Mouse Pad Large', code: 'PAD-MSE-LRG', brand: 'SteelSeries', hsn: '42021200', tax: 18, sale: 800, purchase: 500, qty: 140, alert: 28, rack: 'G1' },
      { name: 'USB Flash Drive 64GB', code: 'USB-FL-64GB', brand: 'SanDisk', hsn: '85235100', tax: 18, sale: 1200, purchase: 800, qty: 160, alert: 32, rack: 'G2' },
      { name: 'External HDD 2TB', code: 'HDD-EXT-2TB', brand: 'Seagate', hsn: '84717010', tax: 18, sale: 6500, purchase: 5000, qty: 45, alert: 9, rack: 'G3' },
      { name: 'Graphics Card RTX 3060', code: 'GPU-RTX-3060', brand: 'NVIDIA', hsn: '84713000', tax: 18, sale: 35000, purchase: 28000, qty: 15, alert: 3, rack: 'H1' },
      { name: 'RAM DDR4 16GB', code: 'RAM-DDR4-16', brand: 'Corsair', hsn: '84733090', tax: 18, sale: 5500, purchase: 4000, qty: 60, alert: 12, rack: 'H2' },
      { name: 'SSD Internal 512GB', code: 'SSD-INT-512', brand: 'Samsung', hsn: '84717010', tax: 18, sale: 4500, purchase: 3500, qty: 75, alert: 15, rack: 'H3' },
      { name: 'CPU Cooler Air', code: 'CPU-COOL-AIR', brand: 'Cooler Master', hsn: '84195000', tax: 18, sale: 3500, purchase: 2500, qty: 50, alert: 10, rack: 'I1' }
    ];

    const itemIds = [];
    for (const product of products) {
      const [result] = await connection.execute(
        'INSERT INTO items (product_name, product_code, brand, hsn_number, tax_rate, sale_rate, purchase_rate, quantity, alert_quantity, rack_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE product_name=product_name',
        [product.name, product.code, product.brand, product.hsn, product.tax, product.sale, product.purchase, product.qty, product.alert, product.rack]
      );
      const [existing] = await connection.execute('SELECT id FROM items WHERE product_code = ?', [product.code]);
      itemIds.push(existing[0].id);
      console.log(`   ✓ Added product: ${product.name}`);
    }

    // 5. Add purchase transactions (to increase stock)
    console.log('\n5. Adding purchase transactions...');
    const purchaseDates = [
      new Date('2024-01-15'),
      new Date('2024-01-20'),
      new Date('2024-02-01'),
      new Date('2024-02-10'),
      new Date('2024-02-25')
    ];

    // Purchase some items from different buyers
    const purchases = [
      { buyerId: buyerIds[0], itemId: itemIds[0], qty: 20, rate: 70000, date: purchaseDates[0] },
      { buyerId: buyerIds[0], itemId: itemIds[1], qty: 50, rate: 1800, date: purchaseDates[0] },
      { buyerId: buyerIds[1], itemId: itemIds[2], qty: 30, rate: 9000, date: purchaseDates[1] },
      { buyerId: buyerIds[1], itemId: itemIds[3], qty: 15, rate: 28000, date: purchaseDates[1] },
      { buyerId: buyerIds[2], itemId: itemIds[4], qty: 100, rate: 500, date: purchaseDates[2] },
      { buyerId: buyerIds[2], itemId: itemIds[5], qty: 30, rate: 3200, date: purchaseDates[2] },
      { buyerId: buyerIds[3], itemId: itemIds[6], qty: 40, rate: 6500, date: purchaseDates[3] },
      { buyerId: buyerIds[3], itemId: itemIds[7], qty: 20, rate: 11000, date: purchaseDates[3] },
      { buyerId: buyerIds[4], itemId: itemIds[8], qty: 45, rate: 2500, date: purchaseDates[4] },
      { buyerId: buyerIds[4], itemId: itemIds[9], qty: 60, rate: 2000, date: purchaseDates[4] }
    ];

    for (const purchase of purchases) {
      await connection.execute(
        'INSERT INTO purchase_transactions (buyer_party_id, item_id, quantity, purchase_rate, total_amount, transaction_date) VALUES (?, ?, ?, ?, ?, ?)',
        [purchase.buyerId, purchase.itemId, purchase.qty, purchase.rate, purchase.qty * purchase.rate, purchase.date]
      );
    }
    console.log(`   ✓ Added ${purchases.length} purchase transactions`);

    // 6. Add sale transactions
    console.log('\n6. Adding sale transactions...');
    const saleDates = [
      new Date('2024-03-01'),
      new Date('2024-03-05'),
      new Date('2024-03-10'),
      new Date('2024-03-15'),
      new Date('2024-03-20')
    ];

    // Create sales with multiple items
    const sales = [
      {
        sellerId: sellerIds[0],
        date: saleDates[0],
        items: [
          { itemId: itemIds[0], qty: 2, rate: 85000 },
          { itemId: itemIds[1], qty: 5, rate: 2500 }
        ],
        paymentStatus: 'fully_paid'
      },
      {
        sellerId: sellerIds[1],
        date: saleDates[1],
        items: [
          { itemId: itemIds[2], qty: 3, rate: 12000 },
          { itemId: itemIds[3], qty: 1, rate: 35000 }
        ],
        paymentStatus: 'fully_paid'
      },
      {
        sellerId: sellerIds[2],
        date: saleDates[2],
        items: [
          { itemId: itemIds[4], qty: 10, rate: 800 },
          { itemId: itemIds[5], qty: 2, rate: 4500 }
        ],
        paymentStatus: 'partially_paid',
        paidAmount: 15000
      },
      {
        sellerId: sellerIds[3],
        date: saleDates[3],
        items: [
          { itemId: itemIds[6], qty: 5, rate: 8500 },
          { itemId: itemIds[7], qty: 2, rate: 15000 }
        ],
        paymentStatus: 'fully_paid'
      },
      {
        sellerId: sellerIds[4],
        date: saleDates[4],
        items: [
          { itemId: itemIds[8], qty: 8, rate: 3500 },
          { itemId: itemIds[9], qty: 12, rate: 2800 }
        ],
        paymentStatus: 'partially_paid',
        paidAmount: 50000
      }
    ];

    for (let i = 0; i < sales.length; i++) {
      const sale = sales[i];
      let totalAmount = 0;
      const saleItems = [];

      // Calculate total
      for (const item of sale.items) {
        const itemTotal = item.qty * item.rate;
        totalAmount += itemTotal;
        saleItems.push({ ...item, itemTotal });
      }

      const paidAmount = sale.paymentStatus === 'fully_paid' ? totalAmount : (sale.paidAmount || 0);
      const balanceAmount = totalAmount - paidAmount;
      const billNumber = `BILL-${Date.now()}-${i + 1}`;

      // Insert sale transaction
      const [saleResult] = await connection.execute(
        'INSERT INTO sale_transactions (seller_party_id, transaction_date, total_amount, paid_amount, balance_amount, payment_status, bill_number) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [sale.sellerId, sale.date, totalAmount, paidAmount, balanceAmount, sale.paymentStatus, billNumber]
      );

      const saleTransactionId = saleResult.insertId;

      // Insert sale items and update stock
      for (const item of saleItems) {
        await connection.execute(
          'INSERT INTO sale_items (sale_transaction_id, item_id, quantity, sale_rate, total_amount) VALUES (?, ?, ?, ?, ?)',
          [saleTransactionId, item.itemId, item.qty, item.rate, item.itemTotal]
        );

        // Update item quantity
        await connection.execute(
          'UPDATE items SET quantity = quantity - ? WHERE id = ?',
          [item.qty, item.itemId]
        );
      }

      // Update seller party balance
      await connection.execute(
        'UPDATE seller_parties SET balance_amount = balance_amount + ?, paid_amount = paid_amount + ? WHERE id = ?',
        [balanceAmount, paidAmount, sale.sellerId]
      );

      console.log(`   ✓ Added sale transaction ${i + 1} (Bill: ${billNumber}, Amount: ₹${totalAmount})`);
    }

    console.log('\n✓ All seed data added successfully!');
    console.log('\nSummary:');
    console.log('  - 1 admin user (admin1 / admin123)');
    console.log('  - 1 sales user (sales1 / sales123)');
    console.log(`  - ${products.length} products`);
    console.log('  - 5 buyer parties');
    console.log('  - 5 seller parties');
    console.log('  - 10 purchase transactions');
    console.log('  - 5 sale transactions');

  } catch (error) {
    console.error('✗ Error seeding data:', error.message);
    if (error.code) {
      console.error(`Error code: ${error.code}`);
    }
    if (error.sqlMessage) {
      console.error(`SQL Error: ${error.sqlMessage}`);
    }
    console.error('\nPlease ensure:');
    console.error('  1. MySQL server is running');
    console.error('  2. Database credentials in .env file are correct');
    console.error('  3. Database host is accessible');
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
    if (adminConnection) {
      await adminConnection.end();
    }
  }
}

seedData();













