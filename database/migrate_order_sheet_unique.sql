-- Migration: Add UNIQUE constraint to order_sheet.item_id
-- This ensures only one order entry per item, allowing ON DUPLICATE KEY UPDATE to work properly
-- Run this if you have an existing database without the UNIQUE constraint

USE inventory_management;

-- First, remove any duplicate entries (keep the most recent one)
DELETE os1 FROM order_sheet os1
INNER JOIN order_sheet os2 
WHERE os1.id < os2.id AND os1.item_id = os2.item_id;

-- Add UNIQUE constraint
ALTER TABLE order_sheet 
ADD UNIQUE KEY unique_item_id (item_id);




