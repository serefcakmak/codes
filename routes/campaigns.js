// routes/campaigns.js
const express = require('express');
const router = express.Router();
const sql = require('mssql');
const config = require('../config/db'); // config doğru dizindeyse

// Kampanya Kaydı Yapan Endpoint
router.post('/campaigns', async (req, res) => {
  try {
    const {
      campaignName,
      campaignType,
      campaignDescription,
      startDate,            // örn. "2025-04-18T09:05"
      endDate,              // örn. "2025-04-18T10:00"
      includeSubCategories,
      discountValue,
      discountType,
      isCombinable,
      selectedCategories,
      selectedProducts
    } = req.body;

    await sql.connect(config);
    const safeDiscountValue = discountValue || 0;

    const insertCampaignQuery = `
      INSERT INTO Campaigns (
        CampaignName,
        Description,
        StartDate,
        EndDate,
        CampaignType,
        IncludeSubCategories,
        DiscountValue,
        DiscountType,
        IsCombinable
      )
      OUTPUT INSERTED.CampaignID
      VALUES (
        @Name,
        @Desc,
        @Start,
        @End,
        @Type,
        @IncludeSub,
        @DiscountValue,
        @DiscountType,
        @IsComb
      );
    `;
    const request = new sql.Request();
    request.input('Name',             sql.NVarChar, campaignName);
    request.input('Desc',             sql.NVarChar, campaignDescription);
    // vvv local datetime hack: "2025-04-18T09:05" › "2025-04-18 09:05:00"
    const sqlStart = startDate.replace('T', ' ') + ':00';
    const sqlEnd   = endDate  .replace('T', ' ') + ':00';
    request.input('Start',            sql.DateTime, sqlStart);
    request.input('End',              sql.DateTime, sqlEnd);
    // ^^^ buraya kadar
    request.input('Type',             sql.NVarChar, campaignType);
    request.input('IncludeSub',       sql.Bit,       includeSubCategories ? 1 : 0);
    request.input('DiscountValue',    sql.Decimal(5,2), safeDiscountValue);
    request.input('DiscountType',     sql.NVarChar, discountType || 'PERCENT');
    request.input('IsComb',           sql.Bit,       isCombinable ? 1 : 0);

    const result = await request.query(insertCampaignQuery);
    const newCampaignID = result.recordset[0].CampaignID;

    // — Kategori ilişkileri —
    if (selectedCategories && Array.isArray(selectedCategories)) {
      for (const catID of selectedCategories) {
        if (!catID) continue;
        const catReq = new sql.Request();
        catReq.input('CampaignID', sql.Int, newCampaignID);
        catReq.input('CategoryID', sql.Int, parseInt(catID, 10));
        await catReq.query(`
          INSERT INTO Campaign_Categories (CampaignID, SkartAgacID)
          VALUES (@CampaignID, @CategoryID);
        `);
      }
    }

    // — Ürün ilişkileri —
    if (selectedProducts && Array.isArray(selectedProducts)) {
      for (const prodID of selectedProducts) {
        if (!prodID) continue;
        const prodReq = new sql.Request();
        prodReq.input('CampaignID', sql.Int, newCampaignID);
        prodReq.input('ProductID',  sql.Int, parseInt(prodID, 10));
        await prodReq.query(`
          INSERT INTO Campaign_Products (CampaignID, ProductID)
          VALUES (@CampaignID, @ProductID);
        `);
      }
    }

    res.json({ success: true, message: 'Kampanya başarıyla kaydedildi.', campaignId: newCampaignID });
  } catch (error) {
    console.error('Kampanya kaydı hata:', error);
    res.status(500).json({ success: false, message: 'Kampanya kaydı sırasında hata oluştu.', error: error.message });
  }
});


//Kampanya düzenleme (PUT) Endpointi
router.put('/campaigns/:campaignID', async (req, res) => {
  try {
    const campaignID = parseInt(req.params.campaignID, 10);
    const { 
      campaignName,
      campaignType,
      campaignDescription,
      startDate,
      endDate,
      includeSubCategories,
      discountValue,
      discountType,
      isCombinable,
      selectedCategories
    } = req.body;
    
    await sql.connect(config);
    
    const safeDiscountValue = discountValue || 0;
    
    // Kampanya tablosunu güncelleyen sorgu:
    const updateCampaignQuery = `
      UPDATE Campaigns
      SET 
        CampaignName = @Name,
        Description = @Desc,
        StartDate = @Start,
        EndDate = @End,
        CampaignType = @Type,
        IncludeSubCategories = @IncludeSub,
        DiscountValue = @DiscountValue,
        DiscountType = @DiscountType,
        IsCombinable = @IsComb
      WHERE CampaignID = @CampaignID;
      SELECT CampaignID FROM Campaigns WHERE CampaignID = @CampaignID;
    `;
    
    const request = new sql.Request();
    request.input('Name', sql.NVarChar, campaignName);
    request.input('Desc', sql.NVarChar, campaignDescription);
    request.input('Start', sql.DateTime, new Date(startDate));
    request.input('End', sql.DateTime, new Date(endDate));
    request.input('Type', sql.NVarChar, campaignType);
    request.input('IncludeSub', sql.Bit, includeSubCategories ? 1 : 0);
    request.input('DiscountValue', sql.Decimal(5,2), safeDiscountValue);
    request.input('DiscountType', sql.NVarChar, discountType || "PERCENT");
    request.input('IsComb', sql.Bit, isCombinable ? 1 : 0);
    request.input('CampaignID', sql.Int, campaignID);
    
    const result = await request.query(updateCampaignQuery);
    
    // Eğer güncelleme başarılıysa, önceki Campaign_Categories kayıtlarını silip yeniden eklemek isteyebilirsiniz:
    await sql.query(`DELETE FROM Campaign_Categories WHERE CampaignID = ${campaignID}`);
    
    if (selectedCategories && Array.isArray(selectedCategories)) {
      for (let catID of selectedCategories) {
        if (!catID) continue;
        const insertCatQuery = `
          INSERT INTO Campaign_Categories (CampaignID, SkartAgacID)
          VALUES (@CampaignID, @CategoryID)
        `;
        const catRequest = new sql.Request();
        catRequest.input('CampaignID', sql.Int, campaignID);
        catRequest.input('CategoryID', sql.Int, parseInt(catID, 10));
        await catRequest.query(insertCatQuery);
      }
    }
    
    res.json({ success: true, message: "Kampanya başarıyla güncellendi.", campaignId: campaignID });
  } catch (error) {
    console.error("Kampanya güncelleme hatası:", error);
    res.status(500).json({ success: false, message: "Kampanya güncelleme sırasında hata oluştu.", error: error.message });
  }
});

//Mevcut Kampanyaları Gösteren Endpoint
router.get('/campaigns', async (req, res) => {
  try {
    await sql.connect(config);
    // Kampanyaları, örneğin en yeni veya başlangıç tarihine göre sıralayarak çekiyoruz.
    const result = await sql.query(`
      SELECT 
        CampaignID, 
        CampaignName, 
        CampaignType, 
        CONVERT(varchar, StartDate, 126) AS StartDate, 
        CONVERT(varchar, EndDate, 126) AS EndDate, 
        IncludeSubCategories, 
        DiscountValue, 
        DiscountType,
        IsCombinable
      FROM Campaigns
      ORDER BY StartDate DESC
    `);
    res.json({ success: true, data: result.recordset });
  } catch (error) {
    console.error("Kampanyalar çekilirken hata:", error);
    res.status(500).json({ success: false, message: "Kampanyalar alınırken hata oluştu.", error: error.message });
  }
});
//Tek Kampanya Bilgisi Döndüren endpoint
router.get('/campaigns/:campaignID', async (req, res) => {
  try {
    const campaignID = parseInt(req.params.campaignID, 10);
    await sql.connect(config);
    const query = `
      SELECT CampaignID, CampaignName, CampaignType, Description, StartDate, EndDate, 
             IncludeSubCategories, DiscountValue, DiscountType, IsCombinable
      FROM Campaigns
      WHERE CampaignID = @CampaignID
    `;
    const request = new sql.Request();
    request.input('CampaignID', sql.Int, campaignID);
    const result = await request.query(query);
    
    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "Kampanya bulunamadı." });
    }
    // Kampanya bilgilerini doğrudan JSON olarak döndürüyoruz.
    res.json({ success: true, ...result.recordset[0] });
  } catch (error) {
    console.error("Kampanya detay getirme hatası:", error);
    res.status(500).json({ success: false, message: "Kampanya bilgileri alınırken hata oluştu.", error: error.message });
  }
});

//Kampanya silme
router.delete('/campaigns/:campaignID', async (req, res) => {
  try {
    const campaignID = parseInt(req.params.campaignID, 10);
    await sql.connect(config);
    const deleteQuery = 'DELETE FROM Campaigns WHERE CampaignID = @ID';
    const request = new sql.Request();
    request.input('ID', sql.Int, campaignID);
    await request.query(deleteQuery);
    res.json({ success: true, message: "Kampanya silindi." });
  } catch (error) {
    console.error("Kampanya silme hatası:", error);
    res.status(500).json({ success: false, message: "Kampanya silme sırasında hata oluştu.", error: error.message });
  }
});

router.get('/category-campaigns', async (req, res) => {
  try {
    await sql.connect(config);
    const query = `
      SELECT 
        cc.SkartAgacID,
        sa.AD AS categoryName,
        c.CampaignName,
        c.StartDate,
        c.EndDate,
        c.DiscountValue        -- veya indirim oranını tuttuğun kolon
      FROM Campaign_Categories cc
      JOIN Campaigns c 
        ON cc.CampaignID = c.CampaignID
      JOIN SKARTAGAC sa 
        ON cc.SkartAgacID = sa.ID
      WHERE c.CampaignType = 'CATEGORY_CART'
    `;
    const result = await sql.query(query);
    res.json({ success: true, data: result.recordset });
  } catch (error) {
    console.error("Kategori kampanyaları alınırken hata:", error);
    res.status(500).json({ success: false, message: "Kategori kampanyaları alınamadı.", error: error.message });
  }
});


// Diğer kampanya endpoint’leri de buraya eklenebilir (PUT, GET, DELETE)

// ✨ En kritik satır:
module.exports = router;











