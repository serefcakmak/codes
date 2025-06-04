const express = require('express');
const router = express.Router();
const sql = require('mssql');
const config = require('../config/db');

const customOrder = [
  "MOBILYALAR", "DUVAR DEKOR GRUBU", "AYDINLATMA", "ZEMIN URUNLERI",
  "ISLENMIS BUYUK BASLAR", "EV TEKSTILI", "EV AKSESUARLARI",
  "CANTA VE CUZDANLAR", "GÖZLÜK,TELEFON,IPAD KILIFLARI", "KUCUK KISISEL URUNLER",
  "DERI KRUPONLAR", "DERI KARTELALAR", "YARDIMCI URETIM MALZEMESI", "DIGER"
];

//Ürünler Özet Model raporu
router.get('/ozet-model-report', async (req, res) => {
  try {
    const customOrder = [
      "MOBILYALAR",
      "DUVAR DEKOR GRUBU",
      "AYDINLATMA",
      "ZEMIN URUNLERI",
      "ISLENMIS BUYUK BASLAR",
      "EV TEKSTILI",
      "EV AKSESUARLARI",
      "CANTA VE CUZDANLAR",
      "GÖZLÜK,TELEFON,IPAD KILIFLARI",
      "KUCUK KISISEL URUNLER",
      "DERI KRUPONLAR",
      "DERI KARTELALAR",
      "YARDIMCI URETIM MALZEMESI",
      "DIGER"
    ];

    const homQuery = `
      SELECT BASAMAK2, BASAMAK4, MODEL, SUM(HOM) AS HomKodSayisi
      FROM SKART_OZELLIK
      WHERE HOM <> 0
      GROUP BY BASAMAK2, BASAMAK4, MODEL
    `;
    const homResult = await sql.query(homQuery);
    const homData = homResult.recordset;

    const cartQuery = `
      SELECT        sa.BASAMAK2, sa.BASAMAK4, SKART_MODEL.ADI AS MODEL, sum(ci.QUANTITY) AS KonseptProductCount
FROM            CART_ITEMS AS ci INNER JOIN
                         CART AS c ON ci.CART_ID = c.ID INNER JOIN
                         SKART AS s ON ci.PRODUCT_ID = s.KOD INNER JOIN
                         SKARTAGACBUL AS sa ON s.OZEL1 = sa.KOD LEFT OUTER JOIN
                         SKART_MODEL ON s.OZEL2 = SKART_MODEL.KOD
WHERE        (c.CONSEPT = 1) AND (c.CUSTOMER_NAME <> 'FUAR 2025')
GROUP BY sa.BASAMAK2, sa.BASAMAK4, SKART_MODEL.ADI
    `;
    const cartResult = await sql.query(cartQuery);
    const cartData = cartResult.recordset;

    const mergedData = homData.map(item => {
      const match = cartData.find(c =>
        c.BASAMAK2 === item.BASAMAK2 &&
        c.BASAMAK4 === item.BASAMAK4 &&
        (c.MODEL || '') === (item.MODEL || '')
      );
      const konseptCount = match ? match.KonseptProductCount : 0;
      const ratio = item.HomKodSayisi > 0
        ? ((konseptCount / item.HomKodSayisi) * 100).toFixed(2) + '%'
        : '0%';

      return {
        BASAMAK2: item.BASAMAK2 || "DIGER",
        BASAMAK4: item.BASAMAK4 || "DIGER",
        MODEL: item.MODEL || "",
        HomKodSayisi: item.HomKodSayisi,
        KonseptProductCount: konseptCount,
        Ratio: ratio
      };
    });

    // ? customOrderBasamak sırasına göre sıralıyoruz
    const orderedData = mergedData.sort((a, b) => {
      const aIndex = customOrder.indexOf(a.BASAMAK2 || "DIGER");
      const bIndex = customOrder.indexOf(b.BASAMAK2 || "DIGER");
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return (a.BASAMAK2 || "").localeCompare(b.BASAMAK2 || "", 'tr');
    });

    res.json({ success: true, data: orderedData });
  } catch (err) {
    console.error("Model bazlı özet raporu oluşturulurken hata:", err);
    res.status(500).json({ success: false, message: "Rapor oluşturulurken hata oluştu." });
  }
});

//Ürünler Özet Model raporu
router.get('/detay-model-report', async (req, res) => {
  try {
    const customOrder = [
      "MOBILYALAR",
      "DUVAR DEKOR GRUBU",
      "AYDINLATMA",
      "ZEMIN URUNLERI",
      "ISLENMIS BUYUK BASLAR",
      "EV TEKSTILI",
      "EV AKSESUARLARI",
      "CANTA VE CUZDANLAR",
      "GÖZLÜK,TELEFON,IPAD KILIFLARI",
      "KUCUK KISISEL URUNLER",
      "DERI KRUPONLAR",
      "DERI KARTELALAR",
      "YARDIMCI URETIM MALZEMESI",
      "DIGER"
    ];

    const homQuery = `
      SELECT BASAMAK2, BASAMAK4, MODEL,KOD,SFIYAT1,SFIYAT4, HOM AS HomKodSayisi
      FROM SKART_OZELLIK
      WHERE HOM <> 0
    `;
    const homResult = await sql.query(homQuery);
    const homData = homResult.recordset;

    const cartQuery = `
      SELECT        sa.BASAMAK2, sa.BASAMAK4, SKART_MODEL.ADI AS MODEL,ci.PRODUCT_ID as KOD, sum(ci.QUANTITY) AS KonseptProductCount, s.SFIYAT1, s.SFIYAT4
FROM            CART_ITEMS AS ci INNER JOIN
                         CART AS c ON ci.CART_ID = c.ID INNER JOIN
                         SKART AS s ON ci.PRODUCT_ID = s.KOD INNER JOIN
                         SKARTAGACBUL AS sa ON s.OZEL1 = sa.KOD LEFT OUTER JOIN
                         SKART_MODEL ON s.OZEL2 = SKART_MODEL.KOD
WHERE        (c.CONSEPT = 1) AND (c.CUSTOMER_NAME <> 'FUAR 2025')
GROUP BY sa.BASAMAK2, sa.BASAMAK4, SKART_MODEL.ADI, ci.PRODUCT_ID, s.SFIYAT1, s.SFIYAT4
    `;
    const cartResult = await sql.query(cartQuery);
    const cartData = cartResult.recordset;

    const mergedData = homData.map(item => {
      const match = cartData.find(c =>
        c.BASAMAK2 === item.BASAMAK2 &&
        c.BASAMAK4 === item.BASAMAK4 &&
		c.KOD === item.KOD &&
		c.SFIYAT1 === item.SFIYAT1 &&
        (c.MODEL || '') === (item.MODEL || '')
      );
      const konseptCount = match ? match.KonseptProductCount : 0;
	  const PRKTL = item.SFIYAT1;
      const ratio = item.HomKodSayisi > 0
        ? ((konseptCount / item.HomKodSayisi) * 100).toFixed(2) + '%'
        : '0%';

      return {
        BASAMAK2: item.BASAMAK2 || "DIGER",
        BASAMAK4: item.BASAMAK4 || "DIGER",
        MODEL: item.MODEL || "",
		KOD: item.KOD,
		PRKTL: item.SFIYAT1,
		PRKUSD: item.SFIYAT4,
        HomKodSayisi: item.HomKodSayisi,
        KonseptProductCount: konseptCount,
        Ratio: ratio
      };
    });

    // Yardımcı fonksiyon: customOrder dizisinde bulunmayan veya "DIGER" ise yüksek indeks döndürür.
	const getOrderIndex = (value, orderArray) => {
	  // Eğer değer "DIGER" ise, en son sıralanması için Infinity döndür.
	  if (value === "DIGER") return Infinity;
	  const idx = orderArray.indexOf(value);
	  return idx === -1 ? Infinity : idx;
	};

	const orderedData = mergedData.sort((a, b) => {
	  // BASAMAK2 için customOrder sıralaması. "DIGER" veya dizide bulunmayanlar Infinity döner.
	  const aIndex = getOrderIndex(a.BASAMAK2 || "", customOrder);
	  const bIndex = getOrderIndex(b.BASAMAK2 || "", customOrder);
	  if (aIndex < bIndex) return -1;
	  if (aIndex > bIndex) return 1;
	  
	  // BASAMAK2 aynı ise, BASAMAK4'e göre sıralama (alfabetik)
	  const cmpB4 = (a.BASAMAK4 || "").localeCompare(b.BASAMAK4 || "", "tr", { sensitivity: "base" });
	  if (cmpB4 !== 0) return cmpB4;
	  
	  // Eğer BASAMAK4 aynı ise, MODEL'e göre sıralama (alfabetik)
	  const cmpModel = (a.MODEL || "").localeCompare(b.MODEL || "", "tr", { sensitivity: "base" });
	  if (cmpModel !== 0) return cmpModel;
	  
	  // MODEL de aynı ise, KOD'a göre sıralama (alfabetik)
	  return (a.KOD || "").localeCompare(b.KOD || "", "tr", { sensitivity: "base" });
	});


    res.json({ success: true, data: orderedData });
  } catch (err) {
    console.error("Model bazlı özet raporu oluşturulurken hata:", err);
    res.status(500).json({ success: false, message: "Rapor oluşturulurken hata oluştu." });
  }
});

//Ürünler Özet raporu
router.get('/ozet-report', async (req, res) => {
  try {
	const customOrder = [
      "MOBILYALAR",
      "DUVAR DEKOR GRUBU",
      "AYDINLATMA",
      "ZEMIN URUNLERI",
      "ISLENMIS BUYUK BASLAR",
      "EV TEKSTILI",
      "EV AKSESUARLARI",
      "CANTA VE CUZDANLAR",
      "GÖZLÜK,TELEFON,IPAD KILIFLARI",
      "KUCUK KISISEL URUNLER",
      "DERI KRUPONLAR",
      "DERI KARTELALAR",
      "YARDIMCI URETIM MALZEMESI",
      "DIGER"
    ];
    // SKART_OZELLIK sorgusu: HOM > 0, BASAMAK2 ve BASAMAK4'e göre benzersiz KOD sayısı
    const homQuery = `
      SELECT BASAMAK2, BASAMAK4, SUM(HOM) AS HomKodSayisi
      FROM SKART_OZELLIK
      WHERE HOM <> 0
      GROUP BY BASAMAK2, BASAMAK4
	  ORDER BY BASAMAK2, BASAMAK4
    `;
    const homResult = await sql.query(homQuery);
    const homData = homResult.recordset; // Örnek: [{ BASAMAK2: 'A', BASAMAK4: 'X', HomKodSayisi: 10 }, ...]

    // CART_ITEMS, CART ve SKART_OZELLIK join sorgusu:
    // - CART_ITEMS tablosundaki CART_ID, CART tablosundaki ID ile eşleşiyor
    // - Sadece CART tablosunda CONSEPT = 1 olanlar alınıyor
    // - SKART_OZELLIK tablosundan BASAMAK2, BASAMAK4 alanlarını almak için, PRODUCT_ID ile KOD eşleştiriliyor.
    const cartQuery = `
		SELECT        sa.BASAMAK2, sa.BASAMAK4,  sum(ci.QUANTITY) AS KonseptProductCount
		FROM            CART_ITEMS AS ci INNER JOIN
								 CART AS c ON ci.CART_ID = c.ID INNER JOIN
								 SKART AS s ON ci.PRODUCT_ID = s.KOD INNER JOIN
								 SKARTAGACBUL AS sa ON s.OZEL1 = sa.KOD LEFT OUTER JOIN
								 SKART_MODEL ON s.OZEL2 = SKART_MODEL.KOD
		WHERE        (c.CONSEPT = 1) AND (c.CUSTOMER_NAME <> 'FUAR 2025')
		GROUP BY sa.BASAMAK2, sa.BASAMAK4
    `;
    const cartResult = await sql.query(cartQuery);
    const cartData = cartResult.recordset; // Örnek: [{ BASAMAK2: 'A', BASAMAK4: 'X', KonseptProductCount: 5 }, ...]

    // İki veri setini BASAMAK2 ve BASAMAK4'e göre birleştirelim:
    const mergedData = homData.map(item => {
      const cartItem = cartData.find(c => c.BASAMAK2 === item.BASAMAK2 && c.BASAMAK4 === item.BASAMAK4);
      const konpCount = cartItem ? cartItem.KonseptProductCount : 0;
      const ratio = item.HomKodSayisi > 0 ? ((konpCount / item.HomKodSayisi) * 100).toFixed(2) + '%' : '0%';
      return {
        BASAMAK2: item.BASAMAK2,
        BASAMAK4: item.BASAMAK4,
        HomKodSayisi: item.HomKodSayisi,
        KonseptProductCount: konpCount,
        Ratio: ratio
      };
    });
	// ? customOrderBasamak sırasına göre sıralıyoruz
    const orderedData = mergedData.sort((a, b) => {
      const aIndex = customOrder.indexOf(a.BASAMAK2 || "DIGER");
      const bIndex = customOrder.indexOf(b.BASAMAK2 || "DIGER");
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return (a.BASAMAK2 || "").localeCompare(b.BASAMAK2 || "", 'tr');
    });

    res.json({ success: true, data: mergedData });
  } catch (err) {
    console.error("Özet raporu oluşturulurken hata:", err);
    res.status(500).json({ success: false, message: "Özet raporu oluşturulurken hata oluştu." });
  }
});

// Ürünler Detay Model raporunda Karttaki konsept detay raporu: Belirli bir ürün kodu (PRODUCT_ID) için,
// CART tablosunda CUSTOMER_NAME içerisinde "FUAR 2025" içermeyen müşterileri getirir.
router.get('/kod-konsept-detay', async (req, res) => {
  try {
    const { kod } = req.query;
    if (!kod) {
      return res.status(400).json({ success: false, message: "KOD parametresi gerekli" });
    }

    const query = `
      SELECT DISTINCT c.CUSTOMER_NAME
      FROM CART_ITEMS ci
      INNER JOIN CART c ON ci.CART_ID = c.ID
      WHERE ci.PRODUCT_ID = @kod
        AND c.CUSTOMER_NAME NOT LIKE '%FUAR 2025%' and c.CONSEPT=1
    `;

    // Örnek olarak mssql modülünü kullanıyorsanız:
    const request = new sql.Request();
    request.input('kod', sql.VarChar, kod);
    const result = await request.query(query);

    res.json({ success: true, data: result.recordset });
  } catch (err) {
    console.error("KOD detay raporu oluşturulurken hata:", err);
    res.status(500).json({ success: false, message: "Detay raporu oluşturulurken hata oluştu." });
  }
});



module.exports = router;
