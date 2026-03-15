const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const config = require('../config/config');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { validateLogin, validateRegister } = require('../middleware/validation');
const { decryptCredentials } = require('../utils/encryption');

const router = express.Router();

// Login
router.post('/login', validateLogin, async (req, res) => {
  try {
    // Decrypt credentials if they are encrypted
    let { user_id, password } = req.body;
    
    // Check if credentials are encrypted
    if (req.body.encrypted) {
      const decrypted = decryptCredentials(req.body);
      user_id = decrypted.user_id;
      password = decrypted.password;
    }

    if (!user_id || !password) {
      return res.status(400).json({ error: 'User ID and password are required' });
    }

    const [users] = await pool.execute(
      'SELECT * FROM users WHERE user_id = ?',
      [user_id]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = users[0];
    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!config.jwt.secret) {
      console.error('JWT_SECRET is not set in environment variables');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const token = jwt.sign(
      { id: user.id, user_id: user.user_id, role: user.role },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    res.json({
      token,
      user: {
        id: user.id,
        user_id: user.user_id,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// Register new user (only for super admin)
router.post('/register', authenticateToken, authorizeRole('super_admin'), validateRegister, async (req, res) => {
  try {
    const { user_id, password, role } = req.body;

    if (!user_id || !password || !role) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await pool.execute(
      'INSERT INTO users (user_id, password, role) VALUES (?, ?, ?)',
      [user_id, hashedPassword, role]
    );

    res.json({ message: 'User registered successfully', id: result.insertId });
  } catch (error) {
    console.error('Registration error:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'User ID already exists' });
    }
    res.status(500).json({ error: 'Server error during registration' });
  }
});

module.exports = router;


