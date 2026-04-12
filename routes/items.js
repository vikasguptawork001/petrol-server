const express = require('express');
const multer = require('multer');
const pool = require('../config/database');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { validateItem } = require('../middleware/validation');
const { getLocalISOString } = require('../utils/dateUtils');
const { validateItemRatesConsistency } = require('../utils/itemRateValidation');
const { uploadImage: uploadToCloudinary } = require('../utils/cloudinary');

const router = express.Router();

// Configure multer for image uploads (3MB limit)
const upload = multer({
  limits: { fileSize: 3 * 1024 * 1024 }, // 3MB
  storage: multer.memoryStorage()
});

// Get all items with pagination and search
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 200, search = '', searchField = '' } = req.query;
    
    // Ensure page and limit are valid integers
    const pageNum = Math.max(1, parseInt(page) || 1);
    let limitNum;
    if (limit === 'all') {
      limitNum = 999999; // Very large number for "all"
    } else {
      limitNum = Math.max(1, Math.min(10000, parseInt(limit) || 200));
    }
    const offset = (pageNum - 1) * limitNum;

    // Select only needed columns (exclude image blob for performance)
    const selectFields = req.user.role === 'super_admin'
      ? 'id, product_name, unit, brand, tax_rate, sale_rate, purchase_rate, quantity, alert_quantity, rack_number, remarks, created_by, updated_by, is_archived, created_at, updated_at'
      : 'id, product_name, unit, brand, tax_rate, sale_rate, quantity, alert_quantity, rack_number, remarks, created_by, updated_by, is_archived, created_at, updated_at';
    
    let query = `SELECT ${selectFields} FROM items WHERE is_archived = FALSE`;
    const params = [];

    if (search && searchField) {
      if (searchField === 'product_name') {
        query += ' AND product_name LIKE ?';
        params.push(`%${search}%`);
      } else if (searchField === 'brand') {
        query += ' AND brand LIKE ?';
        params.push(`%${search}%`);
      } else if (searchField === 'remarks') {
        query += ' AND remarks LIKE ?';
        params.push(`%${search}%`);
      }
    }

    // Use template literals for LIMIT/OFFSET since they're validated integers
    // This avoids MySQL parameterization issues with LIMIT/OFFSET
    query += ` ORDER BY id DESC LIMIT ${limitNum} OFFSET ${offset}`;

    const [items] = await pool.execute(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM items WHERE is_archived = FALSE';
    const countParams = [];
    if (search && searchField) {
      if (searchField === 'product_name') {
        countQuery += ' AND product_name LIKE ?';
        countParams.push(`%${search}%`);
      } else if (searchField === 'brand') {
        countQuery += ' AND brand LIKE ?';
        countParams.push(`%${search}%`);
      } else if (searchField === 'remarks') {
        countQuery += ' AND remarks LIKE ?';
        countParams.push(`%${search}%`);
      }
    }
    const [countResult] = await pool.execute(countQuery, countParams);
    const total = countResult[0].total;

    res.json({
      items,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Get items error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Advanced search with multiple conditions
router.post('/advanced-search', authenticateToken, async (req, res) => {
  try {
    const { product_name, brand, remarks } = req.body;
    
    // Select only needed columns (exclude image blob for performance)
    const selectFields = req.user.role === 'super_admin'
      ? 'id, product_name, unit, brand, tax_rate, sale_rate, purchase_rate, quantity, alert_quantity, rack_number, remarks, created_by, updated_by, is_archived, created_at, updated_at'
      : 'id, product_name, unit, brand, tax_rate, sale_rate, quantity, alert_quantity, rack_number, remarks, created_by, updated_by, is_archived, created_at, updated_at';
    
    let query = `SELECT ${selectFields} FROM items WHERE is_archived = FALSE`;
    const params = [];

    if (product_name) {
      query += ' AND product_name LIKE ?';
      params.push(`%${product_name}%`);
    }
    if (brand) {
      query += ' AND brand LIKE ?';
      params.push(`%${brand}%`);
    }
    if (remarks) {
      query += ' AND remarks LIKE ?';
      params.push(`%${remarks}%`);
    }

    query += ' ORDER BY id DESC';

    const [items] = await pool.execute(query, params);
    
    res.json({ items });
  } catch (error) {
    console.error('Advanced search error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get product details by IDs (without image, created/updated info) - with optional purchase_rate flag
router.post('/details', authenticateToken, async (req, res) => {
  try {
    const { item_ids, include_purchase_rate = false } = req.body;

    if (!item_ids || !Array.isArray(item_ids) || item_ids.length === 0) {
      return res.status(400).json({ error: 'item_ids array is required' });
    }

    // Filter out null/undefined IDs
    const validItemIds = item_ids.filter(id => id != null);
    
    if (validItemIds.length === 0) {
      return res.status(400).json({ error: 'At least one valid item_id is required' });
    }

    // Determine if purchase_rate should be included
    // Include if: user is super_admin OR include_purchase_rate flag is true
    const shouldIncludePurchaseRate = req.user.role === 'super_admin' || include_purchase_rate === true;

    // Build SELECT fields based on flag
    const selectFields = shouldIncludePurchaseRate
      ? 'id, product_name, unit, brand, COALESCE(tax_rate, 0) as tax_rate, sale_rate, purchase_rate, quantity, COALESCE(min_sale_rate, 0) as min_sale_rate'
      : 'id, product_name, unit, brand, COALESCE(tax_rate, 0) as tax_rate, sale_rate, quantity, COALESCE(min_sale_rate, 0) as min_sale_rate';

    // Fetch all items in a single query (excluding image blob and created/updated fields)
    const [items] = await pool.execute(
      `SELECT ${selectFields}
       FROM items 
       WHERE id IN (${validItemIds.map(() => '?').join(',')}) AND is_archived = FALSE
       ORDER BY FIELD(id, ${validItemIds.map(() => '?').join(',')})`,
      [...validItemIds, ...validItemIds]
    );

    if (items.length === 0) {
      return res.status(404).json({ error: 'No items found with the provided IDs' });
    }

    // Check if any requested items were not found
    const foundIds = new Set(items.map(item => item.id));
    const missingIds = validItemIds.filter(id => !foundIds.has(id));
    
    if (missingIds.length > 0) {
      return res.status(404).json({ 
        error: `Items not found or archived: ${missingIds.join(', ')}`,
        found_items: items,
        missing_ids: missingIds
      });
    }

    res.json({ 
      items,
      include_purchase_rate: shouldIncludePurchaseRate
    });
  } catch (error) {
    console.error('Get product details error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get item details by IDs (without image blob) - for bill preview/generation (sales and returns)
router.post('/bill-preview', authenticateToken, async (req, res) => {
  try {
    const { item_ids } = req.body;

    if (!item_ids || !Array.isArray(item_ids) || item_ids.length === 0) {
      return res.status(400).json({ error: 'item_ids array is required' });
    }

    // Filter out null/undefined IDs
    const validItemIds = item_ids.filter(id => id != null);
    
    if (validItemIds.length === 0) {
      return res.status(400).json({ error: 'At least one valid item_id is required' });
    }

    // Fetch all items in a single query (excluding image blob and unnecessary fields for bill preview)
    const [items] = await pool.execute(
      `SELECT 
        id,
        product_name,
        unit,
        brand,
        COALESCE(tax_rate, 0) as tax_rate,
        sale_rate,
        purchase_rate,
        quantity
       FROM items 
       WHERE id IN (${validItemIds.map(() => '?').join(',')}) AND is_archived = FALSE
       ORDER BY FIELD(id, ${validItemIds.map(() => '?').join(',')})`,
      [...validItemIds, ...validItemIds]
    );

    if (items.length === 0) {
      return res.status(404).json({ error: 'No items found with the provided IDs' });
    }

    // Check if any requested items were not found
    const foundIds = new Set(items.map(item => item.id));
    const missingIds = validItemIds.filter(id => !foundIds.has(id));
    
    if (missingIds.length > 0) {
      return res.status(404).json({ 
        error: `Items not found or archived: ${missingIds.join(', ')}`,
        found_items: items,
        missing_ids: missingIds
      });
    }

    res.json({ items });
  } catch (error) {
    console.error('Bill preview error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Search items for autocomplete
router.get('/search', authenticateToken, async (req, res) => {
  try {
    const { q, include_purchase_rate = false } = req.query;
    
    if (!q || q.length < 2) {
      return res.json({ items: [] });
    }

    // Determine if purchase_rate should be included
    // Include if: user is super_admin OR include_purchase_rate flag is true
    const shouldIncludePurchaseRate = req.user.role === 'super_admin' || include_purchase_rate === 'true' || include_purchase_rate === true;

    // Build SELECT fields based on flag
    const selectFields = shouldIncludePurchaseRate
      ? 'id, product_name, unit, brand, COALESCE(tax_rate, 0) AS tax_rate, quantity, sale_rate, purchase_rate, COALESCE(min_sale_rate, 0) AS min_sale_rate'
      : 'id, product_name, unit, brand, COALESCE(tax_rate, 0) AS tax_rate, quantity, sale_rate, COALESCE(min_sale_rate, 0) AS min_sale_rate';

    // Include the fields needed to add-to-cart without extra API calls (smooth UX in SellItem)
    const [items] = await pool.execute(
      `SELECT ${selectFields}
       FROM items 
       WHERE is_archived = FALSE AND (product_name LIKE ? OR brand LIKE ? OR remarks LIKE ?) 
       LIMIT 50`,
      [`%${q}%`, `%${q}%`, `%${q}%`]
    );

    res.json({ 
      items,
      include_purchase_rate: shouldIncludePurchaseRate
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single item
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const [items] = await pool.execute(
      `SELECT i.*, 
       u1.user_id as created_by_user, 
       u2.user_id as updated_by_user
       FROM items i
       LEFT JOIN users u1 ON i.created_by = u1.user_id
       LEFT JOIN users u2 ON i.updated_by = u2.user_id
       WHERE i.id = ?`,
      [req.params.id]
    );
    if (items.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }
    const item = items[0];
    // Formating timestamps
    if (item.created_at) {
      item.created_at_formatted = new Date(item.created_at).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour12: false
      });
    }

    if (item.updated_at) {
      item.updated_at_formatted = new Date(item.updated_at).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour12: false
      });
    }
    res.json({ item });
  } catch (error) {
    console.error('Get item error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Helper function to check for duplicates (excludes archived items)
async function checkDuplicate(product_name, brand, excludeId = null) {
  let query = `SELECT id FROM items WHERE is_archived = FALSE AND (
    (product_name = ? AND brand = ?) OR
    (product_name = ? AND brand IS NULL AND ? IS NULL)
  )`;
  const params = [
    product_name, brand,
    product_name, brand
  ];
  
  if (excludeId) {
    query += ' AND id != ?';
    params.push(parseInt(excludeId)); // Ensure it's an integer
  }
  
  const [duplicates] = await pool.execute(query, params);
  return duplicates.length > 0;
}

// Helper function to save item history
async function saveItemHistory(itemId, itemData, actionType, userId) {
  try {
    await pool.execute(
      `INSERT INTO items_history 
      (item_id, product_name, unit, brand, tax_rate, sale_rate, purchase_rate, 
       quantity, alert_quantity, rack_number, remarks, action_type, changed_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        itemId,
        itemData.product_name,
        itemData.unit || null,
        itemData.brand || null,
        itemData.tax_rate || 0,
        itemData.sale_rate,
        itemData.purchase_rate,
        itemData.quantity || 0,
        itemData.alert_quantity || 0,
        itemData.rack_number || null,
        itemData.remarks || null,
        actionType,
        userId
      ]
    );
  } catch (error) {
    console.error('Error saving item history:', error);
    // Don't throw - history is not critical
  }
}

// Add new item (only admin and super_admin)
router.post('/', authenticateToken, authorizeRole('admin', 'super_admin', 'sales'), upload.single('image'), async (req, res) => {
  try {
    const {
      product_name,
      unit,
      brand,
      hsn_number,
      tax_rate,
      sale_rate,
      purchase_rate,
      min_sale_rate,
      quantity,
      alert_quantity,
      rack_number,
      remarks
    } = req.body;

    // Parse tax_rate to ensure it's a number (FormData sends strings)
    const parsedTaxRate = tax_rate !== undefined && tax_rate !== null && tax_rate !== '' 
      ? parseFloat(tax_rate) 
      : 18;
    const validTaxRates = [5, 18, 28];
    const finalTaxRate = !isNaN(parsedTaxRate) && validTaxRates.includes(parsedTaxRate) 
      ? parsedTaxRate 
      : 18;
    
    // Debug log to verify tax_rate is being received correctly
    console.log('Received tax_rate:', tax_rate, 'Parsed:', parsedTaxRate, 'Final:', finalTaxRate);

    // Validation
    if (!product_name || product_name.trim() === '') {
      return res.status(400).json({ error: 'Product name is required' });
    }

    if (sale_rate === undefined || sale_rate === null || sale_rate < 0) {
      return res.status(400).json({ error: 'Sale rate is required and must be a positive number' });
    }

    if (purchase_rate === undefined || purchase_rate === null || purchase_rate < 0) {
      return res.status(400).json({ error: 'Purchase rate is required and must be a positive number' });
    }

    // Quantity is optional on create; default to 0 (FormData sends strings)
    const quantityNum =
      quantity !== undefined && quantity !== null && quantity !== ''
        ? parseInt(quantity, 10)
        : 0;
    if (Number.isNaN(quantityNum) || quantityNum < 0) {
      return res.status(400).json({ error: 'Quantity must be a non-negative number' });
    }

    const saleRateNum = parseFloat(sale_rate);
    const purchaseRateNum = parseFloat(purchase_rate);

    // Validate remarks length
    if (remarks && remarks.length > 200) {
      return res.status(400).json({ error: 'Remarks must be 200 characters or less' });
    }

    // Optional min_sale_rate: null, empty, or number >= 0
    const minSaleRateValue = min_sale_rate === undefined || min_sale_rate === null || min_sale_rate === ''
      ? null
      : parseFloat(min_sale_rate);
    if (minSaleRateValue !== null && (isNaN(minSaleRateValue) || minSaleRateValue < 0)) {
      return res.status(400).json({ error: 'Min sale rate must be 0 or greater, or empty' });
    }

    const ratesPost = validateItemRatesConsistency({
      saleRate: saleRateNum,
      purchaseRate: purchaseRateNum,
      minSaleRate: minSaleRateValue
    });
    if (!ratesPost.ok) {
      return res.status(400).json({ error: ratesPost.error });
    }

    // Check for duplicates (Product Name, Brand combination)
    const isDuplicate = await checkDuplicate(
      product_name.trim(),
      brand ? brand.trim() : null
    );
    
    if (isDuplicate) {
      return res.status(400).json({ 
        error: 'A product with the same Product Name, Product Code, and Brand already exists' 
      });
    }

    const userId = req.user.user_id;

    const baseParams = [
      product_name.trim(),
      unit ? unit.trim() : null,
      brand ? brand.trim() : null,
      finalTaxRate,
      sale_rate,
      purchase_rate,
      minSaleRateValue,
      quantityNum,
      alert_quantity || 0,
      rack_number ? rack_number.trim() : null,
      remarks ? remarks.trim().substring(0, 200) : null,
      userId
    ];

    const [result] = await pool.execute(
      `INSERT INTO items (product_name, unit, brand, tax_rate, sale_rate, purchase_rate, min_sale_rate,
        quantity, alert_quantity, rack_number, remarks, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      baseParams
    );

    // Fetch the created item to return complete data
    const [items] = await pool.execute('SELECT * FROM items WHERE id = ? AND is_archived = FALSE', [result.insertId]);
    const newItem = items[0];
    
    // Save history
    await saveItemHistory(result.insertId, newItem, 'created', userId);
    
    res.json({ 
      message: 'Item added successfully', 
      id: result.insertId,
      item: newItem
    });
  } catch (error) {
    console.error('Add item error:', error);
    // product_code is no longer UNIQUE (migration_remove_unique_product_code.sql)
    // so ER_DUP_ENTRY should generally not occur for product_code.
    res.status(500).json({ error: 'Server error while adding item' });
  }
});

// Update item (admin and super_admin can update, only super_admin can edit purchase rate)
router.patch('/:id', authenticateToken, authorizeRole('admin', 'super_admin', 'sales'), async (req, res) => {
  try {
    const {
      product_name,
      unit,
      brand,
      tax_rate,
      sale_rate,
      purchase_rate,
      min_sale_rate,
      quantity,
      alert_quantity,
      rack_number,
      remarks
    } = req.body;

    // Check if item exists and is not archived
    const [existingItems] = await pool.execute('SELECT * FROM items WHERE id = ? AND is_archived = FALSE', [req.params.id]);
    if (existingItems.length === 0) {
      return res.status(404).json({ error: 'Item not found or has been archived' });
    }

    const existingItem = existingItems[0];
    const updateFields = [];
    const params = [];

    // Only validate and add fields that are provided
    if (product_name !== undefined) {
      if (typeof product_name !== 'string' || product_name.trim().length === 0) {
        return res.status(400).json({ error: 'Product name must be a non-empty string' });
      }
      if (product_name.length > 255) {
        return res.status(400).json({ error: 'Product name must be less than 255 characters' });
      }
      updateFields.push('product_name = ?');
      params.push(product_name.trim());
    }

    if (unit !== undefined) {
      updateFields.push('unit = ?');
      params.push(unit ? unit.trim() : null);
    }

    if (brand !== undefined) {
      updateFields.push('brand = ?');
      params.push(brand ? brand.trim() : null);
    }

    if (tax_rate !== undefined) {
      updateFields.push('tax_rate = ?');
      params.push(tax_rate || 0);
    }

    if (sale_rate !== undefined) {
      if (sale_rate === null || isNaN(sale_rate) || sale_rate < 0) {
        return res.status(400).json({ error: 'Sale rate must be a positive number' });
      }
      updateFields.push('sale_rate = ?');
      params.push(sale_rate);
    }

    if (min_sale_rate !== undefined) {
      const minRate = min_sale_rate === null || min_sale_rate === '' ? null : parseFloat(min_sale_rate);
      if (minRate !== null && (isNaN(minRate) || minRate < 0)) {
        return res.status(400).json({ error: 'Min sale rate must be 0 or greater, or empty' });
      }
      updateFields.push('min_sale_rate = ?');
      params.push(minRate);
    }

    if (quantity !== undefined) {
      if (quantity === null || isNaN(quantity) || quantity < 0) {
        return res.status(400).json({ error: 'Quantity must be 0 or greater' });
      }
      updateFields.push('quantity = ?');
      params.push(quantity);
    }

    if (alert_quantity !== undefined) {
      updateFields.push('alert_quantity = ?');
      params.push(alert_quantity || 0);
    }

    if (rack_number !== undefined) {
      updateFields.push('rack_number = ?');
      params.push(rack_number ? rack_number.trim() : null);
    }

    if (remarks !== undefined) {
      if (remarks && remarks.length > 200) {
        return res.status(400).json({ error: 'Remarks must be 200 characters or less' });
      }
      updateFields.push('remarks = ?');
      params.push(remarks ? remarks.trim().substring(0, 200) : null);
    }

    if (req.file) {
      // Image update is no longer supported per request, but we omit the logic
    }

    // Check if user is super admin for purchase_rate update
    if (purchase_rate !== undefined) {
      if (req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'sales') {
        return res.status(403).json({ error: 'Only authorized users can update purchase rate' });
      }
      if (isNaN(purchase_rate) || purchase_rate < 0) {
        return res.status(400).json({ error: 'Purchase rate must be a positive number' });
      }
      updateFields.push('purchase_rate = ?');
      params.push(purchase_rate);
    }

    const finalSaleRate = sale_rate !== undefined ? sale_rate : existingItem.sale_rate;
    const finalPurchaseRate = purchase_rate !== undefined ? purchase_rate : existingItem.purchase_rate;
    let finalMinSale;
    if (min_sale_rate !== undefined) {
      finalMinSale = min_sale_rate === null || min_sale_rate === '' ? null : parseFloat(min_sale_rate);
    } else {
      const ex = existingItem.min_sale_rate;
      finalMinSale = ex === undefined || ex === null || ex === '' ? null : parseFloat(ex);
    }

    const ratesPatch = validateItemRatesConsistency({
      saleRate: finalSaleRate,
      purchaseRate: finalPurchaseRate,
      minSaleRate: finalMinSale
    });
    if (!ratesPatch.ok) {
      return res.status(400).json({ error: ratesPatch.error });
    }

    // Check for duplicates only if product_name or brand are being updated
    if (product_name !== undefined || brand !== undefined) {
      const finalProductName = product_name !== undefined ? product_name.trim() : existingItem.product_name;
      const finalBrand = brand !== undefined ? (brand ? brand.trim() : null) : existingItem.brand;
      
      const isDuplicate = await checkDuplicate(
        finalProductName,
        finalBrand,
        req.params.id
      );
      
      if (isDuplicate) {
        return res.status(400).json({ 
          error: 'A product with the same Product Name, Product Code, and Brand already exists' 
        });
      }
    }

    // If no fields to update, return error
    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields provided to update' });
    }

    // Add updated_by and WHERE clause
    updateFields.push('updated_by = ?');
    params.push(req.user.user_id);
    params.push(req.params.id);

    const query = `UPDATE items SET ${updateFields.join(', ')} WHERE id = ?`;
    await pool.execute(query, params);
    
    // Check if quantity reached alert quantity and update order sheet
    const finalQuantity = quantity !== undefined ? quantity : existingItem.quantity;
    const finalAlertQty = alert_quantity !== undefined ? alert_quantity : existingItem.alert_quantity;
    if (finalQuantity <= finalAlertQty) {
      // Calculate required quantity (alert_quantity - current_quantity, minimum 1)
      const requiredQty = Math.max(1, finalAlertQty - finalQuantity);
      await pool.execute(
        'INSERT INTO order_sheet (item_id, required_quantity, current_quantity, status) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE required_quantity = ?, current_quantity = ?, status = ?',
        [req.params.id, requiredQty, finalQuantity, 'pending', requiredQty, finalQuantity, 'pending']
      );
    } else {
      // Remove from order sheet if quantity is above alert
      await pool.execute(
        'DELETE FROM order_sheet WHERE item_id = ? AND status = ?',
        [req.params.id, 'pending']
      );
    }
    
    // Fetch updated item
    const [updatedItems] = await pool.execute('SELECT * FROM items WHERE id = ? AND is_archived = FALSE', [req.params.id]);
    const updatedItem = updatedItems[0];
    
    // Save history
    await saveItemHistory(req.params.id, updatedItem, 'updated', req.user.user_id);
    
    res.json({ 
      message: 'Item updated successfully',
      item: updatedItem
    });
  } catch (error) {
    console.error('Update item error:', error);
    // product_code is no longer UNIQUE (migration_remove_unique_product_code.sql)
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete item (only super admin)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'sales') {
      return res.status(403).json({ error: 'Only authorized users can delete items' });
    }

    // Get item data before archiving for history
    const [items] = await pool.execute('SELECT * FROM items WHERE id = ?', [req.params.id]);
    if (items.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Check if already archived
    if (items[0].is_archived) {
      return res.status(400).json({ error: 'Item is already archived' });
    }

    // Save history before archiving
    await saveItemHistory(req.params.id, items[0], 'deleted', req.user.user_id);

    // Archive the item instead of deleting
    await pool.execute('UPDATE items SET is_archived = TRUE WHERE id = ?', [req.params.id]);
    res.json({ message: 'Item archived successfully' });
  } catch (error) {
    console.error('Delete item error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add items in bulk (purchase) - only admin and super_admin
// router.post('/purchase', authenticateToken, authorizeRole('admin', 'super_admin'), async (req, res) => {
//   try {
//     const { buyer_party_id, items, payment_status = 'partially_paid', paid_amount = 0 } = req.body;

//     if (!buyer_party_id || !items || items.length === 0) {
//       return res.status(400).json({ error: 'Buyer party and items are required' });
//     }

//     const connection = await pool.getConnection();
//     await connection.beginTransaction();

//     try {
//       // Validate buyer exists + get current balances
//       const [buyerRows] = await connection.execute(
//         'SELECT id, balance_amount, paid_amount FROM buyer_parties WHERE id = ?',
//         [buyer_party_id]
//       );
//       if (buyerRows.length === 0) {
//         await connection.rollback();
//         return res.status(404).json({ error: 'Buyer party not found' });
//       }
//       const currentBalance = parseFloat(buyerRows[0].balance_amount || 0);
//       const currentPaidTotal = parseFloat(buyerRows[0].paid_amount || 0);

//       // Compute total purchase amount
//       const totalPurchaseAmount = items.reduce((sum, it) => {
//         const qty = parseInt(it.quantity) || 0;
//         const rate = parseFloat(it.purchase_rate) || 0;
//         return sum + qty * rate;
//       }, 0);

//       const paidNow =
//         payment_status === 'fully_paid'
//           ? totalPurchaseAmount
//           : Math.max(0, parseFloat(paid_amount) || 0);

//       if (paidNow > totalPurchaseAmount) {
//         await connection.rollback();
//         return res.status(400).json({ error: 'Paid amount cannot exceed total purchase amount' });
//       }

//       // Ensure payment_transactions table exists if we will record payment
//       if (paidNow > 0) {
//         const [tableCheck] = await connection.execute(`
//           SELECT COUNT(*) as count 
//           FROM INFORMATION_SCHEMA.TABLES 
//           WHERE TABLE_SCHEMA = DATABASE() 
//           AND TABLE_NAME = 'payment_transactions'
//         `);

//         if (tableCheck[0].count === 0) {
//           await connection.execute(`
//             CREATE TABLE payment_transactions (
//               id INT AUTO_INCREMENT PRIMARY KEY,
//               party_type ENUM('buyer', 'seller') NOT NULL,
//               party_id INT NOT NULL,
//               amount DECIMAL(10,2) NOT NULL,
//               payment_date DATE NOT NULL,
//               created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//               created_by INT,
//               INDEX idx_party (party_type, party_id),
//               INDEX idx_date (payment_date)
//             )
//           `);
//         }
//       }

//       for (const item of items) {
//         const { item_id, product_code, brand, hsn_number, tax_rate, sale_rate, purchase_rate, quantity, alert_quantity, rack_number, remarks } = item;

//         // Validate sale_rate >= purchase_rate
//         const saleRateNum = parseFloat(sale_rate);
//         const purchaseRateNum = parseFloat(purchase_rate);
//         if (isNaN(saleRateNum) || isNaN(purchaseRateNum) || saleRateNum < purchaseRateNum) {
//           await connection.rollback();
//           return res.status(400).json({ error: `Sale rate must be greater than or equal to purchase rate for item: ${item.product_name || 'Unknown'}` });
//         }

//         if (item_id) {
//           // Update existing item
//           await connection.execute(
//             'UPDATE items SET quantity = quantity + ?, product_code = ?, brand = ?, hsn_number = ?, tax_rate = ?, sale_rate = ?, purchase_rate = ?, alert_quantity = ?, rack_number = ?, remarks = ? WHERE id = ?',
//             [quantity, product_code, brand, hsn_number, tax_rate, sale_rate, purchase_rate, alert_quantity, rack_number, remarks || null, item_id]
//           );

//           // Record purchase transaction
//           await connection.execute(
//             'INSERT INTO purchase_transactions (buyer_party_id, item_id, quantity, purchase_rate, total_amount, transaction_date) VALUES (?, ?, ?, ?, ?, CURDATE())',
//             [buyer_party_id, item_id, quantity, purchase_rate, purchase_rate * quantity]
//           );
//         } else {
//           // Create new item
//           const [result] = await connection.execute(
//             'INSERT INTO items (product_name, product_code, brand, hsn_number, tax_rate, sale_rate, purchase_rate, quantity, alert_quantity, rack_number, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
//             [item.product_name, product_code, brand, hsn_number, tax_rate, sale_rate, purchase_rate, quantity, alert_quantity, rack_number, remarks || null]
//           );

//           // Record purchase transaction
//           await connection.execute(
//             'INSERT INTO purchase_transactions (buyer_party_id, item_id, quantity, purchase_rate, total_amount, transaction_date) VALUES (?, ?, ?, ?, ?, CURDATE())',
//             [buyer_party_id, result.insertId, quantity, purchase_rate, purchase_rate * quantity]
//           );
//         }

//         // Check if quantity reached alert quantity
//         const effectiveItemId = item_id || result.insertId;
//         const [itemData] = await connection.execute('SELECT quantity, alert_quantity FROM items WHERE id = ? AND is_archived = FALSE', [effectiveItemId]);
//         if (itemData[0] && itemData[0].quantity <= itemData[0].alert_quantity) {
//           await connection.execute(
//             'INSERT INTO order_sheet (item_id, required_quantity, current_quantity, status) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE required_quantity = ?, current_quantity = ?, status = ?',
//             [effectiveItemId, itemData[0].alert_quantity, itemData[0].quantity, 'pending', itemData[0].alert_quantity, itemData[0].quantity, 'pending']
//           );
//         }
//       }

//       // Record payment (if any) + update buyer balance/paid totals
//       const newBalance = Math.max(0, currentBalance + totalPurchaseAmount - paidNow);
//       const newPaidTotal = currentPaidTotal + paidNow;

//       if (paidNow > 0) {
//         await connection.execute(
//           `INSERT INTO payment_transactions (party_type, party_id, amount, payment_date, created_by)
//            VALUES (?, ?, ?, CURDATE(), ?)`,
//           ['buyer', buyer_party_id, paidNow, req.user?.id || null]
//         );
//       }

//       await connection.execute(
//         'UPDATE buyer_parties SET balance_amount = ?, paid_amount = ? WHERE id = ?',
//         [newBalance, newPaidTotal, buyer_party_id]
//       );

//       await connection.commit();
//       res.json({ 
//         message: 'Items added successfully',
//         purchase_total: totalPurchaseAmount,
//         paid_amount: paidNow,
//         new_balance: newBalance
//       });
//     } catch (error) {
//       await connection.rollback();
//       throw error;
//     } finally {
//       connection.release();
//     }
//   } catch (error) {
//     console.error('Purchase items error:', error);
//     res.status(500).json({ error: 'Server error' });
//   }
// });





router.post('/purchase', authenticateToken, authorizeRole('admin', 'super_admin', 'sales'), async (req, res) => {
  try {
    const { buyer_party_id, items, payment_status = 'partially_paid', paid_amount = 0 } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Items are required' });
    }

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      let currentBalance = 0;
      let currentPaidTotal = 0;
      let isInventoryOnly = !buyer_party_id; // If no buyer_party_id, this is inventory addition only

      if (!isInventoryOnly) {
        // Validate buyer exists + get current balances
        const [buyerRows] = await connection.execute(
          'SELECT id, balance_amount, paid_amount FROM buyer_parties WHERE id = ?',
          [buyer_party_id]
        );
        if (buyerRows.length === 0) {
          await connection.rollback();
          return res.status(404).json({ error: 'Buyer party not found' });
        }
        currentBalance = parseFloat(buyerRows[0].balance_amount || 0);
        currentPaidTotal = parseFloat(buyerRows[0].paid_amount || 0);
      }

      // Compute total purchase amount
      const totalPurchaseAmount = items.reduce((sum, it) => {
        const qty = parseInt(it.quantity) || 0;
        const rate = parseFloat(it.purchase_rate) || 0;
        return sum + qty * rate;
      }, 0);

      const paidNow = isInventoryOnly ? totalPurchaseAmount : Math.max(0, parseFloat(paid_amount) || 0);

      if (!isInventoryOnly && paidNow > totalPurchaseAmount) {
        await connection.rollback();
        return res.status(400).json({ error: 'Paid amount cannot exceed total purchase amount' });
      }

      const newBalance = isInventoryOnly ? 0 : Math.max(0, currentBalance + totalPurchaseAmount - paidNow);
      const finalPaymentStatus = isInventoryOnly ? 'fully_paid' : (paidNow >= totalPurchaseAmount ? 'fully_paid' : (paidNow > 0 ? 'partially_paid' : 'unpaid'));

      // Check if new structure exists (both table and column)
      const [tableCheck] = await connection.execute(`
        SELECT COUNT(*) as count 
        FROM INFORMATION_SCHEMA.TABLES 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'purchase_items'
      `);
      const [columnCheck] = await connection.execute(`
        SELECT COUNT(*) as count 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'purchase_transactions' 
        AND COLUMN_NAME = 'total_amount_new'
      `);
      // Also check if item_id is nullable (required for new structure)
      const [itemIdCheck] = await connection.execute(`
        SELECT IS_NULLABLE 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'purchase_transactions' 
        AND COLUMN_NAME = 'item_id'
      `);
      const hasNewStructure = tableCheck[0].count > 0 && columnCheck[0].count > 0 && itemIdCheck[0]?.IS_NULLABLE === 'YES';

      let purchaseTransactionId;
      let billNumber;
      let paymentTransactionId = null;
      let paymentReceiptNumber = null;
      let paymentMethod = null;

      if (hasNewStructure) {
        // NEW STRUCTURE: Create header first, then items

        // Helper: bulk increment quantities for existing items using a derived table
        const bulkIncrementItemQuantities = async (rows) => {
          // rows: [{ id: number, qty: number }]
          if (!rows || rows.length === 0) return;

          // Build: UPDATE items i JOIN (SELECT ? AS id, ? AS qty UNION ALL ...) v ON i.id=v.id
          const unionSql = rows.map(() => 'SELECT ? AS id, ? AS qty').join(' UNION ALL ');
          const sql = `
            UPDATE items i
            JOIN (${unionSql}) v ON i.id = v.id
            SET i.quantity = i.quantity + v.qty
            WHERE i.is_archived = FALSE
          `;
          const params = rows.flatMap(r => [r.id, r.qty]);
          await connection.execute(sql, params);
        };
        
        // Generate bill number (only for actual purchases)
        let billNumber = null;
        if (!isInventoryOnly) {
          const [countResult] = await connection.execute(
            'SELECT COUNT(*) as count FROM purchase_transactions WHERE bill_number IS NOT NULL'
          );
          billNumber = `PUR-${Date.now()}-${countResult[0].count + 1}`;
        }

        // 1. Create purchase header (one per request) - only for actual purchases
        let purchaseTransactionId = null;
        if (!isInventoryOnly) {
          // Note: item_id is set to NULL for header records in new structure
          const [purchaseResult] = await connection.execute(
            `INSERT INTO purchase_transactions 
             (buyer_party_id, item_id, transaction_date, total_amount_new, paid_amount, balance_amount, payment_status, bill_number)
             VALUES (?, NULL, CURDATE(), ?, ?, ?, ?, ?)`,
            [buyer_party_id, totalPurchaseAmount, paidNow, newBalance, finalPaymentStatus, billNumber]
          );
          purchaseTransactionId = purchaseResult.insertId;
        }

        // 2. Bulk process items (minimize DB calls)
        const existingQtyRows = [];
        const newItems = [];

        for (const item of items) {
          const {
            item_id,
            product_code,
            brand,
            hsn_number,
            tax_rate,
            sale_rate,
            purchase_rate,
            quantity,
            alert_quantity,
            rack_number,
            remarks
          } = item;

          // Validate sale_rate >= purchase_rate (keep existing behavior)
          const saleRateNum = parseFloat(sale_rate);
          const purchaseRateNum = parseFloat(purchase_rate);
          if (isNaN(saleRateNum) || isNaN(purchaseRateNum) || saleRateNum < purchaseRateNum) {
            await connection.rollback();
            return res.status(400).json({ error: `Sale rate must be greater than or equal to purchase rate for item: ${item.product_name || 'Unknown'}` });
          }

          const qtyNum = parseInt(quantity) || 0;
          if (item_id) {
            existingQtyRows.push({ id: parseInt(item_id), qty: qtyNum });
          } else {
            newItems.push({
              ref: item,
              product_name: item.product_name,
              product_code,
              brand,
              hsn_number,
              tax_rate,
              sale_rate,
              purchase_rate,
              quantity: qtyNum,
              alert_quantity,
              rack_number,
              remarks: remarks || null
            });
          }
        }

        // 2a. Bulk increment quantities for existing items
        await bulkIncrementItemQuantities(existingQtyRows);

        // 2b. Bulk insert any new items, and map IDs back
        if (newItems.length > 0) {
          const valuesSql = newItems.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
          const insertSql = `
            INSERT INTO items
              (product_name, product_code, brand, hsn_number, tax_rate, sale_rate, purchase_rate, quantity, alert_quantity, rack_number, remarks)
            VALUES ${valuesSql}
          `;
          const insertParams = newItems.flatMap(n => [
            n.product_name,
            n.product_code,
            n.brand,
            n.hsn_number,
            n.tax_rate,
            n.sale_rate,
            n.purchase_rate,
            n.quantity,
            n.alert_quantity,
            n.rack_number,
            n.remarks
          ]);
          const [insertResult] = await connection.execute(insertSql, insertParams);

          // mysql2 returns the first insertId; subsequent IDs are sequential for multi-row insert
          const firstId = insertResult.insertId;
          for (let idx = 0; idx < newItems.length; idx++) {
            const newId = firstId + idx;
            newItems[idx].ref.item_id = newId;
          }
        }

        // Line items for purchase_items (after new items receive IDs)
        const purchaseItemRows = items
          .map((it) => {
            const id = parseInt(it.item_id, 10);
            const qty = parseInt(it.quantity, 10) || 0;
            const pr = parseFloat(it.purchase_rate) || 0;
            return {
              item_id: id,
              quantity: qty,
              purchase_rate: pr,
              total_amount: pr * qty
            };
          })
          .filter((r) => r.item_id && !Number.isNaN(r.item_id) && r.quantity > 0);

        // 2c. Bulk insert into purchase_items (only for actual purchases)
        if (!isInventoryOnly && purchaseItemRows.length > 0) {
          const valuesSql = purchaseItemRows.map(() => '(?, ?, ?, ?, ?)').join(', ');
          const insertSql = `
            INSERT INTO purchase_items (purchase_transaction_id, item_id, quantity, purchase_rate, total_amount)
            VALUES ${valuesSql}
          `;
          const params = purchaseItemRows.flatMap(r => [
            purchaseTransactionId,
            r.item_id,
            r.quantity,
            r.purchase_rate,
            r.total_amount
          ]);
          await connection.execute(insertSql, params);
        }

        // 2d. Bulk order_sheet check + upsert (single SELECT + single INSERT)
        const affectedItemIds = Array.from(
          new Set([
            ...existingQtyRows.map(r => r.id),
            ...newItems.map(n => parseInt(n.ref.item_id))
          ].filter(Boolean))
        );

        if (affectedItemIds.length > 0) {
          const placeholders = affectedItemIds.map(() => '?').join(', ');
          const [itemRows] = await connection.execute(
            `SELECT id, quantity, alert_quantity
             FROM items
             WHERE is_archived = FALSE AND id IN (${placeholders})`,
            affectedItemIds
          );

          const lowStock = itemRows.filter(r => r.quantity <= r.alert_quantity);
          if (lowStock.length > 0) {
            const valuesSql = lowStock.map(() => '(?, ?, ?, ?)').join(', ');
            const upsertSql = `
              INSERT INTO order_sheet (item_id, required_quantity, current_quantity, status)
              VALUES ${valuesSql}
              ON DUPLICATE KEY UPDATE
                required_quantity = VALUES(required_quantity),
                current_quantity = VALUES(current_quantity),
                status = VALUES(status)
            `;
            const params = lowStock.flatMap(r => [r.id, r.alert_quantity, r.quantity, 'pending']);
            await connection.execute(upsertSql, params);
          }
        }

        // Record payment with direct link to purchase_transaction_id (only for actual purchases)
        if (!isInventoryOnly && paidNow > 0) {
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

          const [paymentResult] = await connection.execute(
            `INSERT INTO payment_transactions 
             (party_type, party_id, purchase_transaction_id, amount, payment_date, previous_balance, updated_balance, receipt_number, created_by)
             VALUES (?, ?, ?, CURDATE(), ?, ?, ?, ?, ?)`,
            ['buyer', buyer_party_id, purchaseTransactionId, paidNow, currentBalance, newBalance, receiptNumber, (req.user?.id ? parseInt(req.user.id) : null)]
          );
          paymentTransactionId = paymentResult.insertId;
          paymentReceiptNumber = receiptNumber;
          paymentMethod = null; // Payment method not set in purchase payment
          console.log(`[DEBUG] Payment transaction created with ID: ${paymentTransactionId}, linked to purchase: ${purchaseTransactionId}`);
        }
      } else {
        // OLD STRUCTURE: Keep backward compatibility
        // This is the existing code path for systems not yet migrated
        // Helper: bulk increment quantities for existing items using a derived table
        const bulkIncrementItemQuantities = async (rows) => {
          if (!rows || rows.length === 0) return;
          const unionSql = rows.map(() => 'SELECT ? AS id, ? AS qty').join(' UNION ALL ');
          const sql = `
            UPDATE items i
            JOIN (${unionSql}) v ON i.id = v.id
            SET i.quantity = i.quantity + v.qty
            WHERE i.is_archived = FALSE
          `;
          const params = rows.flatMap(r => [r.id, r.qty]);
          await connection.execute(sql, params);
        };

        const existingQtyRows = [];
        const newItems = [];

        for (const item of items) {
          const {
            item_id,
            product_code,
            brand,
            hsn_number,
            tax_rate,
            sale_rate,
            purchase_rate,
            quantity,
            alert_quantity,
            rack_number,
            remarks
          } = item;

          // Validate sale_rate >= purchase_rate (keep existing behavior)
          const saleRateNum = parseFloat(sale_rate);
          const purchaseRateNum = parseFloat(purchase_rate);
          if (isNaN(saleRateNum) || isNaN(purchaseRateNum) || saleRateNum < purchaseRateNum) {
            await connection.rollback();
            return res.status(400).json({ error: `Sale rate must be greater than or equal to purchase rate for item: ${item.product_name || 'Unknown'}` });
          }

          const qtyNum = parseInt(quantity) || 0;
          if (item_id) {
            existingQtyRows.push({ id: parseInt(item_id), qty: qtyNum });
          } else {
            newItems.push({
              ref: item,
              product_name: item.product_name,
              product_code,
              brand,
              hsn_number,
              tax_rate,
              sale_rate,
              purchase_rate,
              quantity: qtyNum,
              alert_quantity,
              rack_number,
              remarks: remarks || null
            });
          }
        }

        // Bulk update quantities for existing items
        await bulkIncrementItemQuantities(existingQtyRows);

        // Bulk insert new items (if any) and map IDs
        if (newItems.length > 0) {
          const valuesSql = newItems.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
          const insertSql = `
            INSERT INTO items
              (product_name, product_code, brand, hsn_number, tax_rate, sale_rate, purchase_rate, quantity, alert_quantity, rack_number, remarks)
            VALUES ${valuesSql}
          `;
          const insertParams = newItems.flatMap(n => [
            n.product_name,
            n.product_code,
            n.brand,
            n.hsn_number,
            n.tax_rate,
            n.sale_rate,
            n.purchase_rate,
            n.quantity,
            n.alert_quantity,
            n.rack_number,
            n.remarks
          ]);
          const [insertResult] = await connection.execute(insertSql, insertParams);

          const firstId = insertResult.insertId;
          for (let idx = 0; idx < newItems.length; idx++) {
            const newId = firstId + idx;
            newItems[idx].ref.item_id = newId;
          }
        }

        // Bulk insert purchase_transactions (old structure: one per line item)
        const purchaseRows = items.map(it => {
          const effectiveItemId = parseInt(it.item_id);
          const qtyNum = parseInt(it.quantity) || 0;
          const prNum = parseFloat(it.purchase_rate) || 0;
          return {
            item_id: effectiveItemId,
            quantity: qtyNum,
            purchase_rate: prNum,
            total_amount: prNum * qtyNum
          };
        });

        if (!isInventoryOnly && purchaseRows.length > 0) {
          const valuesSql = purchaseRows.map(() => '(?, ?, ?, ?, ?, CURDATE())').join(', ');
          const insertSql = `
            INSERT INTO purchase_transactions
              (buyer_party_id, item_id, quantity, purchase_rate, total_amount, transaction_date)
            VALUES ${valuesSql}
          `;
          const params = purchaseRows.flatMap(r => [
            buyer_party_id,
            r.item_id,
            r.quantity,
            r.purchase_rate,
            r.total_amount
          ]);
          const [purchaseInsertResult] = await connection.execute(insertSql, params);
          purchaseTransactionId = purchaseInsertResult.insertId;
          console.log(`[DEBUG] Old structure: Bulk inserted ${purchaseRows.length} purchase_transactions. First ID: ${purchaseTransactionId}`);
        }

        // Bulk order_sheet check + upsert
        const affectedItemIds = Array.from(
          new Set([
            ...existingQtyRows.map(r => r.id),
            ...newItems.map(n => parseInt(n.ref.item_id))
          ].filter(Boolean))
        );

        if (affectedItemIds.length > 0) {
          const placeholders = affectedItemIds.map(() => '?').join(', ');
          const [itemRows] = await connection.execute(
            `SELECT id, quantity, alert_quantity
             FROM items
             WHERE is_archived = FALSE AND id IN (${placeholders})`,
            affectedItemIds
          );

          const lowStock = itemRows.filter(r => r.quantity <= r.alert_quantity);
          if (lowStock.length > 0) {
            const valuesSql = lowStock.map(() => '(?, ?, ?, ?)').join(', ');
            const upsertSql = `
              INSERT INTO order_sheet (item_id, required_quantity, current_quantity, status)
              VALUES ${valuesSql}
              ON DUPLICATE KEY UPDATE
                required_quantity = VALUES(required_quantity),
                current_quantity = VALUES(current_quantity),
                status = VALUES(status)
            `;
            const params = lowStock.flatMap(r => [r.id, r.alert_quantity, r.quantity, 'pending']);
            await connection.execute(upsertSql, params);
          }
        }

        // Record payment (old structure) - only for actual purchases
        if (!isInventoryOnly && paidNow > 0) {
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

          const [paymentResult] = await connection.execute(
            `INSERT INTO payment_transactions (party_type, party_id, amount, payment_date, created_by)
             VALUES (?, ?, ?, CURDATE(), ?)`,
            ['buyer', buyer_party_id, paidNow, (req.user?.id ? parseInt(req.user.id) : null)]
          );
          paymentTransactionId = paymentResult.insertId;
          paymentReceiptNumber = null; // Old structure doesn't have receipt numbers
          paymentMethod = null;
          console.log(`[DEBUG] Old structure: Payment transaction created with ID: ${paymentTransactionId}`);
        }
      }

      // Update buyer party balance (only for actual purchases)
      if (!isInventoryOnly) {
        await connection.execute(
          'UPDATE buyer_parties SET balance_amount = ?, paid_amount = ? WHERE id = ?',
          [newBalance, currentPaidTotal + paidNow, buyer_party_id]
        );
      }

      // Insert into unified_transactions table (if it exists) - only for actual purchases
      if (!isInventoryOnly) {
      try {
        const [unifiedTableCheck] = await connection.execute(`
          SELECT COUNT(*) as count 
          FROM INFORMATION_SCHEMA.TABLES 
          WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'unified_transactions'
        `);
        
        console.log(`[DEBUG] unified_transactions table check: ${unifiedTableCheck[0].count > 0 ? 'EXISTS' : 'NOT FOUND'}`);
        console.log(`[DEBUG] purchaseTransactionId: ${purchaseTransactionId}, billNumber: ${billNumber}`);
        
        if (unifiedTableCheck[0].count > 0) {
          if (!purchaseTransactionId) {
            console.warn('[WARN] Purchase transaction ID is not set. Cannot insert into unified_transactions.');
            console.warn('[WARN] This might happen with old structure. hasNewStructure:', hasNewStructure);
          } else {
            console.log(`[INFO] Inserting purchase_payment transaction ${purchaseTransactionId} into unified_transactions`);
            console.log(`[INFO] Buyer ID: ${buyer_party_id}, Amount: ${totalPurchaseAmount}, Paid: ${paidNow}, Balance: ${currentBalance} -> ${newBalance}`);
            
            // Create ONLY ONE purchase_payment transaction entry (regardless of payment amount)
            // This represents the purchase transaction with any payment made at that time
            const [insertResult] = await connection.execute(
              `INSERT INTO unified_transactions (
                party_type, party_id, transaction_type, transaction_date,
                previous_balance, transaction_amount, paid_amount, balance_after,
                reference_id, bill_number, payment_method, payment_status, created_by
              ) VALUES (?, ?, ?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                'buyer',
                buyer_party_id,
                'purchase_payment', // Always use purchase_payment type
                currentBalance, // Balance before purchase
                totalPurchaseAmount, // Total purchase amount
                paidNow, // Amount paid at purchase time (can be 0, partial, or full)
                newBalance, // Balance after purchase (after payment)
                purchaseTransactionId || null, // Reference to purchase transaction
                billNumber || null, // Old structure doesn't have bill numbers
                paymentMethod || null,
                finalPaymentStatus || 'unpaid',
                (req.user?.id ? parseInt(req.user.id) : null)
              ]
            );
            console.log(`[SUCCESS] Purchase payment transaction inserted into unified_transactions with ID: ${insertResult.insertId}`);
          }
        } else {
          console.log('[INFO] unified_transactions table does not exist. Run migration: server/database/migration_unified_transactions.sql');
        }
      } catch (unifiedError) {
        console.error('[ERROR] Error inserting into unified_transactions:', unifiedError.message);
        console.error('[ERROR] Full error:', unifiedError);
        if (unifiedError.code) {
          console.error('[ERROR] SQL Error Code:', unifiedError.code);
        }
        if (unifiedError.sql) {
          console.error('[ERROR] SQL:', unifiedError.sql);
        }
        // Don't fail the transaction if unified_transactions has issues
      }
      }

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

// Get total stock amount (sum of purchase_rate * quantity) - super admin only
router.get('/stock/total-amount', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only admin and super admin can view total stock amount' });
    }

    const [result] = await pool.execute(
      'SELECT SUM(purchase_rate * quantity) as total_stock_amount FROM items WHERE is_archived = FALSE'
    );

    res.json({ 
      total_stock_amount: result[0].total_stock_amount || 0 
    });
  } catch (error) {
    console.error('Get total stock amount error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get total stock amount by brand - super admin only
router.get('/stock/total-amount-by-brand', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only admin and super admin can view brand-wise stock amount' });
    }
    console.log('Get total stock amount by brand request received');

    const [rows] = await pool.execute(
      `SELECT 
        COALESCE(NULLIF(TRIM(brand), ''), 'Unbranded') AS brand,
        SUM(purchase_rate * quantity) AS total_stock_amount
       FROM items 
       WHERE is_archived = FALSE
       GROUP BY COALESCE(NULLIF(TRIM(brand), ''), 'Unbranded')
       ORDER BY total_stock_amount DESC`
    );

    const by_brand = (rows || []).map(r => ({
      brand: r.brand,
      total_stock_amount: parseFloat(r.total_stock_amount) || 0
    }));

    const total_stock_amount = by_brand.reduce((sum, b) => sum + b.total_stock_amount, 0);

    res.json({
      total_stock_amount,
      by_brand
    });
  } catch (error) {
    console.error('Get total stock amount by brand error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;


