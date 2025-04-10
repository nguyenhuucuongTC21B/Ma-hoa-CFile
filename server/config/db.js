// server/config/db.js
const { Pool } = require('pg');
require('dotenv').config();

// Config cho môi trường development và production
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { 
    rejectUnauthorized: false 
  } : false
});

// Kiểm tra kết nối database
pool.connect((err) => {
  if (err) {
    console.error('❌ Kết nối database thất bại:', err.stack);
  } else {
    console.log('✅ Đã kết nối đến PostgreSQL database');
  }
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool // Export pool để dùng transaction
};