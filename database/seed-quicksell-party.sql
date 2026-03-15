-- Create the Quick Sell seller party (required for Dashboard Quick Sale).
-- The app looks for a seller with party_name = 'quick_sell'.
-- Run this on your database (e.g. after creating tables). Safe to run multiple times.
-- Change database name below if different, or run: mysql -u user -p your_db < seed-quicksell-party.sql
USE `u812625986_steepwholesale`;

INSERT INTO `seller_parties` (
  `party_name`,
  `mobile_number`,
  `email`,
  `address`,
  `opening_balance`,
  `closing_balance`,
  `paid_amount`,
  `balance_amount`,
  `gst_number`
)
SELECT 'quick_sell', NULL, NULL, NULL, 0, 0, 0, 0, NULL
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `seller_parties` WHERE `party_name` = 'quick_sell' LIMIT 1
);
