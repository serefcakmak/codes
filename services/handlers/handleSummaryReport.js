const { generateSummaryPdf } = require('../../services/pdfService');
const { graphClient } = require('../../config/graphClient');

async function handleSummaryReport(from, subject, msgId) {
  console.log('📄 Özet Rapor isteği alındı');
  const pdfBuffer = await generateSummaryPdf();
  const pdfBase64 = pdfBuffer.toString('base64');

  await graphClient.api(`/users/${process.env.WATCH_EMAIL}/sendMail`).post({
    message: {
      subject: `Re: ${subject}`,
      toRecipients: [{ emailAddress: { address: from } }],
      body: {
        contentType: 'html',
        content: '<p>Merhaba,</p><p>İstediğiniz özet rapor ekte gönderilmiştir.</p><p>İyi çalışmalar!</p>'
      },
      attachments: [
        {
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: 'OzetRapor.pdf',
          contentBytes: pdfBase64,
          contentType: 'application/pdf'
        }
      ]
    }
  });

  await graphClient.api(`/users/${process.env.WATCH_EMAIL}/messages/${msgId}`).patch({ isRead: true });
  console.log('✅ Özet rapor gönderildi.');
}

module.exports = { handleSummaryReport };
