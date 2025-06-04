// controllers/authController.js
const sql = require('mssql');
const jwt = require('jsonwebtoken');
const config = require('../config/db');

async function loginUser(req, res) {
  const { username, password } = req.body;

  try {
    await sql.connect(config);
    const request = new sql.Request();
    request.input('username', sql.VarChar, username);
    request.input('password', sql.VarChar, password);

    const result = await request.query(`
      SELECT USERNAME, USERNAME AS ID, ADMIN, CAMPAIGNADMIN
      FROM KULLANICI
      WHERE USERNAME = @username AND PASSWORD = @password
    `);

    if (result.recordset.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Geçersiz kullanıcı adı veya şifre.'
      });
    }

    const user = result.recordset[0];
    const payload = {
      id: user.ID,
      username: user.USERNAME,
      isAdmin: user.ADMIN === 1,
      isCampaignAdmin: user.CAMPAIGNADMIN === 1
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.TOKEN_EXPIRES_IN || '2h'
    });

    res.json({ success: true, token, user: payload });
  } catch (error) {
    console.error('Giriş hatası:', error);
    res.status(500).json({ success: false, message: 'Sunucu hatası. Lütfen daha sonra tekrar deneyin.' });
  }
}

module.exports = { loginUser };
