const express = require('express');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { parsePageLimit } = require('../utils/paginationParams');
const { getLocalDateString } = require('../utils/dateUtils');

const router = express.Router();

/**
 * Get all transactions for a party (seller or buyer)
 * GET /api/unified-transactions/party/:party_type/:party_id
 * Query params: page, limit, from_date, to_date, transaction_type
 */
router.get('/party/:party_type/:party_id', authenticateToken, async (req, res) => {
  try {
    const { party_type, party_id } = req.params;
    const { page = 1, limit = 20, from_date, to_date, transaction_type } = req.query;

    const { pageNum, limitNum, offset } = parsePageLimit(page, limit, { defaultLimit: 20, maxLimit: 200 });

    // Validate party_type
    if (!['seller', 'buyer'].includes(party_type)) {
      return res.status(400).json({ error: 'Invalid party_type. Must be "seller" or "buyer"' });
    }

    // Verify party exists
    const partyTable = party_type === 'seller' ? 'seller_parties' : 'buyer_parties';
    const [partyCheck] = await pool.execute(
      `SELECT id, balance_amount FROM ${partyTable} WHERE id = ?`,
      [party_id]
    );
    
    if (partyCheck.length === 0) {
      return res.status(404).json({ error: `${party_type} party not found` });
    }

    // Build query
    let query = `
      SELECT 
        id,
        party_type,
        party_id,
        transaction_type,
        transaction_date AS date,
        transaction_date AS transaction_date,
        previous_balance,
        transaction_amount,
        paid_amount,
        balance_after,
        reference_id,
        bill_number,
        payment_method,
        payment_status,
        notes,
        previous_due_date,
        new_due_date,
        created_at AS transaction_timestamp
      FROM unified_transactions
      WHERE party_type = ? AND party_id = ?
    `;
    
    const params = [party_type, party_id];

    if (from_date) {
      query += ' AND transaction_date >= ?';
      params.push(from_date);
    }
    
    if (to_date) {
      query += ' AND transaction_date <= ?';
      params.push(to_date);
    }
    
    if (transaction_type) {
      query += ' AND transaction_type = ?';
      params.push(transaction_type);
    }

    // Get total count
    const countQuery = query.replace(
      /SELECT[\s\S]*FROM unified_transactions/,
      'SELECT COUNT(*) as total FROM unified_transactions'
    );
    const [countResult] = await pool.execute(countQuery, params);
    const totalRecords = countResult[0].total;
    const totalPages = Math.ceil(totalRecords / limitNum);

    // Get paginated results (newest first)
    query += ' ORDER BY transaction_date DESC, created_at DESC';
    query += ` LIMIT ${limitNum} OFFSET ${offset}`;

    const [transactions] = await pool.execute(query, params);
    const formattedTransactions = transactions.map((txn) => ({
      ...txn,
      previous_balance: txn.previous_balance != null ? parseFloat(txn.previous_balance) : 0,
      transaction_amount: txn.transaction_amount != null ? parseFloat(txn.transaction_amount) : 0,
      paid_amount: txn.paid_amount != null ? parseFloat(txn.paid_amount) : 0,
      balance_after: txn.balance_after != null ? parseFloat(txn.balance_after) : 0
    }));
    // const formattedTransactions = transactions.map(txn => ({
    //   ...txn,
    //   transaction_timestamp: txn.transaction_timestamp.toLocaleString('en-IN', {
    //     timeZone: 'Asia/Kolkata',
    //     hour12: false
    //   })
    // }));

    // Format response
    // const formattedTransactions = transactions.map(txn => ({
    //   id: txn.id,
    //   date: txn.date || txn.created_at,
    //   amount: parseFloat(txn.transaction_amount || 0),
    //   type: txn.transaction_type,
    //   description: getTransactionDescription(txn),
    //   bill_number: txn.bill_number,
    //   paid_amount: parseFloat(txn.paid_amount || 0),
    //   previous_balance: parseFloat(txn.previous_balance || 0),
    //   balance_amount: parseFloat(txn.balance_after || 0),
    //   payment_status: txn.payment_status,
    //   // created_at: txn.created_at,
    //   transaction_timestamp: txn.transaction_timestamp,
    //   payment_method: txn.payment_method,
    //   notes: txn.notes
    // }));

    res.json({
      transactions: formattedTransactions,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalRecords,
        totalPages
      }
    });
  } catch (error) {
    console.error('Get unified transactions error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Create a new transaction in unified_transactions
 * POST /api/unified-transactions
 */
router.post('/', authenticateToken, async (req, res) => {
  try {
    const {
      party_type,
      party_id,
      transaction_type,
      transaction_date,
      previous_balance,
      transaction_amount,
      paid_amount,
      balance_after,
      reference_id,
      bill_number,
      payment_method,
      payment_status,
      notes
    } = req.body;

    // Validate required fields
    if (!party_type || !party_id || !transaction_type) {
      return res.status(400).json({ error: 'party_type, party_id, and transaction_type are required' });
    }

    if (!['seller', 'buyer'].includes(party_type)) {
      return res.status(400).json({ error: 'Invalid party_type. Must be "seller" or "buyer"' });
    }

    if (!['sale', 'purchase', 'sale_payment', 'purchase_payment', 'payment', 'return'].includes(transaction_type)) {
      return res.status(400).json({ error: 'Invalid transaction_type' });
    }

    // Verify party exists
    const partyTable = party_type === 'seller' ? 'seller_parties' : 'buyer_parties';
    const [party] = await pool.execute(
      `SELECT id, balance_amount FROM ${partyTable} WHERE id = ?`,
      [party_id]
    );
    
    if (party.length === 0) {
      return res.status(404).json({ error: `${party_type} party not found` });
    }

    // Calculate values if not provided
    const prevBalance = previous_balance !== undefined ? parseFloat(previous_balance) : parseFloat(party[0].balance_amount || 0);
    const txnAmount = parseFloat(transaction_amount || 0);
    const paid = parseFloat(paid_amount || 0);
    const balance = balance_after !== undefined 
      ? parseFloat(balance_after) 
      : Math.max(0, prevBalance + txnAmount - paid);

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Insert into unified_transactions
      const [result] = await connection.execute(
        `INSERT INTO unified_transactions (
          party_type, party_id, transaction_type, transaction_date,
          previous_balance, transaction_amount, paid_amount, balance_after,
          reference_id, bill_number, payment_method, payment_status, notes, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          party_type,
          party_id,
          transaction_type,
          transaction_date || getLocalDateString(),
          prevBalance,
          txnAmount,
          paid,
          balance,
          reference_id || null,
          bill_number || null,
          payment_method || null,
          payment_status || null,
          notes || null,
          (req.user?.id ? parseInt(req.user.id) : null)
        ]
      );

      // Update party balance
      await connection.execute(
        `UPDATE ${partyTable} SET balance_amount = ? WHERE id = ?`,
        [balance, party_id]
      );

      await connection.commit();

      // Get created transaction
      const [created] = await connection.execute(
        'SELECT * FROM unified_transactions WHERE id = ?',
        [result.insertId]
      );

      res.json({
        message: 'Transaction created successfully',
        transaction: created[0]
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Create unified transaction error:', error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
});

/**
 * Get transaction by ID
 * GET /api/unified-transactions/:id
 */
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const [transactions] = await pool.execute(
      'SELECT * FROM unified_transactions WHERE id = ?',
      [req.params.id]
    );

    if (transactions.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json({ transaction: transactions[0] });
  } catch (error) {
    console.error('Get unified transaction error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Helper function to generate transaction description
 */
function getTransactionDescription(txn) {
  const type = txn.transaction_type;
  const billNumber = txn.bill_number || 'N/A';
  const paymentMethod = txn.payment_method || 'Cash';
  
  switch (type) {
    case 'sale':
      return `Sale - Bill #${billNumber}`;
    case 'purchase':
      return `Purchase - Bill #${billNumber}`;
    case 'sale_payment':
      return `Sale Payment - ${paymentMethod} (Receipt: ${billNumber})`;
    case 'purchase_payment':
      return `Purchase Payment - ${paymentMethod} (Receipt: ${billNumber})`;
    case 'payment':
      return `Payment - ${paymentMethod} (Receipt: ${billNumber})`;
    case 'return':
      return `Return - Bill #${billNumber}`;
    default:
      return 'Transaction';
  }
}

module.exports = router;
