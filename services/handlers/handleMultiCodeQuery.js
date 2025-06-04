// handleMultiCodeQuery.js
const sql = require('mssql');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const config = require('../../config/db');
const { formatNumber } = require('../../utils');
const graphClient = require('../../config/graphClient');

async function handleMultiCodeQuery(from, subject, codeString, msgId) {
  const codes = codeString.split(',').map(c => c.trim()).filter(Boolean);
  console.log(`📦 Kod sorgusu: [${codes.join(', ')}]`);

  await sql.connect(config);
  const req = new sql.Request();
  codes.forEach((c, i) => req.input(`c${i}`, sql.VarChar, c));
  const placeholders = codes.map((_, i) => `@c${i}`).join(',');

  const qr = await req.query(`
    SELECT KOD, ADI, MODEL, EBAT,
           SFIYAT1 AS TL, SFIYAT4 AS USD, SFIYAT5 AS EUR,
           BASAMAK2 AS Kategori, BASAMAK4 AS AltKategori
    FROM SKART_OZELLIK
    WHERE KOD IN (${placeholders})
  `);
  const rows = qr.recordset;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('KodSorgu');
  ws.columns = [
    { header: 'Resim',       key: 'resim',      width: 8  },
    { header: 'Kategori',    key: 'Kategori',   width: 20 },
    { header: 'AltKategori', key: 'AltKategori',width: 20 },
    { header: 'KOD',         key: 'KOD',        width: 15 },
    { header: 'ADI',         key: 'ADI',        width: 30 },
    { header: 'MODEL',       key: 'MODEL',      width: 20 },
    { header: 'EBAT',        key: 'EBAT',       width: 15 },
    { header: 'PRK TL',      key: 'TL',         width: 12 },
    { header: 'PRK USD',     key: 'USD',        width: 12 },
    { header: 'PRK EUR',     key: 'EUR',        width: 12 }
  ];
  ws.getRow(1).height = 30;

  let rowIndex = 2;
  for (let r of rows) {
    ws.addRow({
      resim: '',
      Kategori: r.Kategori,
      AltKategori: r.AltKategori,
      KOD: r.KOD,
      ADI: r.ADI,
      MODEL: r.MODEL,
      EBAT: r.EBAT,
      TL: formatNumber(r.TL),
      USD: formatNumber(r.USD),
      EUR: formatNumber(r.EUR)
    });
    const imgPath = path.join('c:/resim', `${r.KOD}.jpg`);
    const imgFile = fs.existsSync(imgPath) ? imgPath : path.join('c:/resim', 'YOK.jpg');
    const imgId = wb.addImage({ buffer: fs.readFileSync(imgFile), extension: 'jpeg' });
    ws.addImage(imgId, {
      tl: { col: 0, row: rowIndex - 1 },
      ext: { width: 40, height: 40 }
    });
    ws.getRow(rowIndex).height = 30;
    rowIndex++;
  }

  const buffer = await wb.xlsx.writeBuffer();
  const attachment = {
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: `Kodlar_${codes.join('-')}.xlsx`,
    contentBytes: buffer.toString('base64'),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  };

  await graphClient.api(`/users/${process.env.WATCH_EMAIL}/sendMail`).post({
    message: {
      subject: `Re: ${subject}`,
      toRecipients: [{ emailAddress: { address: from } }],
      body: {
        contentType: 'html',
        content: '<p>Merhaba,</p><p>İstediğiniz kodlar ekte gönderilmiştir.</p><p>İyi çalışmalar!</p>'
      },
      attachments: [attachment]
    }
  });

  await graphClient.api(`/users/${process.env.WATCH_EMAIL}/messages/${msgId}`).patch({ isRead: true });
  console.log('✅ Çoklu kod maili gönderildi');
}

module.exports = handleMultiCodeQuery;
