// routes/similar.js
const express = require('express');
const router = express.Router();
const sql = require('mssql');
const config = require('../config/db');
const { rbfSimilarity } = require('../utils/similarity');

router.get('/similar', async (req, res) => {
  try {
    const queryCode = req.query.code;

    await sql.connect(config);
    const skartResult = await sql.query`SELECT BASAMAK4 FROM SKART_OZELLIK WHERE KOD = ${queryCode}`;

    if (skartResult.recordset.length === 0) {
      return res.status(404).json({ message: `SKART_OZELLIK kaydında ${queryCode} bulunamadı.` });
    }

    const queryBasamak4 = skartResult.recordset[0].BASAMAK4;

    const featuresResult = await sql.query`
      SELECT KOD, AESTHETIC_FEATURES 
      FROM INTRAFOTO_FEATURES 
      WHERE KOD IN (SELECT KOD FROM SKART_OZELLIK WHERE INTRAWEB='X' and BASAMAK4 = ${queryBasamak4})
    `;

    const records = featuresResult.recordset.map(row => {
      try {
        return {
          KOD: row.KOD,
          AESTHETIC_FEATURES: JSON.parse(row.AESTHETIC_FEATURES)
        };
      } catch (e) {
        console.error(`Parse hatası: ${row.KOD}`, e);
        return null;
      }
    }).filter(Boolean);

    const queryProduct = records.find(r => r.KOD === queryCode);
    if (!queryProduct) {
      return res.status(404).json({ message: `Ürün kodu ${queryCode} bulunamadı.` });
    }

    const similarities = records
      .filter(r => r.KOD !== queryCode)
      .map(r => ({
        KOD: r.KOD,
        similarity: rbfSimilarity(queryProduct.AESTHETIC_FEATURES, r.AESTHETIC_FEATURES)
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);

    res.json({ query: queryCode, BASAMAK4: queryBasamak4, topSimilar: similarities });

  } catch (error) {
    console.error("Benzerlik hesaplama hatası:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
