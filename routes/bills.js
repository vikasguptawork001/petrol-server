const express = require('express');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { generateBillPDF, generateReturnBillPDF, generatePaymentReceiptPDF, generateReturnReceiptPDF, generatePaymentReceiptSmallPDF } = require('../utils/pdfGenerator');

const router = express.Router();

// Get bill PDF
router.get('/:id/pdf', authenticateToken, async (req, res) => {
  try {
    const [transactions] = await pool.execute(
      `SELECT st.*, sp.party_name, sp.mobile_number, sp.address, sp.email, sp.gst_number,
              a.name AS attendant_name, n.name AS nozzle_name,
              ut_due.new_due_date AS bill_due_date
       FROM sale_transactions st
       JOIN seller_parties sp ON st.seller_party_id = sp.id
       LEFT JOIN attendants a ON st.attendant_id = a.id
       LEFT JOIN nozzles n ON st.nozzle_id = n.id
       LEFT JOIN unified_transactions ut_due ON ut_due.reference_id = st.id
         AND ut_due.party_type = 'seller' AND ut_due.transaction_type = 'sale'
       WHERE st.id = ?`,
      [req.params.id]
    );

    if (transactions.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const transaction = transactions[0];
    
    // Calculate previous balance that was included in the grand total
    // The previous balance is automatically added to grand_total if seller had outstanding balance
    // Formula: previous_balance = grand_total - (subtotal + tax_amount)
    // This works because: grand_total = (subtotal + tax) + previous_balance
    // Note: grandTotal in DB is already rounded, so we need to account for rounding when calculating previous balance
    const subtotal = parseFloat(transaction.subtotal || 0);
    const taxAmount = parseFloat(transaction.tax_amount || 0);
    const grandTotal = parseFloat(transaction.total_amount || 0); // This is the rounded grand total
    
    // Calculate unrounded today's total
    const unroundedTodaysTotal = subtotal + taxAmount;
    
    // Calculate unrounded grand total (before rounding was applied)
    // Since grandTotal is rounded, we need to work backwards
    // The previous balance should be: grandTotal - unroundedTodaysTotal (but this might be off due to rounding)
    // Better approach: use previous_balance_paid if available, or calculate from difference
    let calculatedPreviousBalance = 0;
    if (transaction.previous_balance_paid !== undefined && transaction.previous_balance_paid !== null) {
      // Use the stored previous_balance_paid value if available
      calculatedPreviousBalance = parseFloat(transaction.previous_balance_paid || 0);
    } else {
      // Fallback: calculate from difference (may be slightly off due to rounding)
      calculatedPreviousBalance = Math.max(0, grandTotal - unroundedTodaysTotal);
    }
    
    // Only show previous balance if it's significant (> 0.01) to avoid rounding errors
    transaction.previous_balance = calculatedPreviousBalance > 0.01 ? calculatedPreviousBalance : 0;

    const [items] = await pool.execute(
      `SELECT si.*, i.product_name, i.brand, i.hsn_number, i.tax_rate,
              COALESCE(NULLIF(TRIM(si.unit), ''), NULLIF(TRIM(i.unit), ''), 'PCS') AS line_unit
       FROM sale_items si 
       JOIN items i ON si.item_id = i.id 
       WHERE si.sale_transaction_id = ?`,
      [req.params.id]
    );

    if (items.length === 0) {
      return res.status(404).json({ error: 'No items found for this transaction' });
    }

    // Generate PDF - handle errors within the function
    try {
      generateBillPDF(transaction, items, res);
    } catch (pdfError) {
      console.error('PDF generation error in route:', pdfError);
      // Only send error if headers haven't been sent
      if (!res.headersSent && !res.destroyed && !res.closed) {
        res.status(500).json({ error: 'Failed to generate PDF: ' + pdfError.message });
      }
    }
  } catch (error) {
    console.error('Generate PDF route error:', error);
    // Only send error response if headers haven't been sent and stream is still writable
    if (!res.headersSent && !res.destroyed && !res.closed) {
      try {
        res.status(500).json({ error: 'Server error: ' + error.message });
      } catch (responseError) {
        console.error('Error sending error response:', responseError);
      }
    }
  }
});

// Get return bill PDF
router.get('/return/:id/pdf', authenticateToken, async (req, res) => {
  try {
    // Check if new structure exists
    const [tableCheck] = await pool.execute(`
      SELECT COUNT(*) as count 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'return_items'
    `);
    const hasNewStructure = tableCheck[0].count > 0;

    if (hasNewStructure) {
      // New structure: Get return transaction with items
      const [returnTransactions] = await pool.execute(
        `SELECT rt.*, 
         ${req.query.party_type === 'buyer' 
           ? 'bp.party_name, bp.mobile_number, bp.address, bp.email, bp.gst_number' 
           : 'sp.party_name, sp.mobile_number, sp.address, sp.email, sp.gst_number'
         }
         FROM return_transactions rt
         ${req.query.party_type === 'buyer' 
           ? 'LEFT JOIN buyer_parties bp ON rt.buyer_party_id = bp.id' 
           : 'LEFT JOIN seller_parties sp ON rt.seller_party_id = sp.id'
         }
         WHERE rt.id = ?`,
        [req.params.id]
      );

      if (returnTransactions.length === 0) {
        return res.status(404).json({ error: 'Return transaction not found' });
      }

      const returnTransaction = returnTransactions[0];
      
      // Get return items
      const [returnItems] = await pool.execute(
        `SELECT ri.*, i.product_name, i.brand, i.hsn_number, i.tax_rate 
         FROM return_items ri 
         JOIN items i ON ri.item_id = i.id 
         WHERE ri.return_transaction_id = ?`,
        [req.params.id]
      );

      if (returnItems.length === 0) {
        return res.status(404).json({ error: 'No items found for this return transaction' });
      }

      // Format items for PDF
      const formattedItems = returnItems.map(item => ({
        ...item,
        itemDetails: {
          product_name: item.product_name,
          brand: item.brand,
          hsn_number: item.hsn_number
        }
      }));

      const party = {
        party_name: returnTransaction.party_name,
        mobile_number: returnTransaction.mobile_number,
        address: returnTransaction.address,
        email: returnTransaction.email,
        gst_number: returnTransaction.gst_number
      };

      try {
        generateReturnBillPDF(returnTransaction, formattedItems, party, res);
      } catch (pdfError) {
        console.error('PDF generation error in route:', pdfError);
        if (!res.headersSent && !res.destroyed && !res.closed) {
          res.status(500).json({ error: 'Failed to generate PDF: ' + pdfError.message });
        }
      }
    } else {
      return res.status(400).json({ error: 'Return bill PDF requires new database structure. Please run migration.' });
    }
  } catch (error) {
    console.error('Generate return bill PDF route error:', error);
    if (!res.headersSent && !res.destroyed && !res.closed) {
      try {
        res.status(500).json({ error: 'Server error: ' + error.message });
      } catch (responseError) {
        console.error('Error sending error response:', responseError);
      }
    }
  }
});

// Get payment receipt PDF
router.get('/payment/:id/pdf', authenticateToken, async (req, res) => {
  try {
    // Query from unified_transactions where transaction_type = 'payment'
    const [paymentTransactions] = await pool.execute(
      `SELECT ut.*, 
       ${req.query.party_type === 'buyer' 
         ? 'bp.party_name, bp.mobile_number, bp.address, bp.email, bp.gst_number' 
         : 'sp.party_name, sp.mobile_number, sp.address, sp.email, sp.gst_number'
       }
       FROM unified_transactions ut
       ${req.query.party_type === 'buyer' 
         ? 'LEFT JOIN buyer_parties bp ON ut.party_id = bp.id AND ut.party_type = "buyer"' 
         : 'LEFT JOIN seller_parties sp ON ut.party_id = sp.id AND ut.party_type = "seller"'
       }
       WHERE ut.id = ? AND ut.transaction_type = 'payment'`,
      [req.params.id]
    );

    if (paymentTransactions.length === 0) {
      return res.status(404).json({ error: 'Payment transaction not found' });
    }

    const unifiedTransaction = paymentTransactions[0];

    // Map unified_transactions fields to what PDF generator expects
    const paymentTransaction = {
      receipt_number: unifiedTransaction.bill_number || `REC-${unifiedTransaction.id}`,
      payment_date: unifiedTransaction.transaction_date,
      created_at: unifiedTransaction.created_at, // Include created_at for full timestamp
      previous_balance: unifiedTransaction.previous_balance,
      amount: unifiedTransaction.paid_amount,
      updated_balance: unifiedTransaction.balance_after,
      payment_method: unifiedTransaction.payment_method || 'Cash',
      notes: unifiedTransaction.notes,
      party_type: unifiedTransaction.party_type,
      new_due_date: unifiedTransaction.new_due_date
    };

    const party = {
      party_name: unifiedTransaction.party_name,
      mobile_number: unifiedTransaction.mobile_number,
      address: unifiedTransaction.address,
      email: unifiedTransaction.email,
      gst_number: unifiedTransaction.gst_number
    };

    try {
      generatePaymentReceiptPDF(paymentTransaction, party, res);
    } catch (pdfError) {
      console.error('PDF generation error in route:', pdfError);
      if (!res.headersSent && !res.destroyed && !res.closed) {
        res.status(500).json({ error: 'Failed to generate PDF: ' + pdfError.message });
      }
    }
  } catch (error) {
    console.error('Generate payment receipt PDF route error:', error);
    if (!res.headersSent && !res.destroyed && !res.closed) {
      try {
        res.status(500).json({ error: 'Server error: ' + error.message });
      } catch (responseError) {
        console.error('Error sending error response:', responseError);
      }
    }
  }
});

// Get return receipt PDF (small format)
router.get('/return/:id/receipt', authenticateToken, async (req, res) => {
  try {
    const [tableCheck] = await pool.execute(`
      SELECT COUNT(*) as count 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'return_items'
    `);
    const hasNewStructure = tableCheck[0].count > 0;

    if (hasNewStructure) {
      const [returnTransactions] = await pool.execute(
        `SELECT rt.*, 
         ${req.query.party_type === 'buyer' 
           ? 'bp.party_name, bp.mobile_number, bp.address, bp.email, bp.gst_number' 
           : 'sp.party_name, sp.mobile_number, sp.address, sp.email, sp.gst_number'
         }
         FROM return_transactions rt
         ${req.query.party_type === 'buyer' 
           ? 'LEFT JOIN buyer_parties bp ON rt.buyer_party_id = bp.id' 
           : 'LEFT JOIN seller_parties sp ON rt.seller_party_id = sp.id'
         }
         WHERE rt.id = ?`,
        [req.params.id]
      );

      if (returnTransactions.length === 0) {
        return res.status(404).json({ error: 'Return transaction not found' });
      }

      const returnTransaction = returnTransactions[0];
      
      const [returnItems] = await pool.execute(
        `SELECT ri.*, i.product_name, i.brand, i.hsn_number, i.tax_rate 
         FROM return_items ri 
         JOIN items i ON ri.item_id = i.id 
         WHERE ri.return_transaction_id = ?`,
        [req.params.id]
      );

      if (returnItems.length === 0) {
        return res.status(404).json({ error: 'No items found for this return transaction' });
      }

      // Calculate total return amount
      const totalAmount = returnItems.reduce((sum, item) => {
        return sum + (parseFloat(item.total_amount) || 0);
      }, 0);

      const formattedItems = returnItems.map(item => ({
        ...item,
        itemDetails: {
          product_name: item.product_name,
          brand: item.brand,
          hsn_number: item.hsn_number
        }
      }));

      const party = {
        party_name: returnTransaction.party_name,
        mobile_number: returnTransaction.mobile_number,
        address: returnTransaction.address,
        email: returnTransaction.email,
        gst_number: returnTransaction.gst_number
      };

      // Fetch balance information from unified_transactions
      let balanceInfo = null;
      try {
        const partyType = req.query.party_type || (returnTransaction.seller_party_id ? 'seller' : 'buyer');
        const partyId = returnTransaction.seller_party_id || returnTransaction.buyer_party_id;
        
        // Try to find the unified transaction by reference_id (return_transaction_id)
        let [unifiedTxns] = await pool.execute(
          `SELECT previous_balance, transaction_amount, paid_amount, balance_after
           FROM unified_transactions
           WHERE transaction_type = 'return'
             AND party_type = ?
             AND party_id = ?
             AND reference_id = ?
           ORDER BY id DESC
           LIMIT 1`,
          [partyType, partyId, req.params.id]
        );

        // If not found, try to find by matching transaction amount and date
        if (unifiedTxns.length === 0) {
          const returnAmount = totalAmount || parseFloat(returnTransaction.return_amount || 0);
          const returnDate = returnTransaction.return_date || returnTransaction.created_at;
          
          [unifiedTxns] = await pool.execute(
            `SELECT previous_balance, transaction_amount, paid_amount, balance_after, return_type
             FROM unified_transactions
             WHERE transaction_type = 'return'
               AND party_type = ?
               AND party_id = ?
               AND ABS(transaction_amount - ?) < 0.01
               AND DATE(transaction_date) = DATE(?)
             ORDER BY id DESC
             LIMIT 1`,
            [partyType, partyId, returnAmount, returnDate]
          );
        }

        if (unifiedTxns.length > 0) {
          const ut = unifiedTxns[0];
          const previousBalance = parseFloat(ut.previous_balance || 0);
          const returnAmount = parseFloat(ut.transaction_amount || returnTransaction.return_amount || 0);
          const adjustmentAmount = ut.return_type === 'adjust' ? returnAmount : 0;
          const newBalance = parseFloat(ut.balance_after || 0);
          const cashPaymentRequired = Math.max(0, returnAmount - previousBalance);

          balanceInfo = {
            previous_balance: previousBalance,
            return_amount: returnAmount,
            adjustment_amount: adjustmentAmount,
            new_balance: newBalance,
            cash_payment_required: cashPaymentRequired > 0 ? cashPaymentRequired : 0
          };
        }
      } catch (balanceError) {
        console.warn('Could not fetch balance information:', balanceError.message);
      }

      // Add balance info to returnTransaction object
      if (balanceInfo) {
        returnTransaction.warning = balanceInfo.cash_payment_required > 0 ? {
          requires_cash_payment: true,
          return_amount: balanceInfo.return_amount,
          current_balance: balanceInfo.previous_balance,
          adjustment_amount: balanceInfo.adjustment_amount,
          cash_payment_required: balanceInfo.cash_payment_required,
          new_balance: balanceInfo.new_balance
        } : null;
        returnTransaction.previous_balance = balanceInfo.previous_balance;
        returnTransaction.adjustment_amount = balanceInfo.adjustment_amount;
        returnTransaction.new_balance = balanceInfo.new_balance;
      } else {
        // If balanceInfo not found, try to get from party's current balance
        try {
          const partyType = req.query.party_type || (returnTransaction.seller_party_id ? 'seller' : 'buyer');
          const partyId = returnTransaction.seller_party_id || returnTransaction.buyer_party_id;
          const partyTable = partyType === 'seller' ? 'seller_parties' : 'buyer_parties';
          
          const [partyData] = await pool.execute(
            `SELECT balance_amount FROM ${partyTable} WHERE id = ?`,
            [partyId]
          );
          
          if (partyData.length > 0) {
            const currentBalance = parseFloat(partyData[0].balance_amount || 0);
            const returnAmount = totalAmount || parseFloat(returnTransaction.return_amount || 0);
            // For seller returns with adjust type, balance decreases
            const adjustmentAmount = returnTransaction.return_type === 'adjust' ? returnAmount : 0;
            const previousBalance = currentBalance + adjustmentAmount; // Reverse calculate
            const newBalance = currentBalance;
            
            returnTransaction.previous_balance = previousBalance;
            returnTransaction.adjustment_amount = adjustmentAmount;
            returnTransaction.new_balance = newBalance;
          }
        } catch (fallbackError) {
          console.warn('Could not fetch party balance as fallback:', fallbackError.message);
        }
      }

      try {
        generateReturnReceiptPDF(returnTransaction, formattedItems, party, res);
      } catch (pdfError) {
        console.error('PDF generation error in route:', pdfError);
        if (!res.headersSent && !res.destroyed && !res.closed) {
          res.status(500).json({ error: 'Failed to generate PDF: ' + pdfError.message });
        }
      }
    } else {
      return res.status(400).json({ error: 'Return receipt requires new database structure. Please run migration.' });
    }
  } catch (error) {
    console.error('Generate return receipt route error:', error);
    if (!res.headersSent && !res.destroyed && !res.closed) {
      try {
        res.status(500).json({ error: 'Server error: ' + error.message });
      } catch (responseError) {
        console.error('Error sending error response:', responseError);
      }
    }
  }
});

// Get payment receipt PDF (small format)
router.get('/payment/:id/receipt', authenticateToken, async (req, res) => {
  try {
    // Query from unified_transactions where transaction_type = 'payment'
    const [paymentTransactions] = await pool.execute(
      `SELECT ut.*, 
       ${req.query.party_type === 'buyer' 
         ? 'bp.party_name, bp.mobile_number, bp.address, bp.email, bp.gst_number' 
         : 'sp.party_name, sp.mobile_number, sp.address, sp.email, sp.gst_number'
       }
       FROM unified_transactions ut
       ${req.query.party_type === 'buyer' 
         ? 'LEFT JOIN buyer_parties bp ON ut.party_id = bp.id AND ut.party_type = "buyer"' 
         : 'LEFT JOIN seller_parties sp ON ut.party_id = sp.id AND ut.party_type = "seller"'
       }
       WHERE ut.id = ? AND ut.transaction_type = 'payment'`,
      [req.params.id]
    );

    if (paymentTransactions.length === 0) {
      return res.status(404).json({ error: 'Payment transaction not found' });
    }

    const unifiedTransaction = paymentTransactions[0];

    // Map unified_transactions fields to what PDF generator expects
    const paymentTransaction = {
      receipt_number: unifiedTransaction.bill_number || `REC-${unifiedTransaction.id}`,
      payment_date: unifiedTransaction.transaction_date,
      created_at: unifiedTransaction.created_at, // Include created_at for full timestamp
      previous_balance: unifiedTransaction.previous_balance,
      amount: unifiedTransaction.paid_amount,
      updated_balance: unifiedTransaction.balance_after,
      payment_method: unifiedTransaction.payment_method || 'Cash',
      notes: unifiedTransaction.notes,
      party_type: unifiedTransaction.party_type,
      new_due_date: unifiedTransaction.new_due_date
    };

    const party = {
      party_name: unifiedTransaction.party_name,
      mobile_number: unifiedTransaction.mobile_number,
      address: unifiedTransaction.address,
      email: unifiedTransaction.email,
      gst_number: unifiedTransaction.gst_number
    };

    try {
      generatePaymentReceiptSmallPDF(paymentTransaction, party, res);
    } catch (pdfError) {
      console.error('PDF generation error in route:', pdfError);
      if (!res.headersSent && !res.destroyed && !res.closed) {
        res.status(500).json({ error: 'Failed to generate PDF: ' + pdfError.message });
      }
    }
  } catch (error) {
    console.error('Generate payment receipt route error:', error);
    if (!res.headersSent && !res.destroyed && !res.closed) {
      try {
        res.status(500).json({ error: 'Server error: ' + error.message });
      } catch (responseError) {
        console.error('Error sending error response:', responseError);
      }
    }
  }
});

module.exports = router;




