// Validate required environment variables
require('dotenv').config();

const requiredEnvVars = [
  'DB_HOST',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
  'JWT_SECRET'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingVars.forEach(varName => {
    console.error(`   - ${varName}`);
  });
  console.error('\nPlease create a .env file in the server directory with these variables.');
  console.error('You can copy server/.env.example as a template.');
  process.exit(1);
}

// Validate JWT_SECRET strength
if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
  console.warn('⚠️  WARNING: JWT_SECRET should be at least 32 characters long for security.');
}

// Validate NODE_ENV
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development';
}

console.log('✓ Environment variables validated');

module.exports = {};













