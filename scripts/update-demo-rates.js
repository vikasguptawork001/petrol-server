require('dotenv').config({ path: '../.env' });
const pool = require('../config/database');

/**
 * Script to automatically update the 'min_sale_rate' of all stock items 
 * to be exactly 'sale_rate - 20' for demo purposes.
 * 
 * Target: items table, min_sale_rate column
 */
async function updateMinSaleRatesForDemo() {
  console.log('--- Starting Min Sale Rate Update for Demo ---');
  
  try {
    // 1. Check if column exists (safety check)
    try {
      await pool.execute('SELECT min_sale_rate FROM items LIMIT 1');
    } catch (e) {
      console.error('❌ Column "min_sale_rate" does not seem to exist in the database.');
      console.log('Attempting to add column first...');
      await pool.execute('ALTER TABLE items ADD COLUMN min_sale_rate DECIMAL(10,2) DEFAULT NULL AFTER purchase_rate');
      console.log('✓ Column "min_sale_rate" added.');
    }

    // 2. Check current state
    const [counts] = await pool.execute('SELECT COUNT(*) as total FROM items');
    console.log(`Found ${counts[0].total} items in stock.`);

    if (counts[0].total === 0) {
      console.log('No items found to update.');
      process.exit(0);
    }

    // 3. Perform the update
    // We update min_sale_rate to be sale_rate - 20
    const [result] = await pool.execute('UPDATE items SET min_sale_rate = sale_rate - 20');
    
    console.log(`✓ Successfully updated ${result.affectedRows} items.`);
    console.log('Rule applied: min_sale_rate = sale_rate - 20');

    // 4. Verify a few items
    const [samples] = await pool.execute('SELECT product_name, sale_rate, min_sale_rate FROM items LIMIT 5');
    console.log('\nSample results:');
    samples.forEach(item => {
      console.log(`- ${item.product_name}: Sale=${item.sale_rate}, Min Sale=${item.min_sale_rate} (Diff=${item.sale_rate - item.min_sale_rate})`);
    });

  } catch (error) {
    console.error('❌ Error updating rates:', error.message);
  } finally {
    // Note: We don't close the pool if it's being used by other things in a larger context, 
    // but for a standalone script, we should.
    await pool.end();
    console.log('\n--- Script Completed ---');
    process.exit(0);
  }
}

updateMinSaleRatesForDemo();
