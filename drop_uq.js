const pool = require('./config/database');
async function drop() {
  try {
    // 1. Create an explicit index on attendant_id for the foreign key
    await pool.execute('CREATE INDEX idx_attendant_id ON nozzle_readings(attendant_id)');
    console.log('Created index on attendant_id');
    // 2. Drop the unique constraint
    await pool.execute('ALTER TABLE nozzle_readings DROP INDEX uq_attendant_nozzle_date');
    console.log('Dropped unique constraint successfully');
  } catch(e) {
    console.error(e.message);
  }
  process.exit(0);
}
drop();
