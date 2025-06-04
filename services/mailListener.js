const cron = require('node-cron');
const { loadAllowedSenders } = require('../utils');
const graphClient = require('../config/graphClient');

// Handler'lar
const handleModelQuery = require('./handlers/handleModelQuery');
const handleMultiCodeQuery = require('./handlers/handleMultiCodeQuery');
const handlePriceQuery = require('./handlers/handlePriceQuery');
const { handleCollectionUpdate } = require('./handlers/handleCollectionUpdate');
const { handleSummaryReport } = require('./handlers/handleSummaryReport');

// Ana mail dinleyici fonksiyonu
function startMailListener() {
  cron.schedule('*/1 * * * *', async () => {
    console.log('🔄 Cron tetiklendi');
    const rawSenders = await loadAllowedSenders();
    const allowedSenders = Array.isArray(rawSenders) ? rawSenders : [];

    try {
      const res = await graphClient
        .api(`/users/${process.env.WATCH_EMAIL}/mailFolders/Inbox/messages`)
        .filter('isRead eq false')
        .select('id,subject,from')
        .top(10)
        .get();

      for (let msg of res.value) {
        const fromAddr = msg.from.emailAddress.address.toLowerCase();
        const rawSubject = msg.subject.trim();
        const norm = rawSubject.replace(/İ/g, 'i').replace(/ı/g, 'i').toLowerCase();

        // 0) Özet Rapor
        if (norm.includes('ozet rapor')) {
          await handleSummaryReport(fromAddr, rawSubject, msg.id);
          continue;
        }

        // 1) Model Sorgu
        const modelMatch = norm.match(/^model\s*:\s*(.+)$/);
        if (modelMatch) {
          await handleModelQuery(fromAddr, rawSubject, modelMatch[1], msg.id);
          continue;
        }

        // 2) Çoklu Kod Sorgu
        const multiMatch = norm.match(/^kod\s*:\s*(.+)$/);
        if (multiMatch) {
          await handleMultiCodeQuery(fromAddr, rawSubject, multiMatch[1], msg.id);
          continue;
        }

        // 3) Tek Kur Sorgu
        const singleMatch = rawSubject.match(/^(TL|USD|EUR)\s*:\s*(.+)$/i);
        if (singleMatch) {
          await handlePriceQuery(fromAddr, rawSubject, singleMatch[1], singleMatch[2], msg.id);
          continue;
        }

        // 4) Geniş Koleksiyon Güncelleme
        if (allowedSenders.includes(fromAddr)) {
          if (rawSubject.startsWith('Genis Koleksiyon:')) {
            await handleCollectionUpdate(fromAddr, rawSubject, false, msg.id);
            continue;
          }
          if (rawSubject.startsWith('-Genis Koleksiyon:')) {
            await handleCollectionUpdate(fromAddr, rawSubject, true, msg.id);
            continue;
          }
        }
      }
    } catch (err) {
      console.error('❌ Mail dinleme/güncelleme hatası:', err);
    }
  });
}

module.exports = { startMailListener };
