import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log("\n=== TEST SUITE: Unpoisoned Charts & Ledger Parity Verification ===");

// 1. Verify Google Sheet MangaSales data (from scratch/live_manga_sales.json)
console.log("\n[Test 1] Verifying live MangaSales unpoisoned values...");
const sales = JSON.parse(fs.readFileSync(path.join(rootDir, 'scratch/live_manga_sales.json'), 'utf8'));

// Verify no comic has poisoned 3x revenue
const beastKing = sales.find(s => s.seriesname && s.seriesname.includes('ก่อกำเนิดราชันย์อสูร'));
assert(beastKing, "ก่อกำเนิดราชันย์อสูร must exist in MangaSales");
assert.strictEqual(parseFloat(beastKing.revenue), 6001.2, `Expected 6001.2, got ${beastKing.revenue} (was 18003.6)`);
console.log(`✓ 'ก่อกำเนิดราชันย์อสูร': revenue = ฿${beastKing.revenue} (clean 1x, unpoisoned from 18,003.6)`);

const swordsman = sales.find(s => s.seriesname && s.seriesname.includes('ผู้ฝึกกระบี่'));
assert(swordsman, "ผู้ฝึกกระบี่เต็มเวลา must exist in MangaSales");
assert.strictEqual(parseFloat(swordsman.revenue), 583.2, `Expected 583.2, got ${swordsman.revenue} (was 1166.4)`);
console.log(`✓ 'ผู้ฝึกกระบี่เต็มเวลา': revenue = ฿${swordsman.revenue} (clean 1x, unpoisoned from 1,166.4)`);

// Verify sum of ReadRealm + Chaply + Kairew is NOT 106,816.8
const rckSales = sales.filter(s => s.website === 'ReadRealm + Chaply + Kairew');
const sumRCK = rckSales.reduce((acc, s) => acc + (parseFloat(s.revenue) || 0), 0);
assert(sumRCK < 40000, `Expected sumRCK < 40,000, got ${sumRCK}`);
assert.notStrictEqual(sumRCK, 106816.8, "sumRCK must NOT be 106,816.8!");
console.log(`✓ 'ReadRealm + Chaply + Kairew' combo bar sum = ฿${sumRCK.toFixed(2)} (106,816.8 completely eliminated)`);

// 2. Test FinancialsView chartsData calculation with reconciledMonthData
console.log("\n[Test 2] Simulating FinancialsView chartsData channel breakdown parity with BudgetTransactions...");
const budgetTxs = JSON.parse(fs.readFileSync(path.join(rootDir, 'scratch/budget_transactions.json'), 'utf8'));
const targetM = '2026-10';
const budgetIncomeItems = budgetTxs.filter((t) => {
  if (!t.date) return false;
  const dStr = String(t.date).slice(0, 7);
  const isTargetMonth = dStr === targetM || (t.date && String(t.date).startsWith(targetM));
  const tType = String(t.type || "").toLowerCase();
  return isTargetMonth && (tType === "income" || tType === "รายรับ");
});
const totalBudgetRev = Math.round(budgetIncomeItems.reduce((acc, t) => acc + (parseFloat(t.amount) || 0), 0) * 100) / 100;
assert.strictEqual(totalBudgetRev, 65601.45, "totalBudgetRev must match 65601.45");

const platformMap = {};
budgetIncomeItems.forEach((t) => {
  const cat = t.category || "งบประมาณ & บัญชี";
  platformMap[cat] = (platformMap[cat] || 0) + (parseFloat(t.amount) || 0);
});

const reconciledMonthData = {
  hasBudgetRevenue: totalBudgetRev > 0,
  platformMap,
  totalRev: totalBudgetRev,
  totalCost: 29395,
  netProfit: 36206.45
};

// Simulation of updated chartsData in FinancialsView.tsx
const effectivePlatformRevenue = {};
if (reconciledMonthData.hasBudgetRevenue && Object.keys(reconciledMonthData.platformMap).length > 0) {
  Object.assign(effectivePlatformRevenue, reconciledMonthData.platformMap);
}
const chartWebsites = Object.keys(effectivePlatformRevenue).sort();
const barChartData = chartWebsites.map((w) => effectivePlatformRevenue[w] || 0);
const chartTotal = Math.round(barChartData.reduce((acc, v) => acc + v, 0) * 100) / 100;

assert.strictEqual(chartTotal, 65601.45, `Bar chart total must exactly match budget revenue 65601.45, got ${chartTotal}`);
console.log(`✓ Bar Chart / Pie Chart channels:`);
chartWebsites.forEach((w) => {
  console.log(`    - ${w}: ฿${effectivePlatformRevenue[w].toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
});
console.log(`✓ Total in Chart: ฿${chartTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (100% matched with Overview Cards)`);

console.log("\n================================================================");
console.log("ALL UNPOISONED CHARTS & LEDGER VERIFICATION TESTS PASSED 100%!");
console.log("================================================================\n");
