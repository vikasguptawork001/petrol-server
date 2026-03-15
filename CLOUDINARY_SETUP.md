# Cloudinary setup for item images

Item images are uploaded to Cloudinary and the **public URL** is stored in the database (`image_url`). If Cloudinary is not configured, images fall back to being stored in the DB as before (blob).

## 1. Run the database migration

Add the `image_url` column to the `items` table:

```bash
# From project root, using your MySQL client (replace with your connection details)
mysql -h YOUR_HOST -u YOUR_USER -p YOUR_DB < server/database/add_image_url_column.sql
```

Or run this SQL in your DB tool:

```sql
ALTER TABLE items ADD COLUMN image_url VARCHAR(512) NULL DEFAULT NULL AFTER remarks;
```

## 2. Get Cloudinary credentials

1. Sign up at [cloudinary.com](https://cloudinary.com).
2. In the Dashboard, note: **Cloud name**, **API Key**, **API Secret**.

## 3. Add to `.env`

In `server/.env` add:

```env
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

Restart the server. New and updated item images will be uploaded to Cloudinary and the public URL stored in `items.image_url`. Existing items keep using the blob until you re-save them with an image.
