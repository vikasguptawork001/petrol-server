// Improved Transaction Display Query - Using Header-Detail Structure
// This is the improved version of the /parties/buyers/:id/transactions endpoint
// Copy this logic to replace the existing query in server/routes/parties.js

// Get buyer party transaction history - IMPROVED VERSION
router.get('/buyers/:id/transactions', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 20;
    const offset = (pageNum - 1) * limitNum;

    // Verify party exists and get balance
    const [partyCheck] = await pool.execute('SELECT id, balance_amount FROM buyer_parties WHERE id = ?', [id]);
    if (partyCheck.length === 0) {
      return res.status(404).json({ error: 'Buyer party not found' });
    }
    const party = partyCheck[0];

    // Check if new structure exists
    const [tableCheck] = await pool.execute(`
      SELECT COUNT(*) as count 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'purchase_items'
    `);
    const hasNewStructure = tableCheck[0].count > 0;

    let purchases = [];

    if (hasNewStructure) {
      // NEW STRUCTURE: Use header-detail pattern
      const [purchaseRows] = await pool.execute(
        `SELECT 
          pt.id,
          pt.transaction_date as date,
          pt.total_amount_new as amount,
          pt.paid_amount,
          pt.balance_amount,
          pt.payment_status,
          pt.bill_number,
          pt.created_at,
          COUNT(DISTINCT pi.id) as item_count,
          GROUP_CONCAT(DISTINCT CONCAT(i.product_name, ' (', pi.quantity, ')') ORDER BY pi.id SEPARATOR ', ') as items_summary,
          'purchase' as type,
          CONCAT('Purchase - ', COUNT(DISTINCT pi.id), ' item(s)') as description
        FROM purchase_transactions pt
        LEFT JOIN purchase_items pi ON pt.id = pi.purchase_transaction_id
        LEFT JOIN items i ON pi.item_id = i.id
        WHERE pt.buyer_party_id = ?
          AND pt.total_amount_new > 0  -- Only new structure records
        GROUP BY pt.id, pt.transaction_date, pt.total_amount_new, pt.paid_amount, pt.balance_amount, pt.payment_status, pt.bill_number, pt.created_at
        ORDER BY pt.transaction_date DESC, pt.created_at DESC
        LIMIT ${limitNum} OFFSET ${offset}`,
        [id]
      );
      purchases = purchaseRows;
    } else {
      // OLD STRUCTURE: Group by time window (backward compatibility)
      const [purchaseRows] = await pool.execute(
        `SELECT 
          MIN(pt.id) as id,
          pt.transaction_date as date,
          SUM(pt.total_amount) as amount,
          'purchase' as type,
          CONCAT('Purchase - ', COUNT(DISTINCT pt.id), ' item(s)') as description,
          CONCAT('PUR-', DATE_FORMAT(pt.transaction_date, '%Y%m%d'), '-', MIN(pt.id)) as bill_number,
          COALESCE(SUM(pay.amount), 0) as paid_amount,
          NULL as balance_amount,
          CASE 
            WHEN COALESCE(SUM(pay.amount), 0) >= SUM(pt.total_amount) THEN 'fully_paid'
            WHEN COALESCE(SUM(pay.amount), 0) > 0 THEN 'partially_paid'
            ELSE 'unpaid'
          END as payment_status,
          MIN(pt.created_at) as created_at,
          COUNT(DISTINCT pt.id) as item_count,
          GROUP_CONCAT(DISTINCT CONCAT(i.product_name, ' (', pt.quantity, ')') ORDER BY pt.id SEPARATOR ', ') as items_summary,
          MIN(pt.created_at) as purchase_timestamp
        FROM purchase_transactions pt
        JOIN items i ON pt.item_id = i.id
        LEFT JOIN payment_transactions pay ON 
          pay.party_type = 'buyer' 
          AND pay.party_id = pt.buyer_party_id
          AND ABS(TIMESTAMPDIFF(SECOND, pt.created_at, pay.created_at)) <= 5
          AND pay.payment_date = pt.transaction_date
        WHERE pt.buyer_party_id = ?
          AND pt.total_amount_new IS NULL OR pt.total_amount_new = 0  -- Only old structure records
        GROUP BY 
          pt.transaction_date, 
          pt.buyer_party_id,
          FLOOR(UNIX_TIMESTAMP(pt.created_at) / 5)
        ORDER BY pt.transaction_date DESC, MIN(pt.created_at) DESC
        LIMIT ${limitNum} OFFSET ${offset}`,
        [id]
      );
      purchases = purchaseRows;
    }

    // Get return transactions (same as before)
    let returns = [];
    try {
      const [tableCheck] = await pool.execute(`
        SELECT COUNT(*) as count 
        FROM INFORMATION_SCHEMA.TABLES 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'return_items'
      `);
      const hasNewReturnStructure = tableCheck[0].count > 0;

      if (hasNewReturnStructure) {
        const [returnRows] = await pool.execute(
          `SELECT 
            rt.id,
            rt.return_date as date,
            rt.total_amount as amount,
            'return' as type,
            CONCAT('Return - ', COUNT(DISTINCT ri.id), ' item(s)') as description,
            rt.bill_number,
            NULL as paid_amount,
            NULL as balance_amount,
            NULL as payment_status,
            rt.created_at,
            COUNT(DISTINCT ri.id) as item_count,
            GROUP_CONCAT(DISTINCT CONCAT(i.product_name, ' (', ri.quantity, ')') SEPARATOR ', ') as items_summary
          FROM return_transactions rt
          LEFT JOIN return_items ri ON rt.id = ri.return_transaction_id
          LEFT JOIN items i ON ri.item_id = i.id
          WHERE rt.buyer_party_id = ? AND rt.party_type = 'buyer'
          GROUP BY rt.id, rt.return_date, rt.total_amount, rt.bill_number, rt.created_at
          ORDER BY rt.return_date DESC, rt.created_at DESC
          LIMIT ${limitNum} OFFSET ${offset}`,
          [id]
        );
        returns = returnRows;
      } else {
        const [returnCheck] = await pool.execute(`
          SELECT COLUMN_NAME 
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'return_transactions' 
          AND COLUMN_NAME = 'buyer_party_id'
        `);
        
        if (returnCheck.length > 0) {
          const [returnRows] = await pool.execute(
            `SELECT 
              MIN(rt.id) as id,
              rt.return_date as date,
              SUM(rt.return_amount) as amount,
              'return' as type,
              CONCAT('Return - ', COUNT(DISTINCT rt.id), ' item(s)') as description,
              NULL as bill_number,
              NULL as paid_amount,
              NULL as balance_amount,
              NULL as payment_status,
              MIN(rt.created_at) as created_at,
              COUNT(DISTINCT rt.id) as item_count,
              GROUP_CONCAT(DISTINCT CONCAT(i.product_name, ' (', rt.quantity, ')') SEPARATOR ', ') as items_summary
            FROM return_transactions rt
            JOIN items i ON rt.item_id = i.id
            WHERE rt.buyer_party_id = ?
            GROUP BY rt.return_date, DATE_FORMAT(rt.created_at, '%Y-%m-%d %H:%i:%s')
            ORDER BY rt.return_date DESC, MIN(rt.created_at) DESC
            LIMIT ${limitNum} OFFSET ${offset}`,
            [id]
          );
          returns = returnRows;
        }
      }
    } catch (err) {
      // buyer_party_id column doesn't exist, skip buyer returns
    }

    // Get standalone payment transactions (payments not linked to purchases)
    let payments = [];
    try {
      const [paymentCheck] = await pool.execute(`
        SELECT COUNT(*) as count 
        FROM INFORMATION_SCHEMA.TABLES 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'payment_transactions'
      `);
      
      if (paymentCheck[0].count > 0) {
        if (hasNewStructure) {
          // NEW: Payments not linked to purchase_transaction_id
          const [paymentRows] = await pool.execute(
            `SELECT 
              pt.id,
              pt.payment_date as date,
              pt.amount,
              'payment' as type,
              CONCAT('Payment - ', COALESCE(pt.payment_method, 'Cash'), ' (Receipt: ', COALESCE(pt.receipt_number, 'N/A'), ')') as description,
              pt.receipt_number as bill_number,
              pt.amount as paid_amount,
              pt.previous_balance,
              pt.updated_balance as balance_amount,
              NULL as payment_status,
              pt.created_at,
              pt.payment_date,
              pt.created_at as transaction_timestamp,
              pt.payment_method,
              pt.notes
            FROM payment_transactions pt
            WHERE pt.party_type = 'buyer' 
              AND pt.party_id = ?
              AND pt.purchase_transaction_id IS NULL  -- Standalone payments only
            ORDER BY pt.payment_date DESC, pt.created_at DESC
            LIMIT ${limitNum} OFFSET ${offset}`,
            [id]
          );
          payments = paymentRows;
        } else {
          // OLD: Payments not linked by time window
          const [paymentRows] = await pool.execute(
            `SELECT 
              pt.id,
              pt.payment_date as date,
              pt.amount,
              'payment' as type,
              CONCAT('Payment - ', COALESCE(pt.payment_method, 'Cash'), ' (Receipt: ', COALESCE(pt.receipt_number, 'N/A'), ')') as description,
              COALESCE(pt.receipt_number, CONCAT('PAY-', pt.id)) as bill_number,
              pt.amount as paid_amount,
              COALESCE(pt.previous_balance, 0) as previous_balance,
              COALESCE(pt.updated_balance, 0) as balance_amount,
              NULL as payment_status,
              pt.created_at,
              pt.payment_date,
              pt.created_at as transaction_timestamp,
              pt.payment_method,
              pt.notes
            FROM payment_transactions pt
            LEFT JOIN purchase_transactions pur ON 
              pur.buyer_party_id = pt.party_id
              AND ABS(TIMESTAMPDIFF(SECOND, pur.created_at, pt.created_at)) <= 5
              AND pur.transaction_date = pt.payment_date
            WHERE pt.party_type = 'buyer' 
              AND pt.party_id = ?
              AND pur.id IS NULL
            ORDER BY pt.payment_date DESC, pt.created_at DESC
            LIMIT ${limitNum} OFFSET ${offset}`,
            [id]
          );
          payments = paymentRows;
        }
      }
    } catch (err) {
      // Payment table doesn't exist, skip
    }

    // Combine all transactions and sort by date (newest first)
    const allTransactionsUnsorted = [...purchases, ...returns, ...payments];
    const allTransactionsSorted = allTransactionsUnsorted.sort((a, b) => {
      const dateA = new Date(a.date || a.created_at || a.transaction_timestamp);
      const dateB = new Date(b.date || b.created_at || b.transaction_timestamp);
      return dateB - dateA; // Newest first
    });

    // Calculate running balance backwards from current balance
    let runningBalance = parseFloat(party.balance_amount || 0);
    
    const transactionsWithBalance = allTransactionsSorted.map(txn => {
      const txnAmount = parseFloat(txn.amount || txn.total_amount || 0) || 0;
      const txnPaid = parseFloat(txn.paid_amount || (txn.type === 'payment' ? txn.amount : 0) || 0) || 0;
      
      const balanceAfter = runningBalance;
      
      // Update balance based on transaction type
      if (txn.type === 'purchase') {
        const purchaseAmount = txnAmount;
        const paymentAmount = txnPaid;
        runningBalance = Math.max(0, runningBalance - purchaseAmount + paymentAmount);
      } else if (txn.type === 'payment') {
        runningBalance = runningBalance + txnAmount;
      } else if (txn.type === 'return') {
        runningBalance = runningBalance + txnAmount;
      }
      
      let displayDate = txn.date || txn.created_at;
      if (txn.type === 'payment') {
        displayDate = txn.created_at || txn.transaction_timestamp || txn.payment_date || txn.date;
      }
      
      let previousBalance = runningBalance;
      if (txn.type === 'purchase') {
        previousBalance = runningBalance;
      }
      
      return {
        ...txn,
        balance_amount: txn.balance_amount !== null && txn.balance_amount !== undefined 
          ? parseFloat(txn.balance_amount) 
          : balanceAfter,
        previous_balance: previousBalance,
        date: displayDate
      };
    });
    
    const allTransactions = transactionsWithBalance;

    // Get total count
    let purchaseCount = { total: 0 };
    if (hasNewStructure) {
      const [countRows] = await pool.execute(
        'SELECT COUNT(*) as total FROM purchase_transactions WHERE buyer_party_id = ? AND total_amount_new > 0',
        [id]
      );
      purchaseCount = countRows[0];
    } else {
      const [countRows] = await pool.execute(
        'SELECT COUNT(*) as total FROM purchase_transactions WHERE buyer_party_id = ?',
        [id]
      );
      purchaseCount = countRows[0];
    }

    let returnCount = { total: 0 };
    try {
      const [returnCountCheck] = await pool.execute(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'return_transactions' 
        AND COLUMN_NAME = 'buyer_party_id'
      `);
      if (returnCountCheck.length > 0) {
        const [returnCountRows] = await pool.execute(
          'SELECT COUNT(*) as total FROM return_transactions WHERE buyer_party_id = ?',
          [id]
        );
        returnCount = returnCountRows[0];
      }
    } catch (err) {
      // buyer_party_id column doesn't exist
    }

    let paymentCount = 0;
    try {
      const [paymentCountRows] = await pool.execute(
        'SELECT COUNT(*) as total FROM payment_transactions WHERE party_type = ? AND party_id = ?',
        ['buyer', id]
      );
      paymentCount = paymentCountRows[0]?.total || 0;
    } catch (err) {
      // Payment table doesn't exist
    }

    const totalRecords = purchaseCount.total + (returnCount.total || 0) + paymentCount;
    const totalPages = Math.ceil(totalRecords / limitNum);

    res.json({
      transactions: allTransactions.slice(0, limitNum),
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalRecords,
        totalPages
      }
    });
  } catch (error) {
    console.error('Get buyer transaction history error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});
