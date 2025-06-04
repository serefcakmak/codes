const sql = require('mssql');
const config = require('../config/db');

async function addCartItemService({ cartId, productId, quantity }) {
  await sql.connect(config);

  // 1) Sepet bilgisi
  const cartRes = await new sql.Request()
    .input('cartId', sql.Int, cartId)
    .query(`
      SELECT PRICE_TYPE, DISCOUNT_RATE AS baseDiscount, VATINCLUEDED, SALES_AREA
      FROM CART WHERE ID = @cartId
    `);
  if (!cartRes.recordset.length) throw new Error("Geçerli bir sepet bulunamadı.");

  const { PRICE_TYPE, baseDiscount, VATINCLUEDED, SALES_AREA } = cartRes.recordset[0];

  // 2) Kategori ID
  const catRes = await new sql.Request()
    .input('productId', sql.VarChar, productId)
    .query(`
      SELECT SKARTAGAC.ID AS SkartAgacID
      FROM SKART
      JOIN SKARTAGAC ON SKART.OZEL1 = SKARTAGAC.KOD
      WHERE SKART.KOD = @productId
    `);
  if (!catRes.recordset.length) throw new Error("Ürün bulunamadı (kategori yok).");

  const categoryId = catRes.recordset[0].SkartAgacID;
  const now = new Date();

  // 3) Ürün indirimi kontrol
  const prodCamp = await new sql.Request()
    .input('productCode', sql.VarChar, productId)
    .input('now', sql.DateTime, now)
    .query(`
      SELECT TOP 1 c.DiscountValue
      FROM Campaign_Products cp
      JOIN Campaigns c ON cp.CampaignID = c.CampaignID
      JOIN SKART s ON s.ID = cp.ProductID
      WHERE s.KOD = @productCode AND c.CampaignType = 'PRODUCT'
        AND c.StartDate <= @now AND c.EndDate >= @now
      ORDER BY c.DiscountValue DESC
    `);

  let appliedDiscount = baseDiscount;
  if (prodCamp.recordset.length) {
    appliedDiscount = Number(prodCamp.recordset[0].DiscountValue);
  } else {
    const catCamp = await new sql.Request()
      .input('categoryId', sql.Int, categoryId)
      .input('now', sql.DateTime, now)
      .query(`
        SELECT TOP 1 c.DiscountValue
        FROM Campaign_Categories cc
        JOIN Campaigns c ON cc.CampaignID = c.CampaignID
        WHERE cc.SkartAgacID = @categoryId
          AND c.CampaignType = 'CATEGORY_CART'
          AND c.StartDate <= @now AND c.EndDate >= @now
        ORDER BY c.DiscountValue DESC
      `);
    if (catCamp.recordset.length) {
      appliedDiscount = Number(catCamp.recordset[0].DiscountValue);
    }
  }

  // 4) Fiyat sütunu seçimi
  const priceColumns = {
    '1': 'SFIYAT1', '2': 'SFIYAT2', '3': 'SFIYAT3',
    '4': 'SFIYAT4', '5': 'SFIYAT5', '6': '(SFIYAT5/2)'
  };
  const priceColumn = priceColumns[String(PRICE_TYPE)];
  if (!priceColumn) throw new Error("Geçersiz PRICE_TYPE.");

  // 5) Ürün fiyatı
  const priceRes = await new sql.Request()
    .input('productId', sql.VarChar, productId)
    .query(`SELECT ${priceColumn} AS PRICE FROM SKART WHERE KOD = @productId`);

  if (!priceRes.recordset.length) throw new Error("Ürün bulunamadı.");
  const price = Number(priceRes.recordset[0].PRICE);
  const discountedPrice = price * (1 - appliedDiscount / 100);

  // 6) KDV bilgisi
  const vatRes = await new sql.Request()
    .input('productId', sql.VarChar, productId)
    .query(`SELECT KDV AS VAT_RATE FROM SKART_OZELLIK WHERE KOD = @productId`);
  if (!vatRes.recordset.length) throw new Error("KDV bilgisi bulunamadı.");
  let vatRate = Number(vatRes.recordset[0].VAT_RATE);
  if (SALES_AREA.toLowerCase() === 'yurtdisi') vatRate = 0;

  // 7) Hesaplamalar
  const qty = Number(quantity);
  const vatIncl = Number(VATINCLUEDED);
  let priceNotIncludedVat, vatUnitPrice, vatTotal, amountNotIncludedVat, totalAmount;

  if (vatIncl === 1) {
    vatUnitPrice = discountedPrice - discountedPrice / (1 + vatRate);
    priceNotIncludedVat = discountedPrice - vatUnitPrice;
  } else {
    priceNotIncludedVat = discountedPrice;
    vatUnitPrice = discountedPrice * vatRate;
  }

  vatTotal = vatUnitPrice * qty;
  amountNotIncludedVat = priceNotIncludedVat * qty;
  totalAmount = amountNotIncludedVat + vatTotal;

  // 8) Sepete ekle
  await new sql.Request()
    .input('cartId', sql.Int, cartId)
    .input('productId', sql.VarChar, productId)
    .input('quantity', sql.Int, qty)
    .input('price', sql.Float, price)
    .input('discountRate', sql.Float, appliedDiscount)
    .input('discountedPrice', sql.Float, discountedPrice)
    .input('vatRate', sql.Float, vatRate)
    .input('vatUnitPrice', sql.Float, vatUnitPrice)
    .input('vatTotal', sql.Float, vatTotal)
    .input('priceNotIncludedVat', sql.Float, priceNotIncludedVat)
    .input('amountNotIncludedVat', sql.Float, amountNotIncludedVat)
    .input('totalAmount', sql.Float, totalAmount)
    .query(`
      INSERT INTO CART_ITEMS (
        CART_ID, PRODUCT_ID, QUANTITY, PRICE, DISCOUNT_RATE, DISCOUNTED_PRICE,
        VAT_RATE, VAT_UNITPRICE, VAT_TOTAL, PRICE_NOTINCLUDED_VAT,
        AMOUNT_NOTINCLUDED_VAT, TOTAL_AMOUNT
      )
      VALUES (
        @cartId, @productId, @quantity, @price, @discountRate, @discountedPrice,
        @vatRate, @vatUnitPrice, @vatTotal, @priceNotIncludedVat,
        @amountNotIncludedVat, @totalAmount
      )
    `);

  return "Ürün sepete başarıyla eklendi.";
}

module.exports = { addCartItemService };
