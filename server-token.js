// server.js
global.fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

const express = require('express');
const fileUpload = require('express-fileupload');
const ExcelJS = require('exceljs');
const sql = require('mssql');
const bodyParser = require('body-parser');
const app = express();
const port = 3001;
const fs = require("fs");
const path = require("path");
const cron = require('node-cron');
const puppeteer   = require('puppeteer');
const PDFDocument = require('pdfkit');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const authRoutes = require('./routes/auth');
const { formatNumber, loadAllowedSenders } = require('./utils');
const { generateSummaryPdf } = require('./services/pdfService');
const { startMailListener } = require('./services/mailListener');
const verifyToken = require('./middleware/auth');

//Benzer �r�n �a��rma ai
const similarRoutes = require('./routes/similar');
app.use('/api', similarRoutes);

// Sepet route'u tan�mla
const cartRoutes = require('./routes/cart');
app.use('/cart', cartRoutes);

//Kampanya Endpointleri Mod�l�
const campaignRoutes = require('./routes/campaigns');
app.use('/api', campaignRoutes);

// Excelden Fiyat G�ncelleme Endpoint'i (Express)
const updatePriceRoutes = require('./routes/updatePricesExcel');
app.use('/api', updatePriceRoutes);

//�r�nler Raporlar� Mod�l�
const productReportRoutes = require('./routes/productReportRoutes');
app.use('/api', productReportRoutes);

require('pdfkit');
require('dotenv').config();
require('./services/mailListener').startMailListener();

app.use(express.json());
app.use('/auth', authRoutes);

app.use(cors());
app.use(bodyParser.json());
app.use(fileUpload()); // express-fileupload middleware'u

app.use(express.static(path.join(__dirname, 'public')));


app.use(bodyParser.json()); // JSON deste�i


let allowedSenders = [];


// SQL Server ba�lant� ayarlar�
const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    options: {
        encrypt: process.env.DB_ENCRYPT === "true", // String de�erini boolean'a �evirme
        trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === "true",
        requestTimeout: parseInt(process.env.DB_REQUEST_TIMEOUT, 10)
    }
};

app.use(express.static(path.join(__dirname, 'public')));


// Sunucu ba�larken bir kez �a��r:
loadAllowedSenders(config); // ? do�ru kullan�m

// Sepet olu�turma
app.post('/cart', async (req, res) => {
    const { userId, priceType, discount } = req.body;
    try {
        await sql.connect(config);
        const result = await sql.query(
            `INSERT INTO CART (USER_ID, CUSTOMER_NAME, PRICE_TYPE, DISCOUNT_RATE, CREATED_AT)
    OUTPUT INSERTED.ID
    VALUES ('${userId}', '${customerName}', '${priceType}', ${discountRate}, GETDATE())`
        );
        res.json({ success: true, cartId: result.recordset[0].ID });
    } catch (error) {
        console.error("Sepet olu�turma hatas�:", error);
        res.status(500).json({ success: false, message: 'Sepet olu�turulamad�' });
    }
});

// Sepetleri Listeleme Endpoint'i (Konsept sepetlerini gizleme/g�sterme deste�i eklenmi�tir)
app.get('/carts/:userId', async (req, res) => {
  const { userId } = req.params;
  const showConcept = req.query.showConcept || "true";

  if (!userId) {
    return res.status(400).json({ success: false, message: 'Kullan�c� kimli�i belirtilmedi.' });
  }

  try {
    await sql.connect(config);

    // Kullan�c� bilgilerini getirerek konsept admin olup olmad���n� kontrol edelim.
    const userReq = new sql.Request();
    userReq.input('userId', sql.VarChar, userId);
    const userResult = await userReq.query(`
      SELECT CONCEPTADMIN
      FROM KULLANICI 
      WHERE USERNAME = @userId
    `);
    let isConceptAdmin = false;
    if (userResult.recordset.length > 0) {
      isConceptAdmin = userResult.recordset[0].CONCEPTADMIN === 1;
    }

    const request = new sql.Request();
    request.input('userId', sql.VarChar, userId);
    let query = "";
    // Normal kullan�c�: yaln�zca konsept olmayan sepetler getiriliyor.
    if (!isConceptAdmin || showConcept === "false" || showConcept === "0") {
      query = `
        SELECT 
          ID, 
          CUSTOMER_NAME, 
          CREATED_AT, 
          USER_ID, 
          CONSEPT AS CONCEPT,
          CONCEPTLOCK
        FROM CART
        WHERE USER_ID = @userId
          AND ISNULL(CONSEPT, 0) <> 1
      `;
    } else {
      // Konsept admin: hem konsept hem de konsept olmayan sepetler getiriliyor.
      query = `
        SELECT 
          ID, 
          CUSTOMER_NAME, 
          CREATED_AT, 
          USER_ID, 
          CONSEPT AS CONCEPT,
          GRUP.ADI AS CONCEPT_AREA,
          CONCEPTLOCK
        FROM CART 
        LEFT JOIN GRUP ON GRUP.KOD = CART.CONCEPT_AREA
        WHERE USER_ID = @userId OR CONSEPT = 1
      `;
    }

    const result = await request.query(query);
    res.json(result.recordset);
  } catch (error) {
    console.error('Sepet listeleme hatas�:', error);
    res.status(500).json({ success: false, message: 'Sepetler y�klenemedi.', error: error.message });
  }
});


// Lookup de�erlerini �ekmek i�in endpoint
app.get('/api/lookups', async (req, res) => {
    const { tip } = req.query;

    if (!tip) {
        return res.status(400).json({ success: false, message: 'TIP parametresi gerekli.' });
    }

    try {
        await sql.connect(config);
        const request = new sql.Request();
        request.input('tip', sql.Int, parseInt(tip, 10));

        const result = await request.query(`
            SELECT KOD, ADI, SAYI1
            FROM GRUP
            WHERE TIP = @tip
            ORDER BY ADI
        `);

        res.json({ success: true, data: result.recordset });
    } catch (error) {
        console.error('Lookup de�erleri �ekilirken hata:', error);
        res.status(500).json({ success: false, message: 'Lookup de�erleri al�namad�.', error: error.message });
    }
});

// Lookup Basamak de�erlerini �ekmek i�in endpoint
app.get('/api/lookups-basamak', async (req, res) => {
    const { tip } = req.query;

    if (!tip) {
        return res.status(400).json({ success: false, message: 'TIP parametresi gerekli.' });
    }

    try {
        await sql.connect(config);
        const request = new sql.Request();
        request.input('tip', sql.Int, parseInt(tip, 0));

        const result = await request.query(`
            SELECT AD as KOD, AD AS ADI
			FROM [SKARTAGAC] WHERE ALTID = @tip
            ORDER BY AD
        `);

        res.json({ success: true, data: result.recordset });
    } catch (error) {
        console.error('Lookup basamak de�erleri �ekilirken hata:', error);
        res.status(500).json({ success: false, message: 'Lookup basamak de�erleri al�namad�.', error: error.message });
    }
});

// /api/cart-items/:cartItemId/config GET Endpoint'i
app.get('/api/cart-items/:cartItemId/config', async (req, res) => {
    const cartItemId = parseInt(req.params.cartItemId, 10);

    try {
        await sql.connect(config);
        const request = new sql.Request();
        request.input('CART_ITEM_ID', sql.Int, cartItemId);

        const query = `
            SELECT 
                COALESCE(cic.REFERENCE_CODE, ci.PRODUCT_ID) AS REFERENCE_CODE, 
                cic.CUSTOM_CODE, 
                cic.CUSTOM_NAME, 
                cic.MODEL_KOD, 
                cic.MATERYAL_KOD, 
                cic.DESEN_KOD, 
                cic.LAMINE_KOD, 
                cic.AKSESUAR1_KOD, 
                cic.AKSESUAR2_KOD, 
                cic.AKSESUAR3_KOD, 
                cic.EBAT_KOD, 
                cic.RENK_KOD,
				cic.AYAK_KOD,				
                cic.UPDATED_AT,
                sk.MODELKOD, 
                sk.MATERYALKOD, 
                sk.DESENKOD, 
                sk.LAMINEKOD, 
                sk.AKSESUAR1KOD, 
                sk.AKSESUAR2KOD, 
                sk.AKSESUAR3KOD, 
                sk.EBATKOD, 
                sk.RENKKOD, 
                sk.LEGKOD AS AYAKKOD
            FROM CART_ITEMS ci
            LEFT JOIN CART_ITEMS_CONFIGURABLE cic ON cic.CART_ITEM_ID = ci.ID
            LEFT JOIN SKART_OZELLIK sk ON ci.PRODUCT_ID = sk.KOD
            WHERE ci.ID = @CART_ITEM_ID
        `;

        const result = await request.query(query);
		console.log('Veritaban�ndan d�nen veri:', result.recordset); // <-- Konsola yazd�rma

        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Cart Item bulunamad�.' });
        }

        const configData = result.recordset[0];

        res.json({ success: true, data: configData });
    } catch (error) {
        console.error('Konfig�rasyon getirme hatas�:', error);
        res.status(500).json({ success: false, message: 'Konfig�rasyon al�namad�.', error: error.message });
    }
});





// /api/cart-items/:cartItemId/config POST Endpoint'i
app.post('/api/cart-items/:cartItemId/config', async (req, res) => {
    const cartItemId = parseInt(req.params.cartItemId, 10);
    const {
        referenceCode, // Referans kodu
        customCode,
        customName,
        modelKod,
        materyalKod,
        desenKod,
        lamineKod,
        aksesuar1Kod,
        aksesuar2Kod,
        aksesuar3Kod,
        ebatKod,
        renkKod,
		ayakKod
    } = req.body;

    try {
        await sql.connect(config);

        const mergeQuery = `
            MERGE INTO CART_ITEMS_CONFIGURABLE AS target
            USING (SELECT @CART_ITEM_ID AS CART_ITEM_ID) AS source
            ON target.CART_ITEM_ID = source.CART_ITEM_ID
            WHEN MATCHED THEN
                UPDATE SET
					REFERENCE_CODE = @REFERENCE_CODE,				
                    CUSTOM_CODE = @CUSTOM_CODE,
                    CUSTOM_NAME = @CUSTOM_NAME,
                    MODEL_KOD = @MODEL_KOD,
                    MATERYAL_KOD = @MATERYAL_KOD,
                    DESEN_KOD = @DESEN_KOD,
                    LAMINE_KOD = @LAMINE_KOD,
                    AKSESUAR1_KOD = @AKSESUAR1_KOD,
                    AKSESUAR2_KOD = @AKSESUAR2_KOD,
                    AKSESUAR3_KOD = @AKSESUAR3_KOD,
                    EBAT_KOD = @EBAT_KOD,
                    RENK_KOD = @RENK_KOD,
					AYAK_KOD = @AYAK_KOD,
                    UPDATED_AT = GETDATE()
            WHEN NOT MATCHED THEN
                INSERT (CART_ITEM_ID, REFERENCE_CODE, CUSTOM_CODE, CUSTOM_NAME, MODEL_KOD, MATERYAL_KOD, DESEN_KOD, 
                        LAMINE_KOD, AKSESUAR1_KOD, AKSESUAR2_KOD, AKSESUAR3_KOD, EBAT_KOD, RENK_KOD, AYAK_KOD)
                VALUES (@CART_ITEM_ID, @REFERENCE_CODE, @CUSTOM_CODE, @CUSTOM_NAME, @MODEL_KOD, @MATERYAL_KOD, 
                        @DESEN_KOD, @LAMINE_KOD, @AKSESUAR1_KOD, @AKSESUAR2_KOD, @AKSESUAR3_KOD, @EBAT_KOD, @RENK_KOD, @AYAK_KOD);
        `;

        const request = new sql.Request();
        request.input('CART_ITEM_ID', sql.Int, cartItemId);
        request.input('REFERENCE_CODE', sql.VarChar(255), referenceCode || null); // Referans kodu
        request.input('CUSTOM_CODE', sql.VarChar(255), customCode || null);
        request.input('CUSTOM_NAME', sql.VarChar(255), customName || null);
        request.input('MODEL_KOD', sql.VarChar(50), modelKod || null);
        request.input('MATERYAL_KOD', sql.VarChar(50), materyalKod || null);
        request.input('DESEN_KOD', sql.VarChar(50), desenKod || null);
        request.input('LAMINE_KOD', sql.VarChar(50), lamineKod || null);
        request.input('AKSESUAR1_KOD', sql.VarChar(50), aksesuar1Kod || null);
        request.input('AKSESUAR2_KOD', sql.VarChar(50), aksesuar2Kod || null);
        request.input('AKSESUAR3_KOD', sql.VarChar(50), aksesuar3Kod || null);
        request.input('EBAT_KOD', sql.VarChar(50), ebatKod || null);
        request.input('RENK_KOD', sql.VarChar(50), renkKod || null);
		request.input('AYAK_KOD', sql.VarChar(50), ayakKod || null);

        await request.query(mergeQuery);

        res.json({ success: true, message: 'Konfig�rasyon kaydedildi' });
    } catch (error) {
        console.error("Konfig�rasyon hatas�:", error);
        res.status(500).json({ success: false, message: 'Konfig�rasyon kaydedilemedi.', error: error.message });
    }
});


//Varsay�lan kullan�c� veya oturumdan al�nan kullan�c�
app.get('/session', (req, res) => {
    const userId = req.session?.userId || 'KADIR'; // Varsay�lan kullan�c� veya oturumdan al�nan kullan�c�
    if (userId) {
        res.json({ userId });
    } else {
        res.status(404).send('Kullan�c� oturumu bulunamad�.');
    }
});

//Aktif Sepeti G�ncelleme
app.post('/set-active-cart', async (req, res) => {
    const { cartId } = req.body;
    try {
        // Gerekirse kullan�c� kontrol� eklenebilir
        await sql.connect(config);
        res.json({ success: true, activeCartId: cartId });
    } catch (error) {
        console.error('�r�n ekleme hatas�:', {
        errorMessage: error.message,
        stack: error.stack
    });
    res.status(500).send(`�r�n eklenemedi: ${error.message}`);
    }
});


// �r�n bazl� aktif kampanyalar� d�nen endpoint
app.get('/api/product-campaigns', async (req, res) => {
  try {
    await sql.connect(config);
    const result = await sql.query(`
      SELECT
        s.KOD,
        MAX(c.DiscountValue) AS DiscountValue
      FROM Campaign_Products cp
      JOIN Campaigns c
        ON cp.CampaignID = c.CampaignID
      JOIN SKART s
        ON cp.ProductID = s.ID
      WHERE
        c.CampaignType = 'PRODUCT'
        AND c.StartDate <= GETDATE()
        AND c.EndDate   >= GETDATE()
      GROUP BY s.KOD
    `);
    res.json({ success: true, data: result.recordset });
  } catch (error) {
    console.error("�r�n kampanyalar� �ekilirken hata:", error);
    res.status(500).json({ success: false, message: "�r�n kampanyalar� al�namad�.", error: error.message });
  }
});

app.put('/cart/:cartId/update-vat', async (req, res) => {
  const { cartId } = req.params;
  try {
    await sql.connect(config);

    // 1) Sepet (header) bilgilerini al
    const cartResult = await new sql.Request()
      .input('cartId', sql.Int, cartId)
      .query(`
        SELECT SALES_AREA, DISCOUNT_RATE, VATINCLUEDED, PRICE_TYPE
        FROM CART
        WHERE ID = @cartId
      `);

    if (!cartResult.recordset.length) {
      return res.status(404).json({ success: false, message: 'Sepet bulunamad�.' });
    }

    const {
      SALES_AREA,
      DISCOUNT_RATE: headerDiscountRate,
      VATINCLUEDED,
      PRICE_TYPE
    } = cartResult.recordset[0];
    const vatIncludedInt = parseInt(VATINCLUEDED, 10);

    // 2) Hangi SKART s�tununu kullanaca��m�z� belirle
    let priceColumn;
    switch (parseInt(PRICE_TYPE, 10)) {
      case 1: priceColumn = 'SFIYAT1'; break;
      case 2: priceColumn = 'SFIYAT2'; break;
      case 3: priceColumn = 'SFIYAT3'; break;
      case 4: priceColumn = 'SFIYAT4'; break;
      case 5: priceColumn = 'SFIYAT5'; break;
      case 6: priceColumn = '(SFIYAT5/2)'; break;
      default:
        return res.status(400).json({ success: false, message: 'Ge�ersiz PRICE_TYPE.' });
    }

    // 3) Sepetteki kalemleri �ek, basePrice = configurable varsa onlar�n PRICE'� yoksa SKART�tan gelen priceColumn
    const itemsResult = await new sql.Request()
      .input('cartId', sql.Int, cartId)
      .query(`
        SELECT 
          ci.ID            AS cartItemId,
          ci.QUANTITY,
          ISNULL(cc.PRICE, sp.PRICE) AS basePrice,
          s.KDV           AS VAT_RATE,
          CASE WHEN cc.CART_ITEM_ID IS NOT NULL THEN 1 ELSE 0 END AS isConfigurable
        FROM CART_ITEMS ci
        JOIN SKART_OZELLIK s   ON ci.PRODUCT_ID = s.KOD
        LEFT JOIN CART_ITEMS_CONFIGURABLE cc ON ci.ID = cc.CART_ITEM_ID
        JOIN (SELECT KOD, ${priceColumn} AS PRICE FROM SKART) sp ON sp.KOD = ci.PRODUCT_ID
        WHERE ci.CART_ID = @cartId
      `);

    // 4) Her kalem i�in KDV ve indirim hesaplamalar�n� yap ve g�ncelle
    for (const item of itemsResult.recordset) {
      const { cartItemId, QUANTITY, basePrice, VAT_RATE: rawVatRate, isConfigurable } = item;
      // yurtd��� ise KDV�yi 0 al
      const VAT_RATE = SALES_AREA.toLowerCase() === 'yurtdisi' ? 0 : rawVatRate;

      // indirimli fiyat
      const discountedPrice = basePrice * (1 - headerDiscountRate / 100);

      // KDV hesaplamalar�
      let priceNotIncludedVat, vatUnitPrice, vatTotal, amountNotIncludedVat, totalAmount;
      if (vatIncludedInt === 1) {
        // KDV dahil
        vatUnitPrice        = discountedPrice - (discountedPrice / (1 + VAT_RATE));
        priceNotIncludedVat = discountedPrice - vatUnitPrice;
        vatTotal            = vatUnitPrice * QUANTITY;
        amountNotIncludedVat= priceNotIncludedVat * QUANTITY;
        totalAmount         = amountNotIncludedVat + vatTotal;
      } else {
        // KDV hari�
        priceNotIncludedVat = discountedPrice;
        vatUnitPrice        = discountedPrice * VAT_RATE;
        vatTotal            = vatUnitPrice * QUANTITY;
        amountNotIncludedVat= discountedPrice * QUANTITY;
        totalAmount         = (discountedPrice + vatUnitPrice) * QUANTITY;
      }

      // 5) CART_ITEMS g�ncelle � PRICE art�k basePrice de�il, 
      //    sizin istedi�iniz �zere "basePrice" de�il "discountedPrice" yerine basePrice ile set ediliyorsa:
      await new sql.Request()
        .input('price',               sql.Float, basePrice)           // **burada basePrice**
        .input('discountRate',        sql.Float, headerDiscountRate)
        .input('discountedPrice',     sql.Float, discountedPrice)
        .input('vatRate',             sql.Float, VAT_RATE)
        .input('vatUnitPrice',        sql.Float, vatUnitPrice)
        .input('vatTotal',            sql.Float, vatTotal)
        .input('priceNotIncludedVat', sql.Float, priceNotIncludedVat)
        .input('amountNotIncludedVat',sql.Float, amountNotIncludedVat)
        .input('totalAmount',         sql.Float, totalAmount)
        .input('cartItemId',          sql.Int,   cartItemId)
        .query(`
          UPDATE CART_ITEMS
          SET 
            PRICE                = @price,
            DISCOUNT_RATE        = @discountRate,
            DISCOUNTED_PRICE     = @discountedPrice,
            VAT_RATE             = @vatRate,
            VAT_UNITPRICE        = @vatUnitPrice,
            VAT_TOTAL            = @vatTotal,
            PRICE_NOTINCLUDED_VAT= @priceNotIncludedVat,
            AMOUNT_NOTINCLUDED_VAT=@amountNotIncludedVat,
            TOTAL_AMOUNT         = @totalAmount,
            UPDATED_AT           = GETDATE()
          WHERE ID = @cartItemId
        `);

      // 6) Configurable varsa o tabloyu da g�ncelle
      if (isConfigurable) {
        await new sql.Request()
          .input('price',           sql.Float, basePrice)
          .input('discountRate',    sql.Float, headerDiscountRate)
          .input('discountedPrice', sql.Float, discountedPrice)
          .input('cartItemId',      sql.Int,   cartItemId)
          .query(`
            UPDATE CART_ITEMS_CONFIGURABLE
            SET 
              PRICE            = @price,
              DISCOUNT_RATE    = @discountRate,
              DISCOUNTED_PRICE = @discountedPrice,
              UPDATED_AT       = GETDATE()
            WHERE CART_ITEM_ID = @cartItemId
          `);
      }
    }

    // 7) Sepet �zeti (subtotal, vattotal, freight, insurance, total) g�ncelle
    const summaryResult = await new sql.Request()
      .input('cartId', sql.Int, cartId)
      .query(`
        SELECT 
          SUM(PRICE_NOTINCLUDED_VAT * QUANTITY) AS SUBTOTAL,
          SUM(VAT_TOTAL)                        AS VATTOTAL
        FROM CART_ITEMS
        WHERE CART_ID = @cartId
      `);

    const { SUBTOTAL, VATTOTAL } = summaryResult.recordset[0];

    const extraResult = await new sql.Request()
      .input('cartId', sql.Int, cartId)
      .query(`SELECT FREIGHT, INSURANCE FROM CART WHERE ID = @cartId`);

    const FREIGHT   = extraResult.recordset[0]?.FREIGHT   || 0;
    const INSURANCE = extraResult.recordset[0]?.INSURANCE || 0;
    const TOTAL     = SUBTOTAL + VATTOTAL + FREIGHT + INSURANCE;

    await new sql.Request()
      .input('cartId',   sql.Int, cartId)
      .input('subtotal', sql.Decimal(18,2), SUBTOTAL)
      .input('vattotal', sql.Decimal(18,2), VATTOTAL)
      .input('freight',  sql.Decimal(18,2), FREIGHT)
      .input('insurance',sql.Decimal(18,2), INSURANCE)
      .input('total',    sql.Decimal(18,2), TOTAL)
      .query(`
        UPDATE CART
        SET 
          SUBTOTAL   = @subtotal,
          VATTOTAL   = @vattotal,
          FREIGHT    = @freight,
          INSURANCE  = @insurance,
          TOTAL      = @total,
          UPDATED_AT = GETDATE()
        WHERE ID = @cartId
      `);

    res.json({ success: true, message: 'Sepet ba�ar�yla g�ncellendi.' });
  } catch (error) {
    console.error('Sepet g�ncelleme hatas�:', error);
    res.status(500).json({ success: false, message: 'G�ncelleme s�ras�nda hata olu�tu.', error: error.message });
  }
});


// Yeni: Sat�r baz�nda indirim oran� ve VAT hesaplamalar�n� g�ncelleyen endpoint
app.put('/cart/item/:cartItemId/update-discount-vat', async (req, res) => {
  const { cartItemId } = req.params;
  const { discountRate } = req.body; // Yeni indirim oran�

  try {
    await sql.connect(config);

    // 1) CART_ITEMS kayd�n� getir
    const itemResult = await new sql.Request()
      .input('cartItemId', sql.Int, cartItemId)
      .query(`
        SELECT PRICE, QUANTITY, PRODUCT_ID
        FROM CART_ITEMS
        WHERE ID = @cartItemId
      `);

    if (!itemResult.recordset.length) {
      return res.status(404).json({ success: false, message: "Cart item not found." });
    }

    // basePrice olarak �nce orijinal PRICE
    let { PRICE: basePrice, QUANTITY, PRODUCT_ID } = itemResult.recordset[0];

    // 2) Configurable ise manuel fiyat� al
    const configResult = await new sql.Request()
      .input('cartItemId', sql.Int, cartItemId)
      .query(`
        SELECT PRICE AS manualPrice
        FROM CART_ITEMS_CONFIGURABLE
        WHERE CART_ITEM_ID = @cartItemId
      `);

    const isConfigurable = configResult.recordset.length > 0
      && configResult.recordset[0].manualPrice != null;

    if (isConfigurable) {
      basePrice = configResult.recordset[0].manualPrice;
    }

    // 3) Sepet bilgileri (sat�� b�lgesi, KDV dahil mi)
    const cartResult = await new sql.Request()
      .input('cartItemId', sql.Int, cartItemId)
      .query(`
        SELECT SALES_AREA, VATINCLUEDED
        FROM CART
        WHERE ID = (SELECT CART_ID FROM CART_ITEMS WHERE ID = @cartItemId)
      `);

    if (!cartResult.recordset.length) {
      return res.status(404).json({ success: false, message: "Cart not found." });
    }

    const { SALES_AREA, VATINCLUEDED } = cartResult.recordset[0];
    const vatIncludedInt = parseInt(VATINCLUEDED, 10);

    // 4) Yeni indirimli fiyat
    const newDiscountRate = discountRate;
    const discountedPrice = basePrice * (1 - newDiscountRate / 100);

    // 5) VAT_RATE'i al
    const vatResult = await new sql.Request()
      .input('productId', sql.VarChar, PRODUCT_ID)
      .query(`
        SELECT KDV AS VAT_RATE
        FROM SKART_OZELLIK
        WHERE KOD = @productId
      `);

    let VAT_RATE = vatResult.recordset[0]?.VAT_RATE || 0;
    if (SALES_AREA.toLowerCase() === 'yurtdisi') VAT_RATE = 0;

    // 6) KDV hesaplamalar�
    let priceNotIncludedVat, vatUnitPrice, vatTotal, amountNotIncludedVat, totalAmount;

    if (vatIncludedInt === 1) {
      // KDV dahil
      vatUnitPrice        = discountedPrice - (discountedPrice / (1 + VAT_RATE));
      priceNotIncludedVat = discountedPrice - vatUnitPrice;
      vatTotal            = vatUnitPrice * QUANTITY;
      amountNotIncludedVat= priceNotIncludedVat * QUANTITY;
      totalAmount         = amountNotIncludedVat + vatTotal;
    } else {
      // KDV hari�
      priceNotIncludedVat = discountedPrice;
      vatUnitPrice        = discountedPrice * VAT_RATE;
      vatTotal            = vatUnitPrice * QUANTITY;
      amountNotIncludedVat= discountedPrice * QUANTITY;
      totalAmount         = (discountedPrice + vatUnitPrice) * QUANTITY;
    }

    // 7) CART_ITEMS g�ncelle � art�k PRICE da basePrice
    const updateItemsQuery = `
      UPDATE CART_ITEMS
      SET 
        PRICE                  = @price,
        DISCOUNT_RATE          = @discountRate,
        DISCOUNTED_PRICE       = @discountedPrice,
        VAT_RATE               = @vatRate,
        VAT_UNITPRICE          = @vatUnitPrice,
        VAT_TOTAL              = @vatTotal,
        PRICE_NOTINCLUDED_VAT  = @priceNotIncludedVat,
        AMOUNT_NOTINCLUDED_VAT = @amountNotIncludedVat,
        TOTAL_AMOUNT           = @totalAmount,
        UPDATED_AT             = GETDATE()
      WHERE ID = @cartItemId
    `;

    const updateItemsReq = new sql.Request()
      .input('price',               sql.Float, basePrice)              // <-- basePrice
      .input('discountRate',        sql.Float, newDiscountRate)
      .input('discountedPrice',     sql.Float, discountedPrice)
      .input('vatRate',             sql.Float, VAT_RATE)
      .input('vatUnitPrice',        sql.Float, vatUnitPrice)
      .input('vatTotal',            sql.Float, vatTotal)
      .input('priceNotIncludedVat', sql.Float, priceNotIncludedVat)
      .input('amountNotIncludedVat',sql.Float, amountNotIncludedVat)
      .input('totalAmount',         sql.Float, totalAmount)
      .input('cartItemId',          sql.Int,   cartItemId);

    await updateItemsReq.query(updateItemsQuery);

    // 8) E�er configurable ise orada PRICE = basePrice kals�n
    if (isConfigurable) {
      const updateConfigQuery = `
        UPDATE CART_ITEMS_CONFIGURABLE
        SET
          PRICE            = @price,
          DISCOUNT_RATE    = @discountRate,
          DISCOUNTED_PRICE = @discountedPrice,
          UPDATED_AT       = GETDATE()
        WHERE CART_ITEM_ID = @cartItemId
      `;
      await new sql.Request()
        .input('price',           sql.Float, basePrice)
        .input('discountRate',    sql.Float, newDiscountRate)
        .input('discountedPrice', sql.Float, discountedPrice)
        .input('cartItemId',      sql.Int,   cartItemId)
        .query(updateConfigQuery);
    }

    res.json({ success: true, message: 'Cart item ba�ar�yla g�ncellendi.' });
  } catch (error) {
    console.error('Sat�r g�ncelleme hatas�:', error);
    res.status(500).json({ success: false, message: 'Sat�r g�ncellenemedi.', error: error.message });
  }
});


// /api/categories endpoint'i
app.get('/api/categories', async (req, res) => {
  try {
    // Veritaban�na ba�lan�n
    await sql.connect(config);
    // SKARTAGAC tablonuzdaki ID, ALTID ve AD s�tunlar�n� �ekiyoruz
    const result = await sql.query("SELECT ID, ALTID, AD FROM SKARTAGAC WHERE ID NOT IN (748,758,964,968,975,979)");
    
    // Gelen kay�tlar� jstree format�na d�n��t�r�yoruz
    const categories = result.recordset.map(row => {
      return {
        id: row.ID.toString(),              // id alan� string format�nda
        parent: row.ALTID === 0 ? "#" : row.ALTID.toString(), // ALTID=0 ise k�k ("#"), di�er durumlarda parent olarak ALTID
        text: row.AD                        // Kategori ad� olarak AD s�tununu kullan�yoruz
      };
    });
    
    res.json(categories);
  } catch (error) {
    console.error("Kategori verileri �ekilirken hata:", error);
    res.status(500).send("Kategori verileri al�n�rken hata olu�tu.");
  }
});

// Sepet �zetini (SUBTOTAL, VATTOTAL, FREIGHT, INSURANCE, TOTAL) g�ncelleyen endpoint
app.put('/cart/:cartId/update-summary', async (req, res) => {
  const { cartId } = req.params;
  const { freight, insurance } = req.body; // �stemciden gelen navlun ve sigorta de�erleri

  try {
    await sql.connect(config);

    // 1. Ad�m: Bu sepetin t�m CART_ITEMS kay�tlar�ndan SUBTOTAL (KDVsiz toplam) ve VATTOTAL (KDV toplam�) hesapla
    const summaryQuery = `
      SELECT 
        ISNULL(SUM(AMOUNT_NOTINCLUDED_VAT), 0) AS subtotal,
        ISNULL(SUM(VAT_TOTAL), 0) AS vatTotal
      FROM CART_ITEMS
      WHERE CART_ID = @cartId
    `;
    const summaryReq = new sql.Request();
    summaryReq.input('cartId', sql.Int, cartId);
    const summaryResult = await summaryReq.query(summaryQuery);

    const { subtotal, vatTotal } = summaryResult.recordset[0];

    // 2. Ad�m: TOTAL hesaplamas�: TOTAL = SUBTOTAL + VATTOTAL + FREIGHT + INSURANCE
    const total = parseFloat(subtotal) + parseFloat(vatTotal) + parseFloat(freight) + parseFloat(insurance);

    // 3. Ad�m: CART tablosunu g�ncelle
    const updateQuery = `
      UPDATE CART
      SET SUBTOTAL = @subtotal,
          VATTOTAL = @vatTotal,
          FREIGHT = @freight,
          INSURANCE = @insurance,
          TOTAL = @total,
          UPDATED_AT = GETDATE()
      WHERE ID = @cartId
    `;
    const updateReq = new sql.Request();
    updateReq.input('subtotal', sql.Float, subtotal);
    updateReq.input('vatTotal', sql.Float, vatTotal);
    updateReq.input('freight', sql.Float, freight);
    updateReq.input('insurance', sql.Float, insurance);
    updateReq.input('total', sql.Float, total);
    updateReq.input('cartId', sql.Int, cartId);
    await updateReq.query(updateQuery);

    res.json({ success: true, message: 'Sepet �zeti ba�ar�yla g�ncellendi.', subtotal, vatTotal, total });
  } catch (error) {
    console.error("Sepet �zeti g�ncelleme hatas�:", error);
    res.status(500).json({ success: false, message: 'Sepet �zeti g�ncellenemedi.', error: error.message });
  }
});


//�zelle�tirilmi� sepet verisi i�in endpoint
app.get('/cart/:cartId/items', async (req, res) => {
    const { cartId } = req.params;

    try {
        await sql.connect(config);
        const query = `
            SELECT 
                ci.ID AS cartItemId,
                ci.PRODUCT_ID,
                sk.ADI AS PRODUCT_NAME,
                cic.CUSTOM_CODE,
                cic.CUSTOM_NAME,
                cic.MODEL_KOD,
                cic.MATERYAL_KOD,
                cic.DESEN_KOD,
                ci.QUANTITY,
                ci.PRICE,
                ci.DISCOUNT_RATE,
                ci.DISCOUNTED_PRICE
            FROM CART_ITEMS ci
            LEFT JOIN CART_ITEMS_CONFIGURABLE cic ON ci.ID = cic.CART_ITEM_ID
            LEFT JOIN SKART sk ON ci.PRODUCT_ID = sk.KOD
            WHERE ci.CART_ID = @cartId
        `;

        const request = new sql.Request();
        request.input('cartId', sql.Int, cartId);
        const result = await request.query(query);

        res.json({ success: true, items: result.recordset });
    } catch (error) {
        console.error('Sepet i�eri�i al�n�rken hata:', error);
        res.status(500).json({ success: false, message: 'Sepet i�eri�i al�namad�.', error: error.message });
    }
});


// Sepeti g�r�nt�leme
app.get('/cart/:id', async (req, res) => {
    const cartId = req.params.id;
    try {
        await sql.connect(config);
        const cartItems = await sql.query(
            `SELECT PRODUCT_ID, QUANTITY, PRICE, DISCOUNT_RATE, DISCOUNTED_PRICE FROM CART_ITEMS WHERE CART_ID = ${cartId}`
        );
        res.json(cartItems.recordset);
    } catch (error) {
        console.error("Sepeti g�r�nt�leme hatas�:", error);
        res.status(500).send('Sepet g�r�nt�lenemedi.');
    }
});

// Sepet detaylar�n� g�ncelleme
app.put('/update-cart', async (req, res) => {
    const { cartId, productId, quantity, discountRate } = req.body;

    try {
        await sql.connect(config);
        const product = await sql.query(`
            SELECT PRICE 
            FROM CART_ITEMS 
            WHERE CART_ID = ${cartId} AND PRODUCT_ID = '${productId}'
        `);
        const price = product.recordset[0]?.PRICE;

        if (!price) {
            return res.status(404).send('�r�n bulunamad�.');
        }

        const discountedPrice = price * (1 - discountRate / 100);

        await sql.query(`
            UPDATE CART_ITEMS 
            SET QUANTITY = ${quantity}, DISCOUNT_RATE = ${discountRate}, DISCOUNTED_PRICE = ${discountedPrice}
            WHERE CART_ID = ${cartId} AND PRODUCT_ID = '${productId}'
        `);
        res.send('Sepet g�ncellendi.');
    } catch (error) {
        console.error('Sepet g�ncelleme hatas�:', error);
        res.status(500).send('Sepet g�ncellenirken hata olu�tu.');
    }
});
//CKART Verilerini Getiren Endpoint
app.get('/api/ckart', async (req, res) => {
    try {
        await sql.connect(config);
        const result = await sql.query("SELECT KOD, ADI FROM CKART ORDER BY ADI");
        res.json({ success: true, data: result.recordset });
    } catch (error) {
        console.error("CKART verileri al�n�rken hata:", error);
        res.status(500).json({ success: false, message: "CKART verileri al�namad�.", error: error.message });
    }
});
//Sepetteki CKOD ve CUSTOMER_NAME G�ncelleme Endpoint'i
app.put('/cart/update-ckod', async (req, res) => {
    const { cartId, ckod } = req.body;
    if (!cartId || !ckod) {
        return res.status(400).json({ success: false, message: "CartId ve CKOD gerekli." });
    }
    try {
        await sql.connect(config);
        // CKART tablosundan se�ili ckod'ya ait ADI bilgisini alal�m
        const request = new sql.Request();
        request.input('ckod', sql.VarChar, ckod);
        const result = await request.query("SELECT ADI FROM CKART WHERE KOD = @ckod");
        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, message: "Se�ili CKART bulunamad�." });
        }
        const customerName = result.recordset[0].ADI;

        // CART tablosunu g�ncelleyelim
        const updateRequest = new sql.Request();
        updateRequest.input('cartId', sql.Int, cartId);
        updateRequest.input('ckod', sql.VarChar, ckod);
        updateRequest.input('customerName', sql.VarChar, customerName);
        await updateRequest.query("UPDATE CART SET CKOD = @ckod, CUSTOMER_NAME = @customerName WHERE ID = @cartId");

        res.json({ success: true, message: "Sepet g�ncellendi." });
    } catch (error) {
        console.error("Sepet g�ncelleme hatas�:", error);
        res.status(500).json({ success: false, message: "Sepet g�ncellenemedi.", error: error.message });
    }
});

//Sepet Kategorisini G�ncelle
app.put('/update-cart-category', async (req, res) => {
    const { cartItemId, mainConcept, additional, additionalaks, accessories, supplementary } = req.body;

    if (!cartItemId) {
        return res.status(400).json({ success: false, message: "Eksik parametre: cartItemId gereklidir." });
    }

    try {
        await sql.connect(config);

        //console.log("?? G�ncelleme �ste�i Al�nd�:", { cartItemId, mainConcept, additional, additionalaks, accessories, supplementary });

        const updates = [];
        if (mainConcept !== undefined) updates.push(`MAINCONCEPT = @mainConcept`);
        if (additional !== undefined) updates.push(`ADDITIONAL = @additional`);
		if (additionalaks !== undefined) updates.push(`ADDITIONALAKS = @additionalaks`);
        if (accessories !== undefined) updates.push(`ACCESSORIES = @accessories`);
		if (supplementary !== undefined) updates.push(`SUPPLEMENTARY = @supplementary`);

        if (updates.length === 0) {
            return res.status(400).json({ success: false, message: "G�ncellenecek alan belirtilmedi." });
        }

        const query = `
            UPDATE CART_ITEMS 
            SET ${updates.join(", ")}
            WHERE ID = @cartItemId
        `;

        const request = new sql.Request();
        request.input("cartItemId", sql.Int, cartItemId);
        if (mainConcept !== undefined) request.input("mainConcept", sql.Int, mainConcept ? 1 : 0);
        if (additional !== undefined) request.input("additional", sql.Int, additional ? 1 : 0);
		if (additionalaks !== undefined) request.input("additionalaks", sql.Int, additionalaks ? 1 : 0);
        if (accessories !== undefined) request.input("accessories", sql.Int, accessories ? 1 : 0);
		if (supplementary !== undefined) request.input("supplementary", sql.Int, supplementary ? 1 : 0);

        await request.query(query);

        res.json({ success: true, message: "Kategori g�ncellemesi ba�ar�yla yap�ld�." });

    } catch (error) {
        console.error("?? Kategori g�ncelleme hatas�:", error);
        res.status(500).json({ success: false, message: "Kategori g�ncellenirken hata olu�tu." });
    }
});
app.get('/api/user/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        await sql.connect(config);
        const request = new sql.Request();
        request.input('userId', sql.VarChar, userId);

        const result = await request.query(`
            SELECT CONCEPTADMIN, CONCEPTUNLOCK, CAMPAIGNADMIN 
            FROM KULLANICI 
            WHERE USERNAME = @userId
        `);

        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Kullan�c� bulunamad�.' });
        }

        res.json(result.recordset[0]);
    } catch (error) {
        console.error('Kullan�c� bilgisi hatas�:', error);
        res.status(500).json({ success: false, message: 'Kullan�c� bilgisi al�namad�.' });
    }
});
// Konsept sepetlerinin �zet raporu (matrix format�nda)
// Bu endpoint, yaln�zca CART ve CART_ITEMS tablolar�ndan (�zelle�tirme bilgileri kullan�lm�yor)
// hesaplamalar� yapar. Tutar hesaplamas� i�in TOTAL_AMOUNT alan� kullan�l�r.
app.get('/api/konsept-summary', async (req, res) => {
  try {
    await sql.connect(config);
    // Query parametresinden para cinsi al�n�r, varsay�lan TL
    const currency = (req.query.currency || 'TL').toUpperCase();
    const request = new sql.Request();
    request.input('currency', sql.VarChar, currency);
    const query = `
      SELECT 
        ISNULL(g.ADI, 'DIGER') AS Alan,
        c.CUSTOMER_NAME AS KonseptAdi,
        c.PRICE_TYPE,
        c.ID,
		c.CONCEPTLOCK,
        SUM(CASE WHEN ci.ACCESSORIES = 1 THEN ci.QUANTITY ELSE 0 END) AS Accessories_Miktar,
        SUM(CASE WHEN ci.ACCESSORIES = 1 THEN ci.QUANTITY *
          (CASE @currency WHEN 'TL' THEN s.SFIYAT1 WHEN 'USD' THEN s.SFIYAT4 WHEN 'EUR' THEN s.SFIYAT5 ELSE s.SFIYAT1 END)
          ELSE 0 END) AS Accessories_Tutar,
        SUM(CASE WHEN ci.ADDITIONAL = 1 THEN ci.QUANTITY ELSE 0 END) AS Additional_Miktar,
        SUM(CASE WHEN ci.ADDITIONAL = 1 THEN ci.QUANTITY *
          (CASE @currency WHEN 'TL' THEN s.SFIYAT1 WHEN 'USD' THEN s.SFIYAT4 WHEN 'EUR' THEN s.SFIYAT5 ELSE s.SFIYAT1 END)
          ELSE 0 END) AS Additional_Tutar,
        SUM(CASE WHEN ci.ADDITIONALAKS = 1 THEN ci.QUANTITY ELSE 0 END) AS Additionalaks_Miktar,
        SUM(CASE WHEN ci.ADDITIONALAKS = 1 THEN ci.QUANTITY *
          (CASE @currency WHEN 'TL' THEN s.SFIYAT1 WHEN 'USD' THEN s.SFIYAT4 WHEN 'EUR' THEN s.SFIYAT5 ELSE s.SFIYAT1 END)
          ELSE 0 END) AS Additionalaks_Tutar,
        SUM(CASE WHEN ci.MAINCONCEPT = 1 THEN ci.QUANTITY ELSE 0 END) AS MainConcept_Miktar,
        SUM(CASE WHEN ci.MAINCONCEPT = 1 THEN ci.QUANTITY *
          (CASE @currency WHEN 'TL' THEN s.SFIYAT1 WHEN 'USD' THEN s.SFIYAT4 WHEN 'EUR' THEN s.SFIYAT5 ELSE s.SFIYAT1 END)
          ELSE 0 END) AS MainConcept_Tutar,
        SUM(CASE WHEN ci.SUPPLEMENTARY = 1 THEN ci.QUANTITY ELSE 0 END) AS Supplementary_Miktar,
        SUM(CASE WHEN ci.SUPPLEMENTARY = 1 THEN ci.QUANTITY *
          (CASE @currency WHEN 'TL' THEN s.SFIYAT1 WHEN 'USD' THEN s.SFIYAT4 WHEN 'EUR' THEN s.SFIYAT5 ELSE s.SFIYAT1 END)
          ELSE 0 END) AS Supplementary_Tutar,
        SUM(CASE WHEN (ci.MAINCONCEPT = 0 OR ci.MAINCONCEPT IS NULL)
               AND (ci.ADDITIONAL = 0 OR ci.ADDITIONAL IS NULL)
               AND (ci.ADDITIONALAKS = 0 OR ci.ADDITIONALAKS IS NULL)
               AND (ci.ACCESSORIES = 0 OR ci.ACCESSORIES IS NULL)
               AND (ci.SUPPLEMENTARY = 0 OR ci.SUPPLEMENTARY IS NULL)
             THEN ci.QUANTITY ELSE 0 END) AS Others_Miktar,
        SUM(CASE WHEN (ci.MAINCONCEPT = 0 OR ci.MAINCONCEPT IS NULL)
               AND (ci.ADDITIONAL = 0 OR ci.ADDITIONAL IS NULL)
               AND (ci.ADDITIONALAKS = 0 OR ci.ADDITIONALAKS IS NULL)
               AND (ci.ACCESSORIES = 0 OR ci.ACCESSORIES IS NULL)
               AND (ci.SUPPLEMENTARY = 0 OR ci.SUPPLEMENTARY IS NULL)
             THEN ci.QUANTITY *
          (CASE @currency WHEN 'TL' THEN s.SFIYAT1 WHEN 'USD' THEN s.SFIYAT4 WHEN 'EUR' THEN s.SFIYAT5 ELSE s.SFIYAT1 END)
             ELSE 0 END) AS Others_Tutar,
        SUM(ci.QUANTITY) AS Total_Miktar,
        SUM(ci.QUANTITY *
          (CASE @currency WHEN 'TL' THEN s.SFIYAT1 WHEN 'USD' THEN s.SFIYAT4 WHEN 'EUR' THEN s.SFIYAT5 ELSE s.SFIYAT1 END)
        ) AS Total_Tutar
      FROM CART c
      JOIN CART_ITEMS ci ON c.ID = ci.CART_ID
      LEFT JOIN SKART	 s ON ci.PRODUCT_ID = s.KOD
      LEFT JOIN GRUP g ON c.CONCEPT_AREA = g.KOD
      WHERE c.CONSEPT = 1 AND c.CUSTOMER_NAME <> 'FUAR 2025'
      GROUP BY c.CONCEPT_AREA, g.ADI, c.CUSTOMER_NAME, c.PRICE_TYPE, c.ID, c.CONCEPTLOCK
      ORDER BY g.ADI, c.CUSTOMER_NAME, c.PRICE_TYPE, c.ID
    `;
    const result = await request.query(query);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    console.error("Konsept �zet raporu al�n�rken hata:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});




//Sepetlerdeki Konsept Bilgisini Getir
app.get('/api/carts/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        await sql.connect(config);
        const request = new sql.Request();
        request.input('userId', sql.VarChar, userId);

        const result = await request.query(`
            SELECT ID, CUSTOMER_NAME, CREATED_AT, CONSEPT AS CONCEPT, CONCEPTLOCK
            FROM CART
            WHERE USER_ID = @userId
        `);

        res.json(result.recordset);
    } catch (error) {
        console.error('Sepet konsept bilgisi �ekme hatas�:', error);
        res.status(500).json({ success: false, message: 'Sepet konsept bilgisi al�namad�.' });
    }
});
//Sepetler Listesinde Konsept Bilgisini Alma
app.get('/api/cart/concept', async (req, res) => {
    const cartId = req.query.cartId; // Query parametre olarak al
    if (!cartId) return res.status(400).json({ success: false, message: "cartId eksik!" });

    try {
        await sql.connect(config);
        const request = new sql.Request();
        request.input('cartId', sql.Int, cartId);
        const result = await request.query("SELECT CONSEPT FROM CART WHERE ID = @cartId");

        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, message: "Sepet bulunamad�!" });
        }

        res.json({ success: true, concept: result.recordset[0].CONSEPT });
    } catch (error) {
        console.error("? Hata:", error);
        res.status(500).json({ success: false, message: "Veri al�namad�!" });
    }
});
//Sepetler Listesinde Konsept Bilgisini G�ncelleme
app.put('/api/cart/concept', async (req, res) => {
    const { cartId, conceptValue } = req.body;

    if (!cartId) {
        return res.status(400).json({ success: false, message: "Sepet ID eksik!" });
    }

    try {
        await sql.connect(config);
        const request = new sql.Request();
        request.input('cartId', sql.Int, cartId);
        request.input('conceptValue', sql.Int, conceptValue);

        await request.query(`
            UPDATE CART
            SET CONSEPT = @conceptValue
            WHERE ID = @cartId
        `);

        res.json({ success: true, message: 'Konsept bilgisi g�ncellendi.' });
    } catch (error) {
        console.error('Konsept g�ncelleme hatas�:', error);
        res.status(500).json({ success: false, message: 'Konsept g�ncellenemedi.' });
    }
});
// Sepetler Listesinde Konsept Kilidi Bilgisini G�ncelleme
app.put('/api/cart/conceptlock', async (req, res) => {
    const { cartId, conceptLockValue } = req.body;
    if (!cartId) {
        return res.status(400).json({ success: false, message: "Sepet ID eksik!" });
    }
    try {
        await sql.connect(config);
        const request = new sql.Request();
        request.input('cartId', sql.Int, cartId);
        request.input('conceptLockValue', sql.Int, conceptLockValue);
        await request.query(`
            UPDATE CART
            SET CONCEPTLOCK = @conceptLockValue
            WHERE ID = @cartId
        `);
        res.json({ success: true, message: 'Konsept kilidi g�ncellendi.' });
    } catch (error) {
        console.error("Konsept kilidi g�ncelleme hatas�:", error);
        res.status(500).json({ success: false, message: 'Konsept kilidi g�ncellenemedi.' });
    }
});

// Header indirim oran� de�i�ti�inde sepetteki t�m �r�nlerin fiyat hesaplamalar�n� g�ncelleyen endpoint
app.post('/api/cart/update-prices', async (req, res) => {
  const { cartId, confirmUpdate } = req.body;
  if (!cartId) {
    return res.status(400).json({ success: false, message: 'Ge�erli bir sepet ID gerekli.' });
  }

  try {
    await sql.connect(config);

    // 1) Sepet ba�l�k verileri
    const cartResult = await new sql.Request()
      .input('cartId', sql.Int, cartId)
      .query(`
        SELECT PRICE_TYPE, VATINCLUEDED, DISCOUNT_RATE, SALES_AREA
        FROM CART
        WHERE ID = @cartId
      `);

    if (cartResult.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Sepet bulunamad�.' });
    }

    const { PRICE_TYPE, VATINCLUEDED, DISCOUNT_RATE } = cartResult.recordset[0];
    const headerDiscountRate = DISCOUNT_RATE;
    const vatIncludedInt     = parseInt(VATINCLUEDED, 10);

    // 2) Sepet kalemleri (configurable fark edilsin diye LEFT JOIN)
    const itemsResult = await new sql.Request()
      .input('cartId', sql.Int, cartId)
      .query(`
        SELECT 
          ci.ID            AS cartItemId,
          ci.PRODUCT_ID,
          ci.QUANTITY,
          ci.DISCOUNT_RATE AS rowDiscountRate,
          ISNULL(cc.PRICE,
            CASE 
              WHEN c.PRICE_TYPE = 1 THEN s.SFIYAT1
              WHEN c.PRICE_TYPE = 2 THEN s.SFIYAT2
              WHEN c.PRICE_TYPE = 3 THEN s.SFIYAT3
              WHEN c.PRICE_TYPE = 4 THEN s.SFIYAT4
              WHEN c.PRICE_TYPE = 5 THEN s.SFIYAT5
              WHEN c.PRICE_TYPE = 6 THEN s.SFIYAT5 / 2
            END
          ) AS basePrice,
          s.KDV        AS VAT_RATE,
          cc.CART_ITEM_ID AS isConfigurable
        FROM CART_ITEMS ci
        JOIN SKART_OZELLIK s ON ci.PRODUCT_ID = s.KOD
        JOIN CART c          ON ci.CART_ID     = c.ID
        LEFT JOIN CART_ITEMS_CONFIGURABLE cc 
          ON ci.ID = cc.CART_ITEM_ID
        WHERE ci.CART_ID = @cartId
      `);

    if (itemsResult.recordset.length === 0) {
      return res.json({ success: true, message: 'Fiyat g�ncellenmesi gerekmiyor.' });
    }

    // 3) E�er sadece preview istiyorsa d�n
    if (!confirmUpdate) {
      return res.json({
        success: true,
        message: 'Fiyat de�i�iklikleri bulundu.',
        priceChanges: itemsResult.recordset
      });
    }

    // 4) G�ncelle
    for (const item of itemsResult.recordset) {
      const basePrice         = item.basePrice;      // manuel veya SKART fiyat�
      const discountedPrice   = basePrice * (1 - headerDiscountRate / 100);
      const quantity          = item.QUANTITY;
      let priceNotIncludedVat, vatUnitPrice, vatTotal, totalAmount;

      if (vatIncludedInt === 1) {
        // KDV dahil
        priceNotIncludedVat = discountedPrice / (1 + item.VAT_RATE);
        vatUnitPrice        = discountedPrice - priceNotIncludedVat;
        vatTotal            = vatUnitPrice * quantity;
        totalAmount         = discountedPrice * quantity;
      } else {
        // KDV hari�
        priceNotIncludedVat = discountedPrice;
        vatUnitPrice        = discountedPrice * item.VAT_RATE;
        vatTotal            = vatUnitPrice * quantity;
        totalAmount         = (discountedPrice + vatUnitPrice) * quantity;
      }

      // 4a) CART_ITEMS g�ncellemesi � art�k PRICE da basePrice olacak
      await new sql.Request()
        .input('price',                sql.Float, basePrice)
        .input('discountRate',         sql.Float, headerDiscountRate)
        .input('discountedPrice',      sql.Float, discountedPrice)
        .input('priceNotIncludedVat',  sql.Float, priceNotIncludedVat)
        .input('vatUnitPrice',         sql.Float, vatUnitPrice)
        .input('vatTotal',             sql.Float, vatTotal)
        .input('totalAmount',          sql.Float, totalAmount)
        .input('cartItemId',           sql.Int,   item.cartItemId)
        .query(`
          UPDATE CART_ITEMS
          SET 
            PRICE                = @price,
            DISCOUNT_RATE        = @discountRate,
            DISCOUNTED_PRICE     = @discountedPrice,
            PRICE_NOTINCLUDED_VAT= @priceNotIncludedVat,
            VAT_UNITPRICE        = @vatUnitPrice,
            VAT_TOTAL            = @vatTotal,
            TOTAL_AMOUNT         = @totalAmount,
            UPDATED_AT           = GETDATE()
          WHERE ID = @cartItemId
        `);

      // 4b) Configurable varsa o tabloyu da g�ncelle
      if (item.isConfigurable) {
        await new sql.Request()
          .input('price',           sql.Float, basePrice)
          .input('discountRate',    sql.Float, headerDiscountRate)
          .input('discountedPrice', sql.Float, discountedPrice)
          .input('cartItemId',      sql.Int,   item.cartItemId)
          .query(`
            UPDATE CART_ITEMS_CONFIGURABLE
            SET 
              PRICE            = @price,
              DISCOUNT_RATE    = @discountRate,
              DISCOUNTED_PRICE = @discountedPrice,
              UPDATED_AT       = GETDATE()
            WHERE CART_ITEM_ID = @cartItemId
          `);
      }
    }

    // 5) Sepet �zetini g�ncelle
    const summaryResult = await new sql.Request()
      .input('cartId', sql.Int, cartId)
      .query(`
        SELECT 
          SUM(PRICE_NOTINCLUDED_VAT * QUANTITY) AS SUBTOTAL,
          SUM(VAT_TOTAL)                        AS VATTOTAL
        FROM CART_ITEMS
        WHERE CART_ID = @cartId
      `);

    const { SUBTOTAL, VATTOTAL } = summaryResult.recordset[0];

    // Ekstra �cretleri �ek
    const extra = await new sql.Request()
      .input('cartId', sql.Int, cartId)
      .query(`SELECT FREIGHT, INSURANCE FROM CART WHERE ID = @cartId`);

    const FREIGHT   = extra.recordset[0]?.FREIGHT   || 0;
    const INSURANCE = extra.recordset[0]?.INSURANCE || 0;
    const TOTAL     = SUBTOTAL + VATTOTAL + FREIGHT + INSURANCE;

    await new sql.Request()
      .input('cartId',   sql.Int,     cartId)
      .input('subtotal', sql.Decimal(18,2), SUBTOTAL)
      .input('vattotal', sql.Decimal(18,2), VATTOTAL)
      .input('freight',  sql.Decimal(18,2), FREIGHT)
      .input('insurance',sql.Decimal(18,2), INSURANCE)
      .input('total',    sql.Decimal(18,2), TOTAL)
      .query(`
        UPDATE CART
        SET 
          SUBTOTAL   = @subtotal,
          VATTOTAL   = @vattotal,
          FREIGHT    = @freight,
          INSURANCE  = @insurance,
          TOTAL      = @total,
          UPDATED_AT = GETDATE()
        WHERE ID = @cartId
      `);

    res.json({ success: true, message: 'Header indirim oran� sepetteki t�m �r�nlere uyguland�.' });
  } catch (error) {
    console.error('Fiyat g�ncelleme hatas�:', error);
    res.status(500).json({ success: false, message: 'Fiyat g�ncelleme ba�ar�s�z oldu.', error: error.message });
  }
});


//Sepet Fiyat De�i�ikliklerini Kontrol Eden API
app.get("/api/cart/update-prices", async (req, res) => {
    const { cartId } = req.query;

    if (!cartId) {
        return res.status(400).json({ success: false, message: "Sepet ID gerekli!" });
    }

    try {
        await sql.connect(config);

        // ? CART tablosundan PRICE_TYPE bilgisini alal�m
        const cartResult = await sql.query`SELECT PRICE_TYPE FROM CART WHERE ID = ${cartId}`;
        if (cartResult.recordset.length === 0) {
            return res.status(404).json({ success: false, message: "Sepet bulunamad�." });
        }
        const priceType = cartResult.recordset[0].PRICE_TYPE;

        // ? SKART_OZELLIK tablosundan g�ncel fiyatlar� alal�m
        const priceQuery = `
            SELECT 
                ci.PRODUCT_ID,
                ci.PRICE AS OLD_PRICE,
                ci.DISCOUNT_RATE AS OLD_DISCOUNT_RATE,
                CASE 
                    WHEN ${priceType} = 1 THEN s.SFIYAT1
                    WHEN ${priceType} = 4 THEN s.SFIYAT4
                    WHEN ${priceType} = 5 THEN s.SFIYAT5
					WHEN ${priceType} = 2 THEN s.SFIYAT2
					WHEN ${priceType} = 3 THEN s.SFIYAT3
					WHEN ${priceType} = 6 THEN s.SFIYAT5/2
                END AS NEW_PRICE
            FROM CART_ITEMS ci
            JOIN SKART_OZELLIK s ON ci.PRODUCT_ID = s.KOD
            WHERE ci.CART_ID = @cartId
        `;

        const request = new sql.Request();
        request.input("cartId", sql.Int, cartId);
        const priceResults = await request.query(priceQuery);

        let priceChanges = [];
        priceResults.recordset.forEach(row => {
            const oldPrice = parseFloat(row.OLD_PRICE);
            const newPrice = parseFloat(row.NEW_PRICE);
            const priceDifference = newPrice - oldPrice;

            if (priceDifference !== 0) {
                priceChanges.push({
                    PRODUCT_ID: row.PRODUCT_ID,
                    OLD_PRICE: oldPrice,
                    NEW_PRICE: newPrice,
                    PRICE_DIFFERENCE: priceDifference,
                    PRICE_TYPE: priceType
                });
            }
        });

        res.json({ success: true, priceChanges });
    } catch (error) {
        console.error("Fiyat kontrol hatas�:", error);
        res.status(500).json({ success: false, message: "Fiyatlar� kontrol ederken hata olu�tu." });
    }
});

// Sepet silme
app.delete('/delete-cart/:cartId', async (req, res) => {
    const { cartId } = req.params;

    try {
        await sql.connect(config);
        await sql.query(`DELETE FROM CART_ITEMS WHERE CART_ID = ${cartId}`);
        await sql.query(`DELETE FROM CART WHERE ID = ${cartId}`);
        res.json({ success: true, message: "Sepet silindi." });
    } catch (error) {
        console.error('Sepet silme hatas�:', error);
        res.status(500).send('Sepet silinirken hata olu�tu.');
    }
});
// M��teri Tipi G�ncelleme
app.put('/cart/:cartId/customer-type', async (req, res) => {
  const { cartId } = req.params;
  const { customerType } = req.body;

  if (!customerType) {
    return res.status(400).json({ success: false, message: 'M��teri tipi belirtilmedi.' });
  }

  try {
    await sql.connect(config);

    const query = `
      UPDATE CART
      SET CUSTOMER_TYPE = @customerType
      WHERE ID = @cartId
    `;

    const request = new sql.Request();
    request.input('cartId', sql.Int, cartId);
    request.input('customerType', sql.VarChar, customerType);

    await request.query(query);

    res.json({ success: true, message: 'M��teri tipi g�ncellendi.' });
  } catch (error) {
    console.error("M��teri tipi g�ncelleme hatas�:", error);
    res.status(500).json({ success: false, message: 'M��teri tipi g�ncellenemedi.', error: error.message });
  }
});
// Sat�� B�lgesi G�ncelleme
app.put('/cart/:cartId/sales-area', async (req, res) => {
  const { cartId } = req.params;
  const { salesArea } = req.body;

  if (!salesArea) {
    return res.status(400).json({ success: false, message: 'Sat�� b�lgesi belirtilmedi.' });
  }

  try {
    await sql.connect(config);

    const query = `
      UPDATE CART
      SET SALES_AREA = @salesArea
      WHERE ID = @cartId
    `;

    const request = new sql.Request();
    request.input('cartId', sql.Int, cartId);
    request.input('salesArea', sql.VarChar, salesArea);

    await request.query(query);

    res.json({ success: true, message: 'Sat�� b�lgesi g�ncellendi.' });
  } catch (error) {
    console.error("Sat�� b�lgesi g�ncelleme hatas�:", error);
    res.status(500).json({ success: false, message: 'Sat�� b�lgesi g�ncellenemedi.', error: error.message });
  }
});
// KDV Dahil/Hari� G�ncelleme Endpointi (G�ncellenmi�)
app.put('/cart/:cartId/vat-included', async (req, res) => {
  const { cartId } = req.params;
  let { vatIncluded } = req.body;
  
  // Gelen de�eri say�ya �eviriyoruz:
  vatIncluded = parseInt(vatIncluded, 10);

  if (vatIncluded !== 0 && vatIncluded !== 1) {
    return res.status(400).json({ success: false, message: 'KDV durumu (vatIncluded) 0 veya 1 olarak belirtilmelidir.' });
  }

  try {
    await sql.connect(config);

    const query = `
      UPDATE CART
      SET VATINCLUEDED = @vatIncluded
      WHERE ID = @cartId
    `;

    const request = new sql.Request();
    request.input('cartId', sql.Int, cartId);
    request.input('vatIncluded', sql.Int, vatIncluded);

    await request.query(query);

    res.json({ success: true, message: 'KDV durumu g�ncellendi.' });
  } catch (error) {
    console.error("KDV durumu g�ncelleme hatas�:", error);
    res.status(500).json({ success: false, message: 'KDV durumu g�ncellenemedi.', error: error.message });
  }
});


// Yeni sepet olu�turma (aktif kullan�c� kimli�ini de kontrol eder)
app.post('/create-cart', async (req, res) => {
  // �stekten gelen veriler:
  const { userId, customerName, priceType, discountRate, customerType, vatIncluded, salesArea } = req.body;

  if (!userId) {
    return res.status(400).json({ success: false, message: 'Kullan�c� kimli�i belirtilmedi.' });
  }

  try {
    await sql.connect(config);

    const query = `
      INSERT INTO CART (USER_ID, CUSTOMER_NAME, PRICE_TYPE, DISCOUNT_RATE, CUSTOMER_TYPE, VATINCLUEDED, SALES_AREA, CREATED_AT)
      OUTPUT INSERTED.ID
      VALUES (@userId, @customerName, @priceType, @discountRate, @customerType, @vatIncluded, @salesArea, GETDATE())
    `;

    const request = new sql.Request();
    request.input('userId', sql.VarChar, userId);
    request.input('customerName', sql.VarChar, customerName || 'Anonim M��teri');
    request.input('priceType', sql.Int, priceType || 1);
    request.input('discountRate', sql.Float, discountRate || 0);
    request.input('customerType', sql.VarChar, customerType || 'perakende');
    request.input('vatIncluded', sql.Int, vatIncluded || 1);
    // salesArea alan�: Yurti�i i�in "yurtici", Yurtd��� i�in "yurtdisi"
    request.input('salesArea', sql.VarChar, salesArea || 'yurtici');

    const result = await request.query(query);
    const cartId = result.recordset[0].ID;

    res.json({ success: true, cartId });
  } catch (error) {
    console.error('Sepet olu�turma hatas�:', error);
    res.status(500).json({ success: false, message: 'Sepet olu�turulamad�.', error: error.message });
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/resim', express.static('c:/resim'));

// Men� verisi d�nd�ren endpoint
app.get('/api/menu-data', async (req, res) => {
    try {
        // Veritaban�na ba�lan
        await sql.connect(config);

        // SQL sorgusu
        const query = `
            SELECT BASAMAK2, BASAMAK4
            FROM SKART_OZELLIK
            WHERE INTRAWEB = 'X'
            GROUP BY BASAMAK2, BASAMAK4
            ORDER BY BASAMAK2, BASAMAK4
        `;

        // Sorguyu �al��t�r
        const result = await sql.query(query);

        // Men� verisini yap�land�r
        const menuData = {};
        result.recordset.forEach(row => {
            const { BASAMAK2, BASAMAK4 } = row;

            // Null, undefined veya bo� de�erleri filtrele
            if (BASAMAK2 && BASAMAK2.trim() !== "") {
                if (!menuData[BASAMAK2]) {
                    menuData[BASAMAK2] = [];
                }

                // Alt men�de de null, undefined ve bo� de�erleri kontrol et
                if (BASAMAK4 && BASAMAK4.trim() !== "") {
                    menuData[BASAMAK2].push(BASAMAK4);
                }
            }
        });

        // JSON format�nda d�nd�r
        res.json(menuData);
    } catch (error) {
        console.error('Men� verisi al�n�rken hata olu�tu:', error);
        res.status(500).json({ success: false, message: 'Men� verisi al�namad�.', error: error.message });
    }
});

//konsept men�s�n� d�nd�ren endpoint

app.get('/concepts', async (req, res) => {
    try {
        await sql.connect(config);
        const query = `
            SELECT DISTINCT ID, CUSTOMER_NAME , ISNULL(ADI,'DIGER') AS CONCEPT_AREA
            FROM CART left join GRUP ON GRUP.KOD=CART.CONCEPT_AREA
            WHERE CONSEPT = 1 
            ORDER BY CUSTOMER_NAME
        `;

        const result = await sql.query(query);
        res.json(result.recordset);
    } catch (error) {
        console.error("Konseptler al�n�rken hata:", error);
        res.status(500).send("Konsept verileri al�namad�.");
    }
});

//konseptin detaylar�n� almak

app.get('/concept-info', async (req, res) => {
    const { conceptId } = req.query;
    
    if (!conceptId) {
        return res.status(400).json({ error: "Konsept ID gerekli" });
    }

    try {
        await sql.connect(config);
        const query = `
            SELECT ID, CUSTOMER_NAME, CONCEPT_BANNER 
            FROM CART 
            WHERE CONSEPT = 1 AND ID = @conceptId
        `;

        const request = new sql.Request();
        request.input("conceptId", sql.Int, conceptId);
        const result = await request.query(query);

        if (result.recordset.length === 0) {
            return res.status(404).json({ error: "Konsept bulunamad�" });
        }

        res.json(result.recordset[0]);
    } catch (error) {
        console.error("Konsept bilgisi al�n�rken hata:", error);
        res.status(500).send("Konsept verisi al�namad�.");
    }
});
app.get('/api/orders-daily', async (req, res) => {
    try {
        await sql.connect(config);
        const request = new sql.Request();

        const result = await request.query(`
            SELECT 
                GUN = UPPER(FORMAT(TARIH, 'dddd', 'tr-TR')),  -- ?? **G�n isimlerini b�y�k harfle T�rk�e al**
                SATISGRUP,
                TIP,  
                SUM(SATIR_ORTAK) AS TOPLAM_SIPARIS
            FROM SIPARISDATA
            WHERE YIL = YEAR(GETDATE())   
            AND HAFTANO = DATEPART(WEEK, GETDATE()) 
            AND TIP IN ('SIPARIS', 'TEKLIF') AND ADI NOT LIKE '%FUARI 2025%'
            GROUP BY TARIH, SATISGRUP, TIP
            ORDER BY TARIH;
        `);

        res.json(result.recordset);
    } catch (error) {
        console.error('G�nl�k sipari� verileri al�namad�:', error);
        res.status(500).json({ success: false, message: 'Veri �ekme hatas�' });
    }
});

//Ayl�k Rapor

app.get('/api/monthly-summary', async (req, res) => {
  try {
    await sql.connect(config);
    const request = new sql.Request();
    // �ste�e ba�l� olarak y�l parametresini sorgudan alabiliriz (varsay�lan: bug�nk� y�l)
    const year = req.query.year ? parseInt(req.query.year, 10) : new Date().getFullYear();

    // �nce ayl�k verileri hesaplay�p, ard�ndan LAG fonksiyonu ile bir �nceki ay�n toplam�n� ekliyoruz
    const query = `
      WITH MonthlyData AS (
        SELECT 
          AY = FORMAT(TARIH, 'MM', 'tr-TR'),
          SUM(CASE WHEN SATISGRUP = 'DEKOR' THEN SATIR_ORTAK ELSE 0 END) AS DEKOR,
          SUM(CASE WHEN SATISGRUP = 'DERI' THEN SATIR_ORTAK ELSE 0 END) AS DERI,
          SUM(CASE WHEN SATISGRUP = 'DIGER' THEN SATIR_ORTAK ELSE 0 END) AS DIGER,
          SUM(SATIR_ORTAK) AS TOPLAM
        FROM SIPARISDATA
        WHERE YIL = ${year} and TIP='SIPARIS' AND ADI NOT LIKE '%FUARI 2025%'
        GROUP BY FORMAT(TARIH, 'MM', 'tr-TR')
      )
      SELECT 
        AY,
        DEKOR,
        DERI,
        DIGER,
        TOPLAM,
        LAG(TOPLAM) OVER (ORDER BY AY) AS ONCEKI_TOPLAM
      FROM MonthlyData
      ORDER BY AY;
    `;
    const result = await request.query(query);
    res.json({ success: true, data: result.recordset });
  } catch (error) {
    console.error('Ayl�k sipari� verileri al�namad�:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Veri �ekme hatas�', 
      error: error.message 
    });
  }
});
//TOP 10 performans
app.get('/api/top10-customer-performance', async (req, res) => {
  try {
    await sql.connect(config);
    const request = new sql.Request();
    const query = `
      WITH CustomerPerformance AS (
        SELECT 
          s.SATISGRUP,
          s.ADI,
          SUM(CASE WHEN YEAR(s.TARIH) = YEAR(GETDATE())-1 THEN s.SATIR_ORTAK ELSE 0 END) AS PrevYearTotal,
          AVG(CASE WHEN YEAR(s.TARIH) = YEAR(GETDATE())-1 THEN s.SATIR_ORTAK ELSE 0 END) AS PrevYearAvg,
          SUM(CASE WHEN YEAR(s.TARIH) = YEAR(GETDATE()) THEN s.SATIR_ORTAK ELSE 0 END) AS CurrentYearTotal,
          -- Mevcut y�l�n ortalamas�n�, yaln�zca o ana kadar ge�en ay say�s�na b�lerek hesapl�yoruz:
          CAST(SUM(CASE WHEN YEAR(s.TARIH) = YEAR(GETDATE()) THEN s.SATIR_ORTAK ELSE 0 END) AS FLOAT) / MONTH(GETDATE()) AS CurrentYearAvg,
          ROW_NUMBER() OVER (
            PARTITION BY s.SATISGRUP 
            ORDER BY SUM(CASE WHEN YEAR(s.TARIH) = YEAR(GETDATE()) THEN s.SATIR_ORTAK ELSE 0 END) DESC
          ) AS rn
        FROM SIPARISDATA s
        WHERE YEAR(s.TARIH) IN (YEAR(GETDATE()), YEAR(GETDATE())-1)
          AND TIP = 'SIPARIS'
          AND s.SATISGRUP IS NOT NULL
		  AND s.ADI NOT LIKE '%FUARI 2025%'
        GROUP BY s.SATISGRUP, s.ADI
      )
      SELECT 
        SATISGRUP, 
        ADI, 
        PrevYearTotal, 
        PrevYearAvg, 
        CurrentYearTotal,
        CurrentYearAvg
      FROM CustomerPerformance
      WHERE rn <= 10
      ORDER BY SATISGRUP, CurrentYearTotal DESC;
    `;
    const result = await request.query(query);
    res.json({ success: true, data: result.recordset });
  } catch (error) {
    console.error('Top 10 Customer Performance Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Could not retrieve top customer performance.', 
      error: error.message 
    });
  }
});


//Konsept �r�nlerini d�nd�ren endpoint
app.get('/concept-products', async (req, res) => {
    const { conceptId } = req.query;

    if (!conceptId) {
        return res.status(400).json({ error: "conceptId eksik!" });
    }

    let query = `
        SELECT S.KOD, S.ADI, S.MODEL, S.EBAT, S.RENK, S.DESEN, S.LAMINE, S.MATERYAL, S.LEG,
               S.SFIYAT1, S.SFIYAT4, S.STOK, S.HOM, S.KOLLEKSIYON, S.KOLEKSIYON25, 
               S.KOLEKSIYON24, S.KOLEKSIYON23, S.BASAMAK2, S.BASAMAK4, S.ANAMODEL, 
               S.KURUMSALLIST, S.INDIRIMLIST, S.NOTES, S.FUAR25, S.FKONTROL, S.FKONTROLNOTES,
               S.HSP_MALIYET_TL, S.HSP_MALIYET_USD, 
               ROUND(S.SFIYAT1 / NULLIF(S.HSP_MALIYET_TL, 0), 2) AS CARPANTL, 
               ROUND(S.SFIYAT4 / NULLIF(S.HSP_MALIYET_USD, 0), 2) AS CARPANUSD,
               S.RECETE_MALIYET_TL, S.RECETE_MALIYET_USD, S.MALZEMEUSD, S.ISCILIKUSD, NULLIF(CI.MAINCONCEPT, 0) AS MAINCONCEPT, NULLIF(CI.ADDITIONAL, 0) AS ADDITIONAL, NULLIF(CI.ADDITIONALAKS, 0) AS ADDITIONALAKS,   NULLIF(CI.ACCESSORIES, 0) AS ACCESSORIES,NULLIF(CI.SUPPLEMENTARY, 0) AS SUPPLEMENTARY,
			   CI.QUANTITY AS MIKTAR
        FROM CART_ITEMS CI
        LEFT JOIN CART C ON CI.CART_ID = C.ID
        LEFT JOIN SKART_OZELLIK S ON CI.PRODUCT_ID = S.KOD
        WHERE C.ID = @conceptId AND S.INTRAWEB = 'X'
		ORDER BY CI.MAINCONCEPT, CI.ADDITIONAL, CI.ADDITIONALAKS, CI.ACCESSORIES, CI.SUPPLEMENTARY, S.BASAMAK2, S.BASAMAK4,S.KOD
    `;

    try {
        await sql.connect(config);
        const request = new sql.Request();
        request.input('conceptId', sql.Int, conceptId);
        const result = await request.query(query);

        res.json(result.recordset);
    } catch (err) {
        console.error("Konsept �r�nleri �ekme hatas�:", err);
        res.status(500).send('Konsept �r�nleri �ekme hatas�');
    }
});

//konsept etiketi dropdown Endpointi
app.get('/concept-label-options', async (req, res) => {
  // SQL sorgusunu olu�turuyoruz
  const query = `
    SELECT ID, CONCEPT_AREA, CUSTOMER_NAME
    FROM CART
    WHERE CONSEPT = 1
      AND CUSTOMER_NAME <> 'FUAR 2025'
    ORDER BY CONCEPT_AREA, CUSTOMER_NAME
  `;
  try {
    await sql.connect(config);
    const result = await sql.query(query);
    res.json(result.recordset);
  } catch (err) {
    console.error("Konsept etiket se�enekleri �ekme hatas�:", err);
    res.status(500).send("Konsept etiket se�enekleri �ekme hatas�");
  }
});

// Konsept Etiketi olu�turma i�in Api
app.get('/api/print-concept-label', async (req, res) => {
  const { cartId, lang } = req.query;
  if (!cartId) return res.status(400).send("cartId is required");

  const modelColumn = lang === 'en' ? 'MODELING' : 'MODEL';
  const ebatColumn  = lang === 'en' ? 'EBATING'  : 'EBAT';

  const query = `
    WITH LabeledItems AS (
      SELECT 
        CASE 
          WHEN CI.MAINCONCEPT     = 1 THEN 'ANA KONSEPT'
          WHEN CI.ADDITIONAL      = 1 THEN 'TAMAMLAYICI URUNLER'
          WHEN CI.ADDITIONALAKS   = 1 THEN 'TAMAMLAYICI AKSESUARLAR'
          WHEN CI.ACCESSORIES     = 1 THEN 'AKSESUARLAR'
          WHEN CI.SUPPLEMENTARY   = 1 THEN 'EK URUNLER'
          ELSE 'DI�ER'
        END AS ConceptGroup,
        OZ.BASAMAK4 AS Kategori,
        OZ.KOD, 
        ISNULL(OZ.${modelColumn},'') AS MODEL,
        OZ.${ebatColumn} AS EBAT,
        OZ.SFIYAT1,
        C.CUSTOMER_NAME,
        CI.QUANTITY,
        (CI.QUANTITY * OZ.SFIYAT1) AS Amount
      FROM CART_ITEMS CI
      JOIN SKART_OZELLIK OZ ON CI.PRODUCT_ID = OZ.KOD
      JOIN CART C ON CI.CART_ID = C.ID
      LEFT JOIN CART_ITEMS_CONFIGURABLE CC ON CI.ID = CC.CART_ITEM_ID
      WHERE CI.CART_ID = @cartId
        AND (
          CI.MAINCONCEPT   = 1 OR 
          CI.ADDITIONAL    = 1 OR 
          CI.ADDITIONALAKS = 1 OR 
          CI.ACCESSORIES   = 1 OR 
          CI.SUPPLEMENTARY = 1
        )
    )
    SELECT *
    FROM LabeledItems
    ORDER BY 
      CASE ConceptGroup
        WHEN 'ANA KONSEPT'             THEN 1
        WHEN 'TAMAMLAYICI URUNLER'     THEN 2
        WHEN 'TAMAMLAYICI AKSESUARLAR' THEN 3
        WHEN 'AKSESUARLAR'             THEN 4
        WHEN 'EK URUNLER'              THEN 5
        ELSE 6
      END,
      Amount DESC
  `;

  try {
    await sql.connect(config);
    const request = new sql.Request();
    request.input('cartId', sql.Int, cartId);
    const result = await request.query(query);
    const items = result.recordset;

    // gruplama...
    const groups = {};
    items.forEach(item => {
      const g = item.ConceptGroup;
      if (!groups[g]) groups[g] = { group: g, totalQuantity: 0, totalAmount: 0, items: [] };
      groups[g].items.push(item);
      groups[g].totalQuantity += item.QUANTITY;
      groups[g].totalAmount   += item.Amount;
    });

    const groupedData = Object.values(groups);
    res.json(groupedData);
  } catch (e) {
    console.error(e);
    res.status(500).send("Print concept label error");
  }
});


app.get('/filter-options', async (req, res) => {
    const { basamak2, basamak4, anamodel, model, ebat,kod } = req.query;
    let query = `
        SELECT DISTINCT BASAMAK2, BASAMAK4, ANAMODEL, MODEL, EBAT,KOD
        FROM SKART_OZELLIK
        WHERE INTRAWEB='X'`;

    if (basamak2) query += ` AND BASAMAK2 LIKE '${basamak2}%'`;
    if (basamak4) query += ` AND BASAMAK4 LIKE '${basamak4}%'`;
    if (anamodel) query += ` AND ANAMODEL LIKE '${anamodel}%'`;
    if (model) query += ` AND MODEL LIKE '${model}%'`;
    if (ebat) query += ` AND EBAT LIKE '${ebat}%'`;
	if (kod) query += ` AND KOD LIKE '${kod}%'`;

    try {
        await sql.connect(config);
        const result = await sql.query(query);
        res.json(result.recordset);
    } catch (err) {
        console.error("Filtre se�enekleri �ekme hatas�:", err);
        res.status(500).send('Filtre se�enekleri �ekme hatas�');
    }
});




// Sepet Alt Toplamlar�n� Alma (Effective fiyatland�rma ile)
app.get('/cart-summary/:cartId', async (req, res) => {
  const { cartId } = req.params;
  try {
    await sql.connect(config);

    const summaryQuery = `
      SELECT 
         -- �skontosuz toplam: E�er �zelle�tirilmi� ise, �zelle�tirilmi� (effective) fiyat� kullan; de�ilse normal fiyat�
         SUM(
            CASE 
              WHEN cic.CUSTOM_CODE IS NOT NULL OR cic.CUSTOM_NAME IS NOT NULL 
                THEN ISNULL(cic.PRICE, ci.PRICE) * ci.QUANTITY
              ELSE ci.PRICE * ci.QUANTITY
            END
         ) AS grossTotal,
         -- Toplam indirim: Her sat�r i�in (effective fiyat * quantity) eksi (effective fiyat �zerinden indirim uygulanm�� miktar)
         SUM(
            CASE 
              WHEN cic.CUSTOM_CODE IS NOT NULL OR cic.CUSTOM_NAME IS NOT NULL 
                THEN (ISNULL(cic.PRICE, ci.PRICE) * ci.QUANTITY) 
                     - (ci.QUANTITY * (ISNULL(cic.PRICE, ci.PRICE) * (1 - ISNULL(cic.DISCOUNT_RATE, ci.DISCOUNT_RATE) / 100)))
              ELSE (ci.PRICE * ci.QUANTITY) - (ci.DISCOUNTED_PRICE * ci.QUANTITY)
            END
         ) AS discountTotal,
         MAX(CART.SUBTOTAL) AS subtotal,
         MAX(CART.VATTOTAL) AS vatTotal,
         MAX(CART.FREIGHT) AS freight,
         MAX(CART.INSURANCE) AS insurance,
         MAX(CART.TOTAL) AS total
      FROM CART  
      LEFT JOIN CART_ITEMS ci ON CART.ID = ci.CART_ID
      LEFT JOIN CART_ITEMS_CONFIGURABLE cic ON ci.ID = cic.CART_ITEM_ID
      WHERE CART.ID = @cartId
      GROUP BY CART.ID;
    `;

    const request = new sql.Request();
    request.input('cartId', sql.Int, cartId);
    const result = await request.query(summaryQuery);
    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Cart not found.' });
    }
    res.json({ success: true, ...result.recordset[0] });
  } catch (error) {
    console.error('Sepet �zet hesaplama hatas�:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});



//Sepet Detaylar�n� Alma
app.get('/cart-info/:cartId', async (req, res) => {
    const { cartId } = req.params;

    try {
        await sql.connect(config);

        const result = await sql.query(`
            SELECT CKOD, CUSTOMER_NAME, PRICE_TYPE, DISCOUNT_RATE, CONSEPT as CONCEPT, CONCEPT_BANNER, SALES_AREA, CUSTOMER_TYPE, VATINCLUEDED, PAYMENTTERMS, DELIVERYTIME, BANK, CONCEPT_AREA
            FROM CART
            WHERE ID = ${cartId}
        `);

        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Sepet bulunamad�.' });
        }

        res.json(result.recordset[0]);
    } catch (error) {
        console.error('Sepet bilgileri al�n�rken hata:', error);
        res.status(500).json({ success: false, message: 'Sepet bilgileri al�namad�.' });
    }
});
// Sepetten �r�n kald�rma
app.delete('/remove-from-cart/:cartItemId', async (req, res) => {
    const { cartItemId } = req.params;

    if (!cartItemId) {
        return res.status(400).json({ success: false, message: 'Ge�ersiz �r�n ID.' });
    }

    try {
        await sql.connect(config);

        const deleteQuery = `
            DELETE FROM CART_ITEMS WHERE ID = @cartItemId
        `;
        const request = new sql.Request();
        request.input('cartItemId', sql.Int, cartItemId);
        await request.query(deleteQuery);

        res.json({ success: true, message: '�r�n kald�r�ld�.' });
    } catch (error) {
        console.error('�r�n kald�rma hatas�:', error);
        res.status(500).json({ success: false, message: '�r�n kald�r�lamad�.', error: error.message });
    }
});

// ?? Banner Foto�raflar�n� Getirme API'si


app.get("/api/get-banner-images", (req, res) => {
    const bannerDir = "c:/resim/banner"; // ?? DO�RU Dizin Tan�m�

    fs.readdir(bannerDir, (err, files) => {
        if (err) {
            console.error("?? Banner dosyalar� al�namad�:", err);
            return res.status(500).json({ error: "Banner dosyalar� al�namad�." });
        }
        
        // ?? Yaln�zca .jpg ve .png dosyalar�n� filtrele
        const imageFiles = files.filter(file => file.endsWith(".jpg") || file.endsWith(".png"));

        res.json(imageFiles);
    });
});

//Se�ilen Banner'� G�ncelleme
app.post("/api/update-cart-banner", async (req, res) => {
    const { cartId, bannerPath } = req.body;

    if (!cartId || !bannerPath) {
        return res.status(400).json({ success: false, error: "Eksik parametreler" });
    }

    try {
        await sql.connect(config);
        const query = `
            UPDATE CART 
            SET CONCEPT_BANNER = @bannerPath
            WHERE ID = @cartId
        `;

        const request = new sql.Request();
        request.input("cartId", sql.Int, cartId);
        request.input("bannerPath", sql.NVarChar, bannerPath);
        await request.query(query);

        res.json({ success: true, message: "Banner ba�ar�yla g�ncellendi." });
    } catch (error) {
        console.error("Banner g�ncelleme hatas�:", error);
        res.status(500).json({ success: false, error: "Banner g�ncellenemedi." });
    }
});

//foto�raf sorgulama
app.get('/api/intrafoto/:kod', async (req, res) => {
    const { kod } = req.params;
    try {
        await sql.connect(config);
        const request = new sql.Request();
        request.input('kod', sql.VarChar, kod);
        // Sorguda, e�er dosya ad� parantez i�ermiyorsa (�rne�in "KOD.jpg") s�ralama de�eri 0,
        // aksi halde parantez i�indeki say� al�n�r.
        const query = `
            SELECT resim1 FROM INTRAFOTO 
            WHERE KOD = @kod 
            ORDER BY 
              CASE 
                WHEN resim1 NOT LIKE '% (%.jpg' THEN 0 
                ELSE CAST(SUBSTRING(resim1, CHARINDEX('(', resim1)+1, CHARINDEX(')', resim1)-CHARINDEX('(', resim1)-1) AS INT)
              END ASC
        `;
        const result = await request.query(query);
        
        const imageUrls = result.recordset.map(row => {
            let url = row.resim1;
            if (url) {
                // UNC yolundaki ters e�ik �izgileri ileri e�ik �izgiye �eviriyoruz.
                url = url.replace(/\\\\/g, '/');
                // E�er yol "/" ile ba�l�yorsa kald�r�yoruz.
                if (url.startsWith('/')) {
                    url = url.substring(1);
                }
                // �rne�in "192.168.30.4/resim/MKO-001532.jpg" format�nda,
                // HTTP URL'si olu�turmak i�in �n ek ekliyoruz.
                url = `http://${url}`;
                // Port numaras� 3000 ise, URL'yi g�ncelliyoruz.
                url = url.replace(/^http:\/\/192\.168\.30\.4/, 'http://192.168.30.4:3001');
            }
            return url;
        }).filter(url => url);
        
        if (imageUrls.length === 0) {
            imageUrls.push('/resim/YOK.jpg');
        }
        
        res.json({ success: true, imageUrls });
    } catch (error) {
        console.error('Error fetching intrafoto images:', error);
        res.status(500).json({ success: false, message: 'Error fetching images.', error: error.message });
    }
});

//pdf olu�turma
// T�rk�e PDF i�in endpoint
app.get('/api/cart/:cartId/pdf-data', async (req, res) => {
  const { cartId } = req.params;
  try {
    await sql.connect(config);
    const query = `
      SELECT 
        ci.PRODUCT_ID,
        sk.ADI AS PRODUCT_NAME,
        sk.MODEL,
        sk.EBAT,
        sk.EBATINCH,
        sk.BASAMAK4,
        CASE 
          WHEN ci.MAINCONCEPT = 1 THEN 'ANA KONSEPT' 
          WHEN ci.ADDITIONAL = 1 THEN 'TAMAMLAYICI MOBILYALAR'
          WHEN ci.ADDITIONALAKS = 1 THEN 'TAMAMLAYICI AKSESUARLAR'		  
          WHEN ci.ACCESSORIES = 1 THEN 'AKSESUARLAR' 
		  WHEN ci.SUPPLEMENTARY = 1 THEN 'EK URUNLER' 
        END AS CONCEPTGRUP,
        cic.CUSTOM_CODE,        -- �zelle�tirilmi� kod
        cic.CUSTOM_NAME,        -- �zelle�tirilmi� isim
        cic.PRICE AS CUSTOM_PRICE,       -- �zelle�tirilmi� fiyat
        ci.QUANTITY,
        ci.PRICE,
        ci.DISCOUNT_RATE,
        cic.DISCOUNT_RATE as CUSTOM_DISCOUNT_RATE,  -- �zelle�tirilmi� iskonto oran�
        ci.DISCOUNTED_PRICE,
        (ci.QUANTITY * ci.DISCOUNTED_PRICE) AS TOTAL,
        -- Effective fiyat hesaplamalar�:
        CASE 
          WHEN cic.CUSTOM_CODE IS NOT NULL OR cic.CUSTOM_NAME IS NOT NULL 
          THEN ISNULL(cic.PRICE, ci.PRICE)
          ELSE ci.PRICE 
        END AS EFFECTIVE_PRICE,
        CASE 
          WHEN cic.CUSTOM_CODE IS NOT NULL OR cic.CUSTOM_NAME IS NOT NULL 
          THEN ISNULL(cic.DISCOUNT_RATE, ci.DISCOUNT_RATE)
          ELSE ci.DISCOUNT_RATE 
        END AS EFFECTIVE_DISCOUNT_RATE,
        CASE 
          WHEN cic.CUSTOM_CODE IS NOT NULL 
          THEN ci.QUANTITY * (
            ISNULL(cic.DISCOUNTED_PRICE, (ISNULL(cic.PRICE, ci.PRICE) * (1 - ISNULL(cic.DISCOUNT_RATE, ci.DISCOUNT_RATE) / 100)))
          )
          ELSE (ci.QUANTITY * ci.DISCOUNTED_PRICE)
        END AS EFFECTIVE_TOTAL
      FROM CART_ITEMS ci
      LEFT JOIN SKART_OZELLIK sk ON ci.PRODUCT_ID = sk.KOD
      LEFT JOIN CART_ITEMS_CONFIGURABLE cic ON ci.ID = cic.CART_ITEM_ID
      WHERE ci.CART_ID = @cartId
    `;
    const request = new sql.Request();
    request.input('cartId', sql.Int, cartId);
    const result = await request.query(query);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('Error fetching cart data:', err);
    res.status(500).json({ success: false, message: 'Could not fetch cart data' });
  }
});

// �ngilizce PDF i�in endpoint
app.get('/api/cart/:cartId/pdf-data-en', async (req, res) => {
  const { cartId } = req.params;
  try {
    await sql.connect(config);
    const query = `
      SELECT 
        ci.PRODUCT_ID,
        sk.ENG_ACIK AS PRODUCT_NAME,
        sk.MODEL,
        sk.EBAT,
        sk.EBATINCH,
        sk.BASAMAK4ING AS BASAMAK4,
        CASE 
          WHEN ci.MAINCONCEPT = 1 THEN 'MAIN CONCEPT' 
          WHEN ci.ADDITIONAL = 1 THEN 'ADDITIONAL FURNITURE'
		  WHEN ci.ADDITIONALAKS = 1 THEN 'ADDITIONAL ACCESSORIES'		  
          WHEN ci.ACCESSORIES = 1 THEN 'ACCESSORIES' 
		  WHEN ci.SUPPLEMENTARY = 1 THEN 'SUPPLEMENTARY' 
        END AS CONCEPTGRUP,
        cic.CUSTOM_CODE,        -- Custom code
        cic.CUSTOM_NAME,        -- Custom name
        cic.PRICE AS CUSTOM_PRICE,       -- Custom price
        ci.QUANTITY,
        ci.PRICE,
        ci.DISCOUNT_RATE,
        cic.DISCOUNT_RATE as CUSTOM_DISCOUNT_RATE,  -- Custom discount rate
        ci.DISCOUNTED_PRICE,
        (ci.QUANTITY * ci.DISCOUNTED_PRICE) AS TOTAL,
        -- Effective pricing:
        CASE 
          WHEN cic.CUSTOM_CODE IS NOT NULL OR cic.CUSTOM_NAME IS NOT NULL 
          THEN ISNULL(cic.PRICE, ci.PRICE)
          ELSE ci.PRICE 
        END AS EFFECTIVE_PRICE,
        CASE 
          WHEN cic.CUSTOM_CODE IS NOT NULL OR cic.CUSTOM_NAME IS NOT NULL 
          THEN ISNULL(cic.DISCOUNT_RATE, ci.DISCOUNT_RATE)
          ELSE ci.DISCOUNT_RATE 
        END AS EFFECTIVE_DISCOUNT_RATE,
        CASE 
          WHEN cic.CUSTOM_CODE IS NOT NULL 
          THEN ci.QUANTITY * (
            ISNULL(cic.DISCOUNTED_PRICE, (ISNULL(cic.PRICE, ci.PRICE) * (1 - ISNULL(cic.DISCOUNT_RATE, ci.DISCOUNT_RATE) / 100)))
          )
          ELSE (ci.QUANTITY * ci.DISCOUNTED_PRICE)
        END AS EFFECTIVE_TOTAL
      FROM CART_ITEMS ci
      LEFT JOIN SKART_OZELLIK sk ON ci.PRODUCT_ID = sk.KOD
      LEFT JOIN CART_ITEMS_CONFIGURABLE cic ON ci.ID = cic.CART_ITEM_ID
      WHERE ci.CART_ID = @cartId
    `;
    const request = new sql.Request();
    request.input('cartId', sql.Int, cartId);
    const result = await request.query(query);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('Error fetching cart data:', err);
    res.status(500).json({ success: false, message: 'Could not fetch cart data' });
  }
});


///tablodan konsept pdf olu�turma
//pdf olu�turma
// T�rk�e PDF i�in endpoint
app.get('/api/cart/:cartId/pdfdata', async (req, res) => {
  const { cartId } = req.params;
  // Query parametresinden d�viz cinsini al�yoruz, varsay�lan TL
  const currency = (req.query.currency).toUpperCase();
  try {
    await sql.connect(config);
    const query = `
     SELECT 
        ci.PRODUCT_ID,
        sk.ADI AS PRODUCT_NAME,
        sk.MODEL,
        sk.EBAT,
        sk.EBATINCH,
        sk.BASAMAK4,
        CASE 
          WHEN ci.MAINCONCEPT = 1 THEN 'ANA KONSEPT' 
          WHEN ci.ADDITIONAL = 1 THEN 'TAMAMLAYICI URUNLER'
          WHEN ci.ADDITIONALAKS = 1 THEN 'TAMAMLAYICI AKSESUARLAR'
          WHEN ci.ACCESSORIES = 1 THEN 'EK AKSESUARLAR' 
          WHEN ci.SUPPLEMENTARY = 1 THEN 'EK URUNLER' 
        END AS CONCEPTGRUP,
        cic.CUSTOM_CODE,
        cic.CUSTOM_NAME,
        cic.PRICE AS CUSTOM_PRICE,
        ci.QUANTITY,
        -- Se�ilen d�viz cinsine g�re fiyat:
        CASE 
          WHEN @currency = 'USD' THEN sk.SFIYAT4
          WHEN @currency = 'EUR' THEN sk.SFIYAT5
          WHEN @currency = 'TL' THEN sk.SFIYAT1
        END AS PRICE,
        0 AS DISCOUNT_RATE,
        cic.DISCOUNT_RATE as CUSTOM_DISCOUNT_RATE,
        CASE 
          WHEN @currency = 'USD' THEN sk.SFIYAT4
          WHEN @currency = 'EUR' THEN sk.SFIYAT5
          WHEN @currency = 'TL' THEN sk.SFIYAT1
        END AS DISCOUNTED_PRICE,
        (ci.QUANTITY * CASE 
          WHEN @currency = 'USD' THEN sk.SFIYAT4
          WHEN @currency = 'EUR' THEN sk.SFIYAT5
          WHEN @currency = 'TL' THEN sk.SFIYAT1
        END) AS TOTAL,
        -- Effective fiyat hesaplamas�:
        CASE 
          WHEN cic.CUSTOM_CODE IS NOT NULL OR cic.CUSTOM_NAME IS NOT NULL 
          THEN ISNULL(cic.PRICE, 
            CASE 
              WHEN @currency = 'USD' THEN sk.SFIYAT4
              WHEN @currency = 'EUR' THEN sk.SFIYAT5
              ELSE sk.SFIYAT1
            END)
          ELSE 
            CASE 
              WHEN @currency = 'USD' THEN sk.SFIYAT4
              WHEN @currency = 'EUR' THEN sk.SFIYAT5
              WHEN @currency = 'TL' THEN sk.SFIYAT1
            END
        END AS EFFECTIVE_PRICE,
        0 AS EFFECTIVE_DISCOUNT_RATE,
        (ci.QUANTITY * CASE 
              WHEN @currency = 'USD' THEN sk.SFIYAT4
              WHEN @currency = 'EUR' THEN sk.SFIYAT5
              WHEN @currency = 'TL' THEN sk.SFIYAT1
            END) AS EFFECTIVE_TOTAL
      FROM CART_ITEMS ci
      LEFT JOIN SKART_OZELLIK sk ON ci.PRODUCT_ID = sk.KOD
      LEFT JOIN CART_ITEMS_CONFIGURABLE cic ON ci.ID = cic.CART_ITEM_ID
      WHERE ci.CART_ID = @cartId
    `;
    const request = new sql.Request();
    request.input('cartId', sql.Int, cartId);
    request.input('currency', sql.VarChar, currency);
    const result = await request.query(query);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('Error fetching cart data:', err);
    res.status(500).json({ success: false, message: 'Could not fetch cart data' });
  }
});


// �ngilizce PDF i�in endpoint
app.get('/api/cart/:cartId/pdfdata-en', async (req, res) => {
  const { cartId } = req.params;
  const currency = (req.query.currency || "TL").toUpperCase();
  try {
    await sql.connect(config);
    const query = `
      SELECT 
        ci.PRODUCT_ID,
        sk.ENG_ACIK AS PRODUCT_NAME,
        sk.MODEL,
        sk.EBAT,
        sk.EBATINCH,
        sk.BASAMAK4ING AS BASAMAK4,
        CASE 
          WHEN ci.MAINCONCEPT = 1 THEN 'MAIN CONCEPT' 
          WHEN ci.ADDITIONAL = 1 THEN 'ADDITIONAL ITEMS'
          WHEN ci.ADDITIONALAKS = 1 THEN 'ADDITIONAL ACCESSORIES'
          WHEN ci.ACCESSORIES = 1 THEN 'ACCESSORIES' 
          WHEN ci.SUPPLEMENTARY = 1 THEN 'SUPPLEMENTARY' 
        END AS CONCEPTGRUP,
        cic.CUSTOM_CODE,
        cic.CUSTOM_NAME,
        cic.PRICE AS CUSTOM_PRICE,
        ci.QUANTITY,
        -- Se�ilen d�viz cinsine g�re fiyat:
        CASE 
          WHEN @currency = 'USD' THEN sk.SFIYAT4
          WHEN @currency = 'EUR' THEN sk.SFIYAT5
          WHEN @currency = 'TL' THEN sk.SFIYAT1
        END AS PRICE,
        0 AS DISCOUNT_RATE,
        cic.DISCOUNT_RATE as CUSTOM_DISCOUNT_RATE,
        CASE 
          WHEN @currency = 'USD' THEN sk.SFIYAT4
          WHEN @currency = 'EUR' THEN sk.SFIYAT5
          WHEN @currency = 'TL' THEN sk.SFIYAT1
        END AS DISCOUNTED_PRICE,
        (ci.QUANTITY * CASE 
          WHEN @currency = 'USD' THEN sk.SFIYAT4
          WHEN @currency = 'EUR' THEN sk.SFIYAT5
          WHEN @currency = 'TL' THEN sk.SFIYAT1
        END) AS TOTAL,
        -- Effective fiyat hesaplamas�:
        CASE 
          WHEN cic.CUSTOM_CODE IS NOT NULL OR cic.CUSTOM_NAME IS NOT NULL 
          THEN ISNULL(cic.PRICE, 
            CASE 
              WHEN @currency = 'USD' THEN sk.SFIYAT4
              WHEN @currency = 'EUR' THEN sk.SFIYAT5
              ELSE sk.SFIYAT1
            END)
          ELSE 
            CASE 
              WHEN @currency = 'USD' THEN sk.SFIYAT4
              WHEN @currency = 'EUR' THEN sk.SFIYAT5
              WHEN @currency = 'TL' THEN sk.SFIYAT1
            END
        END AS EFFECTIVE_PRICE,
        0 AS EFFECTIVE_DISCOUNT_RATE,
        (ci.QUANTITY * CASE 
              WHEN @currency = 'USD' THEN sk.SFIYAT4
              WHEN @currency = 'EUR' THEN sk.SFIYAT5
              WHEN @currency = 'TL' THEN sk.SFIYAT1
            END) AS EFFECTIVE_TOTAL
      FROM CART_ITEMS ci
      LEFT JOIN SKART_OZELLIK sk ON ci.PRODUCT_ID = sk.KOD
      LEFT JOIN CART_ITEMS_CONFIGURABLE cic ON ci.ID = cic.CART_ITEM_ID
      WHERE ci.CART_ID = @cartId
    `;
    const request = new sql.Request();
    request.input('cartId', sql.Int, cartId);
    request.input('currency', sql.VarChar, currency);
    const result = await request.query(query);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('Error fetching cart data:', err);
    res.status(500).json({ success: false, message: 'Could not fetch cart data' });
  }
});

//�r�nler Endpointi
app.get('/products', async (req, res) => {
    const { 
        basamak2, basamak4, anamodel, model, ebat, hideNoStock, 
        kurumsalListe, fuarListe, indirimListe, koleksiyon25, 
        koleksiyon24, koleksiyon23, excludeKoleksiyon25, 
        minPrice, maxPrice, fkontrol, kod 
    } = req.query;

    let query = `
        SELECT KOD, ADI, MODEL, EBAT, RENK, DESEN, LAMINE, MATERYAL, LEG, 
               SFIYAT1, SFIYAT4, STOK, HOM, KOLLEKSIYON, KOLEKSIYON25, 
               KOLEKSIYON24, KOLEKSIYON23, BASAMAK2, BASAMAK4, ANAMODEL, 
               KURUMSALLIST, INDIRIMLIST, NOTES, FUAR25, FKONTROL, FKONTROLNOTES,HSP_MALIYET_TL, HSP_MALIYET_USD, ROUND(SFIYAT1 / NULLIF(HSP_MALIYET_TL, 0),2) AS CARPANTL, ROUND(SFIYAT4 / NULLIF(HSP_MALIYET_USD, 0),2) AS CARPANUSD,
			   RECETE_MALIYET_TL,RECETE_MALIYET_USD, MALZEMEUSD, ISCILIKUSD, RECETEKONTROL,RECETEKONTROLTARIH
			   
        FROM SKART_OZELLIK
        WHERE INTRAWEB='X'`;

    if (basamak2) query += ` AND BASAMAK2 LIKE '${basamak2}%'`;
    if (basamak4) query += ` AND BASAMAK4 LIKE '${basamak4}%'`;
    if (anamodel) query += ` AND ANAMODEL = '${anamodel}'`;
    if (model) query += ` AND MODEL = '${model}'`;
    if (ebat) query += ` AND EBAT = '${ebat}'`;
	if (kod) query += ` AND KOD = '${kod}'`;
    
    query += ` ORDER BY BASAMAK2, BASAMAK4, MODEL, EBAT, KOD`;

    try {
        await sql.connect(config);
        const result = await sql.query(query);
        const products = result.recordset.map(product => ({
            ...product,
            imageUrl: `/resim/${product.KOD}.jpg`
        }));
        res.json(products);
    } catch (err) {
        console.error("Veri �ekme hatas�:", err);
        res.status(500).send('Veri �ekme hatas�');
    }
});

// SKART_OZELLIK verilerini filtreleyerek d�nd�ren endpoint (Barkod Bas�m� i�in)
app.get('/api/skart-ozellik', async (req, res) => {
  try {
    const basamak2 = req.query.basamak2; // opsiyonel
    const basamak4 = req.query.basamak4; // opsiyonel
	const kod = req.query.kod; // opsiyonel
    const stoklu = req.query.stoklu === "true"; // true ise HM>0
    await sql.connect(config);
    let query = `
      SELECT KOD, BARKOD, MODEL, EBAT, RENK, DESEN, LAMINE, SFIYAT1, HOM AS HM
      FROM SKART_OZELLIK
      WHERE 1=1
    `;
    if (basamak2) {
      query += ` AND BASAMAK2 = '${basamak2}' `;
    }
    if (basamak4) {
      query += ` AND BASAMAK4 = '${basamak4}' `;
    }
	if (kod) {
      query += ` AND KOD = '${kod}' `;
    }
    if (stoklu) {
      query += ` AND HOM > 0 `;
    }
    const result = await sql.query(query);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    console.error("SKART_OZELLIK sorgu hatas�:", err);
    res.status(500).json({ success: false, message: "Veriler al�namad�", error: err.message });
  }
});

//SKART kay�tlar�n� getiren endpoint
app.get('/api/skart', async (req, res) => {
  try {
    await sql.connect(config);
    const result = await sql.query(`
      SELECT KOD, ADI,CINSKOD AS OZEL1, MODELKOD AS OZEL2, MATERYALKOD AS OZEL3, DESENKOD AS OZEL4,LAMINEKOD AS OZEL5,AKSESUAR1KOD AS OZEL6, AKSESUAR2KOD AS AKSESUAR2, AKSESUAR3KOD AS AKSESUAR3,KALITEKOD AS OZEL8,EBATKOD AS OZEL9,RENKKOD AS OZEL10,ENG_ACIK AS ACIKLAMA,BASAMAK1,BASAMAK2,BASAMAK3,BASAMAK4,BASAMAK5,KOLLEKSIYON as KOLEKSIYON,KOLEKSIYON25,HOM,MRKZ,SHWR,SHWAKS,CUMBA,UP,CT,ISD,UK,AN,GP,SV,SALDESEN,PRIMA,VAKETA,MOTIFSAN,SFIYAT1,SFIYAT2,SFIYAT3,SFIYAT4,SFIYAT5,HSP_MALIYET_USD,TEDARIK_YONTEMI,ID,ISIM,DERITIPI,ISLENTI1,ISLENTI2, BIRIM, FOTODURUM
      FROM SKART_OZELLIK
    `);
    res.json({ success: true, data: result.recordset });
  } catch (error) {
    console.error('SKART verileri al�n�rken hata:', error);
    res.status(500).json({ success: false, message: 'SKART verileri al�namad�', error: error.message });
  }
});

// SKART kayd�n� g�ncelleyen endpoint
app.post('/api/skart/update', async (req, res) => {
  const { kod, ad, ozel1, ozel2, ozel3, ozel4, ozel5, ozel6, aksesuar2, aksesuar3, ozel8, ozel9, ozel10, aciklama, koleksiyon, koleksiyon25, name, deritipi, islenti1, islenti2, tedarikyontemi } = req.body;
  try {
    await sql.connect(config);
    const query = `
      UPDATE SKART
      SET ADI = @ad,
	      OZEL1 = @ozel1,
          OZEL2 = @ozel2,
          OZEL3 = @ozel3,
          OZEL4 = @ozel4,
          OZEL5 = @ozel5,
          OZEL6 = @ozel6,
          AKSESUAR2 = @aksesuar2,
          AKSESUAR3 = @aksesuar3,
          OZEL8 = @ozel8,
          OZEL9 = @ozel9,
          OZEL10 = @ozel10,
          ACIK1 = @aciklama,
		  KOLEKSIYONKOD1 = @koleksiyon,
		  KOLEKSIYONKOD = @koleksiyon,
		  KOLEKSIYON25 = @koleksiyon25,
		  Name = @name,
		  [Leather Type] = @deritipi,
		  [Process 1] = @islenti1,
		  [Process 2] = @islenti2,
		  TEDARIKYONTEMI = @tedarikyontemi
      WHERE KOD = @kod
    `;
    const request = new sql.Request();
    request.input('kod', sql.VarChar, kod);
    request.input('ad', sql.VarChar, ad);
	request.input('ozel1', sql.VarChar, ozel1);
    request.input('ozel2', sql.VarChar, ozel2);
    request.input('ozel3', sql.VarChar, ozel3);
    request.input('ozel4', sql.VarChar, ozel4);
    request.input('ozel5', sql.VarChar, ozel5);
    request.input('ozel6', sql.VarChar, ozel6);
    request.input('aksesuar2', sql.VarChar, aksesuar2);
    request.input('aksesuar3', sql.VarChar, aksesuar3);
    request.input('ozel8', sql.VarChar, ozel8);
    request.input('ozel9', sql.VarChar, ozel9);
    request.input('ozel10', sql.VarChar, ozel10);
    request.input('aciklama', sql.VarChar, aciklama);
	request.input('koleksiyon', sql.VarChar, koleksiyon);
	request.input('koleksiyon25', sql.Int, koleksiyon25);
	request.input('name', sql.NVarChar, name);
	request.input('deritipi', sql.NVarChar, deritipi);
	request.input('islenti1', sql.NVarChar, islenti1);
	request.input('islenti2', sql.NVarChar, islenti2);
	request.input('tedarikyontemi', sql.VarChar, tedarikyontemi);
    await request.query(query);
    res.json({ success: true, message: 'SKART kayd� ba�ar�yla g�ncellendi' });
  } catch (error) {
    console.error('SKART g�ncelleme hatas�:', error);
    res.status(500).json({ success: false, message: 'SKART kayd� g�ncellenemedi', error: error.message });
  }
});

// Sepetteki �r�n miktar�n� g�ncelleme
app.put('/update-cart-item', async (req, res) => {
    const { cartItemId, quantity } = req.body;

    if (!cartItemId || quantity < 1) {
        return res.status(400).json({ success: false, message: 'Ge�ersiz giri�.' });
    }

    try {
        await sql.connect(config);

        const query = `
            UPDATE CART_ITEMS
            SET QUANTITY = @quantity,
                DISCOUNTED_PRICE = PRICE * (1 - DISCOUNT_RATE / 100)
            WHERE ID = @cartItemId
        `;

        const request = new sql.Request();
        request.input('cartItemId', sql.Int, cartItemId);
        request.input('quantity', sql.Int, quantity);

        await request.query(query);

        res.json({ success: true, message: '�r�n miktar� g�ncellendi.' });
    } catch (error) {
        console.error('Miktar g�ncelleme hatas�:', error);
        res.status(500).json({ success: false, message: 'Miktar g�ncellenirken hata olu�tu.' });
    }
});
//�zelle�tirme Yokken G�ncelleme ��in Endpoint
app.post('/api/cart-items/:cartItemId/update-original-data', async (req, res) => {
    const { cartItemId } = req.params;
    const { discountRate } = req.body;

    try {
        await sql.connect(config);

        const query = `
            UPDATE CART_ITEMS
            SET DISCOUNT_RATE = @discountRate, 
                DISCOUNTED_PRICE = PRICE * (1 - @discountRate / 100),
                UPDATED_AT = GETDATE()
            WHERE ID = @cartItemId
        `;

        const request = new sql.Request();
        request.input("discountRate", sql.Float, discountRate);
        request.input("cartItemId", sql.Int, cartItemId);

        const result = await request.query(query);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ success: false, message: "�r�n bulunamad�." });
        }

        res.json({ success: true, message: "�ndirim oran� ba�ar�yla g�ncellendi." });
    } catch (error) {
        console.error("�ndirim oran� g�ncellenirken hata:", error);
        res.status(500).json({ success: false, message: "�ndirim oran� g�ncellenemedi.", error: error.message });
    }
});




// Sepeti g�r�nt�leme
app.get('/get-cart/:cartId', async (req, res) => {
    const { cartId } = req.params;
    // �ste�e ba�l� olarak s�ralama parametrelerini al�n
    const orderField = req.query.order; // �rne�in "PRODUCT_ID"
    const directionParam = req.query.direction;
    // Sadece PRODUCT_ID i�in s�ralama izni veriyoruz; aksi durumda hata veya default s�ralama yap�labilir
    let orderClause = "";
    if (orderField === 'PRODUCT_ID') {
        // Y�n� 'DESC' sadece b�yle kabul edelim, aksi halde ASC
        const orderDirection = (directionParam && directionParam.toUpperCase() === 'DESC') ? 'DESC' : 'ASC';
        orderClause = ` ORDER BY ci.PRODUCT_ID ${orderDirection}`;
    }

    try {
        await sql.connect(config);

        // Sepet detaylar�n� ve PRICE_TYPE bilgisini al�n
        const cartQuery = `
           SELECT 
                c.PRICE_TYPE, 
                ci.ID AS cartItemId, 
                ci.PRODUCT_ID, 
                ci.QUANTITY, 
                ISNULL(cic.PRICE, ci.PRICE) AS PRICE,
                ISNULL(cic.DISCOUNT_RATE, ci.DISCOUNT_RATE) AS DISCOUNT_RATE,
                ISNULL(cic.DISCOUNTED_PRICE, ci.DISCOUNTED_PRICE) AS DISCOUNTED_PRICE,
                ci.AMOUNT_NOTINCLUDED_VAT,
                ci.VAT_TOTAL,
                ci.TOTAL_AMOUNT,
                (ci.QUANTITY * ISNULL(cic.DISCOUNTED_PRICE, ci.DISCOUNTED_PRICE)) AS TOTAL,
                NULLIF(ci.MAINCONCEPT, 0) AS MAINCONCEPT, 
                NULLIF(ci.ADDITIONAL, 0) AS ADDITIONAL, 
                NULLIF(ci.ADDITIONALAKS, 0) AS ADDITIONALAKS, 
                NULLIF(ci.ACCESSORIES, 0) AS ACCESSORIES, 
                NULLIF(ci.SUPPLEMENTARY, 0) AS SUPPLEMENTARY,	
                sk.ADI AS PRODUCT_NAME, 
                cic.CUSTOM_CODE, 
                cic.CUSTOM_NAME, 
                cic.MODEL_KOD,
                gm.ADI AS MODEL_ADI,
                cic.MATERYAL_KOD,
                gmat.ADI AS MATERYAL_ADI,
                cic.DESEN_KOD,
                gd.ADI AS DESEN_ADI,
                cic.LAMINE_KOD,
                gl.ADI AS LAMINE_ADI,
                cic.AKSESUAR1_KOD,
                ga1.ADI AS AKSESUAR1_ADI,
                cic.AKSESUAR2_KOD,
                ga2.ADI AS AKSESUAR2_ADI,
                cic.AKSESUAR3_KOD,
                ga3.ADI AS AKSESUAR3_ADI,
                cic.EBAT_KOD,
                ge.ADI AS EBAT_ADI,
                cic.RENK_KOD,
                gr.ADI AS RENK_ADI
           FROM CART c
           JOIN CART_ITEMS ci ON c.ID = ci.CART_ID
           JOIN SKART sk ON ci.PRODUCT_ID = sk.KOD
           LEFT JOIN CART_ITEMS_CONFIGURABLE cic ON ci.ID = cic.CART_ITEM_ID
           LEFT JOIN GRUP gm ON cic.MODEL_KOD = gm.KOD AND gm.TIP = 71
           LEFT JOIN GRUP gmat ON cic.MATERYAL_KOD = gmat.KOD AND gmat.TIP = 72
           LEFT JOIN GRUP gd ON cic.DESEN_KOD = gd.KOD AND gd.TIP = 73
           LEFT JOIN GRUP gl ON cic.LAMINE_KOD = gl.KOD AND gl.TIP = 74
           LEFT JOIN GRUP ga1 ON cic.AKSESUAR1_KOD = ga1.KOD AND ga1.TIP = 75
           LEFT JOIN GRUP ga2 ON cic.AKSESUAR2_KOD = ga2.KOD AND ga2.TIP = 75
           LEFT JOIN GRUP ga3 ON cic.AKSESUAR3_KOD = ga3.KOD AND ga3.TIP = 75
           LEFT JOIN GRUP ge ON cic.EBAT_KOD = ge.KOD AND ge.TIP = 78
           LEFT JOIN GRUP gr ON cic.RENK_KOD = gr.KOD AND gr.TIP = 79
           WHERE c.ID = @cartId
           ${orderClause}
        `;

        const request = new sql.Request();
        request.input('cartId', sql.Int, cartId);
        const cartResult = await request.query(cartQuery);

        if (cartResult.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Sepet bulunamad� veya bo�.' });
        }

        // PRICE_TYPE bilgisine g�re para birimini belirle
        const priceType = cartResult.recordset[0].PRICE_TYPE;
        let currency;
        if (priceType === '1') currency = 'TL';
        else if (priceType === '4') currency = 'USD';
        else if (priceType === '5') currency = 'EUR';
        else currency = '';

        const items = cartResult.recordset.map(item => ({
            ...item,
            currency
        }));

        res.json({ success: true, items, currency });
    } catch (err) {
        console.error('Sepet detaylar�n� al�rken hata:', err);
        res.status(500).json({ success: false, message: 'Sepet y�klenemedi.', error: err.message });
    }
});

//�zelle�tirilmi� fiyat g�ncelleme endpointi
// /api/cart-items/:cartItemId/update-custom-price Endpoint'i
app.post('/api/cart-items/:cartItemId/update-custom-price', async (req, res) => {
    const { cartItemId } = req.params;
    const { customPrice } = req.body;

    try {
        await sql.connect(config);

        const query = `
            UPDATE CART_ITEMS_CONFIGURABLE
            SET PRICE = @customPrice, UPDATED_AT = GETDATE()
            WHERE CART_ITEM_ID = @cartItemId
        `;

        const request = new sql.Request();
        request.input("customPrice", sql.Float, customPrice);
        request.input("cartItemId", sql.Int, cartItemId);

        const result = await request.query(query);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ success: false, message: "�zelle�tirilmi� �r�n bulunamad�." });
        }

        res.json({ success: true, message: "Fiyat ba�ar�yla g�ncellendi." });
    } catch (error) {
        console.error("Fiyat g�ncellenirken hata:", error);
        res.status(500).json({ success: false, message: "Fiyat g�ncellenemedi.", error: error.message });
    }
});
//�zelle�tirilmi� �r�n Update
app.post('/api/cart-items/:cartItemId/update-custom-data', async (req, res) => {
    const { cartItemId } = req.params;
    const { customPrice, discountRate } = req.body;

    try {
        await sql.connect(config);

        const query = `
            UPDATE CART_ITEMS_CONFIGURABLE
            SET 
                ${customPrice !== undefined ? "PRICE = @customPrice," : ""}
                ${discountRate !== undefined ? "DISCOUNT_RATE = @discountRate," : ""}
                ${customPrice !== undefined && discountRate !== undefined ? "DISCOUNTED_PRICE = @discountedPrice," : ""}
                UPDATED_AT = GETDATE()
            WHERE CART_ITEM_ID = @cartItemId
        `;

        const request = new sql.Request();

        // E�er customPrice varsa parametre ekle
        if (customPrice !== undefined) {
            request.input("customPrice", sql.Float, customPrice);
        }

        // E�er discountRate varsa parametre ekle
        if (discountRate !== undefined) {
            request.input("discountRate", sql.Float, discountRate);
        }

        // E�er hem customPrice hem de discountRate varsa discountedPrice hesapla ve parametre ekle
        if (customPrice !== undefined && discountRate !== undefined) {
            const discountedPrice = customPrice * (1 - discountRate / 100);
            request.input("discountedPrice", sql.Float, discountedPrice);
        }

        request.input("cartItemId", sql.Int, cartItemId);

        const result = await request.query(query);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ success: false, message: "�zelle�tirilmi� �r�n bulunamad�." });
        }

        res.json({ success: true, message: "Fiyat ve/veya indirim oran� ba�ar�yla g�ncellendi." });
    } catch (error) {
        console.error("Fiyat ve/veya indirim oran� g�ncellenirken hata:", error);
        res.status(500).json({ success: false, message: "Fiyat ve/veya indirim oran� g�ncellenemedi.", error: error.message });
    }
});





//�zelle�tirmeyi Silen endpoint
app.delete('/api/cart-items/:cartItemId/customization', async (req, res) => {
    const cartItemId = parseInt(req.params.cartItemId, 10);

    try {
        await sql.connect(config);

        const query = `
            DELETE FROM CART_ITEMS_CONFIGURABLE
            WHERE CART_ITEM_ID = @cartItemId
        `;

        const request = new sql.Request();
        request.input('cartItemId', sql.Int, cartItemId);
        await request.query(query);

        res.json({ success: true, message: '�zelle�tirme ba�ar�yla silindi.' });
    } catch (error) {
        console.error('�zelle�tirme silinirken hata:', error);
        res.status(500).json({ success: false, message: '�zelle�tirme silinemedi.', error: error.message });
    }
});



//Sepeti Temizleme

app.post('/clear-cart/:cartId', async (req, res) => {
  const { cartId } = req.params;
  // Temizleyen kullan�c� ad�n� iste�in body k�sm�ndan al�yoruz (�rne�in "KADIR")
  const { cleared_by } = req.body; 
  
  try {
    // 1. Temizlenecek sepetin i�eri�ini �ekiyoruz.
    const cartResult = await sql.query(`SELECT * FROM CART_ITEMS WHERE CART_ID = ${cartId}`);
    const cartContent = JSON.stringify(cartResult.recordset);

    // 2. Parametreli sorgu ile log kayd�n� ekliyoruz.
    const request = new sql.Request();
    request.input('cartId', sql.Int, cartId);
    request.input('clearedBy', sql.NVarChar(100), cleared_by);
    request.input('cartContent', sql.NVarChar(sql.MAX), cartContent);
    await request.query(
      `INSERT INTO cart_clear_logs (cart_id, cleared_by, cart_content) VALUES (@cartId, @clearedBy, @cartContent)`
    );

    // 3. Sepeti temizliyoruz.
    await sql.query(`DELETE FROM CART_ITEMS WHERE CART_ID = ${cartId}`);

    res.send('Sepet temizlendi ve log kaydedildi');
  } catch (err) {
    console.error('Sepeti temizlerken hata:', err);
    res.status(500).send('Sepet temizleme hatas�');
  }
});


// BANKA tablosundan, KULLAN de�eri -1 olan kay�tlar� d�nd�r�r
app.get('/api/banks', async (req, res) => {
  try {
    await sql.connect(config);
    const result = await sql.query(`
      SELECT KOD, ADI, BANKAADI, SUBEKODU, HESAPADI, SUBE, IBAN, HESAP, SWIFTCODE, DOVIZ
      FROM BANKA
      WHERE KULLAN = -1
      ORDER BY ADI
    `);
    res.json({ success: true, data: result.recordset });
  } catch (error) {
    console.error("Bank retrieval error:", error);
    res.status(500).json({ success: false, message: "Banks could not be retrieved.", error: error.message });
  }
});
// CART tablosundaki BANK alan�n� g�nceller
app.post('/update-cart-bank', async (req, res) => {
  const { cartId, bank } = req.body;
  try {
    await sql.connect(config);
    // Banka bilgisini BANKA tablosunun KOD de�eri olarak sakl�yoruz
    await sql.query(`UPDATE CART SET BANK = '${bank}' WHERE ID = '${cartId}'`);
    res.json({ success: true, message: 'Cart bank updated successfully.' });
  } catch (error) {
    console.error("Cart bank update error:", error);
    res.status(500).json({ success: false, message: 'Cart bank update failed.', error: error.message });
  }
});

// �deme �artlar� (Payment Terms) se�eneklerini almak i�in endpoint
app.get('/api/paymentterms', async (req, res) => {
  try {
    await sql.connect(config);
    // ODEMESARTLARI view'inde KOD, TR ve EN s�tunlar� bulundu�unu varsay�yoruz
    const result = await sql.query(`
      SELECT KOD, TR, EN
      FROM ODEMESARTLARI
      ORDER BY TR
    `);
    res.json({ success: true, data: result.recordset });
  } catch (error) {
    console.error('Payment Terms retrieval error:', error);
    res.status(500).json({ success: false, message: 'Payment terms could not be retrieved.', error: error.message });
  }
});
// Sepetin PAYMENTTERMS s�tununu g�ncellemek i�in endpoint
app.put('/cart/:cartId/paymentterms', async (req, res) => {
  const { cartId } = req.params;
  const { paymentTerms } = req.body; // Se�ilen KOD de�eri g�nderilecek
  try {
    await sql.connect(config);
    const request = new sql.Request();
    request.input('paymentTerms', sql.VarChar, paymentTerms);
    request.input('cartId', sql.Int, cartId);
    await request.query(`
      UPDATE CART
      SET PAYMENTTERMS = @paymentTerms
      WHERE ID = @cartId
    `);
    res.json({ success: true, message: 'Payment terms updated successfully.' });
  } catch (error) {
    console.error('Payment terms update error:', error);
    res.status(500).json({ success: false, message: 'Payment terms could not be updated.', error: error.message });
  }
});
// Konsept Alanlar� se�eneklerini almak i�in endpoint
app.get('/api/conceptarea', async (req, res) => {
  try {
    await sql.connect(config);
    // CONCEPTAREA view'inde KOD, TR ve EN s�tunlar� bulundu�unu varsay�yoruz
    const result = await sql.query(`
      SELECT KOD, TR, EN
      FROM CONCEPTAREA
      ORDER BY TR
    `);
    res.json({ success: true, data: result.recordset });
  } catch (error) {
    console.error('Payment Terms retrieval error:', error);
    res.status(500).json({ success: false, message: 'Payment terms could not be retrieved.', error: error.message });
  }
});
// Sepetin Konsept Alan� s�tununu g�ncellemek i�in endpoint
app.put('/cart/:cartId/conceptarea', async (req, res) => {
  const { cartId } = req.params;
  const { conceptarea } = req.body; // Se�ilen KOD de�eri g�nderilecek
  try {
    await sql.connect(config);
    const request = new sql.Request();
    request.input('conceptarea', sql.VarChar, conceptarea);
    request.input('cartId', sql.Int, cartId);
    await request.query(`
      UPDATE CART
      SET CONCEPT_AREA = @conceptarea
      WHERE ID = @cartId
    `);
    res.json({ success: true, message: 'Concept Area updated successfully.' });
  } catch (error) {
    console.error('Concept Area update error:', error);
    res.status(500).json({ success: false, message: 'Concept Area could not be updated.', error: error.message });
  }
});
// Teslim S�resi (Delivery Time) g�ncelleme endpoint�i
app.put('/cart/:cartId/deliverytime', async (req, res) => {
  const { cartId } = req.params;
  const { deliveryTime } = req.body; // Se�ilen teslim s�resi de�eri (�rne�in: 1, 2, 3, 4, 6, 8, 10, 12)
  try {
    await sql.connect(config);
    const request = new sql.Request();
    request.input('deliveryTime', sql.Int, deliveryTime);
    request.input('cartId', sql.Int, cartId);
    await request.query(`
      UPDATE CART
      SET DELIVERYTIME = @deliveryTime
      WHERE ID = @cartId
    `);
    res.json({ success: true, message: 'Teslim s�resi ba�ar�yla g�ncellendi.' });
  } catch (error) {
    console.error('Teslim s�resi g�ncelleme hatas�:', error);
    res.status(500).json({ success: false, message: 'Teslim s�resi g�ncellenemedi.', error: error.message });
  }
});

//�r�n Detaylar�n� G�ncelleyen Endpoint
app.post('/update-details', async (req, res) => {
    // �lgili alanlar� destructuring ile al�yoruz
    const { KOD, KOLEKSIYON25, KOLEKSIYON24, KOLEKSIYON23, KURUMSALLIST, INDIRIMLIST, NOTES, FKONTROL, FKONTROLNOTES, RECETEKONTROL } = req.body;
    try {
        await sql.connect(config);
        let query = 'UPDATE SKART SET ';

        if (typeof KOLEKSIYON25 !== 'undefined') {
            query += `KOLEKSIYON25 = ${KOLEKSIYON25 ? 1 : 0}, `;
        }
        if (typeof KOLEKSIYON24 !== 'undefined') {
            query += `KOLEKSIYON24 = ${KOLEKSIYON24 ? 1 : 0}, `;
        }
        if (typeof KOLEKSIYON23 !== 'undefined') {
            query += `KOLEKSIYON23 = ${KOLEKSIYON23 ? 1 : 0}, `;
        }
        if (typeof KURUMSALLIST !== 'undefined') {
            query += `KURUMSALLIST = ${KURUMSALLIST ? 1 : 0}, `;
        }
        if (typeof INDIRIMLIST !== 'undefined') {
            query += `INDIRIMLIST = ${INDIRIMLIST ? 1 : 0}, `;
        }
        if (NOTES !== undefined) {
            query += `NOTES = '${NOTES}', `;
        }
        if (typeof FKONTROL !== 'undefined') {
            query += `FKONTROL = ${FKONTROL ? 1 : 0}, `;
        }
        if (FKONTROLNOTES !== undefined) {
            query += `FKONTROLNOTES = '${FKONTROLNOTES}', `;
        }
        // E�er RECETEKONTROL de�eri g�nderildiyse; hem de�eri g�ncelle hem de RECETEKONTROLTARIH�i anl�k tarih olarak ayarla.
        if (typeof RECETEKONTROL !== 'undefined') {
            query += `RECETEKONTROL = ${RECETEKONTROL ? 1 : 0}, `;
            query += `RECETEKONTROLTARIH = GETDATE(), `;
        }

        // Sondaki ekstra virg�l� kald�r
        query = query.slice(0, -2);
        query += ` WHERE KOD = '${KOD}'`;

        await sql.query(query);
        res.send('G�ncelleme ba�ar�l�');
    } catch (err) {
        console.error("G�ncelleme hatas�:", err);
        res.status(500).send('G�ncelleme hatas�');
    }
});



app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
    console.log(`Sunucu �al���yor: http://192.168.30.4:${port}`);
});

// toplam �r�n say�s�n� almak
app.get('/products/count', async (req, res) => {
    const { basamak2, basamak4, anamodel, model, ebat, hideNoStock, kurumsalListe, fuarListe, indirimListe, koleksiyon25, koleksiyon24, koleksiyon23, minPrice, maxPrice, fkontrol,kod } = req.query;

    let query = `
        SELECT COUNT(*) AS total
        FROM SKART_OZELLIK
        WHERE INTRAWEB='X'
    `;

    if (basamak2) query += ` AND BASAMAK2 LIKE '${basamak2}%'`;
    if (basamak4) query += ` AND BASAMAK4 LIKE '${basamak4}%'`;
    if (anamodel) query += ` AND ANAMODEL LIKE '${anamodel}%'`;
    if (model) query += ` AND MODEL LIKE '${model}%'`;
    if (ebat) query += ` AND EBAT LIKE '${ebat}%'`;
	if (kod) query += ` AND KOD LIKE '${kod}%'`;
    if (hideNoStock === 'true') query += ` AND STOK > 0`;
    if (kurumsalListe === '1') query += ` AND KURUMSALLIST = 1`;
    if (fuarListe === '1') query += ` AND FUAR25 = 1`;
    if (koleksiyon25 === '1') query += ` AND KOLEKSIYON25 = 1`;
    if (koleksiyon24 === '1') query += ` AND KOLEKSIYON24 = 1`;
    if (koleksiyon23 === '1') query += ` AND KOLEKSIYON23 = 1`;
    if (indirimListe === '1') query += ` AND INDIRIMLIST = 1`;
    if (minPrice) query += ` AND SFIYAT1 >= ${parseFloat(minPrice)}`;
    if (maxPrice) query += ` AND SFIYAT1 <= ${parseFloat(maxPrice)}`;
    if (fkontrol === '1') query += ` AND FKONTROL = 1`;

    try {
        await sql.connect(config);
        const result = await sql.query(query);
        res.json({ total: result.recordset[0].total });
    } catch (err) {
        console.error("Toplam �r�n say�s�n� al�rken hata:", err);
        res.status(500).send('Toplam �r�n say�s� al�namad�');
    }
});




//Sepetteki �ndirim Oran�n� G�ncelleyen Endpoint
app.put('/cart/:cartId/discount-rate', async (req, res) => {
    const { cartId } = req.params;
    const { discountRate } = req.body;

    try {
        await sql.connect(config);

        // CART tablosunu g�ncelle
        const cartUpdateQuery = `
            UPDATE CART
            SET DISCOUNT_RATE = @discountRate
            WHERE ID = @cartId
        `;
        const cartRequest = new sql.Request();
        cartRequest.input('cartId', sql.Int, cartId);
        cartRequest.input('discountRate', sql.Float, discountRate);
        await cartRequest.query(cartUpdateQuery);

        // CART_ITEMS tablosunu g�ncelle
        const itemsUpdateQuery = `
            UPDATE CART_ITEMS
            SET DISCOUNT_RATE = @discountRate,
                DISCOUNTED_PRICE = PRICE * (1 - @discountRate / 100)
            WHERE CART_ID = @cartId
        `;
        const itemsRequest = new sql.Request();
        itemsRequest.input('cartId', sql.Int, cartId);
        itemsRequest.input('discountRate', sql.Float, discountRate);
        await itemsRequest.query(itemsUpdateQuery);

        res.json({ success: true, message: '�ndirim oran� g�ncellendi.' });
    } catch (error) {
        console.error('�ndirim oran� g�ncelleme hatas�:', error);
        res.status(500).json({ success: false, message: '�ndirim oran� g�ncellenemedi.', error: error.message });
    }
});

//Sepetteki M��teri Ad�n� G�ncelleyen Endpoint

app.put('/update-customer-name', async (req, res) => {
    const { cartId, customerName } = req.body;

    if (!cartId || !customerName) {
        return res.status(400).json({ success: false, message: 'Ge�ersiz giri�.' });
    }

    try {
        await sql.connect(config);

        const query = `
            UPDATE CART
            SET CUSTOMER_NAME = @customerName
            WHERE ID = @cartId
        `;

        const request = new sql.Request();
        request.input('cartId', sql.Int, cartId);
        request.input('customerName', sql.VarChar, customerName);

        await request.query(query);

        res.json({ success: true, message: 'M��teri ad� ba�ar�yla g�ncellendi.' });
    } catch (error) {
        console.error('M��teri ad� g�ncelleme hatas�:', error);
        res.status(500).json({ success: false, message: 'M��teri ad� g�ncellenemedi.', error: error.message });
    }
});


//Sepetteki Fiyat Tipini G�ncelleyen Endpoint

app.put('/cart/:cartId/price-type', async (req, res) => {
    const { cartId } = req.params;
    const { priceType } = req.body;

    try {
        await sql.connect(config);

        // CART tablosunu g�ncelle
        const cartUpdateQuery = `
            UPDATE CART
            SET PRICE_TYPE = @priceType
            WHERE ID = @cartId
        `;
        const cartRequest = new sql.Request();
        cartRequest.input('cartId', sql.Int, cartId);
        cartRequest.input('priceType', sql.VarChar, priceType);
        await cartRequest.query(cartUpdateQuery);

        // Yeni fiyatlara g�re CART_ITEMS g�ncelle
        const priceColumn = priceType === '1' ? 'SFIYAT1' : priceType === '4' ? 'SFIYAT4' : 'SFIYAT5';
        const itemsUpdateQuery = `
            UPDATE CART_ITEMS
            SET PRICE = sk.${priceColumn},
                DISCOUNTED_PRICE = sk.${priceColumn} * (1 - ci.DISCOUNT_RATE / 100)
            FROM CART_ITEMS ci
            JOIN SKART sk ON ci.PRODUCT_ID = sk.KOD
            WHERE ci.CART_ID = @cartId
        `;
        const itemsRequest = new sql.Request();
        itemsRequest.input('cartId', sql.Int, cartId);
        await itemsRequest.query(itemsUpdateQuery);

        res.json({ success: true, message: 'Fiyat tipi g�ncellendi.' });
    } catch (error) {
        console.error('Fiyat tipi g�ncelleme hatas�:', error);
        res.status(500).json({ success: false, message: 'Fiyat tipi g�ncellenemedi.', error: error.message });
    }
});


// Sepet i�eri�indeki �r�n�n indirim oran�n� g�ncelleme
app.put('/cart/item/discount', async (req, res) => {
    const { cartItemId, discountRate } = req.body;

    if (!cartItemId || discountRate == null) {
        return res.status(400).json({ success: false, message: 'Ge�ersiz giri�.' });
    }

    try {
        await sql.connect(config);

        const updateQuery = `
            UPDATE CART_ITEMS
            SET DISCOUNT_RATE = @discountRate,
                DISCOUNTED_PRICE = PRICE * (1 - @discountRate / 100)
            WHERE ID = @cartItemId
        `;

        const request = new sql.Request();
        request.input('cartItemId', sql.Int, cartItemId);
        request.input('discountRate', sql.Float, discountRate);

        await request.query(updateQuery);

        res.json({ success: true, message: '�ndirim oran� g�ncellendi.' });
    } catch (error) {
        console.error('�ndirim oran� g�ncelleme hatas�:', error);
        res.status(500).json({ success: false, message: '�ndirim oran� g�ncellenemedi.', error: error.message });
    }
});


// Yeni endpoint: Devam eden istekleri iptal etme
app.post('/cancel-requests', (req, res) => {
    sql.close(); // Devam etmekte olan t�m SQL i�lemlerini iptal et
    res.send('Devam eden istekler iptal edildi');
});




//Tabulator Kolon G�ster/Gizle ��in Endpointler

// GET preferences
app.get('/api/user-preferences/:userId/:tableName', async (req, res) => {
  const { userId, tableName } = req.params;
  try {
    await sql.connect(config);
    const result = await sql.query`
      SELECT ColumnName, ColumnOrder, IsVisible
      FROM dbo.UserTablePreferences
      WHERE UserId = ${userId} AND TableName = ${tableName}
      ORDER BY ColumnOrder
    `;
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST preferences (tam g�ncelleme)
app.post('/api/user-preferences', async (req, res) => {
  const { userId, tableName, preferences } = req.body;
  const transaction = new sql.Transaction();

  try {
    await sql.connect(config);
    await transaction.begin();

    // 1) Silme i�lemi i�in kendi Request�i
    await transaction.request().query`
      DELETE FROM dbo.UserTablePreferences
      WHERE UserId    = ${userId}
        AND TableName = ${tableName}
    `;

    // 2) Her INSERT i�in ayr� bir Request
    for (let p of preferences) {
      await transaction.request().query`
        INSERT INTO dbo.UserTablePreferences
          (UserId, TableName, ColumnName, ColumnOrder, IsVisible)
        VALUES
          (${userId}, ${tableName}, ${p.columnName}, ${p.columnOrder}, ${p.isVisible})
      `;
    }

    await transaction.commit();
    res.json({ success: true });
  } catch (err) {
    await transaction.rollback();
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

//Depo Durum Raporu
// 1. DEPO listesini veren endpoint
app.get('/api/depos', async (req, res) => {
  try {
    await sql.connect(config);
    const result = await sql.query`
      SELECT KOD, ADI
      FROM DEPO
      ORDER BY KOD
    `;
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2. Stok-envanter raporunu veren endpoint
app.get('/api/stock-inventory', async (req, res) => {
  const { date, depo } = req.query;

  if (!date || !depo) {
    return res.status(400).json({ success: false, message: 'date ve depo zorunlu.' });
  }

  try {
    await sql.connect(config);
    const request = new sql.Request();
    request.input('date', sql.Date, date);
    request.input('depo', sql.VarChar, depo);

    const query = `
      WITH Movements AS (
        -- TIP != 17 (sadece GDEPO)
        SELECT
          f.MKOD AS KOD,
          CASE WHEN f.TIP IN (20,21,22,23,25,27,30,31,32,35) THEN -f.MIKTAR ELSE f.MIKTAR END AS MIK
        FROM SFISD f
        WHERE f.TIP <> 17
          AND f.GDEPO = @depo
          AND f.TARIH <= @date

        UNION ALL

        -- TIP = 17 i�in GDEPO � art�
        SELECT
          f.MKOD AS KOD,
          f.MIKTAR AS MIK
        FROM SFISD f
        WHERE f.TIP = 17
          AND f.GDEPO = @depo
          AND f.TARIH <= @date

        UNION ALL

        -- TIP = 17 i�in CDEPO � eksik
        SELECT
          f.MKOD AS KOD,
          -f.MIKTAR AS MIK
        FROM SFISD f
        WHERE f.TIP = 17
          AND f.CDEPO = @depo
          AND f.TARIH <= @date
      ),

      Grouped AS (
        SELECT
          m.KOD,
          ROUND(SUM(m.MIK), 2) AS MIKTAR
        FROM Movements m
        GROUP BY m.KOD
        HAVING ROUND(SUM(m.MIK), 2) <> 0
      )

      SELECT
        g.KOD,
        s.ADI,
        s.BIRIM       AS BRM,
        s.BASAMAK1,
        s.BASAMAK2,
        s.BASAMAK3,
        s.BASAMAK4,
        s.BASAMAK5,
        s.HSP_MALIYET_USD,
        s.SFIYAT4    AS PRK_USD,
        g.MIKTAR,
        SUM(g.MIKTAR) OVER () AS TOTAL_MIKTAR
      FROM Grouped g
      JOIN SKART_OZELLIK s ON s.KOD = g.KOD
      ORDER BY
        s.BASAMAK1,
        s.BASAMAK2,
        s.BASAMAK3,
        s.BASAMAK4,
        s.BASAMAK5,
        g.KOD;
    `;

    const result = await request.query(query);
    const rows = result.recordset;
    const total = rows.length ? rows[0].TOTAL_MIKTAR : 0;

    const data = rows.map(r => ({
      KOD: r.KOD,
      ADI: r.ADI,
      BRM: r.BRM,
      BASAMAK1: r.BASAMAK1,
      BASAMAK2: r.BASAMAK2,
      BASAMAK3: r.BASAMAK3,
      BASAMAK4: r.BASAMAK4,
      BASAMAK5: r.BASAMAK5,
      HSP_MALIYET_USD: r.HSP_MALIYET_USD,
      PRK_USD: r.PRK_USD,
      MIKTAR: r.MIKTAR
    }));

    res.json({ success: true, data, total });
  } catch (err) {
    console.error('Stock inventory error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});