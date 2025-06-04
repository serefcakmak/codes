const sql = require('mssql');
const { formatNumber } = require('../../utils');
const graphClient = require('../../config/graphClient');
const config = require('../../config/db');

async function handlePriceQuery(from, subject, currency, code, msgId) {
  console.log(`💰 Kur sorgusu: ${currency} ${code}`);

  const colMap = {
    TL: 'SFIYAT1',
    USD: 'SFIYAT4',
    EUR: 'SFIYAT5',
  };

  const column = colMap[currency.toUpperCase()];
  if (!column) {
    console.warn('❗ Geçersiz para birimi:', currency);
    return;
  }

  await sql.connect(config);
  const qr = await new sql.Request()
    .input('code', sql.VarChar, code)
    .query(`SELECT ${column} AS price FROM SKART WHERE KOD = @code`);

  const price = qr.recordset[0]?.price || 0;
  const formatted = formatNumber(price);

  await graphClient.api(`/users/${process.env.WATCH_EMAIL}/sendMail`).post({
    message: {
      subject: `Re: ${subject}`,
      toRecipients: [{ emailAddress: { address: from } }],
      body: {
        contentType: 'html',
        content: `
          <div>Merhaba,</div>
          <p><strong>${code}</strong> kodlu ürünün ${currency} fiyatı: <strong>${formatted}</strong> ${currency}</p>
          <p>İyi çalışmalar!</p>
        `,
      },
    },
  });

  await graphClient.api(`/users/${process.env.WATCH_EMAIL}/messages/${msgId}`).patch({ isRead: true });
  console.log('✅ Kur bilgisi gönderildi.');
}

module.exports = handlePriceQuery;
