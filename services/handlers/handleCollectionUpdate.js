// /handlers/handleCollectionUpdate.js
const sql = require('mssql');
const graphClient = require('../../config/graphClient');
const config = require('../../config/db');

async function handleCollectionUpdate(from, subject, isRemove, msgId) {
  const code = subject.split(':')[1]?.trim();
  const newVal = isRemove ? 'KLKS-000000' : 'KOLEKSIYON 2021';

  if (!code) {
    console.warn('❗ Koleksiyon kodu boş geldi.');
    return;
  }

  console.log(`🔁 Koleksiyon güncelleme: ${code} › ${newVal}`);

  try {
    await sql.connect(config);
    await sql.query`
      UPDATE SKART
      SET KOLEKSIYONKOD = ${newVal},
          KOLEKSIYONKOD1 = ${newVal}
      WHERE KOD = ${code}
    `;

    await graphClient.api(`/users/${process.env.WATCH_EMAIL}/sendMail`).post({
      message: {
        subject: `Re: ${subject}`,
        toRecipients: [{ emailAddress: { address: from } }],
        body: {
          contentType: 'html',
          content: `<p>Merhaba,</p><p><strong>${code}</strong> için geniş koleksiyon <strong>${newVal}</strong> olarak güncellenmiştir.</p><p>İyi çalışmalar!</p>`
        }
      }
    });

    await graphClient.api(`/users/${process.env.WATCH_EMAIL}/messages/${msgId}`).patch({ isRead: true });
    console.log('✅ Koleksiyon maili gönderildi.');
  } catch (err) {
    console.error('❌ Koleksiyon güncelleme hatası:', err);
  }
}

module.exports = { handleCollectionUpdate };
