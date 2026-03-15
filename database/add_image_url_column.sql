-- Add image_url column to store Cloudinary (or any) public image URL.
-- When set, the app uses this URL instead of the image LONGBLOB.
ALTER TABLE items ADD COLUMN image_url VARCHAR(512) NULL DEFAULT NULL AFTER remarks;
