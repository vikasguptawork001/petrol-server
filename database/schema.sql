-- Create Database
CREATE DATABASE IF NOT EXISTS inventory_management;
USE inventory_management;

-- Users Table
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(50) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  role ENUM('super_admin', 'admin', 'sales') NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Items Table
CREATE TABLE IF NOT EXISTS items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_name VARCHAR(255) NOT NULL,
  product_code VARCHAR(100) UNIQUE,
  brand VARCHAR(100),
  hsn_number VARCHAR(50),
  tax_rate DECIMAL(5,2) DEFAULT 0,
  sale_rate DECIMAL(10,2) NOT NULL,
  purchase_rate DECIMAL(10,2) NOT NULL,
  quantity INT DEFAULT 0,
  alert_quantity INT DEFAULT 0,
  rack_number VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Buyer Parties Table
CREATE TABLE IF NOT EXISTS buyer_parties (
  id INT AUTO_INCREMENT PRIMARY KEY,
  party_name VARCHAR(255) NOT NULL,
  mobile_number VARCHAR(20),
  email VARCHAR(100),
  address TEXT,
  opening_balance DECIMAL(10,2) DEFAULT 0,
  closing_balance DECIMAL(10,2) DEFAULT 0,
  paid_amount DECIMAL(10,2) DEFAULT 0,
  balance_amount DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Seller Parties Table
CREATE TABLE IF NOT EXISTS seller_parties (
  id INT AUTO_INCREMENT PRIMARY KEY,
  party_name VARCHAR(255) NOT NULL,
  mobile_number VARCHAR(20),
  email VARCHAR(100),
  address TEXT,
  opening_balance DECIMAL(10,2) DEFAULT 0,
  closing_balance DECIMAL(10,2) DEFAULT 0,
  paid_amount DECIMAL(10,2) DEFAULT 0,
  balance_amount DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Purchase Transactions Table
CREATE TABLE IF NOT EXISTS purchase_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  buyer_party_id INT NOT NULL,
  item_id INT NOT NULL,
  quantity INT NOT NULL,
  purchase_rate DECIMAL(10,2) NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  transaction_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (buyer_party_id) REFERENCES buyer_parties(id),
  FOREIGN KEY (item_id) REFERENCES items(id)
);

-- Sale Transactions Table
CREATE TABLE IF NOT EXISTS sale_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  seller_party_id INT NOT NULL,
  transaction_date DATE NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  paid_amount DECIMAL(10,2) DEFAULT 0,
  balance_amount DECIMAL(10,2) DEFAULT 0,
  payment_status ENUM('fully_paid', 'partially_paid') DEFAULT 'fully_paid',
  bill_number VARCHAR(50) UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (seller_party_id) REFERENCES seller_parties(id)
);

-- Sale Items Table
CREATE TABLE IF NOT EXISTS sale_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sale_transaction_id INT NOT NULL,
  item_id INT NOT NULL,
  quantity INT NOT NULL,
  sale_rate DECIMAL(10,2) NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (sale_transaction_id) REFERENCES sale_transactions(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(id)
);

-- Return Transactions Table
CREATE TABLE IF NOT EXISTS return_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  seller_party_id INT NOT NULL,
  item_id INT NOT NULL,
  quantity INT NOT NULL,
  return_amount DECIMAL(10,2) NOT NULL,
  return_date DATE NOT NULL,
  reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (seller_party_id) REFERENCES seller_parties(id),
  FOREIGN KEY (item_id) REFERENCES items(id)
);

-- Order Sheet Table
CREATE TABLE IF NOT EXISTS order_sheet (
  id INT AUTO_INCREMENT PRIMARY KEY,
  item_id INT NOT NULL UNIQUE,
  required_quantity INT NOT NULL,
  current_quantity INT NOT NULL,
  status ENUM('pending', 'ordered', 'completed') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (item_id) REFERENCES items(id)
);

-- Insert default super admin user (password: admin123)
-- NOTE: The password hash below may not work. After running this schema, run:
--   node server/fix-password.js
-- Or manually update the password hash using bcrypt.
-- Default credentials: User ID: superadmin, Password: admin123
INSERT INTO users (user_id, password, role) 
VALUES ('superadmin', '$2a$10$SmudmB9qhS2GiCBxCIcjFOk1Hnvmdbijoz7Ea41NSE68a24LbYc5W', 'super_admin')
ON DUPLICATE KEY UPDATE user_id=user_id;

