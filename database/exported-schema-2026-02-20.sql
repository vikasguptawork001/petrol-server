-- Exported table structure
-- Database: u812625986_steepwholesale
-- Date: 2026-02-20T05:04:07.744Z
-- Run this on the new database (after creating it) to recreate table structures.

USE `u812625986_steepwholesale`;

-- Table: buyer_parties
DROP TABLE IF EXISTS `buyer_parties`;
CREATE TABLE `buyer_parties` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `party_name` varchar(255) NOT NULL,
  `mobile_number` varchar(20) DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `opening_balance` decimal(10,2) DEFAULT 0.00,
  `closing_balance` decimal(10,2) DEFAULT 0.00,
  `paid_amount` decimal(10,2) DEFAULT 0.00,
  `balance_amount` decimal(10,2) DEFAULT 0.00,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `gst_number` varchar(20) DEFAULT NULL,
  `is_archived` tinyint(1) DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_buyer_mobile_unique` (`mobile_number`),
  UNIQUE KEY `idx_buyer_email_unique` (`email`),
  KEY `idx_buyer_name` (`party_name`),
  KEY `idx_buyer_gst_number` (`gst_number`),
  KEY `idx_buyer_parties_is_archived` (`is_archived`)
) ENGINE=InnoDB AUTO_INCREMENT=525 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Table: items
DROP TABLE IF EXISTS `items`;
CREATE TABLE `items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `product_name` varchar(255) NOT NULL,
  `product_code` varchar(100) DEFAULT NULL,
  `brand` varchar(100) DEFAULT NULL,
  `hsn_number` varchar(50) DEFAULT NULL,
  `tax_rate` decimal(5,2) DEFAULT 0.00,
  `sale_rate` decimal(10,2) NOT NULL,
  `purchase_rate` decimal(10,2) NOT NULL,
  `quantity` int(11) DEFAULT 0,
  `alert_quantity` int(11) DEFAULT 0,
  `rack_number` varchar(50) DEFAULT NULL,
  `is_archived` tinyint(1) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `remarks` varchar(200) DEFAULT NULL,
  `image_url` varchar(512) DEFAULT NULL,
  `image` longblob DEFAULT NULL,
  `created_by` varchar(50) DEFAULT NULL,
  `updated_by` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_is_archived` (`is_archived`),
  KEY `idx_product_code` (`product_code`),
  KEY `idx_product_name` (`product_name`),
  KEY `idx_items_archived_id` (`is_archived`,`id`)
) ENGINE=InnoDB AUTO_INCREMENT=16276 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Table: items_history
DROP TABLE IF EXISTS `items_history`;
CREATE TABLE `items_history` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `item_id` int(11) NOT NULL,
  `product_name` varchar(255) NOT NULL,
  `product_code` varchar(100) DEFAULT NULL,
  `brand` varchar(100) DEFAULT NULL,
  `hsn_number` varchar(50) DEFAULT NULL,
  `tax_rate` decimal(5,2) DEFAULT 0.00,
  `sale_rate` decimal(10,2) NOT NULL,
  `purchase_rate` decimal(10,2) NOT NULL,
  `quantity` int(11) DEFAULT 0,
  `alert_quantity` int(11) DEFAULT 0,
  `rack_number` varchar(50) DEFAULT NULL,
  `remarks` varchar(200) DEFAULT NULL,
  `action_type` enum('created','updated','deleted') NOT NULL,
  `changed_by` varchar(50) DEFAULT NULL,
  `changed_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_item_id` (`item_id`),
  KEY `idx_changed_at` (`changed_at`),
  KEY `idx_action_type` (`action_type`),
  CONSTRAINT `items_history_ibfk_1` FOREIGN KEY (`item_id`) REFERENCES `items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=418 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Table: order_sheet
DROP TABLE IF EXISTS `order_sheet`;
CREATE TABLE `order_sheet` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `item_id` int(11) NOT NULL,
  `required_quantity` int(11) NOT NULL,
  `current_quantity` int(11) NOT NULL,
  `status` enum('pending','ordered','completed') DEFAULT 'pending',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `item_id` (`item_id`),
  KEY `idx_status` (`status`),
  CONSTRAINT `order_sheet_ibfk_1` FOREIGN KEY (`item_id`) REFERENCES `items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=269 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Table: payment_transactions
DROP TABLE IF EXISTS `payment_transactions`;
CREATE TABLE `payment_transactions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `party_type` enum('buyer','seller') NOT NULL,
  `party_id` int(11) NOT NULL,
  `payment_date` date NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `previous_balance` decimal(10,2) NOT NULL DEFAULT 0.00,
  `updated_balance` decimal(10,2) NOT NULL DEFAULT 0.00,
  `receipt_number` varchar(50) DEFAULT NULL,
  `payment_method` varchar(50) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `created_by` varchar(50) DEFAULT NULL,
  `purchase_transaction_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `receipt_number` (`receipt_number`),
  KEY `idx_party` (`party_type`,`party_id`),
  KEY `idx_payment_date` (`payment_date`),
  KEY `idx_receipt_number` (`receipt_number`),
  KEY `idx_purchase_transaction_id` (`purchase_transaction_id`),
  CONSTRAINT `fk_payment_purchase` FOREIGN KEY (`purchase_transaction_id`) REFERENCES `purchase_transactions` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=31 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Table: purchase_items
DROP TABLE IF EXISTS `purchase_items`;
CREATE TABLE `purchase_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `purchase_transaction_id` int(11) NOT NULL,
  `item_id` int(11) NOT NULL,
  `quantity` int(11) NOT NULL,
  `purchase_rate` decimal(10,2) NOT NULL,
  `total_amount` decimal(10,2) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_purchase_transaction_id` (`purchase_transaction_id`),
  KEY `idx_item_id` (`item_id`),
  CONSTRAINT `purchase_items_ibfk_1` FOREIGN KEY (`purchase_transaction_id`) REFERENCES `purchase_transactions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `purchase_items_ibfk_2` FOREIGN KEY (`item_id`) REFERENCES `items` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Table: purchase_transactions
DROP TABLE IF EXISTS `purchase_transactions`;
CREATE TABLE `purchase_transactions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `buyer_party_id` int(11) NOT NULL,
  `item_id` int(11) NOT NULL,
  `quantity` int(11) NOT NULL,
  `purchase_rate` decimal(10,2) NOT NULL,
  `total_amount` decimal(10,2) NOT NULL,
  `transaction_date` date NOT NULL,
  `total_amount_new` decimal(10,2) DEFAULT 0.00,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `paid_amount` decimal(10,2) DEFAULT 0.00,
  `balance_amount` decimal(10,2) DEFAULT 0.00,
  `payment_status` enum('fully_paid','partially_paid','unpaid') DEFAULT 'unpaid',
  `bill_number` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `bill_number` (`bill_number`),
  KEY `idx_buyer_party` (`buyer_party_id`),
  KEY `idx_item` (`item_id`),
  KEY `idx_transaction_date` (`transaction_date`),
  CONSTRAINT `purchase_transactions_ibfk_1` FOREIGN KEY (`buyer_party_id`) REFERENCES `buyer_parties` (`id`) ON DELETE CASCADE,
  CONSTRAINT `purchase_transactions_ibfk_2` FOREIGN KEY (`item_id`) REFERENCES `items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=92 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Table: return_items
DROP TABLE IF EXISTS `return_items`;
CREATE TABLE `return_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `return_transaction_id` int(11) NOT NULL,
  `item_id` int(11) NOT NULL,
  `quantity` int(11) NOT NULL,
  `return_rate` decimal(10,2) NOT NULL,
  `total_amount` decimal(10,2) NOT NULL,
  `discount` decimal(10,2) DEFAULT 0.00,
  `discount_type` varchar(20) DEFAULT 'amount',
  `discount_percentage` decimal(5,2) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_return_transaction` (`return_transaction_id`),
  KEY `idx_item` (`item_id`),
  CONSTRAINT `return_items_ibfk_1` FOREIGN KEY (`return_transaction_id`) REFERENCES `return_transactions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `return_items_ibfk_2` FOREIGN KEY (`item_id`) REFERENCES `items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=214 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Table: return_transactions
DROP TABLE IF EXISTS `return_transactions`;
CREATE TABLE `return_transactions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `seller_party_id` int(11) DEFAULT NULL,
  `buyer_party_id` int(11) DEFAULT NULL,
  `party_type` enum('seller','buyer') NOT NULL,
  `return_date` date NOT NULL,
  `total_amount` decimal(10,2) NOT NULL DEFAULT 0.00,
  `bill_number` varchar(50) DEFAULT NULL,
  `reason` text DEFAULT NULL,
  `return_type` varchar(20) DEFAULT 'adjust',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `bill_number` (`bill_number`),
  KEY `idx_seller_party` (`seller_party_id`),
  KEY `idx_buyer_party` (`buyer_party_id`),
  KEY `idx_return_date` (`return_date`),
  KEY `idx_bill_number` (`bill_number`),
  KEY `idx_party_type` (`party_type`),
  KEY `idx_return_transactions_date_party` (`return_date`,`party_type`),
  KEY `idx_return_transactions_date_id` (`return_date` DESC,`id` DESC),
  CONSTRAINT `return_transactions_ibfk_1` FOREIGN KEY (`seller_party_id`) REFERENCES `seller_parties` (`id`) ON DELETE CASCADE,
  CONSTRAINT `return_transactions_ibfk_2` FOREIGN KEY (`buyer_party_id`) REFERENCES `buyer_parties` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=45 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Table: sale_items
DROP TABLE IF EXISTS `sale_items`;
CREATE TABLE `sale_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `sale_transaction_id` int(11) NOT NULL,
  `item_id` int(11) NOT NULL,
  `quantity` int(11) NOT NULL,
  `sale_rate` decimal(10,2) NOT NULL,
  `total_amount` decimal(10,2) NOT NULL,
  `discount` decimal(10,2) DEFAULT 0.00,
  `discount_type` enum('amount','percentage') DEFAULT 'amount',
  `discount_percentage` decimal(5,2) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_sale_transaction` (`sale_transaction_id`),
  KEY `idx_item` (`item_id`),
  KEY `idx_sale_items_transaction_item` (`sale_transaction_id`,`item_id`),
  CONSTRAINT `sale_items_ibfk_1` FOREIGN KEY (`sale_transaction_id`) REFERENCES `sale_transactions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `sale_items_ibfk_2` FOREIGN KEY (`item_id`) REFERENCES `items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=1496 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Table: sale_transactions
DROP TABLE IF EXISTS `sale_transactions`;
CREATE TABLE `sale_transactions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `seller_party_id` int(11) NOT NULL,
  `transaction_date` date NOT NULL,
  `subtotal` decimal(10,2) DEFAULT 0.00,
  `discount` decimal(10,2) DEFAULT 0.00,
  `discount_type` enum('amount','percentage') DEFAULT 'amount',
  `discount_percentage` decimal(5,2) DEFAULT NULL,
  `tax_amount` decimal(10,2) DEFAULT 0.00,
  `total_amount` decimal(10,2) NOT NULL,
  `paid_amount` decimal(10,2) DEFAULT 0.00,
  `balance_amount` decimal(10,2) DEFAULT 0.00,
  `payment_status` enum('fully_paid','partially_paid') DEFAULT 'fully_paid',
  `bill_number` varchar(50) DEFAULT NULL,
  `with_gst` tinyint(1) DEFAULT 0,
  `previous_balance_paid` decimal(10,2) DEFAULT 0.00,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `bill_number` (`bill_number`),
  KEY `idx_seller_party` (`seller_party_id`),
  KEY `idx_transaction_date` (`transaction_date`),
  KEY `idx_bill_number` (`bill_number`),
  KEY `idx_with_gst` (`with_gst`),
  KEY `idx_payment_status` (`payment_status`),
  KEY `idx_sale_transactions_date_seller` (`transaction_date`,`seller_party_id`),
  KEY `idx_sale_transactions_date_gst` (`transaction_date`,`with_gst`),
  KEY `idx_sale_transactions_date_id` (`transaction_date` DESC,`id` DESC),
  CONSTRAINT `sale_transactions_ibfk_1` FOREIGN KEY (`seller_party_id`) REFERENCES `seller_parties` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=174 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Table: seller_parties
DROP TABLE IF EXISTS `seller_parties`;
CREATE TABLE `seller_parties` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `party_name` varchar(255) NOT NULL,
  `mobile_number` varchar(20) DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `gst_number` varchar(20) DEFAULT NULL,
  `opening_balance` decimal(10,2) DEFAULT 0.00,
  `closing_balance` decimal(10,2) DEFAULT 0.00,
  `paid_amount` decimal(10,2) DEFAULT 0.00,
  `balance_amount` decimal(10,2) DEFAULT 0.00,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `is_archived` tinyint(1) DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_seller_mobile_unique` (`mobile_number`),
  UNIQUE KEY `idx_seller_email_unique` (`email`),
  KEY `idx_seller_name` (`party_name`),
  KEY `idx_gst_number` (`gst_number`),
  KEY `idx_seller_parties_is_archived` (`is_archived`)
) ENGINE=InnoDB AUTO_INCREMENT=1026 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Table: unified_transactions
DROP TABLE IF EXISTS `unified_transactions`;
CREATE TABLE `unified_transactions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `party_type` enum('seller','buyer') NOT NULL,
  `party_id` int(11) NOT NULL,
  `transaction_type` enum('sale','purchase','sale_payment','purchase_payment','payment','return') NOT NULL,
  `transaction_date` date NOT NULL,
  `previous_balance` decimal(10,2) NOT NULL DEFAULT 0.00,
  `transaction_amount` decimal(10,2) NOT NULL DEFAULT 0.00,
  `paid_amount` decimal(10,2) NOT NULL DEFAULT 0.00,
  `balance_after` decimal(10,2) NOT NULL DEFAULT 0.00,
  `reference_id` int(11) DEFAULT NULL,
  `bill_number` varchar(50) DEFAULT NULL,
  `payment_method` varchar(50) DEFAULT NULL,
  `payment_status` enum('fully_paid','partially_paid','unpaid') DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `created_by` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_party` (`party_type`,`party_id`),
  KEY `idx_transaction_date` (`transaction_date`),
  KEY `idx_transaction_type` (`transaction_type`),
  KEY `idx_reference_id` (`reference_id`),
  KEY `idx_bill_number` (`bill_number`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_party_date` (`party_type`,`party_id`,`transaction_date`),
  KEY `idx_party_type_date` (`party_type`,`party_id`,`transaction_type`,`transaction_date`)
) ENGINE=InnoDB AUTO_INCREMENT=298 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: users
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` varchar(50) NOT NULL,
  `password` varchar(255) NOT NULL,
  `role` enum('super_admin','admin','sales') NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_id` (`user_id`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
