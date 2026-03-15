/**
 * Server-side decryption utility
 * Matches client-side encryption for credential decryption
 */

const getDecryptionKey = () => {
  // This should match the client-side key generation
  // In production, use environment variable
  const secret = process.env.ENCRYPTION_SECRET || 'STEEPRAY_SECURE_KEY_2024';
  
  // For server-side, we use just the secret (no browser fingerprint)
  // The client should send the encrypted data with a flag
  let key = secret;
  
  // Ensure key is 32 bytes for AES-256 (pad or truncate)
  while (key.length < 32) {
    key += key;
  }
  return key.substring(0, 32);
};

/**
 * Simple XOR decryption (matches client-side)
 */
const simpleDecrypt = (encryptedText, key) => {
  if (!encryptedText) return '';
  
  try {
    // Decode from base64
    const text = Buffer.from(encryptedText, 'base64').toString('binary');
    let result = '';
    const keyLength = key.length;
    
    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i);
      const keyChar = key.charCodeAt(i % keyLength);
      result += String.fromCharCode(charCode ^ keyChar);
    }
    
    return result;
  } catch (error) {
    console.error('Decryption error:', error);
    return '';
  }
};

/**
 * Decrypt credentials received from client
 */
const decryptCredentials = (encryptedData) => {
  try {
    // If not encrypted, return as-is
    if (!encryptedData.encrypted) {
      return {
        user_id: encryptedData.user_id,
        password: encryptedData.password
      };
    }
    
    const key = getDecryptionKey();
    return {
      user_id: simpleDecrypt(encryptedData.user_id, key),
      password: simpleDecrypt(encryptedData.password, key)
    };
  } catch (error) {
    console.error('Credential decryption error:', error);
    // Fallback to original data if decryption fails
    return {
      user_id: encryptedData.user_id,
      password: encryptedData.password
    };
  }
};

module.exports = {
  decryptCredentials
};

