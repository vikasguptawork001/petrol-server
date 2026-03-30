const pool = require('./config/database');
async function q() {
  try {
    const [rows] = await pool.execute(`
      SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE REFERENCED_TABLE_NAME = 'nozzle_readings'
    `);
    console.log(JSON.stringify(rows, null, 2));
  } catch(e) {
    console.error(e);
  }
  process.exit(0);
}
q();
