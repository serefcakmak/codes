const express = require('express');
const router = express.Router();
const sql = require('mssql');
const ExcelJS = require('exceljs');
const config = require('../config/db');

// Excel'den fiyat güncelleme endpoint'i
router.post('/update-prices', async (req, res) => {
  try {
    const isAdminFromHeader = req.headers['isadmin'];
    if (isAdminFromHeader !== "true") {
      return res.status(403).json({ success: false, message: "Yetkisiz erişim" });
    }

    if (!req.files || !req.files.excelFile) {
      return res.status(400).json({ success: false, message: "Excel dosyası yüklenmedi." });
    }

    const file = req.files.excelFile;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.data);
    const worksheet = workbook.getWorksheet(1);

    const headers = [];
    worksheet.getRow(1).eachCell(cell => headers.push(cell.value));

    const rows = [];
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const rowData = {};
      row.eachCell((cell, colNumber) => {
        const header = headers[colNumber - 1];
        let value = cell.value;
        if (typeof value === 'string') {
          let num = parseFloat(value.replace(',', '.'));
          if (!isNaN(num)) value = num;
        }
        rowData[header] = value;
      });
      rows.push(rowData);
    });

    await sql.connect(config);
    const kullanici = req.headers['kullanici'] || "Bilinmiyor";

    await sql.query(`
      DISABLE TRIGGER TRG_SKART_FIYATDEGISIKLIK ON SKART;
      DISABLE TRIGGER TRG_SKART_ZORUNLUALAN ON SKART;
    `);

    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked"
    });

    for (const row of rows) {
      let kodValue = (row.KOD || "").toString().trim();
      if (!kodValue) {
        res.write(`SKIP - KOD değeri eksik.\n`);
        continue;
      }

      const request = new sql.Request();
      request.input('SFIYAT1', sql.Decimal(18, 2), row.SFIYAT1 || null);
      request.input('SFIYAT2', sql.Decimal(18, 2), row.SFIYAT2 || null);
      request.input('SFIYAT3', sql.Decimal(18, 2), row.SFIYAT3 || null);
      request.input('SFIYAT4', sql.Decimal(18, 2), row.SFIYAT4 || null);
      request.input('SFIYAT5', sql.Decimal(18, 2), row.SFIYAT5 || null);
      request.input('KULLANICI', sql.VarChar(50), kullanici);
      request.input('KOD', sql.VarChar, kodValue);

      await request.query(`
        UPDATE SKART SET 
          SFIYAT1 = @SFIYAT1, SFIYAT2 = @SFIYAT2, SFIYAT3 = @SFIYAT3, 
          SFIYAT4 = @SFIYAT4, SFIYAT5 = @SFIYAT5,
          FIYATTARIH = GETDATE(),
          FIYATTARIH_KULLANICI = @KULLANICI
        WHERE KOD = @KOD
      `);

      res.write(`${kodValue} güncellendi.\n`);
    }

    await sql.query(`
      ENABLE TRIGGER TRG_SKART_FIYATDEGISIKLIK ON SKART;
      ENABLE TRIGGER TRG_SKART_ZORUNLUALAN ON SKART;
    `);

    res.end("Güncelleme tamamlandı.");
  } catch (error) {
    console.error("Fiyat güncelleme hatası:", error);
    try {
      await sql.query(`
        ENABLE TRIGGER TRG_SKART_FIYATDEGISIKLIK ON SKART;
        ENABLE TRIGGER TRG_SKART_ZORUNLUALAN ON SKART;
      `);
    } catch (enableErr) {
      console.error("Trigger yeniden etkinleştirme hatası:", enableErr);
    }
    res.end("Fiyat güncelleme hatası: " + error.message);
  }
});

module.exports = router;
