const express = require('express');
const pool = require('../config/database');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { validateParty } = require('../middleware/validation');
const { getLocalDateString } = require('../utils/dateUtils');

const router = express.Router();

// Helper function to check for duplicate mobile/email (excludes archived parties)
async function checkDuplicateMobileEmail(table, mobile_number, email, excludeId = null) {
  const conditions = [];
  const params = [];
  
  if (mobile_number && mobile_number.trim() !== '') {
    conditions.push('mobile_number = ?');
    params.push(mobile_number.trim());
  }
  
  if (email && email.trim() !== '') {
    conditions.push('email = ?');
    params.push(email.trim().toLowerCase());
  }
  
  if (conditions.length === 0) {
    return { mobileExists: false, emailExists: false };
  }
  
  let query = `SELECT id, mobile_number, email FROM ${table} WHERE (${conditions.join(' OR ')}) AND (is_archived = FALSE OR is_archived IS NULL)`;
  
  if (excludeId) {
    query += ' AND id != ?';
    params.push(parseInt(excludeId));
  }
  
  const [results] = await pool.execute(query, params);
  
  const mobileExists = results.some(r => r.mobile_number && r.mobile_number === mobile_number?.trim());
  const emailExists = results.some(r => r.email && r.email.toLowerCase() === email?.trim().toLowerCase());
  
  return { mobileExists, emailExists };
}

// Get all buyer parties
router.get('/buyers', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10000, include_archived = false } = req.query;
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10000;
    const offset = (pageNum - 1) * limitNum;
    const includeArchived = include_archived === 'true' || include_archived === true;

    // Build WHERE clause to exclude archived parties by default
    const whereClause = includeArchived ? '' : 'WHERE is_archived = FALSE';

    // Get total count
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM buyer_parties ${whereClause}`
    );
    const totalRecords = countResult[0].total;
    const totalPages = Math.ceil(totalRecords / limitNum);

    // Get paginated data
    // Note: LIMIT and OFFSET cannot use placeholders in prepared statements, so we use template literals
    const [parties] = await pool.execute(
      `SELECT * FROM buyer_parties ${whereClause} ORDER BY party_name LIMIT ${limitNum} OFFSET ${offset}`
    );
    
    res.json({ 
      parties,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalRecords,
        totalPages
      }
    });
  } catch (error) {
    console.error('Get buyer parties error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get retail buyer party (default for quick sale)
router.get('/buyers/retail', authenticateToken, async (req, res) => {
  try {
    const [parties] = await pool.execute(
      "SELECT * FROM buyer_parties WHERE party_name = 'Retail Buyer' AND (is_archived = FALSE OR is_archived IS NULL) LIMIT 1"
    );
    if (parties.length === 0) {
      return res.status(404).json({ error: 'Retail Buyer party not found. Please create it first.' });
    }
    res.json({ party: parties[0] });
  } catch (error) {
    console.error('Get retail buyer error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get retail seller party (for quick sale)
router.get('/sellers/retail', authenticateToken, async (req, res) => {
  try {
    const [parties] = await pool.execute(
      "SELECT * FROM seller_parties WHERE party_name = 'quick_sell' LIMIT 1"
    );
    if (parties.length === 0) {
      return res.status(404).json({ error: 'Retail Seller party not found. Please create it first.' });
    }
    res.json({ party: parties[0] });
  } catch (error) {
    console.error('Get retail seller error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single buyer party
router.get('/buyers/:id', authenticateToken, async (req, res) => {
  try {
    const [parties] = await pool.execute('SELECT * FROM buyer_parties WHERE id = ?', [req.params.id]);
    if (parties.length === 0) {
      return res.status(404).json({ error: 'Buyer party not found' });
    }
    res.json({ party: parties[0] });
  } catch (error) {
    console.error('Get buyer party error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add buyer party (only admin and super_admin)
router.post('/buyers', authenticateToken, authorizeRole('admin', 'super_admin'), validateParty, async (req, res) => {
  try {
    const {
      party_name,
      mobile_number,
      email,
      address,
      opening_balance,
      closing_balance,
      gst_number
    } = req.body;

    // Validate GST number (alphanumeric, max 20 chars)
    if (gst_number && (gst_number.length > 20 || !/^[A-Za-z0-9]+$/.test(gst_number))) {
      return res.status(400).json({ error: 'GST number must be alphanumeric and maximum 20 characters' });
    }

    // Check for duplicate mobile number and email
    const { mobileExists, emailExists } = await checkDuplicateMobileEmail('buyer_parties', mobile_number, email);
    if (mobileExists) {
      return res.status(400).json({ error: 'Mobile number already exists' });
    }
    if (emailExists) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const [result] = await pool.execute(
      `INSERT INTO buyer_parties (party_name, mobile_number, email, address, opening_balance, closing_balance, balance_amount, gst_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [party_name, mobile_number || null, email ? email.toLowerCase() : null, address, opening_balance || 0, closing_balance || 0, opening_balance || 0, gst_number || null]
    );

    res.json({ message: 'Buyer party added successfully', id: result.insertId });
  } catch (error) {
    console.error('Add buyer party error:', error);
    // Handle MySQL duplicate entry error
    if (error.code === 'ER_DUP_ENTRY') {
      if (error.sqlMessage.includes('mobile_number')) {
        return res.status(400).json({ error: 'Mobile number already exists' });
      }
      if (error.sqlMessage.includes('email')) {
        return res.status(400).json({ error: 'Email already exists' });
      }
      return res.status(400).json({ error: 'Duplicate entry detected' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// Update buyer party (only admin and super_admin)
router.patch('/buyers/:id', authenticateToken, authorizeRole('admin', 'super_admin'), async (req, res) => {
  try {
    const {
      party_name,
      mobile_number,
      email,
      address,
      opening_balance,
      closing_balance,
      gst_number
    } = req.body;

    // Get existing party to check current values
    const [existingParties] = await pool.execute('SELECT * FROM buyer_parties WHERE id = ?', [req.params.id]);
    if (existingParties.length === 0) {
      return res.status(404).json({ error: 'Buyer party not found' });
    }
    const existingParty = existingParties[0];

    // Check if party is archived
    if (existingParty.is_archived) {
      return res.status(400).json({ error: 'Cannot update archived buyer party. Please restore it first.' });
    }

    const updateFields = [];
    const params = [];

    // Only update fields that are provided
    if (party_name !== undefined) {
      updateFields.push('party_name = ?');
      params.push(party_name);
    }

    if (mobile_number !== undefined) {
      updateFields.push('mobile_number = ?');
      params.push(mobile_number || null);
    }

    if (email !== undefined) {
      updateFields.push('email = ?');
      params.push(email ? email.toLowerCase() : null);
    }

    if (address !== undefined) {
      updateFields.push('address = ?');
      params.push(address);
    }

    if (opening_balance !== undefined) {
      updateFields.push('opening_balance = ?');
      params.push(opening_balance);
    }

    if (closing_balance !== undefined) {
      updateFields.push('closing_balance = ?');
      params.push(closing_balance);
    }

    if (gst_number !== undefined) {
      // Validate GST number (alphanumeric, max 20 chars)
      if (gst_number && (gst_number.length > 20 || !/^[A-Za-z0-9]+$/.test(gst_number))) {
        return res.status(400).json({ error: 'GST number must be alphanumeric and maximum 20 characters' });
      }
      updateFields.push('gst_number = ?');
      params.push(gst_number || null);
    }

    // If no fields to update, return error
    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields provided to update' });
    }

    // Check for duplicate mobile number and email only if they are being updated
    const finalMobileNumber = mobile_number !== undefined ? mobile_number : existingParty.mobile_number;
    const finalEmail = email !== undefined ? email : existingParty.email;
    
    if (mobile_number !== undefined || email !== undefined) {
      const { mobileExists, emailExists } = await checkDuplicateMobileEmail('buyer_parties', finalMobileNumber, finalEmail, req.params.id);
      if (mobileExists) {
        return res.status(400).json({ error: 'Mobile number already exists' });
      }
      if (emailExists) {
        return res.status(400).json({ error: 'Email already exists' });
      }
    }

    params.push(req.params.id);
    const query = `UPDATE buyer_parties SET ${updateFields.join(', ')} WHERE id = ?`;
    await pool.execute(query, params);

    res.json({ message: 'Buyer party updated successfully' });
  } catch (error) {
    console.error('Update buyer party error:', error);
    // Handle MySQL duplicate entry error
    if (error.code === 'ER_DUP_ENTRY') {
      if (error.sqlMessage.includes('mobile_number')) {
        return res.status(400).json({ error: 'Mobile number already exists' });
      }
      if (error.sqlMessage.includes('email')) {
        return res.status(400).json({ error: 'Email already exists' });
      }
      return res.status(400).json({ error: 'Duplicate entry detected' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// Archive buyer party (only admin and super_admin)
router.delete('/buyers/:id', authenticateToken, authorizeRole('admin', 'super_admin'), async (req, res) => {
  try {
    // Check if party exists
    const [parties] = await pool.execute('SELECT * FROM buyer_parties WHERE id = ?', [req.params.id]);
    if (parties.length === 0) {
      return res.status(404).json({ error: 'Buyer party not found' });
    }

    const party = parties[0];

    // Check if already archived
    if (party.is_archived) {
      return res.status(400).json({ error: 'Buyer party is already archived' });
    }

    // Archive the party (soft delete)
    await pool.execute('UPDATE buyer_parties SET is_archived = TRUE WHERE id = ?', [req.params.id]);

    res.json({ message: 'Buyer party archived successfully' });
  } catch (error) {
    console.error('Archive buyer party error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Restore archived buyer party (only admin and super_admin)
router.patch('/buyers/:id/restore', authenticateToken, authorizeRole('admin', 'super_admin'), async (req, res) => {
  try {
    // Check if party exists
    const [parties] = await pool.execute('SELECT * FROM buyer_parties WHERE id = ?', [req.params.id]);
    if (parties.length === 0) {
      return res.status(404).json({ error: 'Buyer party not found' });
    }

    const party = parties[0];

    // Check if already not archived
    if (!party.is_archived) {
      return res.status(400).json({ error: 'Buyer party is not archived' });
    }

    // Restore the party
    await pool.execute('UPDATE buyer_parties SET is_archived = FALSE WHERE id = ?', [req.params.id]);

    res.json({ message: 'Buyer party restored successfully' });
  } catch (error) {
    console.error('Restore buyer party error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all seller parties
router.get('/sellers', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10000, include_archived = false } = req.query;
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10000;
    const offset = (pageNum - 1) * limitNum;
    // Seller list: do not filter by is_archived (column may be missing in seller_parties)
    const whereClause = '';

    // Get total count
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM seller_parties ${whereClause}`
    );
    const totalRecords = countResult[0].total;
    const totalPages = Math.ceil(totalRecords / limitNum);

    // Get paginated data
    const [parties] = await pool.execute(
      `SELECT * FROM seller_parties ${whereClause} ORDER BY party_name LIMIT ${limitNum} OFFSET ${offset}`
    );
    
    res.json({ 
      parties,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalRecords,
        totalPages
      }
    });
  } catch (error) {
    console.error('Get seller parties error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Due Sheet: list creditor parties (seller_parties) with outstanding balance — must be before /sellers/:id
router.get('/sellers/due-sheet', authenticateToken, authorizeRole('super_admin'), async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      from_due_date,
      to_due_date,
      search = '',
      overdue_only
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(200, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    const params = [];
    let where = 'WHERE balance_amount > 0';

    /** When true, only creditors whose due date is in the past (overdue) — matches summary overdue_count logic */
    const overdueOnly =
      overdue_only === true ||
      overdue_only === 'true' ||
      overdue_only === '1' ||
      overdue_only === 1;

    if (overdueOnly) {
      where += ' AND due_date IS NOT NULL AND due_date < CURDATE()';
    }

    if (from_due_date) {
      where += ' AND (due_date IS NULL OR due_date >= ?)';
      params.push(from_due_date);
    }

    if (to_due_date) {
      where += ' AND (due_date IS NULL OR due_date <= ?)';
      params.push(to_due_date);
    }

    if (search && search.trim() !== '') {
      const q = `%${search.trim()}%`;
      where += ' AND (party_name LIKE ? OR mobile_number LIKE ? OR address LIKE ? OR vehicle_number LIKE ?)';
      params.push(q, q, q, q);
    }

    const [countRows] = await pool.execute(
      `SELECT 
         COUNT(*) AS total_creditors,
         COALESCE(SUM(balance_amount), 0) AS total_balance,
         COALESCE(SUM(CASE WHEN due_date IS NOT NULL AND due_date < CURDATE() THEN 1 ELSE 0 END), 0) AS overdue_count
       FROM seller_parties
       ${where}`,
      params
    );

    const totalRecords = countRows[0].total_creditors || 0;
    const totalPages = Math.max(1, Math.ceil(totalRecords / limitNum) || 1);

    const [rows] = await pool.execute(
      `SELECT 
         id,
         party_name,
         mobile_number,
         email,
         address,
         vehicle_number,
         opening_balance,
         closing_balance,
         paid_amount,
         balance_amount,
         due_date,
         created_at,
         updated_at
       FROM seller_parties
       ${where}
       ORDER BY 
         CASE WHEN due_date IS NULL THEN 1 ELSE 0 END,
         due_date ASC,
         party_name ASC
       LIMIT ${limitNum} OFFSET ${offset}`,
      params
    );

    res.json({
      parties: rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalRecords,
        totalPages
      },
      summary: {
        total_creditors: countRows[0].total_creditors || 0,
        total_balance: countRows[0].total_balance || 0,
        overdue_count: countRows[0].overdue_count || 0
      }
    });
  } catch (error) {
    console.error('Get due sheet error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Lightweight due alerts for popup on app launch — must be before /sellers/:id
router.get('/sellers/due-alerts', authenticateToken, authorizeRole('super_admin'), async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const limitNum = Math.max(1, Math.min(50, parseInt(limit, 10) || 10));

    const [rows] = await pool.execute(
      `SELECT 
         id,
         party_name,
         mobile_number,
         balance_amount,
         due_date
       FROM seller_parties
       WHERE balance_amount > 0
         AND due_date IS NOT NULL
         AND due_date <= CURDATE()
       ORDER BY due_date ASC, balance_amount DESC
       LIMIT ${limitNum}`
    );

    res.json({ parties: rows });
  } catch (error) {
    console.error('Get due alerts error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single seller party
router.get('/sellers/:id', authenticateToken, async (req, res) => {
  try {
    const [parties] = await pool.execute('SELECT * FROM seller_parties WHERE id = ?', [req.params.id]);
    if (parties.length === 0) {
      return res.status(404).json({ error: 'Seller party not found' });
    }
    res.json({ party: parties[0] });
  } catch (error) {
    console.error('Get seller party error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add seller party / creditor (only admin and super_admin)
router.post('/sellers', authenticateToken, authorizeRole('admin', 'super_admin'), validateParty, async (req, res) => {
  try {
    const {
      party_name,
      mobile_number,
      email,
      address,
      opening_balance,
      closing_balance,
      gst_number,
      due_date,
      vehicle_number
    } = req.body;

    // Validate GST number (alphanumeric, max 20 chars)
    if (gst_number && (gst_number.length > 20 || !/^[A-Za-z0-9]+$/.test(gst_number))) {
      return res.status(400).json({ error: 'GST number must be alphanumeric and maximum 20 characters' });
    }

    // Check for duplicate mobile number and email
    const { mobileExists, emailExists } = await checkDuplicateMobileEmail('seller_parties', mobile_number, email);
    if (mobileExists) {
      return res.status(400).json({ error: 'Mobile number already exists' });
    }
    if (emailExists) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const [result] = await pool.execute(
      `INSERT INTO seller_parties (party_name, mobile_number, email, address, opening_balance, closing_balance, balance_amount, gst_number, due_date, vehicle_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [party_name, mobile_number || null, email ? email.toLowerCase() : null, address || null, opening_balance || 0, closing_balance || 0, opening_balance || 0, gst_number || null, due_date || null, vehicle_number ? vehicle_number.trim() : null]
    );

    res.json({ message: 'Creditor party added successfully', id: result.insertId });
  } catch (error) {
    console.error('Add seller party error:', error);
    // Handle MySQL duplicate entry error
    if (error.code === 'ER_DUP_ENTRY') {
      if (error.sqlMessage.includes('mobile_number')) {
        return res.status(400).json({ error: 'Mobile number already exists' });
      }
      if (error.sqlMessage.includes('email')) {
        return res.status(400).json({ error: 'Email already exists' });
      }
      return res.status(400).json({ error: 'Duplicate entry detected' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// Update seller party / creditor (only admin and super_admin)
router.patch('/sellers/:id', authenticateToken, authorizeRole('admin', 'super_admin'), async (req, res) => {
  try {
    const {
      party_name,
      mobile_number,
      email,
      address,
      opening_balance,
      closing_balance,
      gst_number,
      due_date,
      vehicle_number
    } = req.body;

    // Get existing party to check current values
    const [existingParties] = await pool.execute('SELECT * FROM seller_parties WHERE id = ?', [req.params.id]);
    if (existingParties.length === 0) {
      return res.status(404).json({ error: 'Seller party not found' });
    }
    const existingParty = existingParties[0];

    // Check if party is archived
    if (existingParty.is_archived) {
      return res.status(400).json({ error: 'Cannot update archived seller party. Please restore it first.' });
    }

    const updateFields = [];
    const params = [];

    // Only update fields that are provided
    if (party_name !== undefined) {
      updateFields.push('party_name = ?');
      params.push(party_name);
    }

    if (mobile_number !== undefined) {
      updateFields.push('mobile_number = ?');
      params.push(mobile_number || null);
    }

    if (email !== undefined) {
      updateFields.push('email = ?');
      params.push(email ? email.toLowerCase() : null);
    }

    if (address !== undefined) {
      updateFields.push('address = ?');
      params.push(address);
    }

    if (opening_balance !== undefined) {
      updateFields.push('opening_balance = ?');
      params.push(opening_balance);
    }

    if (closing_balance !== undefined) {
      updateFields.push('closing_balance = ?');
      params.push(closing_balance);
    }

    if (gst_number !== undefined) {
      // Validate GST number (alphanumeric, max 20 chars)
      if (gst_number && (gst_number.length > 20 || !/^[A-Za-z0-9]+$/.test(gst_number))) {
        return res.status(400).json({ error: 'GST number must be alphanumeric and maximum 20 characters' });
      }
      updateFields.push('gst_number = ?');
      params.push(gst_number || null);
    }

    if (due_date !== undefined) {
      updateFields.push('due_date = ?');
      params.push(due_date === null || due_date === '' ? null : due_date);
    }

    if (vehicle_number !== undefined) {
      updateFields.push('vehicle_number = ?');
      params.push(vehicle_number === null || vehicle_number === '' ? null : (vehicle_number || null));
    }

    // If no fields to update, return error
    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields provided to update' });
    }

    // Check for duplicate mobile number and email only if they are being updated
    const finalMobileNumber = mobile_number !== undefined ? mobile_number : existingParty.mobile_number;
    const finalEmail = email !== undefined ? email : existingParty.email;
    
    if (mobile_number !== undefined || email !== undefined) {
      const { mobileExists, emailExists } = await checkDuplicateMobileEmail('seller_parties', finalMobileNumber, finalEmail, req.params.id);
      if (mobileExists) {
        return res.status(400).json({ error: 'Mobile number already exists' });
      }
      if (emailExists) {
        return res.status(400).json({ error: 'Email already exists' });
      }
    }

    params.push(req.params.id);
    const query = `UPDATE seller_parties SET ${updateFields.join(', ')} WHERE id = ?`;
    await pool.execute(query, params);

    res.json({ message: 'Seller party updated successfully' });
  } catch (error) {
    console.error('Update seller party error:', error);
    // Handle MySQL duplicate entry error
    if (error.code === 'ER_DUP_ENTRY') {
      if (error.sqlMessage.includes('mobile_number')) {
        return res.status(400).json({ error: 'Mobile number already exists' });
      }
      if (error.sqlMessage.includes('email')) {
        return res.status(400).json({ error: 'Email already exists' });
      }
      return res.status(400).json({ error: 'Duplicate entry detected' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// Archive seller party / creditor (only super_admin can delete/archive)
router.delete('/sellers/:id', authenticateToken, authorizeRole('super_admin'), async (req, res) => {
  try {
    // Check if party exists
    const [parties] = await pool.execute('SELECT * FROM seller_parties WHERE id = ?', [req.params.id]);
    if (parties.length === 0) {
      return res.status(404).json({ error: 'Seller party not found' });
    }

    const party = parties[0];

    // Check if already archived
    if (party.is_archived) {
      return res.status(400).json({ error: 'Seller party is already archived' });
    }

    // Archive the party (soft delete)
    await pool.execute('UPDATE seller_parties SET is_archived = TRUE WHERE id = ?', [req.params.id]);

    res.json({ message: 'Seller party archived successfully' });
  } catch (error) {
    console.error('Archive seller party error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Restore archived seller party (only admin and super_admin)
router.patch('/sellers/:id/restore', authenticateToken, authorizeRole('admin', 'super_admin'), async (req, res) => {
  try {
    // Check if party exists
    const [parties] = await pool.execute('SELECT * FROM seller_parties WHERE id = ?', [req.params.id]);
    if (parties.length === 0) {
      return res.status(404).json({ error: 'Seller party not found' });
    }

    const party = parties[0];

    // Check if already not archived
    if (!party.is_archived) {
      return res.status(400).json({ error: 'Seller party is not archived' });
    }

    // Restore the party
    await pool.execute('UPDATE seller_parties SET is_archived = FALSE WHERE id = ?', [req.params.id]);

    res.json({ message: 'Seller party restored successfully' });
  } catch (error) {
    console.error('Restore seller party error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get buyer party transaction history
// router.get('/buyers/:id/transactions', authenticateToken, async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { page = 1, limit = 20 } = req.query;
//     const pageNum = parseInt(page, 10) || 1;
//     const limitNum = parseInt(limit, 10) || 20;
//     const offset = (pageNum - 1) * limitNum;

//     // Verify party exists and get balance
//     const [partyCheck] = await pool.execute('SELECT id, balance_amount FROM buyer_parties WHERE id = ?', [id]);
//     if (partyCheck.length === 0) {
//       return res.status(404).json({ error: 'Buyer party not found' });
//     }
//     const party = partyCheck[0];

//     // Get purchase transactions - Group by transaction_date and time window (within 5 seconds) to show one record per purchase
//     // Link payments made at the same time (within 5 seconds) to the purchase
//     // Group purchases that are within 5 seconds of each other as they're likely from the same transaction
//     const [purchases] = await pool.execute(
//       `SELECT 
//         MIN(pt.id) as id,
//         pt.transaction_date as date,
//         SUM(pt.total_amount) as amount,
//         'purchase' as type,
//         CONCAT('Purchase - ', COUNT(DISTINCT pt.id), ' item(s)') as description,
//         CONCAT('PUR-', DATE_FORMAT(pt.transaction_date, '%Y%m%d'), '-', MIN(pt.id)) as bill_number,
//         COALESCE(SUM(pay.amount), 0) as paid_amount,
//         NULL as balance_amount,
//         CASE 
//           WHEN COALESCE(SUM(pay.amount), 0) >= SUM(pt.total_amount) THEN 'fully_paid'
//           WHEN COALESCE(SUM(pay.amount), 0) > 0 THEN 'partially_paid'
//           ELSE 'unpaid'
//         END as payment_status,
//         MIN(pt.created_at) as created_at,
//         COUNT(DISTINCT pt.id) as item_count,
//         GROUP_CONCAT(DISTINCT CONCAT(i.product_name, ' (', pt.quantity, ')') ORDER BY pt.id SEPARATOR ', ') as items_summary,
//         MIN(pt.created_at) as purchase_timestamp
//       FROM purchase_transactions pt
//       JOIN items i ON pt.item_id = i.id
//       LEFT JOIN payment_transactions pay ON 
//         pay.party_type = 'buyer' 
//         AND pay.party_id = pt.buyer_party_id
//         AND ABS(TIMESTAMPDIFF(SECOND, pt.created_at, pay.created_at)) <= 5
//         AND pay.payment_date = pt.transaction_date
//       WHERE pt.buyer_party_id = ?
//       GROUP BY 
//         pt.transaction_date, 
//         pt.buyer_party_id,
//         FLOOR(UNIX_TIMESTAMP(pt.created_at) / 5)
//       ORDER BY pt.transaction_date DESC, MIN(pt.created_at) DESC
//       LIMIT ${limitNum} OFFSET ${offset}`,
//       [id]
//     );

//     // Get return transactions (buyer returns - check structure)
//     let returns = [];
//     try {
//       // Check if new structure exists
//       const [tableCheck] = await pool.execute(`
//         SELECT COUNT(*) as count 
//         FROM INFORMATION_SCHEMA.TABLES 
//         WHERE TABLE_SCHEMA = DATABASE() 
//         AND TABLE_NAME = 'return_items'
//       `);
//       const hasNewStructure = tableCheck[0].count > 0;

//       if (hasNewStructure) {
//         // New structure: one record per return transaction
//         const [returnRows] = await pool.execute(
//           `SELECT 
//             rt.id,
//             rt.return_date as date,
//             rt.total_amount as amount,
//             'return' as type,
//             CONCAT('Return - ', COUNT(DISTINCT ri.id), ' item(s)') as description,
//             rt.bill_number,
//             NULL as paid_amount,
//             NULL as balance_amount,
//             NULL as payment_status,
//             rt.created_at,
//             COUNT(DISTINCT ri.id) as item_count,
//             GROUP_CONCAT(DISTINCT CONCAT(i.product_name, ' (', ri.quantity, ')') SEPARATOR ', ') as items_summary
//           FROM return_transactions rt
//           LEFT JOIN return_items ri ON rt.id = ri.return_transaction_id
//           LEFT JOIN items i ON ri.item_id = i.id
//           WHERE rt.buyer_party_id = ? AND rt.party_type = 'buyer'
//           GROUP BY rt.id, rt.return_date, rt.total_amount, rt.bill_number, rt.created_at
//           ORDER BY rt.return_date DESC, rt.created_at DESC
//           LIMIT ${limitNum} OFFSET ${offset}`,
//           [id]
//         );
//         returns = returnRows;
//       } else {
//         // Old structure: group by return_date and created_at
//         const [returnCheck] = await pool.execute(`
//           SELECT COLUMN_NAME 
//           FROM INFORMATION_SCHEMA.COLUMNS 
//           WHERE TABLE_SCHEMA = DATABASE() 
//           AND TABLE_NAME = 'return_transactions' 
//           AND COLUMN_NAME = 'buyer_party_id'
//         `);
        
//         if (returnCheck.length > 0) {
//           const [returnRows] = await pool.execute(
//             `SELECT 
//               MIN(rt.id) as id,
//               rt.return_date as date,
//               SUM(rt.return_amount) as amount,
//               'return' as type,
//               CONCAT('Return - ', COUNT(DISTINCT rt.id), ' item(s)') as description,
//               NULL as bill_number,
//               NULL as paid_amount,
//               NULL as balance_amount,
//               NULL as payment_status,
//               MIN(rt.created_at) as created_at,
//               COUNT(DISTINCT rt.id) as item_count,
//               GROUP_CONCAT(DISTINCT CONCAT(i.product_name, ' (', rt.quantity, ')') SEPARATOR ', ') as items_summary
//             FROM return_transactions rt
//             JOIN items i ON rt.item_id = i.id
//             WHERE rt.buyer_party_id = ?
//             GROUP BY rt.return_date, DATE_FORMAT(rt.created_at, '%Y-%m-%d %H:%i:%s')
//             ORDER BY rt.return_date DESC, MIN(rt.created_at) DESC
//             LIMIT ${limitNum} OFFSET ${offset}`,
//             [id]
//           );
//           returns = returnRows;
//         }
//       }
//     } catch (err) {
//       // buyer_party_id column doesn't exist, skip buyer returns
//     }

//     // Get standalone payment transactions (payments not linked to purchases)
//     // These are payments made separately, not as part of a purchase transaction
//     let payments = [];
//     try {
//       const [paymentCheck] = await pool.execute(`
//         SELECT COUNT(*) as count 
//         FROM INFORMATION_SCHEMA.TABLES 
//         WHERE TABLE_SCHEMA = DATABASE() 
//         AND TABLE_NAME = 'payment_transactions'
//       `);
      
//       if (paymentCheck[0].count > 0) {
//         const [paymentRows] = await pool.execute(
//           `SELECT 
//             pt.id,
//             pt.payment_date as date,
//             pt.amount,
//             'payment' as type,
//             CONCAT('Payment - ', pt.payment_method, ' (Receipt: ', pt.receipt_number, ')') as description,
//             pt.receipt_number as bill_number,
//             pt.amount as paid_amount,
//             pt.previous_balance,
//             pt.updated_balance as balance_amount,
//             NULL as payment_status,
//             pt.created_at,
//             pt.payment_date,
//             pt.created_at as transaction_timestamp,
//             pt.payment_method,
//             pt.notes
//           FROM payment_transactions pt
//           LEFT JOIN purchase_transactions pur ON 
//             pur.buyer_party_id = pt.party_id
//             AND ABS(TIMESTAMPDIFF(SECOND, pur.created_at, pt.created_at)) <= 5
//             AND pur.transaction_date = pt.payment_date
//           WHERE pt.party_type = 'buyer' 
//             AND pt.party_id = ?
//             AND pur.id IS NULL
//           ORDER BY pt.payment_date DESC, pt.created_at DESC
//           LIMIT ${limitNum} OFFSET ${offset}`,
//           [id]
//         );
//         payments = paymentRows;
//       }
//     } catch (err) {
//       // Payment table doesn't exist, skip
//     }

//     // Combine all transactions and sort by date (newest first for backwards calculation)
//     const allTransactionsUnsorted = [...purchases, ...returns, ...payments];
//     const allTransactionsSorted = allTransactionsUnsorted.sort((a, b) => {
//       const dateA = new Date(a.date || a.created_at || a.transaction_timestamp);
//       const dateB = new Date(b.date || b.created_at || b.transaction_timestamp);
//       return dateB - dateA; // Newest first
//     });

//     // Calculate running balance backwards from current balance (newest to oldest)
//     // This ensures correct balance even with pagination
//     let runningBalance = parseFloat(party.balance_amount || 0);
    
//     const transactionsWithBalance = allTransactionsSorted.map(txn => {
//       const txnAmount = parseFloat(txn.amount || txn.total_amount || 0) || 0;
//       const txnPaid = parseFloat(txn.paid_amount || (txn.type === 'payment' ? txn.amount : 0) || 0) || 0;
      
//       // Balance AFTER this transaction (current running balance)
//       const balanceAfter = runningBalance;
      
//       // Calculate balance BEFORE this transaction by reversing the effect
//       // Update balance based on transaction type (for buyers)
//       if (txn.type === 'purchase') {
//         // Purchase increases balance, payment decreases it
//         // Balance before = after - purchase amount + payment amount
//         const purchaseAmount = txnAmount;
//         const paymentAmount = txnPaid;
//         runningBalance = Math.max(0, runningBalance - purchaseAmount + paymentAmount);
//       } else if (txn.type === 'payment') {
//         // Payment decreases balance, so before payment = after + payment amount
//         runningBalance = runningBalance + txnAmount;
//       } else if (txn.type === 'return') {
//         // Return decreases balance, so before return = after + return amount
//         runningBalance = runningBalance + txnAmount;
//       }
      
//       // Determine the best date field to use
//       let displayDate = txn.date || txn.created_at;
//       if (txn.type === 'payment') {
//         // For payments, prefer created_at (DATETIME) over payment_date (DATE only)
//         displayDate = txn.created_at || txn.transaction_timestamp || txn.payment_date || txn.date;
//       }
      
//       // For purchases, calculate previous balance (balance before this purchase)
//       let previousBalance = runningBalance;
//       if (txn.type === 'purchase') {
//         previousBalance = runningBalance; // This is the balance before the purchase
//       }
      
//       return {
//         ...txn,
//         balance_amount: txn.balance_amount !== null && txn.balance_amount !== undefined 
//           ? parseFloat(txn.balance_amount) 
//           : balanceAfter,
//         previous_balance: previousBalance,
//         date: displayDate
//       };
//     });
    
//     // Transactions are already in newest-first order with correct balances
//     const allTransactions = transactionsWithBalance;

//     // Get total count
//     const [purchaseCount] = await pool.execute(
//       'SELECT COUNT(*) as total FROM purchase_transactions WHERE buyer_party_id = ?',
//       [id]
//     );
//     let returnCount = { total: 0 };
//     try {
//       const [returnCountCheck] = await pool.execute(`
//         SELECT COLUMN_NAME 
//         FROM INFORMATION_SCHEMA.COLUMNS 
//         WHERE TABLE_SCHEMA = DATABASE() 
//         AND TABLE_NAME = 'return_transactions' 
//         AND COLUMN_NAME = 'buyer_party_id'
//       `);
//       if (returnCountCheck.length > 0) {
//         const [returnCountRows] = await pool.execute(
//           'SELECT COUNT(*) as total FROM return_transactions WHERE buyer_party_id = ?',
//           [id]
//         );
//         returnCount = returnCountRows[0];
//       }
//     } catch (err) {
//       // buyer_party_id column doesn't exist
//     }
//     let paymentCount = 0;
//     try {
//       const [paymentCountRows] = await pool.execute(
//         'SELECT COUNT(*) as total FROM payment_transactions WHERE party_type = ? AND party_id = ?',
//         ['buyer', id]
//       );
//       paymentCount = paymentCountRows[0]?.total || 0;
//     } catch (err) {
//       // Payment table doesn't exist
//     }

//     const totalRecords = purchaseCount[0].total + (returnCount.total || 0) + paymentCount;
//     const totalPages = Math.ceil(totalRecords / limitNum);

//     res.json({
//       transactions: allTransactions.slice(0, limitNum),
//       pagination: {
//         page: pageNum,
//         limit: limitNum,
//         totalRecords,
//         totalPages
//       }
//     });
//   } catch (error) {
//     console.error('Get buyer transaction history error:', error);
//     res.status(500).json({ error: 'Server error' });
//   }
// });

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
            NULL as bill_number,
            NULL as paid_amount,
            NULL as balance_amount,
            NULL as payment_status,
            rt.created_at,
            rt.return_type,
            COUNT(DISTINCT ri.id) as item_count,
            GROUP_CONCAT(DISTINCT CONCAT(i.product_name, ' (', ri.quantity, ')') SEPARATOR ', ') as items_summary
          FROM return_transactions rt
          LEFT JOIN return_items ri ON rt.id = ri.return_transaction_id
          LEFT JOIN items i ON ri.item_id = i.id
          WHERE rt.buyer_party_id = ? AND rt.party_type = 'buyer'
          GROUP BY rt.id, rt.return_date, rt.total_amount, rt.created_at, rt.return_type
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
          // NEW: All payments (including purchase payments)
          const [paymentRows] = await pool.execute(
            `SELECT 
              pt.id,
              pt.payment_date as date,
              pt.amount,
              CASE WHEN pt.purchase_transaction_id IS NOT NULL THEN 'purchase_payment' ELSE 'payment' END as type,
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
            ORDER BY pt.payment_date DESC, pt.created_at DESC
            LIMIT ${limitNum} OFFSET ${offset}`,
            [id]
          );
          payments = paymentRows;
        } else {
          // OLD: All payments (check if purchase_transaction_id column exists)
          const [columnCheck] = await pool.execute(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = 'payment_transactions' 
            AND COLUMN_NAME = 'purchase_transaction_id'
          `);
          const hasPurchaseTransactionId = columnCheck.length > 0;
          
          let paymentRows;
          if (hasPurchaseTransactionId) {
            // New structure: include all payments, mark purchase payments
            [paymentRows] = await pool.execute(
              `SELECT 
                pt.id,
                pt.payment_date as date,
                pt.amount,
                CASE WHEN pt.purchase_transaction_id IS NOT NULL THEN 'purchase_payment' ELSE 'payment' END as type,
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
              WHERE pt.party_type = 'buyer' 
                AND pt.party_id = ?
              ORDER BY pt.payment_date DESC, pt.created_at DESC
              LIMIT ${limitNum} OFFSET ${offset}`,
              [id]
            );
          } else {
            // Old structure: exclude payments linked by time window
            [paymentRows] = await pool.execute(
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
          }
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
      
      // Balance AFTER this transaction (current running balance)
      const balanceAfter = runningBalance;
      
      // Calculate balance BEFORE this transaction by reversing the effect
      let previousBalance = runningBalance;
      let calculatedBalanceAmount = balanceAfter;
      
      // Update balance based on transaction type (for buyers)
      if (txn.type === 'purchase') {
        // Purchase increases balance, payment decreases it
        // Balance before = after - purchase amount + payment amount
        const purchaseAmount = txnAmount;
        const paymentAmount = txnPaid;
        previousBalance = Math.max(0, runningBalance - purchaseAmount + paymentAmount);
        runningBalance = previousBalance;
        calculatedBalanceAmount = balanceAfter;
      } else if (txn.type === 'payment') {
        // Payment decreases balance
        // balanceAfter = balance before payment - payment amount
        // So: balance before payment = balanceAfter + payment amount
        previousBalance = runningBalance + txnAmount;
        // For payments, balance_after should be: previous_balance - payment_amount
        calculatedBalanceAmount = Math.max(0, previousBalance - txnAmount);
        // Update runningBalance for next (older) transaction
        runningBalance = previousBalance;
      } else if (txn.type === 'return') {
        // Return decreases balance only if return_type is 'adjust'
        previousBalance = runningBalance;
        if (txn.return_type === 'adjust' && txnAmount > 0) {
          // Return decreased balance, so before return = after + return amount
          previousBalance = runningBalance + txnAmount;
          runningBalance = previousBalance;
        }
        calculatedBalanceAmount = balanceAfter;
        // If return_type is not 'adjust', balance didn't change, so runningBalance stays the same
      }
      
      let displayDate = txn.date || txn.created_at;
      if (txn.type === 'payment') {
        displayDate = txn.created_at || txn.transaction_timestamp || txn.payment_date || txn.date;
      }
      
      return {
        ...txn,
        previous_balance: previousBalance,
        balance_amount: calculatedBalanceAmount,
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

// Get seller party transaction history
router.get('/sellers/:id/transactions', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 20;
    const offset = (pageNum - 1) * limitNum;

    // Verify party exists and get balance
    const [partyCheck] = await pool.execute('SELECT id, balance_amount FROM seller_parties WHERE id = ?', [id]);
    if (partyCheck.length === 0) {
      return res.status(404).json({ error: 'Seller party not found' });
    }
    const party = partyCheck[0];

    // Get sale transactions with items summary
    const [sales] = await pool.execute(
      `SELECT 
        st.id,
        st.transaction_date as date,
        st.total_amount as amount,
        'sale' as type,
        CONCAT('Sale - Bill #', st.bill_number, ' (', COUNT(DISTINCT si.id), ' item(s))') as description,
        st.bill_number,
        st.paid_amount,
        st.balance_amount,
        st.payment_status,
        st.created_at,
        COUNT(DISTINCT si.id) as item_count,
        GROUP_CONCAT(DISTINCT CONCAT(i.product_name, ' (', si.quantity, ')') SEPARATOR ', ') as items_summary
      FROM sale_transactions st
      LEFT JOIN sale_items si ON st.id = si.sale_transaction_id
      LEFT JOIN items i ON si.item_id = i.id
      WHERE st.seller_party_id = ?
      GROUP BY st.id, st.transaction_date, st.total_amount, st.bill_number, st.paid_amount, st.balance_amount, st.payment_status, st.created_at
      ORDER BY st.transaction_date DESC, st.created_at DESC
      LIMIT ${limitNum} OFFSET ${offset}`,
      [id]
    );

    // Get return transactions - check structure
    let returns = [];
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
        // New structure: one record per return transaction
        const [returnRows] = await pool.execute(
          `SELECT 
            rt.id,
            rt.return_date as date,
            rt.total_amount as amount,
            'return' as type,
            CONCAT('Return', CASE WHEN rt.bill_number IS NOT NULL THEN CONCAT(' - Bill #', rt.bill_number) ELSE '' END, ' (', COUNT(DISTINCT ri.id), ' item(s))') as description,
            rt.bill_number,
            NULL as paid_amount,
            NULL as balance_amount,
            NULL as payment_status,
            rt.created_at,
            rt.return_type,
            COUNT(DISTINCT ri.id) as item_count,
            GROUP_CONCAT(DISTINCT CONCAT(i.product_name, ' (', ri.quantity, ')') SEPARATOR ', ') as items_summary
          FROM return_transactions rt
          LEFT JOIN return_items ri ON rt.id = ri.return_transaction_id
          LEFT JOIN items i ON ri.item_id = i.id
          WHERE rt.seller_party_id = ? AND rt.party_type = 'seller'
          GROUP BY rt.id, rt.return_date, rt.total_amount, rt.bill_number, rt.created_at, rt.return_type
          ORDER BY rt.return_date DESC, rt.created_at DESC
          LIMIT ${limitNum} OFFSET ${offset}`,
          [id]
        );
        returns = returnRows;
      } else {
        // Old structure: group by return_date and created_at (no return_type column)
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
              NULL as return_type,
              COUNT(DISTINCT rt.id) as item_count,
              GROUP_CONCAT(DISTINCT CONCAT(i.product_name, ' (', rt.quantity, ')') SEPARATOR ', ') as items_summary
            FROM return_transactions rt
            JOIN items i ON rt.item_id = i.id
            WHERE rt.seller_party_id = ?
            GROUP BY rt.return_date, DATE_FORMAT(rt.created_at, '%Y-%m-%d %H:%i:%s')
            ORDER BY rt.return_date DESC, MIN(rt.created_at) DESC
            LIMIT ${limitNum} OFFSET ${offset}`,
            [id]
          );
        returns = returnRows;
      }
    } catch (err) {
      console.error('Error fetching returns:', err);
    }

    // Get payment transactions (if payment_transactions table exists)
    let payments = [];
    try {
      const [paymentCheck] = await pool.execute(`
        SELECT COUNT(*) as count 
        FROM INFORMATION_SCHEMA.TABLES 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'payment_transactions'
      `);
      
      if (paymentCheck[0].count > 0) {
        const [paymentRows] = await pool.execute(
          `SELECT 
            id,
            payment_date as date,
            amount,
            CASE WHEN purchase_transaction_id IS NOT NULL THEN 'purchase_payment' ELSE 'payment' END as type,
            CONCAT('Payment - ', COALESCE(payment_method, 'Cash'), ' (Receipt: ', COALESCE(receipt_number, 'N/A'), ')') as description,
            receipt_number as bill_number,
            amount as paid_amount,
            previous_balance,
            updated_balance as balance_amount,
            NULL as payment_status,
            created_at,
            payment_date,
            created_at as transaction_timestamp,
            payment_method,
            notes
          FROM payment_transactions
          WHERE party_type = 'seller' AND party_id = ?
          ORDER BY payment_date DESC, created_at DESC
          LIMIT ${limitNum} OFFSET ${offset}`,
          [id]
        );
        payments = paymentRows;
      }
    } catch (err) {
      // Payment table doesn't exist, skip
    }

    // Combine all transactions and sort by date (newest first for backwards calculation)
    const allTransactionsUnsorted = [...sales, ...returns, ...payments];
    const allTransactionsSorted = allTransactionsUnsorted.sort((a, b) => {
      const dateA = new Date(a.date || a.created_at || a.transaction_timestamp);
      const dateB = new Date(b.date || b.created_at || b.transaction_timestamp);
      return dateB - dateA; // Newest first
    });

    // Calculate running balance backwards from current balance (newest to oldest)
    // This ensures correct balance even with pagination
    let runningBalance = parseFloat(party.balance_amount || 0);
    
    const transactionsWithBalance = allTransactionsSorted.map(txn => {
      const txnAmount = parseFloat(txn.amount || txn.total_amount || 0) || 0;
      const txnPaid = parseFloat(txn.paid_amount || (txn.type === 'payment' ? txn.amount : 0) || 0) || 0;
      
      // Balance AFTER this transaction (current running balance - this is what we start with)
      const balanceAfter = runningBalance;
      
      // Calculate balance BEFORE this transaction by reversing the effect
      // Update balance based on transaction type (for sellers)
      let previousBalance = runningBalance;
      let calculatedBalanceAmount = balanceAfter;
      
      if (txn.type === 'sale') {
        // Sale increases balance by (total_amount - paid_amount)
        // So before sale = after - (total - paid)
        const saleBalance = txnAmount - txnPaid;
        previousBalance = Math.max(0, runningBalance - saleBalance);
        runningBalance = previousBalance;
        calculatedBalanceAmount = balanceAfter;
      } else if (txn.type === 'payment') {
        // Payment decreases balance
        // balanceAfter = balance before payment - payment amount
        // So: balance before payment = balanceAfter + payment amount
        previousBalance = runningBalance + txnAmount;
        // For payments, balance_after should be: previous_balance - payment_amount
        calculatedBalanceAmount = Math.max(0, previousBalance - txnAmount);
        // Update runningBalance for next (older) transaction
        runningBalance = previousBalance;
      } else if (txn.type === 'return') {
        // Return decreases balance only if return_type is 'adjust'
        previousBalance = runningBalance;
        if (txn.return_type === 'adjust' && txnAmount > 0) {
          // Return decreased balance, so before return = after + return amount
          previousBalance = runningBalance + txnAmount;
          runningBalance = previousBalance;
        }
        calculatedBalanceAmount = balanceAfter;
        // If return_type is not 'adjust', balance didn't change, so runningBalance stays the same
      }
      
      // Determine the best date field to use
      let displayDate = txn.date || txn.created_at;
      if (txn.type === 'payment') {
        // For payments, prefer created_at (DATETIME) over payment_date (DATE only)
        displayDate = txn.created_at || txn.transaction_timestamp || txn.payment_date || txn.date;
      }
      
      return {
        ...txn,
        previous_balance: previousBalance,
        balance_amount: calculatedBalanceAmount,
        date: displayDate
      };
    });
    
    // Transactions are already in newest-first order with correct balances
    const allTransactions = transactionsWithBalance;

    // Get total count
    const [saleCount] = await pool.execute(
      'SELECT COUNT(*) as total FROM sale_transactions WHERE seller_party_id = ?',
      [id]
    );
    const [returnCount] = await pool.execute(
      'SELECT COUNT(*) as total FROM return_transactions WHERE seller_party_id = ?',
      [id]
    );
    let paymentCount = 0;
    try {
      const [paymentCountRows] = await pool.execute(
        'SELECT COUNT(*) as total FROM payment_transactions WHERE party_type = ? AND party_id = ?',
        ['seller', id]
      );
      paymentCount = paymentCountRows[0]?.total || 0;
    } catch (err) {
      // Payment table doesn't exist
    }

    const totalRecords = saleCount[0].total + returnCount[0].total + paymentCount;
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
    console.error('Get seller transaction history error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Record payment for buyer party
router.post('/buyers/:id/payment', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, payment_date, payment_method, notes } = req.body;

    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ error: 'Valid payment amount is required' });
    }

    const paymentAmount = parseFloat(amount);
    const paymentDate = payment_date || getLocalDateString();

    // Verify party exists and get current balance
    const [party] = await pool.execute('SELECT * FROM buyer_parties WHERE id = ?', [id]);
    if (party.length === 0) {
      return res.status(404).json({ error: 'Buyer party not found' });
    }

    const currentBalance = parseFloat(party[0].balance_amount || 0);
    if (paymentAmount > currentBalance) {
      return res.status(400).json({ error: 'Payment amount cannot exceed current balance' });
    }

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Check if payment_transactions table exists with new structure
      const [tableCheck] = await connection.execute(`
        SELECT COUNT(*) as count 
        FROM INFORMATION_SCHEMA.TABLES 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'payment_transactions'
      `);

      if (tableCheck[0].count === 0) {
        await connection.execute(`
          CREATE TABLE payment_transactions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            party_type ENUM('buyer', 'seller') NOT NULL,
            party_id INT NOT NULL,
            payment_date DATE NOT NULL,
            amount DECIMAL(10,2) NOT NULL,
            previous_balance DECIMAL(10,2) NOT NULL DEFAULT 0,
            updated_balance DECIMAL(10,2) NOT NULL DEFAULT 0,
            receipt_number VARCHAR(50) UNIQUE,
            payment_method VARCHAR(50) NULL,
            notes TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_party (party_type, party_id),
            INDEX idx_payment_date (payment_date),
            INDEX idx_receipt_number (receipt_number)
          )
        `);
      } else {
        // Check if new columns exist, add if not
        const [columnCheck] = await connection.execute(`
          SELECT COLUMN_NAME 
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'payment_transactions' 
          AND COLUMN_NAME IN ('previous_balance', 'updated_balance', 'receipt_number', 'payment_method', 'notes')
        `);
        const existingColumns = columnCheck.map(c => c.COLUMN_NAME);
        
        if (!existingColumns.includes('previous_balance')) {
          await connection.execute('ALTER TABLE payment_transactions ADD COLUMN previous_balance DECIMAL(10,2) NOT NULL DEFAULT 0');
        }
        if (!existingColumns.includes('updated_balance')) {
          await connection.execute('ALTER TABLE payment_transactions ADD COLUMN updated_balance DECIMAL(10,2) NOT NULL DEFAULT 0');
        }
        if (!existingColumns.includes('receipt_number')) {
          await connection.execute('ALTER TABLE payment_transactions ADD COLUMN receipt_number VARCHAR(50) UNIQUE');
        }
        if (!existingColumns.includes('payment_method')) {
          await connection.execute('ALTER TABLE payment_transactions ADD COLUMN payment_method VARCHAR(50) NULL');
        }
        if (!existingColumns.includes('notes')) {
          await connection.execute('ALTER TABLE payment_transactions ADD COLUMN notes TEXT NULL');
        }
      }

      // Generate receipt number
      const [receiptCount] = await connection.execute('SELECT COUNT(*) as count FROM payment_transactions');
      const receiptNumber = `REC-${Date.now()}-${receiptCount[0].count + 1}`;

      // Calculate new balance
      const newBalance = Math.max(0, currentBalance - paymentAmount);

      // Insert payment transaction with new structure
      await connection.execute(
        `INSERT INTO payment_transactions (party_type, party_id, payment_date, amount, previous_balance, updated_balance, receipt_number, payment_method, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['buyer', id, paymentDate, paymentAmount, currentBalance, newBalance, receiptNumber, payment_method || 'Cash', notes || null, req.user?.id || null]
      );

      // Update buyer party balance
      await connection.execute(
        'UPDATE buyer_parties SET balance_amount = ? WHERE id = ?',
        [newBalance, id]
      );

      // Insert into unified_transactions table (if it exists)
      try {
        const [unifiedTableCheck] = await connection.execute(`
          SELECT COUNT(*) as count 
          FROM INFORMATION_SCHEMA.TABLES 
          WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'unified_transactions'
        `);
        
        if (unifiedTableCheck[0].count > 0) {
          const [paymentTxnId] = await connection.execute(
            'SELECT id FROM payment_transactions WHERE receipt_number = ?',
            [receiptNumber]
          );
          
          await connection.execute(
            `INSERT INTO unified_transactions (
              party_type, party_id, transaction_type, transaction_date,
              previous_balance, transaction_amount, paid_amount, balance_after,
              reference_id, bill_number, payment_method, notes, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              'buyer',
              id,
              'payment', // Standalone payment (not linked to purchase)
              paymentDate,
              currentBalance,
              0, // Payments don't create debt
              paymentAmount,
              newBalance,
              paymentTxnId[0]?.id || null,
              receiptNumber,
              payment_method || 'Cash',
              notes || null,
              (req.user?.id ? parseInt(req.user.id) : null)
            ]
          );
        }
      } catch (unifiedError) {
        console.warn('Could not insert into unified_transactions:', unifiedError.message);
        // Don't fail the transaction if unified_transactions doesn't exist
      }

      await connection.commit();
      
      // Get the payment transaction for receipt
      const [paymentTxn] = await connection.execute(
        'SELECT * FROM payment_transactions WHERE receipt_number = ?',
        [receiptNumber]
      );

      res.json({ 
        message: 'Payment recorded successfully',
        new_balance: newBalance,
        receipt_number: receiptNumber,
        payment_transaction_id: paymentTxn[0]?.id
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Record buyer payment error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Record payment for seller party
router.post('/sellers/:id/payment', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, payment_date, payment_method, notes } = req.body;

    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ error: 'Valid payment amount is required' });
    }

    const paymentAmount = parseFloat(amount);
    const paymentDate = payment_date || getLocalDateString();

    // Verify party exists and get current balance
    const [party] = await pool.execute('SELECT * FROM seller_parties WHERE id = ?', [id]);
    if (party.length === 0) {
      return res.status(404).json({ error: 'Seller party not found' });
    }

    const currentBalance = parseFloat(party[0].balance_amount || 0);
    if (paymentAmount > currentBalance) {
      return res.status(400).json({ error: 'Payment amount cannot exceed current balance' });
    }

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Check if payment_transactions table exists with new structure
      const [tableCheck] = await connection.execute(`
        SELECT COUNT(*) as count 
        FROM INFORMATION_SCHEMA.TABLES 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'payment_transactions'
      `);

      if (tableCheck[0].count === 0) {
        await connection.execute(`
          CREATE TABLE payment_transactions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            party_type ENUM('buyer', 'seller') NOT NULL,
            party_id INT NOT NULL,
            payment_date DATE NOT NULL,
            amount DECIMAL(10,2) NOT NULL,
            previous_balance DECIMAL(10,2) NOT NULL DEFAULT 0,
            updated_balance DECIMAL(10,2) NOT NULL DEFAULT 0,
            receipt_number VARCHAR(50) UNIQUE,
            payment_method VARCHAR(50) NULL,
            notes TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_party (party_type, party_id),
            INDEX idx_payment_date (payment_date),
            INDEX idx_receipt_number (receipt_number)
          )
        `);
      } else {
        // Check if new columns exist, add if not
        const [columnCheck] = await connection.execute(`
          SELECT COLUMN_NAME 
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'payment_transactions' 
          AND COLUMN_NAME IN ('previous_balance', 'updated_balance', 'receipt_number', 'payment_method', 'notes')
        `);
        const existingColumns = columnCheck.map(c => c.COLUMN_NAME);
        
        if (!existingColumns.includes('previous_balance')) {
          await connection.execute('ALTER TABLE payment_transactions ADD COLUMN previous_balance DECIMAL(10,2) NOT NULL DEFAULT 0');
        }
        if (!existingColumns.includes('updated_balance')) {
          await connection.execute('ALTER TABLE payment_transactions ADD COLUMN updated_balance DECIMAL(10,2) NOT NULL DEFAULT 0');
        }
        if (!existingColumns.includes('receipt_number')) {
          await connection.execute('ALTER TABLE payment_transactions ADD COLUMN receipt_number VARCHAR(50) UNIQUE');
        }
        if (!existingColumns.includes('payment_method')) {
          await connection.execute('ALTER TABLE payment_transactions ADD COLUMN payment_method VARCHAR(50) NULL');
        }
        if (!existingColumns.includes('notes')) {
          await connection.execute('ALTER TABLE payment_transactions ADD COLUMN notes TEXT NULL');
        }
      }

      // Generate receipt number
      const [receiptCount] = await connection.execute('SELECT COUNT(*) as count FROM payment_transactions');
      const receiptNumber = `REC-${Date.now()}-${receiptCount[0].count + 1}`;

      // Calculate new balance
      const newBalance = Math.max(0, currentBalance - paymentAmount);

      // Insert payment transaction with new structure
      await connection.execute(
        `INSERT INTO payment_transactions (party_type, party_id, payment_date, amount, previous_balance, updated_balance, receipt_number, payment_method, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['seller', id, paymentDate, paymentAmount, currentBalance, newBalance, receiptNumber, payment_method || 'Cash', notes || null, req.user?.id || null]
      );

      // Update seller party balance
      await connection.execute(
        'UPDATE seller_parties SET balance_amount = ? WHERE id = ?',
        [newBalance, id]
      );

      // Insert into unified_transactions table (if it exists)
      try {
        const [unifiedTableCheck] = await connection.execute(`
          SELECT COUNT(*) as count 
          FROM INFORMATION_SCHEMA.TABLES 
          WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'unified_transactions'
        `);
        
        if (unifiedTableCheck[0].count > 0) {
          const [paymentTxnId] = await connection.execute(
            'SELECT id FROM payment_transactions WHERE receipt_number = ?',
            [receiptNumber]
          );
          
          await connection.execute(
            `INSERT INTO unified_transactions (
              party_type, party_id, transaction_type, transaction_date,
              previous_balance, transaction_amount, paid_amount, balance_after,
              reference_id, bill_number, payment_method, notes, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              'seller',
              id,
              'payment', // Standalone payment (not linked to sale)
              paymentDate,
              currentBalance,
              0, // Payments don't create debt
              paymentAmount,
              newBalance,
              paymentTxnId[0]?.id || null,
              receiptNumber,
              payment_method || 'Cash',
              notes || null,
              (req.user?.id ? parseInt(req.user.id) : null)
            ]
          );
        }
      } catch (unifiedError) {
        console.warn('Could not insert into unified_transactions:', unifiedError.message);
        // Don't fail the transaction if unified_transactions doesn't exist
      }

      await connection.commit();
      
      // Get the payment transaction for receipt
      const [paymentTxn] = await connection.execute(
        'SELECT * FROM payment_transactions WHERE receipt_number = ?',
        [receiptNumber]
      );

      res.json({ 
        message: 'Payment recorded successfully',
        new_balance: newBalance,
        receipt_number: receiptNumber,
        payment_transaction_id: paymentTxn[0]?.id
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Record seller payment error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get detailed transaction information
router.get('/transactions/:type/:id/details', authenticateToken, async (req, res) => {
  try {
    const { type, id } = req.params;
    const { party_type, party_id } = req.query;

    if (!party_type || !party_id) {
      return res.status(400).json({ error: 'party_type and party_id are required' });
    }

    let details = null;

    if (type === 'purchase') {
      // Get all purchase transactions for this date/group
      const [purchases] = await pool.execute(
        `SELECT 
          pt.*,
          i.product_name,
          i.product_code,
          i.brand,
          i.hsn_number,
          i.tax_rate,
          bp.party_name,
          bp.mobile_number,
          bp.address,
          bp.email,
          bp.gst_number
        FROM purchase_transactions pt
        JOIN items i ON pt.item_id = i.id
        JOIN buyer_parties bp ON pt.buyer_party_id = bp.id
        WHERE pt.id = ? AND pt.buyer_party_id = ?`,
        [id, party_id]
      );

      if (purchases.length > 0) {
        // Group by transaction_date and created_at to get all items in same purchase
        const transactionDate = purchases[0].transaction_date;
        const createdAt = purchases[0].created_at;
        
        // Get all purchases in the same 5-second window
        const [allPurchases] = await pool.execute(
          `SELECT 
            pt.*,
            i.product_name,
            i.product_code,
            i.brand,
            i.hsn_number,
            i.tax_rate
          FROM purchase_transactions pt
          JOIN items i ON pt.item_id = i.id
          WHERE pt.buyer_party_id = ? 
          AND pt.transaction_date = ?
          AND FLOOR(UNIX_TIMESTAMP(pt.created_at) / 5) = FLOOR(UNIX_TIMESTAMP(?) / 5)`,
          [party_id, transactionDate, createdAt]
        );

        const totalAmount = allPurchases.reduce((sum, p) => sum + parseFloat(p.total_amount || 0), 0);
        
        // Get payment made at the same time (within 5 seconds)
        const [payments] = await pool.execute(
          `SELECT 
            pt.id,
            pt.amount,
            pt.payment_date,
            pt.payment_method,
            pt.notes,
            pt.previous_balance,
            pt.updated_balance,
            pt.receipt_number,
            pt.created_at
          FROM payment_transactions pt
          WHERE pt.party_type = 'buyer'
            AND pt.party_id = ?
            AND ABS(TIMESTAMPDIFF(SECOND, ?, pt.created_at)) <= 5
            AND pt.payment_date = ?`,
          [party_id, createdAt, transactionDate]
        );
        
        const paidAmount = payments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
        const previousBalance = payments.length > 0 ? parseFloat(payments[0].previous_balance || 0) : 0;
        const balanceAfter = payments.length > 0 ? parseFloat(payments[0].updated_balance || 0) : (previousBalance + totalAmount - paidAmount);
        
        details = {
          type: 'purchase',
          transaction_id: id,
          transaction_date: transactionDate,
          created_at: createdAt,
          bill_number: `PUR-${transactionDate.replace(/-/g, '')}-${id}`,
          party: {
            party_name: purchases[0].party_name,
            mobile_number: purchases[0].mobile_number,
            address: purchases[0].address,
            email: purchases[0].email,
            gst_number: purchases[0].gst_number
          },
          items: allPurchases.map(p => ({
            item_id: p.item_id,
            product_name: p.product_name,
            product_code: p.product_code,
            brand: p.brand,
            hsn_number: p.hsn_number,
            tax_rate: p.tax_rate,
            quantity: p.quantity,
            purchase_rate: p.purchase_rate,
            total_amount: p.total_amount
          })),
          summary: {
            total_items: allPurchases.length,
            total_quantity: allPurchases.reduce((sum, p) => sum + (p.quantity || 0), 0),
            total_amount: totalAmount,
            paid_amount: paidAmount,
            previous_balance: previousBalance,
            balance_amount: balanceAfter,
            remaining_amount: Math.max(0, totalAmount - paidAmount),
            payment_status: paidAmount >= totalAmount ? 'fully_paid' : (paidAmount > 0 ? 'partially_paid' : 'unpaid'),
            payments: payments.map(p => ({
              id: p.id,
              amount: p.amount,
              payment_method: p.payment_method,
              receipt_number: p.receipt_number,
              notes: p.notes,
              payment_date: p.payment_date
            }))
          }
        };
      }
    } else if (type === 'sale') {
      // Get sale transaction with items
      const [sales] = await pool.execute(
        `SELECT 
          st.*,
          sp.party_name,
          sp.mobile_number,
          sp.address,
          sp.email,
          sp.gst_number
        FROM sale_transactions st
        JOIN seller_parties sp ON st.seller_party_id = sp.id
        WHERE st.id = ? AND st.seller_party_id = ?`,
        [id, party_id]
      );

      if (sales.length > 0) {
        const [items] = await pool.execute(
          `SELECT 
            si.*,
            i.product_name,
            i.product_code,
            i.brand,
            i.hsn_number,
            i.tax_rate
          FROM sale_items si
          JOIN items i ON si.item_id = i.id
          WHERE si.sale_transaction_id = ?`,
          [id]
        );

        details = {
          type: 'sale',
          transaction_id: id,
          transaction_date: sales[0].transaction_date,
          created_at: sales[0].created_at,
          bill_number: sales[0].bill_number,
          party: {
            party_name: sales[0].party_name,
            mobile_number: sales[0].mobile_number,
            address: sales[0].address,
            email: sales[0].email,
            gst_number: sales[0].gst_number
          },
          items: items.map(item => ({
            item_id: item.item_id,
            product_name: item.product_name,
            product_code: item.product_code,
            brand: item.brand,
            hsn_number: item.hsn_number,
            tax_rate: item.tax_rate,
            quantity: item.quantity,
            sale_rate: item.sale_rate,
            discount: item.discount,
            discount_type: item.discount_type,
            discount_percentage: item.discount_percentage,
            total_amount: item.total_amount
          })),
          summary: {
            subtotal: parseFloat(sales[0].subtotal || 0),
            discount: parseFloat(sales[0].discount || 0),
            tax_amount: parseFloat(sales[0].tax_amount || 0),
            total_amount: parseFloat(sales[0].total_amount || 0),
            paid_amount: parseFloat(sales[0].paid_amount || 0),
            balance_amount: parseFloat(sales[0].balance_amount || 0),
            previous_balance_paid: parseFloat(sales[0].previous_balance_paid || 0),
            payment_status: sales[0].payment_status,
            with_gst: sales[0].with_gst === 1 || sales[0].with_gst === true,
            total_items: items.length,
            total_quantity: items.reduce((sum, i) => sum + (i.quantity || 0), 0)
          }
        };
      }
    } else if (type === 'return') {
      // Check structure
      const [tableCheck] = await pool.execute(`
        SELECT COUNT(*) as count 
        FROM INFORMATION_SCHEMA.TABLES 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'return_items'
      `);
      const hasNewStructure = tableCheck[0].count > 0;

      if (hasNewStructure) {
        // New structure
        const [returns] = await pool.execute(
          `SELECT 
            rt.*,
            ${party_type === 'buyer' 
              ? 'bp.party_name, bp.mobile_number, bp.address, bp.email, bp.gst_number' 
              : 'sp.party_name, sp.mobile_number, sp.address, sp.email, sp.gst_number'
            }
          FROM return_transactions rt
          ${party_type === 'buyer' 
            ? 'LEFT JOIN buyer_parties bp ON rt.buyer_party_id = bp.id' 
            : 'LEFT JOIN seller_parties sp ON rt.seller_party_id = sp.id'
          }
          WHERE rt.id = ? AND rt.party_type = ?`,
          [id, party_type]
        );

        if (returns.length > 0) {
          const [items] = await pool.execute(
            `SELECT 
              ri.*,
              i.product_name,
              i.product_code,
              i.brand,
              i.hsn_number,
              i.tax_rate
            FROM return_items ri
            JOIN items i ON ri.item_id = i.id
            WHERE ri.return_transaction_id = ?`,
            [id]
          );

          details = {
            type: 'return',
            transaction_id: id,
            return_date: returns[0].return_date,
            created_at: returns[0].created_at,
            bill_number: returns[0].bill_number,
            reason: returns[0].reason,
            return_type: returns[0].return_type,
            party: {
              party_name: returns[0].party_name,
              mobile_number: returns[0].mobile_number,
              address: returns[0].address,
              email: returns[0].email,
              gst_number: returns[0].gst_number
            },
            items: items.map(item => ({
              item_id: item.item_id,
              product_name: item.product_name,
              product_code: item.product_code,
              brand: item.brand,
              hsn_number: item.hsn_number,
              tax_rate: item.tax_rate,
              quantity: item.quantity,
              return_rate: item.return_rate,
              discount: item.discount,
              discount_type: item.discount_type,
              discount_percentage: item.discount_percentage,
              total_amount: item.total_amount
            })),
            summary: {
              total_amount: parseFloat(returns[0].total_amount || 0),
              total_items: items.length,
              total_quantity: items.reduce((sum, i) => sum + (i.quantity || 0), 0)
            }
          };
        }
      } else {
        // Old structure - get all returns for this date/group
        const [returns] = await pool.execute(
          `SELECT 
            rt.*,
            i.product_name,
            i.product_code,
            i.brand,
            i.hsn_number,
            i.tax_rate,
            ${party_type === 'buyer' 
              ? 'bp.party_name, bp.mobile_number, bp.address, bp.email, bp.gst_number' 
              : 'sp.party_name, sp.mobile_number, sp.address, sp.email, sp.gst_number'
            }
          FROM return_transactions rt
          JOIN items i ON rt.item_id = i.id
          ${party_type === 'buyer' 
            ? 'LEFT JOIN buyer_parties bp ON rt.buyer_party_id = bp.id' 
            : 'LEFT JOIN seller_parties sp ON rt.seller_party_id = sp.id'
          }
          WHERE rt.id = ?`,
          [id]
        );

        if (returns.length > 0) {
          const returnDate = returns[0].return_date;
          const createdAt = returns[0].created_at;
          
          const [allReturns] = await pool.execute(
            `SELECT 
              rt.*,
              i.product_name,
              i.product_code,
              i.brand,
              i.hsn_number,
              i.tax_rate
            FROM return_transactions rt
            JOIN items i ON rt.item_id = i.id
            WHERE ${party_type === 'buyer' ? 'rt.buyer_party_id' : 'rt.seller_party_id'} = ? 
            AND rt.return_date = ?
            AND DATE_FORMAT(rt.created_at, '%Y-%m-%d %H:%i:%s') = DATE_FORMAT(?, '%Y-%m-%d %H:%i:%s')`,
            [party_id, returnDate, createdAt]
          );

          const totalAmount = allReturns.reduce((sum, r) => sum + parseFloat(r.return_amount || 0), 0);

          details = {
            type: 'return',
            transaction_id: id,
            return_date: returnDate,
            created_at: createdAt,
            reason: allReturns[0].reason,
            party: {
              party_name: returns[0].party_name,
              mobile_number: returns[0].mobile_number,
              address: returns[0].address,
              email: returns[0].email,
              gst_number: returns[0].gst_number
            },
            items: allReturns.map(r => ({
              item_id: r.item_id,
              product_name: r.product_name,
              product_code: r.product_code,
              brand: r.brand,
              hsn_number: r.hsn_number,
              tax_rate: r.tax_rate,
              quantity: r.quantity,
              return_amount: r.return_amount
            })),
            summary: {
              total_amount: totalAmount,
              total_items: allReturns.length,
              total_quantity: allReturns.reduce((sum, r) => sum + (r.quantity || 0), 0)
            }
          };
        }
      }
    } else if (type === 'payment') {
      // Get payment transaction
      const [payments] = await pool.execute(
        `SELECT 
          pt.*,
          ${party_type === 'buyer' 
            ? 'bp.party_name, bp.mobile_number, bp.address, bp.email, bp.gst_number' 
            : 'sp.party_name, sp.mobile_number, sp.address, sp.email, sp.gst_number'
          }
        FROM payment_transactions pt
        ${party_type === 'buyer' 
          ? 'LEFT JOIN buyer_parties bp ON pt.party_id = bp.id AND pt.party_type = "buyer"' 
          : 'LEFT JOIN seller_parties sp ON pt.party_id = sp.id AND pt.party_type = "seller"'
        }
        WHERE pt.id = ? AND pt.party_type = ? AND pt.party_id = ?`,
        [id, party_type, party_id]
      );

      if (payments.length > 0) {
        details = {
          type: 'payment',
          transaction_id: id,
          payment_date: payments[0].payment_date,
          created_at: payments[0].created_at,
          receipt_number: payments[0].receipt_number,
          party: {
            party_name: payments[0].party_name,
            mobile_number: payments[0].mobile_number,
            address: payments[0].address,
            email: payments[0].email,
            gst_number: payments[0].gst_number
          },
          summary: {
            amount: parseFloat(payments[0].amount || 0),
            previous_balance: parseFloat(payments[0].previous_balance || 0),
            updated_balance: parseFloat(payments[0].updated_balance || 0),
            payment_method: payments[0].payment_method || 'Cash',
            notes: payments[0].notes
          }
        };
      }
    }

    if (!details) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json(details);
  } catch (error) {
    console.error('Get transaction details error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;


