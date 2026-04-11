const express = require('express');
const ExcelJS = require('exceljs');
const pool = require('../config/database');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { getLocalDateString } = require('../utils/dateUtils');
const { parsePageLimit } = require('../utils/paginationParams');

const router = express.Router();

// Get sales report
router.get('/sales', authenticateToken, async (req, res) => {
  try {
    const { from_date, to_date, seller_party_id, nozzle_id, attendant_id, page = 1, limit = 50 } = req.query;
    const { pageNum, limitNum, offset } = parsePageLimit(page, limit, { defaultLimit: 50, maxLimit: 5000 });
    
    let baseQuery = `FROM sale_transactions st
    JOIN seller_parties sp ON st.seller_party_id = sp.id
    LEFT JOIN attendants a ON st.attendant_id = a.id
    LEFT JOIN nozzles n ON st.nozzle_id = n.id
    WHERE 1=1`;
    const params = [];

    if (from_date) {
      baseQuery += ' AND st.transaction_date >= ?';
      params.push(from_date);
    } else {
      baseQuery += ' AND st.transaction_date = CURDATE()';
    }
    
    if (to_date) {
      baseQuery += ' AND st.transaction_date <= ?';
      params.push(to_date);
    }

    if (seller_party_id) {
      baseQuery += ' AND st.seller_party_id = ?';
      params.push(seller_party_id);
    }
    if (nozzle_id) {
      baseQuery += ' AND st.nozzle_id = ?';
      params.push(nozzle_id);
    }
    if (attendant_id) {
      baseQuery += ' AND st.attendant_id = ?';
      params.push(attendant_id);
    }

    // Get total count
    const [countResult] = await pool.execute(`SELECT COUNT(*) as total ${baseQuery}`, params);
    const totalRecords = countResult[0].total;
    const totalPages = Math.ceil(totalRecords / limitNum);

    // Get paginated data (include attendant and nozzle names for display)
    let query = `SELECT 
      st.id,
      st.transaction_date,
      st.created_at,
      st.bill_number,
      sp.party_name,
      st.total_amount,
      st.paid_amount,
      st.balance_amount,
      st.payment_status,
      st.with_gst,
      st.previous_balance_paid,
      a.name AS attendant_name,
      n.name AS nozzle_name
    ${baseQuery}
    ORDER BY st.transaction_date DESC, st.id DESC
    LIMIT ${limitNum} OFFSET ${offset}`;
    
    const [transactions] = await pool.execute(query, params);

    // Calculate totals
    let totalSales = 0;
    let totalPaid = 0;
    let totalBalance = 0;
    let totalProfit = 0;

    for (const txn of transactions) {
      totalSales += parseFloat(txn.total_amount) || 0;
      totalPaid += parseFloat(txn.paid_amount) || 0;
      totalBalance += parseFloat(txn.balance_amount) || 0;
    }

    // Calculate profit in a single query (only for super admin) - FIXED N+1 QUERY PROBLEM
    if (req.user.role === 'super_admin' && transactions.length > 0) {
      // Get all transaction IDs from current page
      const transactionIds = transactions.map(t => t.id);
      
      // Single query to calculate profit for all transactions
      const [profitResult] = await pool.execute(
        `SELECT 
          SUM((si.sale_rate - COALESCE(i.purchase_rate, 0)) * si.quantity) as total_profit
         FROM sale_items si 
         JOIN items i ON si.item_id = i.id 
         WHERE si.sale_transaction_id IN (${transactionIds.map(() => '?').join(',')})`,
        transactionIds
      );
      
      totalProfit = parseFloat(profitResult[0]?.total_profit || 0);
    }

    res.json({
      transactions,
      summary: {
        totalSales,
        totalPaid,
        totalBalance,
        totalProfit: req.user.role === 'super_admin' ? totalProfit : null,
        totalTransactions: totalRecords
      },
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalRecords,
        totalPages
      }
    });
  } catch (error) {
    console.error('Sales report error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/** Aggregated sales totals grouped by attendant (Manage Attendant page) */
router.get('/sales/by-attendant', authenticateToken, async (req, res) => {
  try {
    let { from_date, to_date } = req.query;
    if (from_date && to_date && String(from_date) > String(to_date)) {
      const t = from_date;
      from_date = to_date;
      to_date = t;
    }
    let where = 'WHERE 1=1';
    const params = [];
    if (from_date) {
      where += ' AND st.transaction_date >= ?';
      params.push(from_date);
    } else {
      where += ' AND st.transaction_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)';
    }
    if (to_date) {
      where += ' AND st.transaction_date <= ?';
      params.push(to_date);
    }

    const [rows] = await pool.execute(
      `SELECT
         st.attendant_id,
         COALESCE(a.name, 'Unassigned') AS attendant_name,
         COUNT(*) AS bill_count,
         COALESCE(SUM(st.total_amount), 0) AS total_sales,
         COALESCE(SUM(st.paid_amount), 0) AS total_paid,
         COALESCE(SUM(st.balance_amount), 0) AS total_balance
       FROM sale_transactions st
       LEFT JOIN attendants a ON st.attendant_id = a.id
       ${where}
       GROUP BY st.attendant_id, a.name
       ORDER BY total_sales DESC, bill_count DESC`,
      params
    );

    const normalized = rows.map((r) => ({
      attendant_id: r.attendant_id,
      attendant_name: r.attendant_name || 'Unassigned',
      bill_count: parseInt(r.bill_count, 10) || 0,
      total_sales: parseFloat(r.total_sales) || 0,
      total_paid: parseFloat(r.total_paid) || 0,
      total_balance: parseFloat(r.total_balance) || 0
    }));

    res.json({ rows: normalized });
  } catch (error) {
    console.error('Sales by attendant report error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/** Aggregated sales totals grouped by nozzle (Manage Nozzle page) */
router.get('/sales/by-nozzle', authenticateToken, async (req, res) => {
  try {
    let { from_date, to_date } = req.query;
    if (from_date && to_date && String(from_date) > String(to_date)) {
      const t = from_date;
      from_date = to_date;
      to_date = t;
    }
    let where = 'WHERE 1=1';
    const params = [];
    if (from_date) {
      where += ' AND st.transaction_date >= ?';
      params.push(from_date);
    } else {
      where += ' AND st.transaction_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)';
    }
    if (to_date) {
      where += ' AND st.transaction_date <= ?';
      params.push(to_date);
    }

    const [rows] = await pool.execute(
      `SELECT
         st.nozzle_id,
         COALESCE(n.name, 'Unassigned') AS nozzle_name,
         COUNT(*) AS bill_count,
         COALESCE(SUM(st.total_amount), 0) AS total_sales,
         COALESCE(SUM(st.paid_amount), 0) AS total_paid,
         COALESCE(SUM(st.balance_amount), 0) AS total_balance
       FROM sale_transactions st
       LEFT JOIN nozzles n ON st.nozzle_id = n.id
       ${where}
       GROUP BY st.nozzle_id, n.name
       ORDER BY total_sales DESC, bill_count DESC`,
      params
    );

    const normalized = rows.map((r) => ({
      nozzle_id: r.nozzle_id,
      nozzle_name: r.nozzle_name || 'Unassigned',
      bill_count: parseInt(r.bill_count, 10) || 0,
      total_sales: parseFloat(r.total_sales) || 0,
      total_paid: parseFloat(r.total_paid) || 0,
      total_balance: parseFloat(r.total_balance) || 0
    }));

    res.json({ rows: normalized });
  } catch (error) {
    console.error('Sales by nozzle report error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get item-wise sales report (aggregated by item)
router.get('/sales/items', authenticateToken, async (req, res) => {
  try {
    const { from_date, to_date, item_query, seller_party_id, nozzle_id, attendant_id, page = 1, limit = 50 } = req.query;
    const { pageNum, limitNum, offset } = parsePageLimit(page, limit, { defaultLimit: 50, maxLimit: 5000 });

    let baseQuery = `
      FROM sale_items si
      JOIN sale_transactions st ON si.sale_transaction_id = st.id
      JOIN items i ON si.item_id = i.id
      WHERE i.is_archived = FALSE
    `;

    const params = [];

    if (from_date) {
      baseQuery += ' AND st.transaction_date >= ?';
      params.push(from_date);
    }

    if (to_date) {
      baseQuery += ' AND st.transaction_date <= ?';
      params.push(to_date);
    }

    if (seller_party_id) {
      baseQuery += ' AND st.seller_party_id = ?';
      params.push(seller_party_id);
    }

    if (nozzle_id) {
      baseQuery += ' AND st.nozzle_id = ?';
      params.push(nozzle_id);
    }
    if (attendant_id) {
      baseQuery += ' AND st.attendant_id = ?';
      params.push(attendant_id);
    }

    if (item_query) {
      baseQuery += ' AND (i.product_name LIKE ? OR i.brand LIKE ? OR i.hsn_number LIKE ?)';
      const like = `%${item_query}%`;
      params.push(like, like, like);
    }

    // Get total count (count distinct items after grouping)
    // We need to count the distinct items that match the filters
    const countQuery = `
      SELECT COUNT(DISTINCT i.id) as total
      ${baseQuery}
    `;
    const [countResult] = await pool.execute(countQuery, params);
    const totalRecords = countResult[0].total;
    const totalPages = Math.ceil(totalRecords / limitNum);

    // Get paginated data
    let query = `
      SELECT
        i.id AS item_id,
        i.product_name,
        i.brand,
        i.hsn_number,
        COALESCE(i.tax_rate, 0) AS tax_rate,
        SUM(si.quantity) AS total_quantity,
        SUM(si.quantity * si.sale_rate) AS gross_amount,
        SUM(COALESCE(si.discount, 0)) AS discount_amount,
        SUM(si.total_amount) AS taxable_or_net_amount,
        SUM(
          CASE
            WHEN st.with_gst = 1 THEN (si.total_amount * (COALESCE(i.tax_rate, 0) / 100))
            ELSE 0
          END
        ) AS gst_amount,
        SUM(
          CASE
            WHEN st.with_gst = 1 THEN (si.total_amount + (si.total_amount * (COALESCE(i.tax_rate, 0) / 100)))
            ELSE si.total_amount
          END
        ) AS net_amount,
        COUNT(DISTINCT st.id) AS bills_count,
        COUNT(DISTINCT st.seller_party_id) AS parties_count
      ${baseQuery}
      GROUP BY i.id, i.product_name, i.brand, i.hsn_number, i.tax_rate
      ORDER BY net_amount DESC, total_quantity DESC
      LIMIT ${limitNum} OFFSET ${offset}
    `;

    const [items] = await pool.execute(query, params);

    // Calculate summary from ALL items (not just current page)
    // We need to run the same query without LIMIT to get totals
    const summaryQuery = `
      SELECT
        COUNT(DISTINCT i.id) AS totalItems,
        SUM(si.quantity) AS totalQuantity,
        SUM(si.quantity * si.sale_rate) AS totalGross,
        SUM(COALESCE(si.discount, 0)) AS totalDiscount,
        SUM(si.total_amount) AS totalTaxableOrNet,
        SUM(
          CASE
            WHEN st.with_gst = 1 THEN (si.total_amount * (COALESCE(i.tax_rate, 0) / 100))
            ELSE 0
          END
        ) AS totalGst,
        SUM(
          CASE
            WHEN st.with_gst = 1 THEN (si.total_amount + (si.total_amount * (COALESCE(i.tax_rate, 0) / 100)))
            ELSE si.total_amount
          END
        ) AS totalNet,
        COUNT(DISTINCT st.id) AS totalBills
      ${baseQuery}
    `;
    const [summaryResult] = await pool.execute(summaryQuery, params);
    const summaryRow = summaryResult[0];
    
    const summary = {
      totalItems: parseInt(summaryRow.totalItems, 10) || 0,
      totalQuantity: parseFloat(summaryRow.totalQuantity) || 0,
      totalGross: parseFloat(summaryRow.totalGross) || 0,
      totalDiscount: parseFloat(summaryRow.totalDiscount) || 0,
      totalTaxableOrNet: parseFloat(summaryRow.totalTaxableOrNet) || 0,
      totalGst: parseFloat(summaryRow.totalGst) || 0,
      totalNet: parseFloat(summaryRow.totalNet) || 0,
      totalBills: parseInt(summaryRow.totalBills, 10) || 0
    };

    res.json({ 
      items, 
      summary,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalRecords,
        totalPages
      }
    });
  } catch (error) {
    console.error('Item-wise sales report error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get bill details by bill number
router.get('/sales/bill/:bill_number', authenticateToken, async (req, res) => {
  try {
    const { bill_number } = req.params;

    if (!bill_number) {
      return res.status(400).json({ error: 'Bill number is required' });
    }

    // Get transaction by bill_number (include attendant and nozzle for display)
    const [transactions] = await pool.execute(
      `SELECT st.*, sp.party_name, sp.mobile_number, sp.address, sp.email, sp.gst_number,
        a.name AS attendant_name, n.name AS nozzle_name
       FROM sale_transactions st
       JOIN seller_parties sp ON st.seller_party_id = sp.id
       LEFT JOIN attendants a ON st.attendant_id = a.id
       LEFT JOIN nozzles n ON st.nozzle_id = n.id
       WHERE st.bill_number = ?`,
      [bill_number]
    );

    if (transactions.length === 0) {
      return res.status(404).json({ error: 'Bill not found' });
    }

    const transaction = transactions[0];

    // Get all items for this transaction with complete details
    const [items] = await pool.execute(
      `SELECT 
        si.id,
        si.item_id,
        si.quantity,
        si.sale_rate,
        si.total_amount,
        COALESCE(si.discount, 0) as discount,
        si.discount_type,
        si.discount_percentage,
        (si.quantity * si.sale_rate) as gross_amount,
        COALESCE(si.discount, 0) as discount_amount,
        i.product_name,
        i.product_code,
        i.brand,
        i.hsn_number,
        COALESCE(i.tax_rate, 0) as tax_rate
       FROM sale_items si 
       JOIN items i ON si.item_id = i.id 
       WHERE si.sale_transaction_id = ?
       ORDER BY si.id`,
      [transaction.id]
    );

    if (items.length === 0) {
      return res.status(404).json({ error: 'No items found for this bill' });
    }

    // Format items with calculated fields
    const formattedItems = items.map(item => {
      const grossAmount = parseFloat(item.gross_amount) || 0;
      const discountAmount = parseFloat(item.discount_amount) || 0;
      const totalAmount = parseFloat(item.total_amount) || 0;
      const taxRate = parseFloat(item.tax_rate) || 0;
      
      // Calculate GST amount for this item (if GST-inclusive)
      let gstAmount = 0;
      let netAmount = totalAmount;
      
      if (transaction.with_gst && taxRate > 0) {
        // For GST-inclusive: GST = total_amount * tax_rate / 100
        gstAmount = totalAmount * (taxRate / 100);
        // Net amount is the amount after discount (GST-inclusive)
        netAmount = totalAmount + gstAmount;
      }

      return {
        item_id: item.item_id,
        product_name: item.product_name,
        product_code: item.product_code,
        brand: item.brand,
        hsn_number: item.hsn_number,
        tax_rate: taxRate,
        quantity: parseInt(item.quantity) || 0,
        sale_rate: parseFloat(item.sale_rate) || 0,
        discount: discountAmount,
        discount_type: item.discount_type || 'amount',
        discount_percentage: item.discount_percentage ? parseFloat(item.discount_percentage) : null,
        gross_amount: grossAmount,
        discount_amount: discountAmount,
        total_amount: totalAmount,
        gst_amount: gstAmount,
        net_amount: netAmount
      };
    });

    // Calculate summary
    const totalQuantity = formattedItems.reduce((sum, item) => sum + item.quantity, 0);
    const totalGross = formattedItems.reduce((sum, item) => sum + item.gross_amount, 0);
    const totalDiscount = formattedItems.reduce((sum, item) => sum + item.discount_amount, 0);
    const totalTaxableOrNet = formattedItems.reduce((sum, item) => sum + item.total_amount, 0);
    const totalGst = formattedItems.reduce((sum, item) => sum + item.gst_amount, 0);
    const totalNet = formattedItems.reduce((sum, item) => sum + item.net_amount, 0);

    // Format response
    const response = {
      bill_number: transaction.bill_number,
      transaction_id: transaction.id,
      transaction_date: transaction.transaction_date,
      created_at: transaction.created_at,
      attendant_name: transaction.attendant_name || null,
      nozzle_name: transaction.nozzle_name || null,
      party: {
        party_name: transaction.party_name,
        mobile_number: transaction.mobile_number,
        email: transaction.email,
        address: transaction.address,
        gst_number: transaction.gst_number
      },
      items: formattedItems,
      summary: {
        subtotal: parseFloat(transaction.subtotal || 0),
        discount: totalDiscount,
        tax_amount: parseFloat(transaction.tax_amount || 0),
        total_amount: parseFloat(transaction.total_amount || 0),
        paid_amount: parseFloat(transaction.paid_amount || 0),
        balance_amount: parseFloat(transaction.balance_amount || 0),
        previous_balance_paid: parseFloat(transaction.previous_balance_paid || 0),
        payment_status: transaction.payment_status,
        with_gst: transaction.with_gst === 1 || transaction.with_gst === true,
        total_items: formattedItems.length,
        total_quantity: totalQuantity,
        total_gross: totalGross,
        total_taxable_or_net: totalTaxableOrNet,
        total_gst: totalGst,
        total_net: totalNet
      }
    };

    res.json(response);
  } catch (error) {
    console.error('Get bill details error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get return bill details by bill number or transaction ID
router.get('/returns/bill/:bill_number', authenticateToken, async (req, res) => {
  try {
    const { bill_number } = req.params;

    if (!bill_number) {
      return res.status(400).json({ error: 'Bill number or transaction ID is required' });
    }

    // Check if bill_number is actually a numeric transaction ID
    const isTransactionId = !isNaN(bill_number) && !bill_number.includes('-');

    // Get return transaction by bill_number or transaction ID with party details
    const [transactions] = await pool.execute(
      `SELECT rt.*, 
        sp.party_name as seller_party_name, sp.mobile_number as seller_mobile, 
        sp.address as seller_address, sp.email as seller_email, sp.gst_number as seller_gst,
        bp.party_name as buyer_party_name, bp.mobile_number as buyer_mobile,
        bp.address as buyer_address, bp.email as buyer_email, bp.gst_number as buyer_gst
       FROM return_transactions rt
       LEFT JOIN seller_parties sp ON rt.seller_party_id = sp.id
       LEFT JOIN buyer_parties bp ON rt.buyer_party_id = bp.id
       WHERE ${isTransactionId ? 'rt.id = ?' : 'rt.bill_number = ?'}`,
      [isTransactionId ? parseInt(bill_number) : bill_number]
    );

    if (transactions.length === 0) {
      return res.status(404).json({ error: 'Return transaction not found' });
    }

    const transaction = transactions[0];

    // Check if new structure exists (return_items table)
    const [tableCheck] = await pool.execute(`
      SELECT COUNT(*) as count 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'return_items'
    `);
    const hasNewStructure = tableCheck[0].count > 0;

    if (!hasNewStructure) {
      return res.status(404).json({ error: 'Return items not found. Old structure not supported.' });
    }

    // Get all return items for this transaction with complete details
    const [items] = await pool.execute(
      `SELECT 
        ri.id,
        ri.item_id,
        ri.quantity,
        ri.return_rate,
        ri.total_amount,
        COALESCE(ri.discount, 0) as discount,
        ri.discount_type,
        ri.discount_percentage,
        (ri.quantity * ri.return_rate) as gross_amount,
        COALESCE(ri.discount, 0) as discount_amount,
        i.product_name,
        i.product_code,
        i.brand,
        i.hsn_number,
        COALESCE(i.tax_rate, 0) as tax_rate
       FROM return_items ri 
       JOIN items i ON ri.item_id = i.id 
       WHERE ri.return_transaction_id = ?
       ORDER BY ri.id`,
      [transaction.id]
    );

    if (items.length === 0) {
      return res.status(404).json({ error: 'No items found for this return bill' });
    }

    // Determine party information based on party_type
    const partyType = transaction.party_type || 'seller';
    const party = partyType === 'seller' 
      ? {
          party_name: transaction.seller_party_name,
          mobile_number: transaction.seller_mobile,
          email: transaction.seller_email,
          address: transaction.seller_address,
          gst_number: transaction.seller_gst
        }
      : {
          party_name: transaction.buyer_party_name,
          mobile_number: transaction.buyer_mobile,
          email: transaction.buyer_email,
          address: transaction.buyer_address,
          gst_number: transaction.buyer_gst
        };

    // Format items with calculated fields
    const formattedItems = items.map(item => {
      const grossAmount = parseFloat(item.gross_amount) || 0;
      const discountAmount = parseFloat(item.discount_amount) || 0;
      const totalAmount = parseFloat(item.total_amount) || 0;
      const taxRate = parseFloat(item.tax_rate) || 0;

      return {
        item_id: item.item_id,
        product_name: item.product_name,
        product_code: item.product_code,
        brand: item.brand,
        hsn_number: item.hsn_number,
        tax_rate: taxRate,
        quantity: parseInt(item.quantity) || 0,
        return_rate: parseFloat(item.return_rate) || 0,
        discount: discountAmount,
        discount_type: item.discount_type || 'amount',
        discount_percentage: item.discount_percentage ? parseFloat(item.discount_percentage) : null,
        gross_amount: grossAmount,
        discount_amount: discountAmount,
        total_amount: totalAmount
      };
    });

    // Calculate summary
    const totalQuantity = formattedItems.reduce((sum, item) => sum + item.quantity, 0);
    const totalGross = formattedItems.reduce((sum, item) => sum + item.gross_amount, 0);
    const totalDiscount = formattedItems.reduce((sum, item) => sum + item.discount_amount, 0);
    const totalNet = formattedItems.reduce((sum, item) => sum + item.total_amount, 0);

    // Format response
    const response = {
      bill_number: transaction.bill_number,
      transaction_id: transaction.id,
      return_date: transaction.return_date,
      created_at: transaction.created_at,
      party_type: partyType,
      reason: transaction.reason || null,
      return_type: transaction.return_type || 'adjust',
      party: party,
      items: formattedItems,
      summary: {
        total_amount: parseFloat(transaction.total_amount || 0),
        total_items: formattedItems.length,
        total_quantity: totalQuantity,
        total_gross: totalGross,
        total_discount: totalDiscount,
        total_net: totalNet
      }
    };

    res.json(response);
  } catch (error) {
    console.error('Get return bill details error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Export item-wise sales report to Excel
router.get('/sales/items/export', authenticateToken, async (req, res) => {
  try {
    const { from_date, to_date, item_query, seller_party_id, nozzle_id } = req.query;

    // Reuse the same query as /sales/items
    let query = `
      SELECT
        i.product_name,
        i.brand,
        i.hsn_number,
        COALESCE(i.tax_rate, 0) AS tax_rate,
        SUM(si.quantity) AS total_quantity,
        SUM(si.quantity * si.sale_rate) AS gross_amount,
        SUM(COALESCE(si.discount, 0)) AS discount_amount,
        SUM(si.total_amount) AS taxable_or_net_amount,
        SUM(
          CASE
            WHEN st.with_gst = 1 THEN (si.total_amount * (COALESCE(i.tax_rate, 0) / 100))
            ELSE 0
          END
        ) AS gst_amount,
        SUM(
          CASE
            WHEN st.with_gst = 1 THEN (si.total_amount + (si.total_amount * (COALESCE(i.tax_rate, 0) / 100)))
            ELSE si.total_amount
          END
        ) AS net_amount,
        COUNT(DISTINCT st.id) AS bills_count
      FROM sale_items si
      JOIN sale_transactions st ON si.sale_transaction_id = st.id
      JOIN items i ON si.item_id = i.id
      WHERE i.is_archived = FALSE
    `;

    const params = [];

    if (from_date) {
      query += ' AND st.transaction_date >= ?';
      params.push(from_date);
    } else {
      query += ' AND st.transaction_date = CURDATE()';
    }

    if (to_date) {
      query += ' AND st.transaction_date <= ?';
      params.push(to_date);
    }

    if (seller_party_id) {
      query += ' AND st.seller_party_id = ?';
      params.push(seller_party_id);
    }

    if (nozzle_id) {
      query += ' AND st.nozzle_id = ?';
      params.push(nozzle_id);
    }

    if (item_query) {
      query += ' AND (i.product_name LIKE ? OR i.brand LIKE ? OR i.hsn_number LIKE ?)';
      const like = `%${item_query}%`;
      params.push(like, like, like);
    }

    query += `
      GROUP BY i.id, i.product_name, i.brand, i.hsn_number, i.tax_rate
      ORDER BY net_amount DESC, total_quantity DESC
    `;

    const [rows] = await pool.execute(query, params);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Item-wise Sales');

    worksheet.columns = [
      { header: 'Product Name', key: 'product_name', width: 30 },
      { header: 'Brand', key: 'brand', width: 18 },
      { header: 'HSN', key: 'hsn_number', width: 14 },
      { header: 'Tax %', key: 'tax_rate', width: 10 },
      { header: 'Total Qty', key: 'total_quantity', width: 10 },
      { header: 'Gross Amount', key: 'gross_amount', width: 15 },
      { header: 'Discount', key: 'discount_amount', width: 12 },
      { header: 'Taxable/Net', key: 'taxable_or_net_amount', width: 15 },
      { header: 'GST Amount', key: 'gst_amount', width: 12 },
      { header: 'Net Amount', key: 'net_amount', width: 15 },
      { header: 'Bills Count', key: 'bills_count', width: 12 }
    ];

    // Set header row style with wrapping
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

    rows.forEach((r) => {
      const row = worksheet.addRow({
        product_name: r.product_name,
        brand: r.brand,
        hsn_number: r.hsn_number,
        tax_rate: r.tax_rate,
        total_quantity: r.total_quantity,
        gross_amount: r.gross_amount,
        discount_amount: r.discount_amount,
        taxable_or_net_amount: r.taxable_or_net_amount,
        gst_amount: r.gst_amount,
        net_amount: r.net_amount,
        bills_count: r.bills_count
      });
      // Enable text wrapping for all cells in the row
      row.eachCell((cell) => {
        cell.alignment = { vertical: 'top', wrapText: true };
      });
    });
    
    // Auto-adjust column widths based on content
    worksheet.columns.forEach((column, index) => {
      let maxLength = column.header ? column.header.length : 10;
      worksheet.getColumn(index + 1).eachCell({ includeEmpty: false }, (cell) => {
        const cellValue = cell.value ? String(cell.value) : '';
        if (cellValue.length > maxLength) {
          maxLength = cellValue.length;
        }
      });
      column.width = Math.min(Math.max(maxLength + 2, 10), 50);
    });

    const totals = rows.reduce(
      (acc, r) => {
        acc.total_quantity += parseFloat(r.total_quantity) || 0;
        acc.gross_amount += parseFloat(r.gross_amount) || 0;
        acc.discount_amount += parseFloat(r.discount_amount) || 0;
        acc.taxable_or_net_amount += parseFloat(r.taxable_or_net_amount) || 0;
        acc.gst_amount += parseFloat(r.gst_amount) || 0;
        acc.net_amount += parseFloat(r.net_amount) || 0;
        return acc;
      },
      {
        total_quantity: 0,
        gross_amount: 0,
        discount_amount: 0,
        taxable_or_net_amount: 0,
        gst_amount: 0,
        net_amount: 0
      }
    );

    worksheet.addRow({});
    const totalRow = worksheet.addRow({
      product_name: 'TOTAL',
      total_quantity: totals.total_quantity,
      gross_amount: totals.gross_amount,
      discount_amount: totals.discount_amount,
      taxable_or_net_amount: totals.taxable_or_net_amount,
      gst_amount: totals.gst_amount,
      net_amount: totals.net_amount
    });
    // Enable text wrapping for total row
    totalRow.eachCell((cell) => {
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.font = { bold: true };
    });

    const from = from_date || getLocalDateString();
    const to = to_date || from;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=item_wise_sales_${from}_${to}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Export item-wise sales report error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Export sales report to Excel
router.get('/sales/export', authenticateToken, async (req, res) => {
  try {
    const { from_date, to_date } = req.query;
    
    let query = `SELECT 
      st.transaction_date,
      st.bill_number,
      sp.party_name,
      st.total_amount,
      st.paid_amount,
      st.balance_amount,
      st.payment_status
    FROM sale_transactions st 
    JOIN seller_parties sp ON st.seller_party_id = sp.id 
    WHERE 1=1`;
    const params = [];

    if (from_date) {
      query += ' AND st.transaction_date >= ?';
      params.push(from_date);
    } else {
      query += ' AND st.transaction_date = CURDATE()';
    }
    
    if (to_date) {
      query += ' AND st.transaction_date <= ?';
      params.push(to_date);
    }

    query += ' ORDER BY st.transaction_date DESC';

    const [transactions] = await pool.execute(query, params);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Sales Report');

    // Add headers
    worksheet.columns = [
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Bill Number', key: 'bill_number', width: 20 },
      { header: 'Party Name', key: 'party_name', width: 30 },
      { header: 'Total Amount', key: 'total_amount', width: 15 },
      { header: 'Paid Amount', key: 'paid_amount', width: 15 },
      { header: 'Balance Amount', key: 'balance_amount', width: 15 },
      { header: 'Payment Status', key: 'payment_status', width: 15 }
    ];

    // Set header row style with wrapping
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

    // Add data
    transactions.forEach(txn => {
      const row = worksheet.addRow({
        date: txn.transaction_date,
        bill_number: txn.bill_number,
        party_name: txn.party_name,
        total_amount: txn.total_amount,
        paid_amount: txn.paid_amount,
        balance_amount: txn.balance_amount,
        payment_status: txn.payment_status
      });
      // Enable text wrapping for all cells in the row
      row.eachCell((cell) => {
        cell.alignment = { vertical: 'top', wrapText: true };
      });
    });
    
    // Auto-adjust column widths based on content
    worksheet.columns.forEach((column, index) => {
      let maxLength = column.header ? column.header.length : 10;
      worksheet.getColumn(index + 1).eachCell({ includeEmpty: false }, (cell) => {
        const cellValue = cell.value ? String(cell.value) : '';
        if (cellValue.length > maxLength) {
          maxLength = cellValue.length;
        }
      });
      column.width = Math.min(Math.max(maxLength + 2, 10), 50);
    });

    // Add summary row
    const totalSales = transactions.reduce((sum, t) => sum + (parseFloat(t.total_amount) || 0), 0);
    const totalPaid = transactions.reduce((sum, t) => sum + (parseFloat(t.paid_amount) || 0), 0);
    const totalBalance = transactions.reduce((sum, t) => sum + (parseFloat(t.balance_amount) || 0), 0);

    worksheet.addRow({});
    const totalRow = worksheet.addRow({
      date: 'TOTAL',
      total_amount: totalSales,
      paid_amount: totalPaid,
      balance_amount: totalBalance
    });
    // Enable text wrapping for total row
    totalRow.eachCell((cell) => {
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.font = { bold: true };
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=sales_report.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Export sales report error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get return report
router.get('/returns', authenticateToken, async (req, res) => {
  try {
    const { from_date, to_date, party_type, page = 1, limit = 50 } = req.query;
    const { pageNum, limitNum, offset } = parsePageLimit(page, limit, { defaultLimit: 50, maxLimit: 5000 });
    
    // Check if new structure exists (return_items table)
    const [tableCheck] = await pool.execute(`
      SELECT COUNT(*) as count 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'return_items'
    `);
    const hasNewStructure = tableCheck[0].count > 0;

    let baseQuery, query, countQuery;
    const params = [];

    if (hasNewStructure) {
      // New cumulative structure: join through return_items
      baseQuery = `FROM return_transactions rt 
        LEFT JOIN seller_parties sp ON rt.seller_party_id = sp.id 
        LEFT JOIN buyer_parties bp ON rt.buyer_party_id = bp.id
        LEFT JOIN return_items ri ON rt.id = ri.return_transaction_id
        LEFT JOIN items i ON ri.item_id = i.id 
        WHERE 1=1`;

      if (from_date) {
        baseQuery += ' AND rt.return_date >= ?';
        params.push(from_date);
      } else {
        baseQuery += ' AND rt.return_date = CURDATE()';
      }
      
      if (to_date) {
        baseQuery += ' AND rt.return_date <= ?';
        params.push(to_date);
      }

      if (party_type) {
        baseQuery += ' AND rt.party_type = ?';
        params.push(party_type);
      }

      // Get total count (count distinct return transactions)
      countQuery = `SELECT COUNT(DISTINCT rt.id) as total ${baseQuery}`;
      const [countResult] = await pool.execute(countQuery, params);
      const totalRecords = countResult[0].total;
      const totalPages = Math.ceil(totalRecords / limitNum);

      // Get paginated data - group by return transaction and aggregate items
      query = `SELECT 
        rt.id,
        rt.created_at,
        rt.return_date,
        rt.party_type,
        rt.bill_number,
        COALESCE(sp.party_name, bp.party_name) as party_name,
        rt.total_amount as return_amount,
        rt.reason,
        GROUP_CONCAT(DISTINCT CONCAT(i.product_name, ' (', ri.quantity, ')') SEPARATOR ', ') as items_summary,
        COUNT(DISTINCT ri.id) as item_count
      ${baseQuery}
      GROUP BY rt.id, rt.return_date, rt.party_type, rt.bill_number, party_name, rt.total_amount, rt.reason
      ORDER BY rt.return_date DESC
      LIMIT ${limitNum} OFFSET ${offset}`;

      const [transactions] = await pool.execute(query, params);
      const totalReturns = transactions.reduce((sum, t) => sum + (parseFloat(t.return_amount) || 0), 0);

      res.json({
        transactions,
        summary: {
          totalReturns,
          totalTransactions: totalRecords
        },
        pagination: {
          page: pageNum,
          limit: limitNum,
          totalRecords,
          totalPages
        }
      });
    } else {
      // Old structure: direct join with items
      baseQuery = `FROM return_transactions rt 
        LEFT JOIN seller_parties sp ON rt.seller_party_id = sp.id 
        LEFT JOIN buyer_parties bp ON rt.buyer_party_id = bp.id
        LEFT JOIN items i ON rt.item_id = i.id 
        WHERE 1=1`;

      if (from_date) {
        baseQuery += ' AND rt.return_date >= ?';
        params.push(from_date);
      } else {
        baseQuery += ' AND rt.return_date = CURDATE()';
      }
      
      if (to_date) {
        baseQuery += ' AND rt.return_date <= ?';
        params.push(to_date);
      }

      if (party_type) {
        baseQuery += ' AND rt.party_type = ?';
        params.push(party_type);
      }

      // Get total count
      countQuery = `SELECT COUNT(*) as total ${baseQuery}`;
      const [countResult] = await pool.execute(countQuery, params);
      const totalRecords = countResult[0].total;
      const totalPages = Math.ceil(totalRecords / limitNum);

      // Get paginated data
      query = `SELECT 
        rt.id,
        rt.return_date,
        rt.party_type,
        COALESCE(sp.party_name, bp.party_name) as party_name,
        i.product_name,
        i.brand,
        rt.quantity,
        rt.return_amount,
        rt.reason
      ${baseQuery}
      ORDER BY rt.return_date DESC
      LIMIT ${limitNum} OFFSET ${offset}`;

      const [transactions] = await pool.execute(query, params);
      const totalReturns = transactions.reduce((sum, t) => sum + (parseFloat(t.return_amount) || 0), 0);

      res.json({
        transactions,
        summary: {
          totalReturns,
          totalTransactions: totalRecords
        },
        pagination: {
          page: pageNum,
          limit: limitNum,
          totalRecords,
          totalPages
        }
      });
    }
  } catch (error) {
    console.error('Return report error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Export return report to Excel
router.get('/returns/export', authenticateToken, async (req, res) => {
  try {
    const { from_date, to_date, party_type } = req.query;
    
    // Check if new structure exists
    const [tableCheck] = await pool.execute(`
      SELECT COUNT(*) as count 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'return_items'
    `);
    const hasNewStructure = tableCheck[0].count > 0;

    let query, transactions;
    const params = [];

    if (hasNewStructure) {
      // New structure: join through return_items
      query = `SELECT 
        rt.return_date,
        rt.bill_number,
        COALESCE(sp.party_name, bp.party_name) as party_name,
        rt.party_type,
        GROUP_CONCAT(DISTINCT CONCAT(i.product_name, ' (Qty: ', ri.quantity, ')') SEPARATOR '; ') as items_summary,
        rt.total_amount as return_amount,
        rt.reason
      FROM return_transactions rt 
      LEFT JOIN seller_parties sp ON rt.seller_party_id = sp.id 
      LEFT JOIN buyer_parties bp ON rt.buyer_party_id = bp.id
      LEFT JOIN return_items ri ON rt.id = ri.return_transaction_id
      LEFT JOIN items i ON ri.item_id = i.id 
      WHERE 1=1`;

      if (from_date) {
        query += ' AND rt.return_date >= ?';
        params.push(from_date);
      } else {
        query += ' AND rt.return_date = CURDATE()';
      }
      
      if (to_date) {
        query += ' AND rt.return_date <= ?';
        params.push(to_date);
      }

      if (party_type) {
        query += ' AND rt.party_type = ?';
        params.push(party_type);
      }

      query += ' GROUP BY rt.id, rt.return_date, rt.bill_number, party_name, rt.party_type, rt.total_amount, rt.reason';
      query += ' ORDER BY rt.return_date DESC';

      const [transactionsData] = await pool.execute(query, params);
      // Format for Excel export
      transactions = transactionsData.map(t => ({
        return_date: t.return_date,
        bill_number: t.bill_number,
        party_name: t.party_name,
        party_type: t.party_type,
        product_name: t.items_summary || 'N/A',
        brand: '',
        quantity: '',
        return_amount: t.return_amount,
        reason: t.reason
      }));
    } else {
      // Old structure: direct join with items
      query = `SELECT 
        rt.return_date,
        COALESCE(sp.party_name, bp.party_name) as party_name,
        rt.party_type,
        i.product_name,
        i.brand,
        rt.quantity,
        rt.return_amount,
        rt.reason
      FROM return_transactions rt 
      LEFT JOIN seller_parties sp ON rt.seller_party_id = sp.id 
      LEFT JOIN buyer_parties bp ON rt.buyer_party_id = bp.id
      LEFT JOIN items i ON rt.item_id = i.id 
      WHERE 1=1`;

      if (from_date) {
        query += ' AND rt.return_date >= ?';
        params.push(from_date);
      } else {
        query += ' AND rt.return_date = CURDATE()';
      }
      
      if (to_date) {
        query += ' AND rt.return_date <= ?';
        params.push(to_date);
      }

      if (party_type) {
        query += ' AND rt.party_type = ?';
        params.push(party_type);
      }

      query += ' ORDER BY rt.return_date DESC';

      const [transactionsData] = await pool.execute(query, params);
      transactions = transactionsData;
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Return Report');

    worksheet.columns = [
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Bill Number', key: 'bill_number', width: 20 },
      { header: 'Party Type', key: 'party_type', width: 12 },
      { header: 'Party Name', key: 'party_name', width: 30 },
      { header: 'Items', key: 'product_name', width: 40 },
      { header: 'Brand', key: 'brand', width: 20 },
      { header: 'Quantity', key: 'quantity', width: 10 },
      { header: 'Return Amount', key: 'return_amount', width: 15 },
      { header: 'Reason', key: 'reason', width: 30 }
    ];

    // Set header row style with wrapping
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

    transactions.forEach(txn => {
      const row = worksheet.addRow({
        date: txn.return_date,
        bill_number: txn.bill_number || '',
        party_type: txn.party_type === 'buyer' ? 'Buyer' : 'Seller',
        party_name: txn.party_name,
        product_name: txn.product_name,
        brand: txn.brand || '',
        quantity: txn.quantity || '',
        return_amount: txn.return_amount,
        reason: txn.reason
      });
      // Enable text wrapping for all cells in the row
      row.eachCell((cell) => {
        cell.alignment = { vertical: 'top', wrapText: true };
      });
    });
    
    // Auto-adjust column widths based on content
    worksheet.columns.forEach((column, index) => {
      let maxLength = column.header ? column.header.length : 10;
      worksheet.getColumn(index + 1).eachCell({ includeEmpty: false }, (cell) => {
        const cellValue = cell.value ? String(cell.value) : '';
        if (cellValue.length > maxLength) {
          maxLength = cellValue.length;
        }
      });
      column.width = Math.min(Math.max(maxLength + 2, 10), 50);
    });

    const totalReturns = transactions.reduce((sum, t) => sum + (parseFloat(t.return_amount) || 0), 0);
    worksheet.addRow({});
    const totalRow = worksheet.addRow({
      date: 'TOTAL',
      return_amount: totalReturns
    });
    // Enable text wrapping for total row
    totalRow.eachCell((cell) => {
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.font = { bold: true };
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=return_report.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Export return report error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Day-wise nozzle meter readings: liters sold per calendar day (optionally per nozzle).
 * Query: from_date, to_date, nozzle_id (optional). Defaults: last 30 days through today.
 */
router.get('/nozzle-readings/daywise', authenticateToken, async (req, res) => {
  try {
    let { from_date, to_date, nozzle_id } = req.query;
    if (from_date && to_date && String(from_date) > String(to_date)) {
      const t = from_date;
      from_date = to_date;
      to_date = t;
    }

    let where = 'WHERE 1=1';
    const params = [];
    if (from_date) {
      where += ' AND nr.reading_date >= ?';
      params.push(from_date);
    } else {
      where += ' AND nr.reading_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)';
    }
    if (to_date) {
      where += ' AND nr.reading_date <= ?';
      params.push(to_date);
    } else if (!from_date) {
      where += ' AND nr.reading_date <= CURDATE()';
    }
    if (nozzle_id != null && String(nozzle_id).trim() !== '') {
      const nid = parseInt(nozzle_id, 10);
      if (!Number.isNaN(nid)) {
        where += ' AND nr.nozzle_id = ?';
        params.push(nid);
      }
    }

    const [byDay] = await pool.execute(
      `SELECT
         nr.reading_date,
         COUNT(*) AS shift_count,
         SUM(CASE WHEN nr.closing_reading IS NOT NULL THEN 1 ELSE 0 END) AS completed_shifts,
         SUM(CASE WHEN nr.closing_reading IS NULL THEN 1 ELSE 0 END) AS pending_shifts,
         COALESCE(SUM(CASE WHEN nr.closing_reading IS NOT NULL THEN (nr.closing_reading - nr.opening_reading) ELSE 0 END), 0) AS liters_sold
       FROM nozzle_readings nr
       JOIN nozzles n ON n.id = nr.nozzle_id
       ${where}
       GROUP BY nr.reading_date
       ORDER BY nr.reading_date DESC`,
      params
    );

    const [byDayNozzle] = await pool.execute(
      `SELECT
         nr.reading_date,
         nr.nozzle_id,
         n.name AS nozzle_name,
         COUNT(*) AS shift_count,
         SUM(CASE WHEN nr.closing_reading IS NOT NULL THEN 1 ELSE 0 END) AS completed_shifts,
         SUM(CASE WHEN nr.closing_reading IS NULL THEN 1 ELSE 0 END) AS pending_shifts,
         COALESCE(SUM(CASE WHEN nr.closing_reading IS NOT NULL THEN (nr.closing_reading - nr.opening_reading) ELSE 0 END), 0) AS liters_sold
       FROM nozzle_readings nr
       JOIN nozzles n ON n.id = nr.nozzle_id
       ${where}
       GROUP BY nr.reading_date, nr.nozzle_id, n.name
       ORDER BY nr.reading_date DESC, n.name ASC`,
      params
    );

    const mapDay = (r) => ({
      reading_date: r.reading_date,
      shift_count: parseInt(r.shift_count, 10) || 0,
      completed_shifts: parseInt(r.completed_shifts, 10) || 0,
      pending_shifts: parseInt(r.pending_shifts, 10) || 0,
      liters_sold: parseFloat(r.liters_sold) || 0
    });

    const mapDayNozzle = (r) => ({
      reading_date: r.reading_date,
      nozzle_id: r.nozzle_id,
      nozzle_name: r.nozzle_name || '—',
      shift_count: parseInt(r.shift_count, 10) || 0,
      completed_shifts: parseInt(r.completed_shifts, 10) || 0,
      pending_shifts: parseInt(r.pending_shifts, 10) || 0,
      liters_sold: parseFloat(r.liters_sold) || 0
    });

    const byDayNorm = (byDay || []).map(mapDay);
    const byDayNozzleNorm = (byDayNozzle || []).map(mapDayNozzle);

    const summary = byDayNorm.reduce(
      (acc, row) => {
        acc.total_liters += row.liters_sold;
        acc.total_shifts += row.shift_count;
        acc.days += 1;
        return acc;
      },
      { total_liters: 0, total_shifts: 0, days: 0 }
    );

    res.json({
      by_day: byDayNorm,
      by_day_nozzle: byDayNozzleNorm,
      summary
    });
  } catch (error) {
    console.error('Day-wise nozzle readings report error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Day-wise sales with paid vs due (balance) totals per transaction date.
 * Query: from_date, to_date, seller_party_id, nozzle_id, attendant_id,
 * credit_only — if '1' or 'true', only bills with balance_amount > 0 are included.
 */
router.get('/sales/daywise', authenticateToken, async (req, res) => {
  try {
    let {
      from_date,
      to_date,
      seller_party_id,
      nozzle_id,
      attendant_id,
      credit_only
    } = req.query;

    if (from_date && to_date && String(from_date) > String(to_date)) {
      const t = from_date;
      from_date = to_date;
      to_date = t;
    }

    let where = 'WHERE 1=1';
    const params = [];

    if (from_date) {
      where += ' AND st.transaction_date >= ?';
      params.push(from_date);
    } else {
      where += ' AND st.transaction_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)';
    }
    if (to_date) {
      where += ' AND st.transaction_date <= ?';
      params.push(to_date);
    } else if (!from_date) {
      where += ' AND st.transaction_date <= CURDATE()';
    }

    if (seller_party_id) {
      where += ' AND st.seller_party_id = ?';
      params.push(seller_party_id);
    }
    if (nozzle_id) {
      where += ' AND st.nozzle_id = ?';
      params.push(nozzle_id);
    }
    if (attendant_id) {
      where += ' AND st.attendant_id = ?';
      params.push(attendant_id);
    }

    const onlyCredit = credit_only === '1' || credit_only === 'true';
    if (onlyCredit) {
      where += ' AND st.balance_amount > 0';
    }

    const [rows] = await pool.execute(
      `SELECT
         st.transaction_date,
         COUNT(*) AS bill_count,
         COALESCE(SUM(st.total_amount), 0) AS total_sales,
         COALESCE(SUM(st.paid_amount), 0) AS total_paid,
         COALESCE(SUM(st.balance_amount), 0) AS total_due
       FROM sale_transactions st
       ${where}
       GROUP BY st.transaction_date
       ORDER BY st.transaction_date DESC`,
      params
    );

    const normalized = (rows || []).map((r) => ({
      transaction_date: r.transaction_date,
      bill_count: parseInt(r.bill_count, 10) || 0,
      total_sales: parseFloat(r.total_sales) || 0,
      total_paid: parseFloat(r.total_paid) || 0,
      total_due: parseFloat(r.total_due) || 0
    }));

    const summary = normalized.reduce(
      (acc, row) => {
        acc.bill_count += row.bill_count;
        acc.total_sales += row.total_sales;
        acc.total_paid += row.total_paid;
        acc.total_due += row.total_due;
        acc.days += 1;
        return acc;
      },
      { bill_count: 0, total_sales: 0, total_paid: 0, total_due: 0, days: 0 }
    );

    res.json({ rows: normalized, summary, credit_only: onlyCredit });
  } catch (error) {
    console.error('Day-wise sales / due report error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;








