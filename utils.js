// utils.js
const sql = require('mssql');

function formatNumber(num) {
  return num.toFixed(0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

async function loadAllowedSenders(config) {
  try {
	if (!config || typeof config !== 'object' || !config.server) {
	 console.error("Geçersiz config parametresi");
	 return [];
	}

    await sql.connect(config);
    const result = await sql.query`SELECT EMAIL FROM KULLANICI WHERE ADMIN = 1`;
    return result.recordset
      .map(r => r.EMAIL?.toLowerCase())
      .filter(Boolean);
  } catch (e) {
    console.error('❌ İzinli gönderenler yüklenirken hata:', e);
    return [];
  }
}

module.exports = { formatNumber, loadAllowedSenders };
