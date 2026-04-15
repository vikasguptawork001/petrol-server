/**
 * One-off: compare live DB to tables/columns the app expects.
 * Run: node server/scripts/check-schema.js
 */
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const config = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'inventory_management',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
};

/** Minimal expected schema derived from routes + exported-schema + reset-database */
const EXPECTED = {
  tables: [
    'users',
    'items',
    'items_history',
    'buyer_parties',
    'seller_parties',
    'purchase_transactions',
    'purchase_items',
    'payment_transactions',
    'sale_transactions',
    'sale_items',
    'return_transactions',
    'return_items',
    'order_sheet',
    'unified_transactions',
    'expenses',
    'nozzles',
    'attendants',
    'nozzle_readings',
  ],
  columns: {
    items: [
      'id', 'product_name', 'unit', 'product_code', 'brand', 'hsn_number', 'tax_rate',
      'sale_rate', 'min_sale_rate', 'purchase_rate', 'quantity', 'alert_quantity',
      'rack_number', 'remarks', 'image', 'image_url', 'is_archived', 'created_by', 'updated_by',
    ],
    buyer_parties: [
      'id', 'party_name', 'mobile_number', 'email', 'address', 'gst_number',
      'opening_balance', 'closing_balance', 'paid_amount', 'balance_amount',
      'is_archived', 'cheque_number', 'bank_name',
    ],
    seller_parties: [
      'id', 'party_name', 'mobile_number', 'email', 'address', 'gst_number',
      'opening_balance', 'closing_balance', 'paid_amount', 'balance_amount',
      'due_date', 'vehicle_number', 'is_archived', 'cheque_number', 'bank_name',
    ],
    sale_transactions: [
      'id', 'seller_party_id', 'attendant_id', 'nozzle_id', 'transaction_date',
      'subtotal', 'discount', 'discount_type', 'discount_percentage', 'tax_amount',
      'total_amount', 'paid_amount', 'balance_amount', 'payment_status', 'bill_number',
      'with_gst', 'previous_balance_paid', 'created_at',
    ],
    sale_items: [
      'id', 'sale_transaction_id', 'item_id', 'quantity', 'sale_rate', 'total_amount',
      'discount', 'discount_type', 'discount_percentage', 'unit',
    ],
    purchase_transactions: [
      'id', 'buyer_party_id', 'item_id', 'quantity', 'purchase_rate', 'total_amount',
      'transaction_date', 'total_amount_new', 'paid_amount', 'balance_amount',
      'payment_status', 'bill_number', 'created_at',
    ],
    return_transactions: [
      'id', 'seller_party_id', 'buyer_party_id', 'party_type', 'return_date',
      'total_amount', 'bill_number', 'reason', 'return_type', 'created_at',
    ],
    return_items: [
      'id', 'return_transaction_id', 'item_id', 'quantity', 'return_rate', 'total_amount',
      'discount', 'discount_type', 'discount_percentage',
    ],
    payment_transactions: [
      'id', 'party_type', 'party_id', 'payment_date', 'amount', 'previous_balance',
      'updated_balance', 'receipt_number', 'payment_method', 'notes', 'created_at',
      'created_by', 'purchase_transaction_id',
    ],
    unified_transactions: [
      'id', 'party_type', 'party_id', 'transaction_type', 'transaction_date',
      'previous_balance', 'transaction_amount', 'paid_amount', 'balance_after',
      'reference_id', 'bill_number', 'payment_method', 'payment_status', 'notes',
      'created_at', 'created_by',
    ],
    expenses: [
      'id', 'expense_date', 'amount', 'purpose', 'paid_to', 'reason', 'notes',
      'created_by_user_id', 'created_at',
    ],
  },
};

async function main() {
  let conn;
  try {
    conn = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: config.ssl,
      connectTimeout: 15000,
    });
  } catch (e) {
    console.error('CONNECT_FAILED:', e.code || '', e.message);
    process.exit(2);
  }

  const db = config.database;
  const [tables] = await conn.query(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
    [db]
  );
  const tableSet = new Set(tables.map((t) => t.TABLE_NAME));

  console.log('DATABASE:', db);
  console.log('--- Missing tables (expected by app) ---');
  const missingTables = EXPECTED.tables.filter((t) => !tableSet.has(t));
  if (missingTables.length === 0) console.log('(none)');
  else missingTables.forEach((t) => console.log('  MISSING:', t));

  for (const table of EXPECTED.tables) {
    if (!tableSet.has(table)) continue;
    const expectedCols = EXPECTED.columns[table];
    if (!expectedCols) continue;
    const [cols] = await conn.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [db, table]
    );
    const have = new Set(cols.map((c) => c.COLUMN_NAME));
    const missing = expectedCols.filter((c) => !have.has(c));
    if (missing.length) {
      console.log(`--- ${table}: missing columns ---`);
      missing.forEach((c) => console.log('  MISSING COLUMN:', c));
    }
  }

  console.log('--- Extra tables in DB (not in minimal checklist) ---');
  const extra = [...tableSet].filter((t) => !EXPECTED.tables.includes(t));
  if (extra.length === 0) console.log('(none)');
  else extra.forEach((t) => console.log('  ', t));

  const [uCols] = await conn.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'unified_transactions'`,
    [db]
  );
  const uHave = new Set(uCols.map((c) => c.COLUMN_NAME));
  if (!uHave.has('return_type')) {
    console.log('--- NOTE: unified_transactions has no return_type (bills.js fallback query may error) ---');
  }

  await conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
