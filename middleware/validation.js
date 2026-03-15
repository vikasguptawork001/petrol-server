// Input validation middleware

const validateEmail = (email) => {
  if (!email) return true; // Optional field
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
};

const validateMobile = (mobile) => {
  if (!mobile) return true; // Optional field
  const re = /^[0-9]{10}$/;
  return re.test(mobile);
};

const sanitizeString = (str) => {
  if (typeof str !== 'string') return str;
  return str.trim().replace(/[<>]/g, '');
};

const validateItem = (req, res, next) => {
  const { product_name, sale_rate, purchase_rate } = req.body;

  if (!product_name || typeof product_name !== 'string' || product_name.trim().length === 0) {
    return res.status(400).json({ error: 'Product name is required and must be a non-empty string' });
  }

  if (product_name.length > 255) {
    return res.status(400).json({ error: 'Product name must be less than 255 characters' });
  }

  if (sale_rate === undefined || sale_rate === null || isNaN(sale_rate) || sale_rate < 0) {
    return res.status(400).json({ error: 'Sale rate is required and must be a positive number' });
  }

  if (purchase_rate === undefined || purchase_rate === null || isNaN(purchase_rate) || purchase_rate < 0) {
    return res.status(400).json({ error: 'Purchase rate is required and must be a positive number' });
  }

  // Validate sale_rate >= purchase_rate
  const saleRateNum = parseFloat(sale_rate);
  const purchaseRateNum = parseFloat(purchase_rate);
  if (saleRateNum < purchaseRateNum) {
    return res.status(400).json({ error: 'Sale rate must be greater than or equal to purchase rate' });
  }

  // Sanitize inputs
  if (req.body.product_name) req.body.product_name = sanitizeString(req.body.product_name);
  if (req.body.product_code) req.body.product_code = sanitizeString(req.body.product_code);
  if (req.body.brand) req.body.brand = sanitizeString(req.body.brand);
  if (req.body.hsn_number) req.body.hsn_number = sanitizeString(req.body.hsn_number);
  if (req.body.rack_number) req.body.rack_number = sanitizeString(req.body.rack_number);

  next();
};

const validateParty = (req, res, next) => {
  const { party_name, email, mobile_number } = req.body;

  if (!party_name || typeof party_name !== 'string' || party_name.trim().length === 0) {
    return res.status(400).json({ error: 'Party name is required and must be a non-empty string' });
  }

  if (party_name.length > 255) {
    return res.status(400).json({ error: 'Party name must be less than 255 characters' });
  }

  if (email && !validateEmail(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  if (mobile_number && !validateMobile(mobile_number)) {
    return res.status(400).json({ error: 'Mobile number must be 10 digits' });
  }

  // Sanitize inputs
  if (req.body.party_name) req.body.party_name = sanitizeString(req.body.party_name);
  if (req.body.address) req.body.address = sanitizeString(req.body.address);
  if (req.body.email) req.body.email = sanitizeString(req.body.email).toLowerCase();
  if (req.body.mobile_number) req.body.mobile_number = sanitizeString(req.body.mobile_number);

  next();
};

const validateLogin = (req, res, next) => {
  const { user_id, password } = req.body;

  if (!user_id || typeof user_id !== 'string' || user_id.trim().length === 0) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  if (!password || typeof password !== 'string' || password.length === 0) {
    return res.status(400).json({ error: 'Password is required' });
  }

  if (user_id.length > 50) {
    return res.status(400).json({ error: 'User ID must be less than 50 characters' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  req.body.user_id = sanitizeString(req.body.user_id);

  next();
};

const validateRegister = (req, res, next) => {
  const { user_id, password, role } = req.body;

  if (!user_id || typeof user_id !== 'string' || user_id.trim().length === 0) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Password is required and must be at least 6 characters' });
  }

  if (!role || !['super_admin', 'admin', 'sales'].includes(role)) {
    return res.status(400).json({ error: 'Valid role is required (super_admin, admin, or sales)' });
  }

  if (user_id.length > 50) {
    return res.status(400).json({ error: 'User ID must be less than 50 characters' });
  }

  req.body.user_id = sanitizeString(req.body.user_id);

  next();
};

const validateTransaction = (req, res, next) => {
  const { seller_party_id, items, payment_status, paid_amount, with_gst, previous_balance_paid } = req.body;

  if (!seller_party_id || isNaN(seller_party_id) || seller_party_id <= 0) {
    return res.status(400).json({ error: 'Valid seller party ID is required' });
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'At least one item is required' });
  }

  // Check for duplicate items
  const itemIds = items.map(item => item.item_id);
  const uniqueItemIds = new Set(itemIds);
  if (itemIds.length !== uniqueItemIds.size) {
    return res.status(400).json({ error: 'Duplicate items are not allowed. Please combine quantities for the same item.' });
  }

  for (const item of items) {
    if (!item.item_id || isNaN(item.item_id) || item.item_id <= 0) {
      return res.status(400).json({ error: 'Valid item ID is required for all items' });
    }
    if (!item.quantity || isNaN(item.quantity) || item.quantity <= 0) {
      return res.status(400).json({ error: 'Valid quantity (greater than 0) is required for all items' });
    }
    if (item.quantity % 1 !== 0) {
      return res.status(400).json({ error: 'Quantity must be a whole number' });
    }
    if (item.sale_rate === undefined || item.sale_rate === null || isNaN(item.sale_rate) || item.sale_rate < 0) {
      return res.status(400).json({ error: 'Valid sale rate (>= 0) is required for all items' });
    }
    
    // Validate discount
    if (item.discount !== undefined && item.discount !== null) {
      const discount = parseFloat(item.discount);
      if (isNaN(discount) || discount < 0) {
        return res.status(400).json({ error: 'Discount must be a non-negative number' });
      }
    }
    
    // Validate discount_percentage
    if (item.discount_percentage !== undefined && item.discount_percentage !== null) {
      const discountPct = parseFloat(item.discount_percentage);
      if (isNaN(discountPct) || discountPct < 0 || discountPct > 100) {
        return res.status(400).json({ error: 'Discount percentage must be between 0 and 100' });
      }
    }
    
    // Validate discount_type
    if (item.discount_type && !['amount', 'percentage'].includes(item.discount_type)) {
      return res.status(400).json({ error: 'Discount type must be either "amount" or "percentage"' });
    }
  }

  if (payment_status && !['fully_paid', 'partially_paid'].includes(payment_status)) {
    return res.status(400).json({ error: 'Payment status must be fully_paid or partially_paid' });
  }

  if (payment_status === 'partially_paid') {
    if (paid_amount === undefined || paid_amount === null || isNaN(paid_amount) || paid_amount < 0) {
      return res.status(400).json({ error: 'Paid amount is required and must be a non-negative number for partially paid transactions' });
    }
  }

  // Validate with_gst
  if (with_gst !== undefined && typeof with_gst !== 'boolean') {
    return res.status(400).json({ error: 'with_gst must be a boolean value' });
  }

  // Validate previous_balance_paid
  if (previous_balance_paid !== undefined && previous_balance_paid !== null) {
    const prevBalance = parseFloat(previous_balance_paid);
    if (isNaN(prevBalance) || prevBalance < 0) {
      return res.status(400).json({ error: 'Previous balance paid must be a non-negative number' });
    }
  }

  next();
};

module.exports = {
  validateItem,
  validateParty,
  validateLogin,
  validateRegister,
  validateTransaction
};









