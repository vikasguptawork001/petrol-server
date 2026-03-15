// Improved Purchase Endpoint - Using Header-Detail Structure
// This is the improved version of the /items/purchase endpoint
// Copy this logic to replace the existing endpoint in server/routes/items.js

const express = require('express');
const pool = require('../config/database');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

// Add items in bulk (purchase) - IMPROVED VERSION with header-detail structure
router.post('/purchase', authenticateToken, authorizeRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { buyer_party_id, items, payment_status = 'partially_paid', paid_amount = 0 } = req.body;

    if (!buyer_party_id || !items || items.length === 0) {
      return res.status(400).json({ error: 'Buyer party and items are required' });
    }

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Validate buyer exists + get current balances
      const [buyerRows] = await connection.execute(
        'SELECT id, balance_amount, paid_amount FROM buyer_parties WHERE id = ?',
        [buyer_party_id]
      );
      if (buyerRows.length === 0) {
        await connection.rollback();
        return res.status(404).json({ error: 'Buyer party not found' });
      }
      const currentBalance = parseFloat(buyerRows[0].balance_amount || 0);
      const currentPaidTotal = parseFloat(buyerRows[0].paid_amount || 0);

      // Compute total purchase amount
      const totalPurchaseAmount = items.reduce((sum, it) => {
        const qty = parseInt(it.quantity) || 0;
        const rate = parseFloat(it.purchase_rate) || 0;
        return sum + qty * rate;
      }, 0);

      const paidNow =
        payment_status === 'fully_paid'
          ? totalPurchaseAmount
          : Math.max(0, parseFloat(paid_amount) || 0);

      if (paidNow > totalPurchaseAmount) {
        await connection.rollback();
        return res.status(400).json({ error: 'Paid amount cannot exceed total purchase amount' });
      }

      const newBalance = Math.max(0, currentBalance + totalPurchaseAmount - paidNow);
      const finalPaymentStatus = paidNow >= totalPurchaseAmount ? 'fully_paid' : (paidNow > 0 ? 'partially_paid' : 'unpaid');

      // Check if purchase_items table exists (new structure)
      const [tableCheck] = await connection.execute(`
        SELECT COUNT(*) as count 
        FROM INFORMATION_SCHEMA.TABLES 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'purchase_items'
      `);
      const hasNewStructure = tableCheck[0].count > 0;

      let purchaseTransactionId;
      let billNumber;

      if (hasNewStructure) {
        // NEW STRUCTURE: Create header first, then items
        
        // Generate bill number
        const [countResult] = await connection.execute(
          'SELECT COUNT(*) as count FROM purchase_transactions WHERE bill_number IS NOT NULL'
        );
        billNumber = `PUR-${Date.now()}-${countResult[0].count + 1}`;

        // 1. Create purchase header (one per request)
        const [purchaseResult] = await connection.execute(
          `INSERT INTO purchase_transactions 
           (buyer_party_id, transaction_date, total_amount_new, paid_amount, balance_amount, payment_status, bill_number)
           VALUES (?, CURDATE(), ?, ?, ?, ?, ?)`,
          [buyer_party_id, totalPurchaseAmount, paidNow, newBalance, finalPaymentStatus, billNumber]
        );
        purchaseTransactionId = purchaseResult.insertId;

        // 2. Create purchase items (one per item)
        for (const item of items) {
          const { item_id, product_code, brand, hsn_number, tax_rate, sale_rate, purchase_rate, quantity, alert_quantity, rack_number, remarks } = item;

          // Validate sale_rate >= purchase_rate
          const saleRateNum = parseFloat(sale_rate);
          const purchaseRateNum = parseFloat(purchase_rate);
          if (isNaN(saleRateNum) || isNaN(purchaseRateNum) || saleRateNum < purchaseRateNum) {
            await connection.rollback();
            return res.status(400).json({ error: `Sale rate must be greater than or equal to purchase rate for item: ${item.product_name || 'Unknown'}` });
          }

          if (item_id) {
            // Update existing item
            await connection.execute(
              'UPDATE items SET quantity = quantity + ?, product_code = ?, brand = ?, hsn_number = ?, tax_rate = ?, sale_rate = ?, purchase_rate = ?, alert_quantity = ?, rack_number = ?, remarks = ? WHERE id = ?',
              [quantity, product_code, brand, hsn_number, tax_rate, sale_rate, purchase_rate, alert_quantity, rack_number, remarks || null, item_id]
            );
          } else {
            // Create new item
            const [result] = await connection.execute(
              'INSERT INTO items (product_name, product_code, brand, hsn_number, tax_rate, sale_rate, purchase_rate, quantity, alert_quantity, rack_number, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [item.product_name, product_code, brand, hsn_number, tax_rate, sale_rate, purchase_rate, quantity, alert_quantity, rack_number, remarks || null]
            );
            item.item_id = result.insertId;
          }

          // Insert into purchase_items
          await connection.execute(
            'INSERT INTO purchase_items (purchase_transaction_id, item_id, quantity, purchase_rate, total_amount) VALUES (?, ?, ?, ?, ?)',
            [purchaseTransactionId, item.item_id || item_id, quantity, purchase_rate, purchase_rate * quantity]
          );

          // Check if quantity reached alert quantity
          const effectiveItemId = item.item_id || item_id;
          const [itemData] = await connection.execute('SELECT quantity, alert_quantity FROM items WHERE id = ? AND is_archived = FALSE', [effectiveItemId]);
          if (itemData[0] && itemData[0].quantity <= itemData[0].alert_quantity) {
            await connection.execute(
              'INSERT INTO order_sheet (item_id, required_quantity, current_quantity, status) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE required_quantity = ?, current_quantity = ?, status = ?',
              [effectiveItemId, itemData[0].alert_quantity, itemData[0].quantity, 'pending', itemData[0].alert_quantity, itemData[0].quantity, 'pending']
            );
          }
        }

        // Record payment with direct link to purchase_transaction_id
        if (paidNow > 0) {
          // Ensure payment_transactions table exists
          const [paymentTableCheck] = await connection.execute(`
            SELECT COUNT(*) as count 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = 'payment_transactions'
          `);

          if (paymentTableCheck[0].count === 0) {
            await connection.execute(`
              CREATE TABLE payment_transactions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                party_type ENUM('buyer', 'seller') NOT NULL,
                party_id INT NOT NULL,
                purchase_transaction_id INT NULL,
                amount DECIMAL(10,2) NOT NULL,
                payment_date DATE NOT NULL,
                previous_balance DECIMAL(10,2) DEFAULT 0,
                updated_balance DECIMAL(10,2) DEFAULT 0,
                receipt_number VARCHAR(50) UNIQUE,
                payment_method VARCHAR(50) NULL,
                notes TEXT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_by INT,
                INDEX idx_party (party_type, party_id),
                INDEX idx_purchase_transaction_id (purchase_transaction_id),
                INDEX idx_date (payment_date),
                FOREIGN KEY (purchase_transaction_id) REFERENCES purchase_transactions(id) ON DELETE SET NULL
              )
            `);
          } else {
            // Check if purchase_transaction_id column exists
            const [columnCheck] = await connection.execute(`
              SELECT COLUMN_NAME 
              FROM INFORMATION_SCHEMA.COLUMNS 
              WHERE TABLE_SCHEMA = DATABASE() 
              AND TABLE_NAME = 'payment_transactions' 
              AND COLUMN_NAME = 'purchase_transaction_id'
            `);
            
            if (columnCheck.length === 0) {
              await connection.execute(`
                ALTER TABLE payment_transactions 
                ADD COLUMN purchase_transaction_id INT NULL,
                ADD INDEX idx_purchase_transaction_id (purchase_transaction_id)
              `);
            }
          }

          // Generate receipt number
          const [receiptCount] = await connection.execute('SELECT COUNT(*) as count FROM payment_transactions');
          const receiptNumber = `REC-${Date.now()}-${receiptCount[0].count + 1}`;

          await connection.execute(
            `INSERT INTO payment_transactions 
             (party_type, party_id, purchase_transaction_id, amount, payment_date, previous_balance, updated_balance, receipt_number, created_by)
             VALUES (?, ?, ?, CURDATE(), ?, ?, ?, ?, ?)`,
            ['buyer', buyer_party_id, purchaseTransactionId, paidNow, currentBalance, newBalance, receiptNumber, req.user?.user_id || null]
          );
        }
      } else {
        // OLD STRUCTURE: Keep backward compatibility
        // This is the existing code path for systems not yet migrated
        for (const item of items) {
          const { item_id, product_code, brand, hsn_number, tax_rate, sale_rate, purchase_rate, quantity, alert_quantity, rack_number, remarks } = item;

          // Validate sale_rate >= purchase_rate
          const saleRateNum = parseFloat(sale_rate);
          const purchaseRateNum = parseFloat(purchase_rate);
          if (isNaN(saleRateNum) || isNaN(purchaseRateNum) || saleRateNum < purchaseRateNum) {
            await connection.rollback();
            return res.status(400).json({ error: `Sale rate must be greater than or equal to purchase rate for item: ${item.product_name || 'Unknown'}` });
          }

          if (item_id) {
            await connection.execute(
              'UPDATE items SET quantity = quantity + ?, product_code = ?, brand = ?, hsn_number = ?, tax_rate = ?, sale_rate = ?, purchase_rate = ?, alert_quantity = ?, rack_number = ?, remarks = ? WHERE id = ?',
              [quantity, product_code, brand, hsn_number, tax_rate, sale_rate, purchase_rate, alert_quantity, rack_number, remarks || null, item_id]
            );

            await connection.execute(
              'INSERT INTO purchase_transactions (buyer_party_id, item_id, quantity, purchase_rate, total_amount, transaction_date) VALUES (?, ?, ?, ?, ?, CURDATE())',
              [buyer_party_id, item_id, quantity, purchase_rate, purchase_rate * quantity]
            );
          } else {
            const [result] = await connection.execute(
              'INSERT INTO items (product_name, product_code, brand, hsn_number, tax_rate, sale_rate, purchase_rate, quantity, alert_quantity, rack_number, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [item.product_name, product_code, brand, hsn_number, tax_rate, sale_rate, purchase_rate, quantity, alert_quantity, rack_number, remarks || null]
            );

            await connection.execute(
              'INSERT INTO purchase_transactions (buyer_party_id, item_id, quantity, purchase_rate, total_amount, transaction_date) VALUES (?, ?, ?, ?, ?, CURDATE())',
              [buyer_party_id, result.insertId, quantity, purchase_rate, purchase_rate * quantity]
            );
          }

          const effectiveItemId = item_id || result.insertId;
          const [itemData] = await connection.execute('SELECT quantity, alert_quantity FROM items WHERE id = ? AND is_archived = FALSE', [effectiveItemId]);
          if (itemData[0] && itemData[0].quantity <= itemData[0].alert_quantity) {
            await connection.execute(
              'INSERT INTO order_sheet (item_id, required_quantity, current_quantity, status) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE required_quantity = ?, current_quantity = ?, status = ?',
              [effectiveItemId, itemData[0].alert_quantity, itemData[0].quantity, 'pending', itemData[0].alert_quantity, itemData[0].quantity, 'pending']
            );
          }
        }

        // Record payment (old structure)
        if (paidNow > 0) {
          const [paymentTableCheck] = await connection.execute(`
            SELECT COUNT(*) as count 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = 'payment_transactions'
          `);

          if (paymentTableCheck[0].count === 0) {
            await connection.execute(`
              CREATE TABLE payment_transactions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                party_type ENUM('buyer', 'seller') NOT NULL,
                party_id INT NOT NULL,
                amount DECIMAL(10,2) NOT NULL,
                payment_date DATE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_by INT,
                INDEX idx_party (party_type, party_id),
                INDEX idx_date (payment_date)
              )
            `);
          }

          await connection.execute(
            `INSERT INTO payment_transactions (party_type, party_id, amount, payment_date, created_by)
             VALUES (?, ?, ?, CURDATE(), ?)`,
            ['buyer', buyer_party_id, paidNow, req.user?.user_id || null]
          );
        }
      }

      // Update buyer party balance
      await connection.execute(
        'UPDATE buyer_parties SET balance_amount = ?, paid_amount = ? WHERE id = ?',
        [newBalance, currentPaidTotal + paidNow, buyer_party_id]
      );

      await connection.commit();
      res.json({ 
        message: 'Items added successfully',
        purchase_total: totalPurchaseAmount,
        paid_amount: paidNow,
        new_balance: newBalance,
        purchase_transaction_id: purchaseTransactionId || null,
        bill_number: billNumber || null
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Purchase items error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});
