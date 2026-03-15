const express = require('express');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { validateTransaction } = require('../middleware/validation');

const router = express.Router();

// Create sale transaction
router.post('/sale', authenticateToken, validateTransaction, async (req, res) => {
  try {
    const {
      seller_party_id,
      items,
      payment_status,
      paid_amount,
      with_gst = false,
      previous_balance_paid = 0,
      attendant_id = null,
      nozzle_id = null,
      due_date = null
    } = req.body;

    if (!seller_party_id || !items || items.length === 0) {
      return res.status(400).json({ error: 'Seller party and items are required' });
    }

    if (payment_status === 'partially_paid' && (!due_date || String(due_date).trim() === '')) {
      return res.status(400).json({ error: 'Due date is required for partial payment. Please set due date before proceeding.' });
    }

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Petrol/Diesel (product_code PETROL-001, DIESEL-001): quantity is optional (can be 0). Filter to only items with qty > 0 for processing.
      const itemIds = items.map(item => item.item_id);
      const [allItemData] = await connection.execute(
        `SELECT id, product_name, product_code, quantity, sale_rate, tax_rate, alert_quantity, updated_at 
         FROM items 
         WHERE id IN (${itemIds.map(() => '?').join(',')}) AND is_archived = FALSE`,
        itemIds
      );

      const itemDataMap = new Map(allItemData.map(item => [item.id, item]));

      // Validate: for Petrol/Diesel allow quantity >= 0; for others require quantity > 0
      for (const item of items) {
        const itemData = itemDataMap.get(item.item_id);
        if (!itemData) {
          throw new Error(`Item with id ${item.item_id} not found or has been archived`);
        }
        const qty = parseInt(item.quantity, 10) || 0;
        const isPetrolDiesel = itemData.product_code === 'PETROL-001' || itemData.product_code === 'DIESEL-001';
        if (isPetrolDiesel) {
          if (qty < 0) {
            throw new Error(`Quantity for ${itemData.product_name} cannot be negative`);
          }
        } else {
          if (qty <= 0) {
            throw new Error(`Quantity for "${itemData.product_name}" must be greater than 0`);
          }
        }
        if (itemData.quantity < qty) {
          throw new Error(`Insufficient stock for item ${itemData.product_name}. Available: ${itemData.quantity}, Requested: ${qty}`);
        }
      }

      // Exclude 0-quantity lines (Petrol/Diesel can have 0); require at least one line with qty > 0
      const itemsToProcess = items.filter(item => (parseInt(item.quantity, 10) || 0) > 0);
      if (itemsToProcess.length === 0) {
        throw new Error('At least one item must have quantity greater than 0');
      }

      const itemValidations = itemsToProcess.map(item => itemDataMap.get(item.item_id));

      let subtotal = 0;
      let totalTaxAmount = 0;
      const saleItems = [];

      // Calculate subtotal and process items (only items with qty > 0)
      for (let i = 0; i < itemsToProcess.length; i++) {
        const item = itemsToProcess[i];
        const itemData = itemValidations[i];

        const itemTotal = item.quantity * item.sale_rate;
        
        // Calculate item-wise discount
        let itemDiscount = 0;
        const itemDiscountType = item.discount_type || 'amount';
        if (itemDiscountType === 'percentage' && item.discount_percentage !== null && item.discount_percentage !== undefined) {
          itemDiscount = (itemTotal * item.discount_percentage) / 100;
        } else {
          itemDiscount = parseFloat(item.discount || 0);
        }
        
        // Ensure discount doesn't exceed item total
        itemDiscount = Math.min(itemDiscount, itemTotal);
        
        const itemTotalAfterDiscount = itemTotal - itemDiscount;
        let itemSubtotal = itemTotalAfterDiscount;
        let itemTax = 0;
        let taxableValue = itemTotalAfterDiscount;
        
        // Calculate tax if with_gst is true (GST-inclusive pricing)
        if (with_gst && itemData.tax_rate && itemData.tax_rate > 0) {
          // GST-inclusive: sale_rate includes GST after discount
          // Taxable value = Total / (1 + GST/100)
          taxableValue = itemTotalAfterDiscount / (1 + itemData.tax_rate / 100);
          itemTax = itemTotalAfterDiscount - taxableValue;
          itemSubtotal = taxableValue; // Subtotal is taxable value
          
          totalTaxAmount += itemTax;
          subtotal += taxableValue; // Accumulate taxable value for GST
        } else {
          subtotal += itemSubtotal; // Accumulate subtotal for non-GST
        }
        
        saleItems.push({ 
          ...item, 
          itemSubtotal,
          itemTotal,
          itemDiscount,
          itemTotalAfterDiscount,
          itemTax,
          taxableValue,
          tax_rate: itemData.tax_rate || 0
        });
      }

      // Calculate final total
      let totalAmount;
      if (with_gst) {
        // For GST-inclusive: total = taxable value + tax
        totalAmount = subtotal + totalTaxAmount;
      } else {
        // For non-GST: total = subtotal (after discounts)
        totalAmount = subtotal;
      }

      // Add previous balance amount being paid to total
      // If customer is paying ₹X of previous balance along with new invoice, grand total = invoice + X
      const previousBalancePaidAmount = parseFloat(previous_balance_paid) || 0;
      const grandTotal = totalAmount + previousBalancePaidAmount;
      
      // Calculate rounding: Round to nearest integer
      const roundedOff = Math.round(grandTotal) - grandTotal;
      const finalGrandTotal = Math.round(grandTotal); // Rounded grand total for all calculations
      
      // Also round the sale amount (without previous balance) for consistency
      const roundedSaleAmount = Math.round(totalAmount);

      // Generate bill number
      const [billCount] = await connection.execute('SELECT COUNT(*) as count FROM sale_transactions');
      const billNumber = `BILL-${Date.now()}-${billCount[0].count + 1}`;

      // Calculate balance and validate paid amount
      // finalPaidAmount is the TOTAL payment made today (could cover previous balance + new sale)
      // Use rounded grand total for payment validation
      const finalPaidAmount = payment_status === 'fully_paid' ? finalGrandTotal : (parseFloat(paid_amount) || 0);
      
      // Validate paid amount doesn't exceed rounded grand total
      if (finalPaidAmount > finalGrandTotal) {
        throw new Error(`Paid amount (₹${finalPaidAmount.toFixed(2)}) cannot exceed grand total (₹${finalGrandTotal.toFixed(2)})`);
      }
      
      if (finalPaidAmount < 0) {
        throw new Error('Paid amount cannot be negative');
      }
      
      // Calculate how payment is allocated:
      // - First, payment goes towards previous balance (up to previousBalancePaidAmount)
      // - Remaining payment goes towards new sale
      const actualPreviousBalancePaid = Math.min(finalPaidAmount, previousBalancePaidAmount);
      const amountPaidTowardsNewInvoice = Math.max(0, finalPaidAmount - actualPreviousBalancePaid);
      
      // Calculate balance amount using rounded grand total (for transaction record - includes previous balance in grand total)
      const balanceAmount = Math.max(0, finalGrandTotal - finalPaidAmount);
      
      // Calculate new transaction balance using rounded sale amount (for seller balance update - excludes previous balance payment)
      // This is the amount owed from this new transaction only
      // Formula: newTransactionBalance = roundedSaleAmount - amountPaidTowardsNewInvoice
      const newTransactionBalance = Math.max(0, roundedSaleAmount - amountPaidTowardsNewInvoice);

      // Create sale transaction
      // Check if previous_balance_paid column exists
      const [columns] = await connection.execute(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'sale_transactions' 
        AND COLUMN_NAME = 'previous_balance_paid'
      `);
      
      const hasPreviousBalancePaid = columns.length > 0;
      
      let insertQuery, insertValues;
      if (hasPreviousBalancePaid) {
        // Store rounded grand total in database
        insertQuery = `INSERT INTO sale_transactions (seller_party_id, attendant_id, nozzle_id, transaction_date, subtotal, discount, tax_amount, total_amount, paid_amount, balance_amount, payment_status, bill_number, with_gst, previous_balance_paid)
         VALUES (?, ?, ?, CURDATE(), ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`;
        insertValues = [seller_party_id, attendant_id, nozzle_id, subtotal, totalTaxAmount, finalGrandTotal, finalPaidAmount, balanceAmount, payment_status, billNumber, with_gst ? 1 : 0, previousBalancePaidAmount];
      } else {
        // Fallback if column doesn't exist
        // Store rounded grand total in database
        insertQuery = `INSERT INTO sale_transactions (seller_party_id, attendant_id, nozzle_id, transaction_date, subtotal, discount, tax_amount, total_amount, paid_amount, balance_amount, payment_status, bill_number, with_gst)
         VALUES (?, ?, ?, CURDATE(), ?, 0, ?, ?, ?, ?, ?, ?, ?)`;
        insertValues = [seller_party_id, attendant_id, nozzle_id, subtotal, totalTaxAmount, finalGrandTotal, finalPaidAmount, balanceAmount, payment_status, billNumber, with_gst ? 1 : 0];
        console.warn('Warning: previous_balance_paid column does not exist. Please run the migration: server/database/add_previous_balance_paid.sql');
      }
      
      const [saleResult] = await connection.execute(insertQuery, insertValues);

      const saleTransactionId = saleResult.insertId;

      // Create sale items and update stock - OPTIMIZED: Reduced queries per item
      const saleItemInserts = [];
      const itemUpdates = [];
      const orderSheetUpdates = [];
      
      for (const item of saleItems) {
        const itemData = itemValidations.find(v => v.id === item.item_id);
        const updatedAt = itemData?.updated_at || new Date();
        const newQuantity = itemData.quantity - item.quantity;
        
        // Prepare sale item insert
        saleItemInserts.push([
          saleTransactionId, 
          item.item_id, 
          item.quantity, 
          item.sale_rate, 
          item.itemSubtotal, 
          item.itemDiscount || 0, 
          item.discount_type || 'amount', 
          item.discount_percentage || null
        ]);
        
        // Prepare item quantity update (preserve updated_at)
        itemUpdates.push({
          item_id: item.item_id,
          quantity: item.quantity,
          updated_at: updatedAt
        });
        
        // Check if quantity will reach alert quantity after update
        if (newQuantity <= (itemData.alert_quantity || 0)) {
          orderSheetUpdates.push({
            item_id: item.item_id,
            required_quantity: (itemData.alert_quantity || 0) - newQuantity,
            current_quantity: newQuantity
          });
        }
      }
      
      // Batch insert all sale items
      if (saleItemInserts.length > 0) {
        const placeholders = saleItemInserts.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
        const values = saleItemInserts.flat();
        await connection.execute(
          `INSERT INTO sale_items (sale_transaction_id, item_id, quantity, sale_rate, total_amount, discount, discount_type, discount_percentage) VALUES ${placeholders}`,
          values
        );
      }
      
      // Update item quantities (preserve updated_at) - still need individual updates for updated_at preservation
      for (const update of itemUpdates) {
        await connection.execute(
          'UPDATE items SET quantity = quantity - ?, updated_at = ? WHERE id = ? AND is_archived = FALSE',
          [update.quantity, update.updated_at, update.item_id]
        );
      }
      
      // Batch insert/update order sheet entries
      for (const orderUpdate of orderSheetUpdates) {
        await connection.execute(
          'INSERT INTO order_sheet (item_id, required_quantity, current_quantity, status) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE required_quantity = ?, current_quantity = ?, status = ?',
          [orderUpdate.item_id, orderUpdate.required_quantity, orderUpdate.current_quantity, 'pending', orderUpdate.required_quantity, orderUpdate.current_quantity, 'pending']
        );
      }

      // Get current seller balance before update (for unified_transactions)
      const [sellerBeforeUpdate] = await connection.execute(
        'SELECT balance_amount FROM seller_parties WHERE id = ?',
        [seller_party_id]
      );
      const balanceBeforeSale = parseFloat(sellerBeforeUpdate[0]?.balance_amount || 0);

      // Update seller party balance and optionally due_date (for partial payment)
      // Logic: 
      // 1. Subtract the actual previous balance that was paid (reduces what they owe from old transactions)
      // 2. Add the new balance from this transaction (what they owe from this transaction)
      // Formula: new_balance = old_balance - actual_previous_balance_paid + new_transaction_balance
      const dueDateVal = due_date && String(due_date).trim() ? String(due_date).trim() : null;
      if (payment_status === 'partially_paid' && dueDateVal) {
        await connection.execute(
          'UPDATE seller_parties SET balance_amount = balance_amount - ? + ?, paid_amount = paid_amount + ?, due_date = ? WHERE id = ?',
          [actualPreviousBalancePaid, newTransactionBalance, finalPaidAmount, dueDateVal, seller_party_id]
        );
      } else {
        await connection.execute(
          'UPDATE seller_parties SET balance_amount = balance_amount - ? + ?, paid_amount = paid_amount + ? WHERE id = ?',
          [actualPreviousBalancePaid, newTransactionBalance, finalPaidAmount, seller_party_id]
        );
      }

      // Insert into unified_transactions table (if it exists)
      try {
        const [unifiedTableCheck] = await connection.execute(`
          SELECT COUNT(*) as count 
          FROM INFORMATION_SCHEMA.TABLES 
          WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'unified_transactions'
        `);
        
        if (unifiedTableCheck[0].count > 0) {
          // Calculate balance after sale using rounded values
          // Formula: new_balance = old_balance - actual_previous_balance_paid + new_transaction_balance
          // where new_transaction_balance = roundedSaleAmount - amountPaidTowardsNewInvoice
          const balanceAfterSale = balanceBeforeSale - actualPreviousBalancePaid + newTransactionBalance;
          
          // Create ONLY ONE sale transaction entry
          // This represents the entire sale transaction, even if previous balance was paid
          // Use rounded values for consistency
          await connection.execute(
            `INSERT INTO unified_transactions (
              party_type, party_id, transaction_type, transaction_date,
              previous_balance, transaction_amount, paid_amount, balance_after,
              reference_id, bill_number, payment_status, created_by
            ) VALUES (?, ?, ?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              'seller',
              seller_party_id,
              'sale', // Type is 'sale' for all sales
              balanceBeforeSale, // Balance before this transaction (before any payments)
              roundedSaleAmount, // Transaction amount: ROUNDED sale amount (sum of all items, rounded)
              finalPaidAmount, // Total payment made in this transaction (includes payment for previous balance + new sale)
              balanceAfterSale, // Balance after: old_balance - actual_previous_balance_paid + new_transaction_balance (using rounded values)
              saleTransactionId,
              billNumber,
              payment_status,
              (req.user?.id ? parseInt(req.user.id) : null)
            ]
          );
          console.log(`[INFO] Sale transaction inserted into unified_transactions (SINGLE RECORD):`);
          console.log(`  - Sale Amount (Original): ${totalAmount}`);
          console.log(`  - Sale Amount (Rounded): ${roundedSaleAmount}`);
          console.log(`  - Rounding Applied: ${roundedOff}`);
          console.log(`  - Previous Balance: ${balanceBeforeSale}`);
          console.log(`  - Total Payment Today: ${finalPaidAmount}`);
          console.log(`  - Actual Previous Balance Paid: ${actualPreviousBalancePaid}`);
          console.log(`  - Paid Towards New Sale: ${amountPaidTowardsNewInvoice}`);
          console.log(`  - Paid Amount (Total): ${finalPaidAmount}`);
          console.log(`  - New Transaction Balance: ${newTransactionBalance}`);
          console.log(`  - Balance After: ${balanceAfterSale}`);
        }
      } catch (unifiedError) {
        console.warn('Could not insert into unified_transactions:', unifiedError.message);
        // Don't fail the transaction if unified_transactions doesn't exist
      }

      await connection.commit();

      // Get complete transaction details
      const [transaction] = await connection.execute(
        `SELECT st.*, sp.party_name, sp.mobile_number, sp.address 
         FROM sale_transactions st 
         JOIN seller_parties sp ON st.seller_party_id = sp.id 
         WHERE st.id = ?`,
        [saleTransactionId]
      );

      const [itemsData] = await connection.execute(
        `SELECT si.*, i.product_name, i.brand, i.hsn_number 
         FROM sale_items si 
         JOIN items i ON si.item_id = i.id 
         WHERE si.sale_transaction_id = ?`,
        [saleTransactionId]
      );

      // Get updated seller party info to return
      const [updatedSeller] = await connection.execute(
        'SELECT * FROM seller_parties WHERE id = ?',
        [seller_party_id]
      );

      res.json({
        message: 'Sale transaction created successfully',
        transaction: {
          ...transaction[0],
          items: itemsData
        },
        seller: updatedSeller[0] || null
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Create sale error:', error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
});

// Create return transaction (supports both buyer and seller parties, multiple items)
// Creates cumulative return transactions - all items combined into one transaction with bill number
router.post('/return', authenticateToken, async (req, res) => {
  try {
    const { seller_party_id, buyer_party_id, items, reason, party_type, return_type } = req.body;

    // Support both old format (single item) and new format (array of items)
    let itemsArray = [];
    if (items && Array.isArray(items) && items.length > 0) {
      // New format: array of items
      itemsArray = items;
    } else if (req.body.item_id && req.body.quantity) {
      // Old format: single item (backward compatibility)
      itemsArray = [{
        item_id: req.body.item_id,
        quantity: req.body.quantity,
        return_amount: req.body.return_amount || 0
      }];
    } else {
      return res.status(400).json({ error: 'Items array or item_id/quantity is required' });
    }

    // Validate that either seller or buyer party is provided
    if (!seller_party_id && !buyer_party_id) {
      return res.status(400).json({ error: 'Party (buyer or seller) is required' });
    }

    // Determine party type and ID
    const finalPartyType = party_type || (seller_party_id ? 'seller' : 'buyer');
    const finalPartyId = seller_party_id || buyer_party_id;

    if (!finalPartyId) {
      return res.status(400).json({ error: 'Either seller_party_id or buyer_party_id must be provided' });
    }

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Check if new cumulative structure exists (return_items table)
      const [tableCheck] = await connection.execute(`
        SELECT COUNT(*) as count 
        FROM INFORMATION_SCHEMA.TABLES 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'return_items'
      `);
      const hasNewStructure = tableCheck[0].count > 0;

      // Validate all items first
      const itemIds = itemsArray.map(item => {
        if (!item.item_id || !item.quantity || item.quantity <= 0) {
          throw new Error('Valid item_id and quantity are required for all items');
        }
        return parseInt(item.item_id);
      });

      // Batch fetch all item details in single query
      const placeholders = itemIds.map(() => '?').join(', ');
      const [allItemDetails] = await connection.execute(
        `SELECT id, quantity, purchase_rate, sale_rate, product_name, brand, hsn_number, tax_rate, updated_at 
         FROM items 
         WHERE id IN (${placeholders}) AND is_archived = FALSE`,
        itemIds
      );

      if (allItemDetails.length !== itemIds.length) {
        const foundIds = allItemDetails.map(item => item.id);
        const missingIds = itemIds.filter(id => !foundIds.includes(id));
        throw new Error(`Items not found: ${missingIds.join(', ')}`);
      }

      // Create a map for quick lookup
      const itemMap = new Map();
      allItemDetails.forEach(item => {
        itemMap.set(item.id, item);
      });

      let totalReturnAmount = 0;
      const returnItems = [];
      const itemIdsToCheck = [];
      const buyerReturnUpdates = []; // { id, qty, updated_at }
      const sellerReturnUpdates = []; // { id, qty, updated_at }

      // Process each item and calculate totals
      for (const itemData of itemsArray) {
        const { item_id, quantity, return_amount, discount, discount_type, discount_percentage } = itemData;
        const itemId = parseInt(item_id);
        const qty = parseInt(quantity);

        const itemDetails = itemMap.get(itemId);
        if (!itemDetails) {
          throw new Error(`Item with id ${item_id} not found`);
        }

        const currentQuantity = itemDetails.quantity;
        const purchaseRate = itemDetails.purchase_rate || 0;
        const saleRate = itemDetails.sale_rate || 0;
        const updatedAt = itemDetails.updated_at;

        // Calculate item total and discount
        const baseRate = finalPartyType === 'buyer' ? purchaseRate : saleRate;
        const itemTotal = baseRate * qty;
        let itemDiscount = 0;
        const itemDiscountType = discount_type || 'amount';
        
        if (itemDiscountType === 'percentage' && discount_percentage !== null && discount_percentage !== undefined) {
          itemDiscount = (itemTotal * discount_percentage) / 100;
        } else {
          itemDiscount = parseFloat(discount || 0);
        }
        
        // Ensure discount doesn't exceed item total
        itemDiscount = Math.min(itemDiscount, itemTotal);
        const itemTotalAfterDiscount = itemTotal - itemDiscount;

        // For buyer returns: subtract from stock
        if (finalPartyType === 'buyer') {
          if (currentQuantity < qty) {
            throw new Error(`Insufficient stock for item ${item_id}. Available: ${currentQuantity}, Requested: ${qty}`);
          }
          
          buyerReturnUpdates.push({ id: itemId, qty: qty, updated_at: updatedAt });

          // Calculate return amount
          const calculatedReturnAmount = return_amount !== undefined && return_amount !== null
            ? return_amount
            : itemTotalAfterDiscount;
          totalReturnAmount += calculatedReturnAmount;

          // Store item data for cumulative transaction
          returnItems.push({
            item_id: itemId,
            quantity: qty,
            return_rate: purchaseRate,
            total_amount: calculatedReturnAmount,
            discount: itemDiscount,
            discount_type: itemDiscountType,
            discount_percentage: discount_percentage || null,
            itemDetails: {
              quantity: currentQuantity,
              purchase_rate: purchaseRate,
              sale_rate: saleRate,
              product_name: itemDetails.product_name,
              brand: itemDetails.brand,
              hsn_number: itemDetails.hsn_number,
              tax_rate: itemDetails.tax_rate
            }
          });
        } else {
          sellerReturnUpdates.push({ id: itemId, qty: qty, updated_at: updatedAt });

          // Calculate return amount
          const calculatedReturnAmount = return_amount !== undefined && return_amount !== null 
            ? return_amount 
            : itemTotalAfterDiscount;
          totalReturnAmount += calculatedReturnAmount;

          // Store item data for cumulative transaction
          returnItems.push({
            item_id: itemId,
            quantity: qty,
            return_rate: saleRate,
            total_amount: calculatedReturnAmount,
            discount: itemDiscount,
            discount_type: itemDiscountType,
            discount_percentage: discount_percentage || null,
            itemDetails: {
              quantity: currentQuantity,
              purchase_rate: purchaseRate,
              sale_rate: saleRate,
              product_name: itemDetails.product_name,
              brand: itemDetails.brand,
              hsn_number: itemDetails.hsn_number,
              tax_rate: itemDetails.tax_rate
            }
          });
        }

        itemIdsToCheck.push(itemId);
      }

      // Batch update item quantities (buyer returns: subtract)
      if (buyerReturnUpdates.length > 0) {
        const unionSql = buyerReturnUpdates.map(() => 'SELECT ? AS id, ? AS qty, ? AS updated_at').join(' UNION ALL ');
        const updateSql = `
          UPDATE items i
          JOIN (${unionSql}) v ON i.id = v.id
          SET i.quantity = i.quantity - v.qty, i.updated_at = v.updated_at
          WHERE i.is_archived = FALSE
        `;
        const params = buyerReturnUpdates.flatMap(u => [u.id, u.qty, u.updated_at]);
        await connection.execute(updateSql, params);
      }

      // Batch update item quantities (seller returns: add)
      if (sellerReturnUpdates.length > 0) {
        const unionSql = sellerReturnUpdates.map(() => 'SELECT ? AS id, ? AS qty, ? AS updated_at').join(' UNION ALL ');
        const updateSql = `
          UPDATE items i
          JOIN (${unionSql}) v ON i.id = v.id
          SET i.quantity = i.quantity + v.qty, i.updated_at = v.updated_at
          WHERE i.is_archived = FALSE
        `;
        const params = sellerReturnUpdates.flatMap(u => [u.id, u.qty, u.updated_at]);
        await connection.execute(updateSql, params);
      }

      // Generate bill number only for seller returns (buyer returns don't need bills)
      let billNumber = null;
      if (finalPartyType === 'seller') {
        const [billCount] = await connection.execute('SELECT COUNT(*) as count FROM return_transactions WHERE seller_party_id IS NOT NULL');
        billNumber = `RET-${Date.now()}-${billCount[0].count + 1}`;
      }

      let returnTransactionId;

      if (hasNewStructure) {
        // New cumulative structure: Create one return_transactions header and multiple return_items
        const [returnResult] = await connection.execute(
          `INSERT INTO return_transactions (seller_party_id, buyer_party_id, party_type, return_date, total_amount, bill_number, reason, return_type)
           VALUES (?, ?, ?, CURDATE(), ?, ?, ?, ?)`,
          [
            seller_party_id || null,
            buyer_party_id || null,
            finalPartyType,
            totalReturnAmount,
            billNumber, // NULL for buyer returns
            reason || (finalPartyType === 'buyer' ? 'Buyer return' : 'Return from seller'),
            return_type || 'adjust'
          ]
        );
        returnTransactionId = returnResult.insertId;

        // Batch insert return items
        if (returnItems.length > 0) {
          const valuesSql = returnItems.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
          const insertSql = `
            INSERT INTO return_items (return_transaction_id, item_id, quantity, return_rate, total_amount, discount, discount_type, discount_percentage)
            VALUES ${valuesSql}
          `;
          const params = returnItems.flatMap(ri => [
            returnTransactionId,
            ri.item_id,
            ri.quantity,
            ri.return_rate,
            ri.total_amount,
            ri.discount || 0,
            ri.discount_type || 'amount',
            ri.discount_percentage
          ]);
          await connection.execute(insertSql, params);
        }
      } else {
        // Old structure: Create individual return_transactions for each item (backward compatibility)
        for (const returnItem of returnItems) {
          const [discountColumns] = await connection.execute(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = 'return_transactions' 
            AND COLUMN_NAME IN ('discount', 'discount_type', 'discount_percentage')
          `);
          const hasDiscountColumns = discountColumns.length > 0;

          if (hasDiscountColumns) {
            await connection.execute(
              `INSERT INTO return_transactions (seller_party_id, buyer_party_id, party_type, item_id, quantity, return_amount, discount, discount_type, discount_percentage, return_date, reason)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), ?)`,
              [
                seller_party_id || null,
                buyer_party_id || null,
                finalPartyType,
                returnItem.item_id,
                returnItem.quantity,
                returnItem.total_amount,
                returnItem.discount || 0,
                returnItem.discount_type || 'amount',
                returnItem.discount_percentage,
                reason || (finalPartyType === 'buyer' ? 'Buyer return' : 'Return from seller')
              ]
            );
          } else {
            await connection.execute(
              `INSERT INTO return_transactions (seller_party_id, buyer_party_id, party_type, item_id, quantity, return_amount, return_date, reason)
               VALUES (?, ?, ?, ?, ?, ?, CURDATE(), ?)`,
              [
                seller_party_id || null,
                buyer_party_id || null,
                finalPartyType,
                returnItem.item_id,
                returnItem.quantity,
                returnItem.total_amount,
                reason || (finalPartyType === 'buyer' ? 'Buyer return' : 'Return from seller')
              ]
            );
          }
        }
      }

      // Batch check if quantities are now above alert quantity and remove from order sheet
      if (itemIdsToCheck.length > 0) {
        const checkPlaceholders = itemIdsToCheck.map(() => '?').join(', ');
        const [updatedItems] = await connection.execute(
          `SELECT id, quantity, alert_quantity 
           FROM items 
           WHERE id IN (${checkPlaceholders}) AND is_archived = FALSE`,
          itemIdsToCheck
        );
        
        const itemsToRemove = updatedItems.filter(item => item.quantity > item.alert_quantity);
        if (itemsToRemove.length > 0) {
          const removePlaceholders = itemsToRemove.map(() => '?').join(', ');
          const removeIds = itemsToRemove.map(item => item.id);
          await connection.execute(
            `DELETE FROM order_sheet 
             WHERE item_id IN (${removePlaceholders}) AND status = ?`,
            [...removeIds, 'pending']
          );
        }
      }

      // Get current balance before updating (only if we're adjusting balance)
      let currentBalance = 0;
      let cashPaymentRequired = 0;
      let adjustmentAmount = 0;
      let requiresCashPayment = false;
      
      if (return_type === 'adjust' && totalReturnAmount > 0) {
        if (finalPartyType === 'seller') {
          const [seller] = await connection.execute(
            'SELECT balance_amount FROM seller_parties WHERE id = ?',
            [finalPartyId]
          );
          currentBalance = parseFloat(seller[0]?.balance_amount || 0);
          
          // Check if return amount exceeds current balance
          if (totalReturnAmount > currentBalance) {
            requiresCashPayment = true;
            adjustmentAmount = currentBalance; // Only this much can be adjusted
            cashPaymentRequired = totalReturnAmount - currentBalance; // This much needs to be paid in cash
          } else {
            adjustmentAmount = totalReturnAmount; // Full amount can be adjusted
            cashPaymentRequired = 0;
          }
          
          // Seller return: Subtract from seller balance (seller owes us less)
          // When seller returns items, we reduce what they owe us
          // But we can only reduce up to current balance, rest needs cash payment
          await connection.execute(
            'UPDATE seller_parties SET balance_amount = GREATEST(0, balance_amount - ?) WHERE id = ?',
            [Math.min(totalReturnAmount, currentBalance), finalPartyId]
          );
        } else if (finalPartyType === 'buyer') {
          const [buyer] = await connection.execute(
            'SELECT balance_amount FROM buyer_parties WHERE id = ?',
            [finalPartyId]
          );
          currentBalance = parseFloat(buyer[0]?.balance_amount || 0);
          
          // Check if return amount exceeds current balance
          if (totalReturnAmount > currentBalance) {
            requiresCashPayment = true;
            adjustmentAmount = currentBalance; // Only this much can be adjusted
            cashPaymentRequired = totalReturnAmount - currentBalance; // This much needs to be paid in cash
          } else {
            adjustmentAmount = totalReturnAmount; // Full amount can be adjusted
            cashPaymentRequired = 0;
          }
          
          // Buyer return: Subtract from buyer balance (we owe buyer less)
          // When buyer returns items, we reduce what we owe them
          await connection.execute(
            'UPDATE buyer_parties SET balance_amount = GREATEST(0, balance_amount - ?) WHERE id = ?',
            [Math.min(totalReturnAmount, currentBalance), finalPartyId]
          );
        }
      } else if (totalReturnAmount > 0) {
        // Even if not adjusting, get balance for unified_transactions record
        if (finalPartyType === 'seller') {
          const [seller] = await connection.execute(
            'SELECT balance_amount FROM seller_parties WHERE id = ?',
            [finalPartyId]
          );
          currentBalance = parseFloat(seller[0]?.balance_amount || 0);
        } else if (finalPartyType === 'buyer') {
          const [buyer] = await connection.execute(
            'SELECT balance_amount FROM buyer_parties WHERE id = ?',
            [finalPartyId]
          );
          currentBalance = parseFloat(buyer[0]?.balance_amount || 0);
        }
      }
      
      // Ensure all numeric values are properly parsed
      currentBalance = parseFloat(currentBalance) || 0;
      totalReturnAmount = parseFloat(totalReturnAmount) || 0;
      cashPaymentRequired = parseFloat(cashPaymentRequired) || 0;
      adjustmentAmount = parseFloat(adjustmentAmount) || 0;

      // Insert into unified_transactions table (if it exists)
      try {
        const [unifiedTableCheck] = await connection.execute(`
          SELECT COUNT(*) as count 
          FROM INFORMATION_SCHEMA.TABLES 
          WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'unified_transactions'
        `);
        
        if (unifiedTableCheck[0].count > 0 && totalReturnAmount > 0) {
          // Calculate balance after return
          const balanceAfter = return_type === 'adjust' 
            ? Math.max(0, currentBalance - totalReturnAmount)
            : currentBalance;
          
          // Get return transaction ID (for new structure, we have it; for old structure, get the last one)
          let refReturnTransactionId = null;
          if (hasNewStructure && returnTransactionId) {
            refReturnTransactionId = returnTransactionId;
          } else {
            // For old structure, get the last inserted return transaction ID
            const [lastReturn] = await connection.execute(
              `SELECT id FROM return_transactions 
               WHERE ${finalPartyType === 'seller' ? 'seller_party_id' : 'buyer_party_id'} = ? 
               ORDER BY id DESC LIMIT 1`,
              [finalPartyId]
            );
            if (lastReturn[0]) {
              refReturnTransactionId = lastReturn[0].id;
            }
          }
          
          await connection.execute(
            `INSERT INTO unified_transactions (
              party_type, party_id, transaction_type, transaction_date,
              previous_balance, transaction_amount, paid_amount, balance_after,
              reference_id, bill_number, payment_status, notes, created_by
            ) VALUES (?, ?, ?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              finalPartyType,
              finalPartyId,
              'return',
              currentBalance, // Balance before return
              totalReturnAmount, // Transaction amount (return reduces balance)
              return_type === 'adjust' ? totalReturnAmount : 0, // If adjust, treat as payment
              balanceAfter, // Balance after return
              refReturnTransactionId,
              billNumber || null,
              return_type === 'adjust' ? 'fully_paid' : null,
              reason || null,
              (req.user?.id ? parseInt(req.user.id) : null)
            ]
          );
          console.log(`[INFO] Return transaction inserted into unified_transactions: ${finalPartyType} ${finalPartyId}, Amount: ${totalReturnAmount}`);
        }
      } catch (unifiedError) {
        console.warn('[WARN] Failed to insert return into unified_transactions:', unifiedError.message);
        // Don't fail the transaction if unified_transactions doesn't exist
      }

      await connection.commit();
      res.json({ 
        message: 'Return transaction created successfully', 
        items_processed: itemsArray.length,
        bill_number: hasNewStructure ? billNumber : null,
        return_transaction_id: hasNewStructure ? returnTransactionId : null,
        total_amount: totalReturnAmount,
        // Warning information for returns exceeding balance
        warning: requiresCashPayment ? {
          requires_cash_payment: true,
          return_amount: totalReturnAmount,
          current_balance: currentBalance,
          adjustment_amount: adjustmentAmount,
          cash_payment_required: cashPaymentRequired,
          message: `Return amount (₹${totalReturnAmount.toFixed(2)}) exceeds current balance (₹${currentBalance.toFixed(2)}). You need to pay ₹${cashPaymentRequired.toFixed(2)} in cash to the ${finalPartyType === 'seller' ? 'seller' : 'buyer'}, and ₹${adjustmentAmount.toFixed(2)} will be adjusted in the account.`
        } : null
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Create return error:', error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
});

// Get sale transactions
router.get('/sales', authenticateToken, async (req, res) => {
  try {
    const { from_date, to_date, seller_party_id } = req.query;
    
    let query = `SELECT st.*, sp.party_name 
                 FROM sale_transactions st 
                 JOIN seller_parties sp ON st.seller_party_id = sp.id 
                 WHERE 1=1`;
    const params = [];

    if (from_date) {
      query += ' AND st.transaction_date >= ?';
      params.push(from_date);
    }
    if (to_date) {
      query += ' AND st.transaction_date <= ?';
      params.push(to_date);
    }
    if (seller_party_id) {
      query += ' AND st.seller_party_id = ?';
      params.push(seller_party_id);
    }

    query += ' ORDER BY st.transaction_date DESC, st.id DESC';

    const [transactions] = await pool.execute(query, params);
    res.json({ transactions });
  } catch (error) {
    console.error('Get sales error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get return transactions (supports both buyer and seller)
router.get('/returns',  authenticateToken, async (req, res) => {
  try {
    const { from_date, to_date, seller_party_id, buyer_party_id, party_type } = req.query;
    
    let query = `SELECT 
      rt.*, 
      COALESCE(sp.party_name, bp.party_name) as party_name,
      rt.party_type,
      i.product_name, 
      i.brand 
    FROM return_transactions rt 
    LEFT JOIN seller_parties sp ON rt.seller_party_id = sp.id 
    LEFT JOIN buyer_parties bp ON rt.buyer_party_id = bp.id
    JOIN items i ON rt.item_id = i.id 
    WHERE 1=1`;
    const params = [];

    if (from_date) {
      query += ' AND rt.return_date >= ?';
      params.push(from_date);
    }
    if (to_date) {
      query += ' AND rt.return_date <= ?';
      params.push(to_date);
    }
    if (seller_party_id) {
      query += ' AND rt.seller_party_id = ?';
      params.push(seller_party_id);
    }
    if (buyer_party_id) {
      query += ' AND rt.buyer_party_id = ?';
      params.push(buyer_party_id);
    }
    if (party_type) {
      query += ' AND rt.party_type = ?';
      params.push(party_type);
    }

    query += ' ORDER BY rt.return_date DESC, rt.id DESC';

    const [transactions] = await pool.execute(query, params);
    res.json({ transactions });
  } catch (error) {
    console.error('Get returns error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single sale transaction with items
router.get('/sales/:id', authenticateToken, async (req, res) => {
  try {
    const [transactions] = await pool.execute(
      `SELECT st.*, sp.party_name, sp.mobile_number, sp.address, sp.email 
       FROM sale_transactions st 
       JOIN seller_parties sp ON st.seller_party_id = sp.id 
       WHERE st.id = ?`,
      [req.params.id]
    );

    if (transactions.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const [items] = await pool.execute(
      `SELECT si.*, i.product_name, i.brand, i.hsn_number 
       FROM sale_items si 
       JOIN items i ON si.item_id = i.id 
       WHERE si.sale_transaction_id = ?`,
      [req.params.id]
    );

    res.json({
      transaction: {
        ...transactions[0],
        items
      }
    });
  } catch (error) {
    console.error('Get sale transaction error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;


