const express = require('express');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// List nozzles. Default: active only. ?include_archived=1 for all.
router.get('/', authenticateToken, async (req, res) => {
  try {
    const includeArchived = req.query.include_archived === '1' || req.query.include_archived === 'true';
    let query = 'SELECT id, name, display_order, is_archived, created_at FROM nozzles';
    if (!includeArchived) query += ' WHERE is_archived = 0';
    query += ' ORDER BY display_order ASC, name ASC';
    const [rows] = await pool.execute(query);
    res.json({ nozzles: rows });
  } catch (error) {
    console.error('List nozzles error:', error);
    res.status(500).json({ error: 'Failed to list nozzles' });
  }
});

// Create nozzle
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, display_order } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Nozzle name is required' });
    }
    const order = display_order != null ? parseInt(display_order, 10) : 0;
    const [result] = await pool.execute(
      'INSERT INTO nozzles (name, display_order) VALUES (?, ?)',
      [name.trim(), isNaN(order) ? 0 : order]
    );
    const [rows] = await pool.execute('SELECT id, name, display_order, is_archived, created_at FROM nozzles WHERE id = ?', [result.insertId]);
    res.status(201).json({ nozzle: rows[0] });
  } catch (error) {
    console.error('Create nozzle error:', error);
    res.status(500).json({ error: 'Failed to create nozzle' });
  }
});

// Update nozzle
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid nozzle ID' });
    }
    const { name, display_order } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Nozzle name is required' });
    }
    const order = display_order != null ? parseInt(display_order, 10) : 0;
    const [result] = await pool.execute(
      'UPDATE nozzles SET name = ?, display_order = ? WHERE id = ?',
      [name.trim(), isNaN(order) ? 0 : order, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Nozzle not found' });
    }
    const [rows] = await pool.execute('SELECT id, name, display_order, is_archived, created_at FROM nozzles WHERE id = ?', [id]);
    res.json({ nozzle: rows[0] });
  } catch (error) {
    console.error('Update nozzle error:', error);
    res.status(500).json({ error: 'Failed to update nozzle' });
  }
});

// Delete nozzle (archives; soft delete)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid nozzle ID' });
    }
    const [result] = await pool.execute('UPDATE nozzles SET is_archived = 1 WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Nozzle not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Delete nozzle error:', error);
    res.status(500).json({ error: 'Failed to delete nozzle' });
  }
});

// Restore archived nozzle
router.post('/:id/restore', authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid nozzle ID' });
    }
    const [result] = await pool.execute('UPDATE nozzles SET is_archived = 0 WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Nozzle not found' });
    }
    const [rows] = await pool.execute('SELECT id, name, display_order, is_archived, created_at FROM nozzles WHERE id = ?', [id]);
    res.json({ nozzle: rows[0] });
  } catch (error) {
    console.error('Restore nozzle error:', error);
    res.status(500).json({ error: 'Failed to restore nozzle' });
  }
});

module.exports = router;
