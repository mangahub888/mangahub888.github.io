import assert from 'assert';
import fs from 'fs';
import path from 'path';

console.log('--- TEST SUITE: Verify Multi-Platform Monthly Sales & Tooltip Integrity ---');

// 1. Test dataset in frontend/src/data/grouped_matched_comics.json
console.log('\n[Test 1] Verifying grouped_matched_comics.json has monthly_sales for all 3 platforms...');
const groupedPath = path.resolve('frontend/src/data/grouped_matched_comics.json');
const grouped = JSON.parse(fs.readFileSync(groupedPath, 'utf8'));

const schoolComic = grouped.find(c => c.title && (c.title.includes('ดาวโรงเรียน') || c.title.includes('ไล่ออก')));
assert(schoolComic, 'Target comic "หลังจากโดนดาวโรงเรียนทิ้ง ฉันก็ได้บรรลุวิถียุทธ์" must exist in grouped_matched_comics.json');
assert(schoolComic.readrealm?.monthly_sales, 'readrealm must have monthly_sales');
assert(schoolComic.kairew?.monthly_sales, 'kairew must have monthly_sales');
assert(schoolComic.chaply?.monthly_sales, 'chaply must have monthly_sales');

assert.strictEqual(schoolComic.readrealm.monthly_sales['ตุลาคม'], 2323.8, 'ReadRealm October sales must be 2,323.80 ฿');
assert.strictEqual(schoolComic.kairew.monthly_sales['ตุลาคม'], 0, 'Kairew October sales must be 0.00 ฿');
assert.strictEqual(schoolComic.chaply.monthly_sales['ตุลาคม'], 0, 'Chaply October sales must be 0.00 ฿');
console.log('✓ Grouped dataset confirmed: RR = ฿2,323.80, KW = ฿0.00, CH = ฿0.00 for October');

// 2. Test Tooltip resolution logic for October 2026
console.log('\n[Test 2] Simulating FinancialsView P&L Tooltip calculation for October 2026...');
const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

function resolveTooltipBreakdown(sale, platBreakdown) {
  let rowMonth = "";
  if (sale.month) {
    const mMatch = String(sale.month).match(/^(\d{4}-\d{2})/);
    if (mMatch) rowMonth = mMatch[1];
  }
  if (!rowMonth && sale.date) {
    const dMatch = String(sale.date).match(/^(\d{4}-\d{2})/);
    if (dMatch) rowMonth = dMatch[1];
  }

  let rowThaiMonth = "";
  let rowMonthLabel = "";
  if (rowMonth) {
    const [yP, mP] = rowMonth.split("-");
    const mIdx = parseInt(mP, 10) - 1;
    if (mIdx >= 0 && mIdx < 12) {
      rowThaiMonth = THAI_MONTHS[mIdx];
      rowMonthLabel = `${rowThaiMonth} ${parseInt(yP, 10) + 543}`;
    }
  }

  const rrExists = Boolean(platBreakdown.readrealm);
  const kwExists = Boolean(platBreakdown.kairew);
  const chExists = Boolean(platBreakdown.chaply);

  const rrLifetime = platBreakdown.readrealm?.sales || 0;
  const krLifetime = platBreakdown.kairew?.sales || 0;
  const chLifetime = platBreakdown.chaply?.sales || 0;

  const rrMonthlyMap = platBreakdown.readrealm?.monthly_sales;
  const isRrExact = Boolean(rowThaiMonth && rrMonthlyMap && typeof rrMonthlyMap[rowThaiMonth] === "number");
  const rrMonthSales = isRrExact ? Number(rrMonthlyMap[rowThaiMonth]) : 0;

  const krMonthlyMap = platBreakdown.kairew?.monthly_sales;
  const isKrExact = Boolean(rowThaiMonth && krMonthlyMap && typeof krMonthlyMap[rowThaiMonth] === "number");
  const krMonthSales = isKrExact ? Number(krMonthlyMap[rowThaiMonth]) : 0;

  const chMonthlyMap = platBreakdown.chaply?.monthly_sales;
  const isChExact = Boolean(rowThaiMonth && chMonthlyMap && typeof chMonthlyMap[rowThaiMonth] === "number");
  const chMonthSales = isChExact ? Number(chMonthlyMap[rowThaiMonth]) : 0;

  const rev = parseFloat(sale.revenue) || 0;
  let rrSaleAmt = 0;
  let krSaleAmt = 0;
  let chSaleAmt = 0;

  if (rev <= 0) {
    rrSaleAmt = 0;
    krSaleAmt = 0;
    chSaleAmt = 0;
  } else if (isRrExact || isKrExact || isChExact) {
    rrSaleAmt = rrExists ? rrMonthSales : 0;
    krSaleAmt = kwExists ? krMonthSales : 0;
    chSaleAmt = chExists ? chMonthSales : 0;

    const knownSum = Math.round((rrSaleAmt + krSaleAmt + chSaleAmt) * 100) / 100;
    if (rev > knownSum) {
      const remainder = Math.round((rev - knownSum) * 100) / 100;
      const availKw = (!isKrExact && kwExists) ? Math.max(0, krLifetime - krSaleAmt) : 0;
      const availCh = (!isChExact && chExists) ? Math.max(0, chLifetime - chSaleAmt) : 0;
      const availTot = availKw + availCh;
      if (availTot > 0) {
        const allocKw = Math.min(availKw, Math.round((remainder * (availKw / availTot)) * 100) / 100);
        const allocCh = Math.min(availCh, Math.round((remainder - allocKw) * 100) / 100);
        krSaleAmt += allocKw;
        chSaleAmt += allocCh;
      } else if (!isRrExact && rrExists) {
        rrSaleAmt += remainder;
      }
    }
  }

  return {
    rowMonthLabel,
    isRrExact,
    isKrExact,
    isChExact,
    rrSaleAmt,
    krSaleAmt,
    chSaleAmt,
    total: rrSaleAmt + krSaleAmt + chSaleAmt
  };
}

const mockOctSale = {
  seriesname: schoolComic.title,
  month: "2026-10",
  date: "2026-10-31",
  revenue: "2323.8"
};

const breakdown = resolveTooltipBreakdown(mockOctSale, schoolComic);
console.log('Simulation Results for October 2026:');
console.log('- Month Label:', breakdown.rowMonthLabel);
console.log('- ReadRealm:', breakdown.rrSaleAmt, '฿ (Exact:', breakdown.isRrExact, ')');
console.log('- Kairew:', breakdown.krSaleAmt, '฿ (Exact:', breakdown.isKrExact, ')');
console.log('- Chaply:', breakdown.chSaleAmt, '฿ (Exact:', breakdown.isChExact, ')');
console.log('- Tooltip Total:', breakdown.total, '฿');

assert.strictEqual(breakdown.rowMonthLabel, 'ตุลาคม 2569');
assert.strictEqual(breakdown.rrSaleAmt, 2323.8, 'ReadRealm monthly sales must match October 2,323.80 ฿');
assert.strictEqual(breakdown.krSaleAmt, 0, 'Kairew monthly sales must be strictly 0.00 ฿ (NO 129,301.73!)');
assert.strictEqual(breakdown.chSaleAmt, 0, 'Chaply monthly sales must be strictly 0.00 ฿ (NO 1,862.47!)');
assert.strictEqual(breakdown.total, 2323.8, 'Total revenue for October must be 2,323.80 ฿');
assert(breakdown.krSaleAmt < 1000, 'Kairew must NOT be lifetime total!');
assert(breakdown.chSaleAmt < 1000, 'Chaply must NOT be lifetime total!');

console.log('\n[Test 3] Testing case where month is ISO format "2026-10-31T17:00:00.000Z"...');
const mockIsoSale = {
  seriesname: schoolComic.title,
  month: "2026-10-31T17:00:00.000Z",
  date: "2026-11-30T00:00:00.000Z",
  revenue: "2323.8"
};
const isoBreakdown = resolveTooltipBreakdown(mockIsoSale, schoolComic);
assert.strictEqual(isoBreakdown.rowMonthLabel, 'ตุลาคม 2569', 'ISO month timestamp must parse to October 2569, not fall back to November date!');
assert.strictEqual(isoBreakdown.rrSaleAmt, 2323.8);
assert.strictEqual(isoBreakdown.krSaleAmt, 0);
assert.strictEqual(isoBreakdown.chSaleAmt, 0);
console.log('✓ ISO timestamp successfully parsed to October 2569 without falling back to November!');

console.log('\n✅ ALL VERIFICATION TESTS PASSED 100%');
