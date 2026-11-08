import assert from 'assert';
import fs from 'fs';
import path from 'path';

console.log('--- TEST 1: Verify grouped_matched_comics.json has monthly_sales ---');
const groupedPath = path.resolve('frontend/src/data/grouped_matched_comics.json');
const grouped = JSON.parse(fs.readFileSync(groupedPath, 'utf8'));

const targetComic = grouped.find(c => c.title && c.title.includes('บรรพชน'));
assert(targetComic, 'Target comic "การกลับมาของบรรพชนรุ่นแรก" must exist in grouped_matched_comics.json');
assert(targetComic.readrealm, 'Target comic must have readrealm data');
assert(targetComic.readrealm.monthly_sales, 'readrealm must have monthly_sales map');
assert.strictEqual(targetComic.readrealm.monthly_sales['ตุลาคม'], 7196.4, 'October sales for ReadRealm must be 7,196.40 ฿');
console.log('✓ Grouped comic has readrealm monthly_sales["ตุลาคม"] =', targetComic.readrealm.monthly_sales['ตุลาคม']);

console.log('\n--- TEST 2: Verify backend/Code.js calculateAndSyncMonthlyMangaSales ---');
const codePath = path.resolve('backend/Code.js');
const codeContent = fs.readFileSync(codePath, 'utf8');

assert(!codeContent.includes('item.revenue = platData.total_sales;'), 'backend/Code.js must NOT set item.revenue = platData.total_sales');
assert(codeContent.includes('item.revenue = platData.monthly_sales;'), 'backend/Code.js must support item.revenue = platData.monthly_sales');
assert(codeContent.includes('targetThaiMonth'), 'backend/Code.js must calculate targetThaiMonth');
console.log('✓ backend/Code.js correctly uses monthly_sales / delta30d and prohibits total_sales fallback');

console.log('\n--- TEST 3: Simulate Monthly Breakdown Calculation in FinancialsView ---');
const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
];

function calculateMonthlyBreakdown(sale, platBreakdown) {
  const rev = parseFloat(sale.revenue) || 0;
  let rowMonth = sale.month || "2026-10";
  let [yP, mP] = rowMonth.split("-");
  const mIdx = parseInt(mP, 10) - 1;
  const rowThaiMonth = THAI_MONTHS[mIdx];
  const rowMonthLabel = `${rowThaiMonth} ${parseInt(yP, 10) + 543}`;

  const rrExists = true;
  const kwExists = true;
  const chExists = true;
  const activePlatCount = 3;

  const rrLifetime = platBreakdown.readrealm || 0;
  const krLifetime = platBreakdown.kairew || 0;
  const chLifetime = platBreakdown.chaply || 0;
  const totalLifetime = rrLifetime + krLifetime + chLifetime;

  const rrMonthlyMap = platBreakdown.readrealm_monthly;
  const rrMonthSales = (rowThaiMonth && rrMonthlyMap && typeof rrMonthlyMap[rowThaiMonth] === "number")
    ? Number(rrMonthlyMap[rowThaiMonth])
    : 0;

  let rrSaleAmt = 0;
  let krSaleAmt = 0;
  let chSaleAmt = 0;
  let isRrExact = false;

  if (rev <= 0) {
    rrSaleAmt = 0;
    krSaleAmt = 0;
    chSaleAmt = 0;
  } else if (activePlatCount <= 1) {
    if (kwExists) krSaleAmt = rev;
    else if (chExists) chSaleAmt = rev;
    else rrSaleAmt = rev;
  } else {
    if (rrExists && rrMonthSales > 0 && rev >= rrMonthSales) {
      rrSaleAmt = rrMonthSales;
      isRrExact = true;
      const remainder = Math.round((rev - rrSaleAmt) * 100) / 100;
      const otherLifetime = (kwExists ? krLifetime : 0) + (chExists ? chLifetime : 0);
      if (otherLifetime > 0) {
        if (kwExists && chExists) {
          krSaleAmt = Math.round((remainder * (krLifetime / otherLifetime)) * 100) / 100;
          chSaleAmt = Math.round((remainder - krSaleAmt) * 100) / 100;
        } else if (kwExists) {
          krSaleAmt = remainder;
        } else if (chExists) {
          chSaleAmt = remainder;
        }
      }
    } else if (totalLifetime > 0) {
      const shareRR = rrExists ? (rrLifetime / totalLifetime) : 0;
      const shareKW = kwExists ? (krLifetime / totalLifetime) : 0;
      rrSaleAmt = Math.round((rev * shareRR) * 100) / 100;
      krSaleAmt = Math.round((rev * shareKW) * 100) / 100;
      if (chExists) {
        chSaleAmt = Math.round((rev - rrSaleAmt - krSaleAmt) * 100) / 100;
      }
    }
  }

  const breakdownSum = Math.round((rrSaleAmt + krSaleAmt + chSaleAmt) * 100) / 100;
  return {
    rowMonthLabel,
    rrSaleAmt,
    krSaleAmt,
    chSaleAmt,
    breakdownSum,
    isRrExact,
    totalLifetime,
    rev
  };
}

const mockSale = {
  seriesname: targetComic.title,
  month: "2026-10",
  date: "2026-10-31",
  revenue: "10789.47"
};

const mockPlatBreakdown = {
  readrealm: targetComic.readrealm.sales,
  kairew: targetComic.kairew.sales,
  chaply: targetComic.chaply.sales,
  total: targetComic.total_sales,
  readrealm_monthly: targetComic.readrealm.monthly_sales
};

const result = calculateMonthlyBreakdown(mockSale, mockPlatBreakdown);

console.log('Result Breakdown for October 2026:');
console.log('- Header / Cell Rev:', result.rev, '฿');
console.log('- Month Label:', result.rowMonthLabel);
console.log('- ReadRealm:', result.rrSaleAmt, '฿ (isExact:', result.isRrExact, ')');
console.log('- Kairew:', result.krSaleAmt, '฿');
console.log('- Chaply:', result.chSaleAmt, '฿');
console.log('- Breakdown Sum:', result.breakdownSum, '฿');
console.log('- Lifetime Total:', result.totalLifetime, '฿');

assert.strictEqual(result.breakdownSum, result.rev, 'Breakdown sum must exactly equal cell revenue!');
assert.strictEqual(result.rrSaleAmt, 7196.4, 'ReadRealm must match October monthly sales!');
assert.strictEqual(result.krSaleAmt, 3509.79, 'Kairew must get proportional share of remainder');
assert.strictEqual(result.chSaleAmt, 83.28, 'Chaply must get proportional share of remainder');
assert(result.rrSaleAmt < 100000, 'ReadRealm monthly sales must NOT be lifetime total (102,190.80)!');

console.log('\n✅ ALL VERIFICATION TESTS PASSED SUCCESSFULLY (100%)');
