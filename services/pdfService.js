// /services/pdfService.js

const PDFDocument = require('pdfkit');
const path = require('path');

async function generateSummaryPdf() {
  const [weeklyRes, monthlyRes, top10Res] = await Promise.all([
    fetch('http://192.168.30.4:3001/api/orders-daily'),
    fetch('http://192.168.30.4:3001/api/monthly-summary?year=' + new Date().getFullYear()),
    fetch('http://192.168.30.4:3001/api/top10-customer-performance'),
  ]);

  const weeklyData = await weeklyRes.json();
  const { data: monthlyData } = await monthlyRes.json();
  const { data: top10Data } = await top10Res.json();

  const doc = new PDFDocument({ size: 'A4', margin: 30 });
  const buffers = [];

  doc.on('data', buffers.push.bind(buffers));
  doc.on('end', () => {});

  const fontPath = path.join(__dirname, '..', 'assets', 'fonts', 'NotoSans-Regular.ttf');
  doc.registerFont('TurkceFont', fontPath);
  doc.font('TurkceFont');

  doc.fontSize(22).text('Özet Rapor', { align: 'center' }).moveDown();

  const weekDays = ["PAZARTESİ", "SALI", "ÇARŞAMBA", "PERŞEMBE", "CUMA", "CUMARTESİ", "PAZAR"];
  doc.fontSize(16).text('Haftalık Sipariş / Teklif', { underline: true }).moveDown(0.5);
  weekDays.forEach(gun => {
    const sip = weeklyData.filter(o => o.GUN === gun && o.TIP === 'SIPARIS').reduce((s, o) => s + o.TOPLAM_SIPARIS, 0);
    const tek = weeklyData.filter(o => o.GUN === gun && o.TIP === 'TEKLIF').reduce((s, o) => s + o.TOPLAM_SIPARIS, 0);
    doc.fontSize(12).text(`${gun.padEnd(10)} | Sipariş: ${sip.toLocaleString('tr-TR', { style: 'currency', currency: 'USD' })} | Teklif: ${tek.toLocaleString('tr-TR', { style: 'currency', currency: 'USD' })}`);
  });
  doc.moveDown();

  doc.fontSize(16).text('Aylık Sipariş Performansı', { underline: true }).moveDown(0.5);
  monthlyData.forEach(item => {
    const changePct = item.ONCEKI_TOPLAM && item.ONCEKI_TOPLAM > 0
      ? ((item.TOPLAM - item.ONCEKI_TOPLAM) / item.ONCEKI_TOPLAM * 100).toFixed(1) + '%'
      : 'N/A';
    doc.fontSize(12).text(
      `${item.AY.padEnd(9)} | Dekor: ${Number(item.DEKOR).toLocaleString('tr-TR', { style: 'currency', currency: 'USD' })}` +
      ` | Deri: ${Number(item.DERI).toLocaleString('tr-TR', { style: 'currency', currency: 'USD' })}` +
      ` | Diğer: ${Number(item.DIGER).toLocaleString('tr-TR', { style: 'currency', currency: 'USD' })}` +
      ` | Toplam: ${Number(item.TOPLAM).toLocaleString('tr-TR', { style: 'currency', currency: 'USD' })}` +
      ` | Değişim: ${changePct}`
    );
  });
  doc.moveDown();

  doc.fontSize(16).text('Top 10 Müşteri Performansı (Sipariş)', { underline: true }).moveDown(0.5);
  const groups = top10Data.reduce((acc, o) => {
    (acc[o.SATISGRUP] = acc[o.SATISGRUP] || []).push(o);
    return acc;
  }, {});
  Object.entries(groups).forEach(([grp, items]) => {
    doc.fontSize(14).text(`— ${grp} —`).moveDown(0.2);
    items.forEach(i => {
      const ratio = i.CurrentYearTotal > 0
        ? ((i.CurrentYearTotal / items.reduce((s, o) => s + o.CurrentYearTotal, 0)) * 100).toFixed(1) + '%'
        : 'N/A';
      doc.fontSize(12).text(
        `${i.ADI.padEnd(20)} | Ö.Yıl: ${Number(i.PrevYearTotal).toLocaleString('tr-TR', { style: 'currency', currency: 'USD' })}` +
        ` | Bu Yıl: ${Number(i.CurrentYearTotal).toLocaleString('tr-TR', { style: 'currency', currency: 'USD' })}` +
        ` | Oran: ${ratio}`
      );
    });
    doc.moveDown(0.5);
  });

  doc.end();
  return new Promise(resolve => {
    doc.on('end', () => resolve(Buffer.concat(buffers)));
  });
}

module.exports = { generateSummaryPdf };
