const cloudinary = require('cloudinary').v2;

let configured = false;

function configure() {
  if (configured) return;
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (cloudName && apiKey && apiSecret) {
    cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
    configured = true;
  }
}

/**
 * Upload image buffer to Cloudinary and return the public URL.
 * @param {Buffer} buffer - Image file buffer
 * @param {string} [folder='items'] - Cloudinary folder
 * @param {string} [mimetype='image/jpeg'] - MIME type of the image
 * @returns {Promise<string|null>} - Public URL or null if upload/configure fails
 */
async function uploadImage(buffer, folder = 'items', mimetype = 'image/jpeg') {
  configure();
  if (!configured) {
    console.warn('Cloudinary not configured (missing CLOUDINARY_* env). Skipping upload.');
    return null;
  }
  const dataUri = `data:${mimetype};base64,${buffer.toString('base64')}`;
  return new Promise((resolve) => {
    cloudinary.uploader.upload(
      dataUri,
      {
        folder,
        resource_type: 'image'
      },
      (err, result) => {
        if (err) {
          console.error('Cloudinary upload error:', err);
          resolve(null);
          return;
        }
        resolve(result?.secure_url || null);
      }
    );
  });
}

module.exports = { uploadImage, configure };
