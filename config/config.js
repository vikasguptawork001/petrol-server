const path = require('path');
const fs = require('fs');

// Load .env from current working directory (where the server process was started)
const envPath = path.join(process.cwd(), '.env');
require('dotenv').config({ path: envPath });

// Log which .env is used (helpful when debugging or running from Electron)
if (process.env.DEBUG_ENV_PATH !== 'false') {
  const exists = fs.existsSync(envPath);
  console.log(`[config] .env path: ${envPath} (${exists ? 'found' : 'NOT FOUND'})`);
}

const config = {
  // Server Configuration
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',

  // Database Configuration
  database: {
    host: process.env.DB_HOST || 'shuttle.proxy.rlwy.net',
    port: parseInt(process.env.DB_PORT) || 15272,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'WXhGrlTkRIUBeEPUzdQnYmSGZXONzsKM',
    database: process.env.DB_NAME || 'railway',
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 10,
    queueLimit: parseInt(process.env.DB_QUEUE_LIMIT) || 0,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
  },
  
  // JWT Configuration
  jwt: {
    secret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h'
  },
  
  // CORS Configuration
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    credentials: true
  },
  
  // API Configuration
  api: {
    baseUrl: process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 5000}`,
    prefix: '/api'
  },
  
  // File Upload Configuration
  upload: {
    maxFileSize: process.env.MAX_FILE_SIZE || '10mb',
    allowedMimeTypes: process.env.ALLOWED_MIME_TYPES?.split(',') || ['application/json']
  },
  
  // Logging Configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    enableRequestLogging: process.env.ENABLE_REQUEST_LOGGING !== 'false'
  },

  // Cloudinary (optional - if set, item images are uploaded here and URL stored in DB)
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET
  }
};

// Validate required environment variables in production
if (config.nodeEnv === 'production') {
  const required = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'JWT_SECRET'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

module.exports = config;




