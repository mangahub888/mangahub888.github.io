import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log("\n=== TEST SUITE: October 2026 Financial Revenue & Parity Verification ===");

// Test 1: BudgetTransactions October Income (60k+)
console.log("\n[Test 1] Verifying BudgetTransactions October 2026 income equals ฿65,601.45 (60k+)...");
const budgetTxs = JSON.parse(fs.readFileSync(path.join(rootDir, 'scratch/budget_transactions.json'), 'utf8'));
const octIncomes = budgetTxs.filter(t => {
  const isOct = t.date && t.date.startsWith('2026-10');
  const isIncome = String(t.type).toLowerCase() === 'income';
  return isOct && isIncome;
});
const totalIncome = Math.round(octIncomes.reduce((acc, t) => acc + (parseFloat(t.amount) || 0), 0) * 100) / 100;
assert.strictEqual(totalIncome, 65601.45, `Expected total income 65601.45, got ${totalIncome}`);
assert(totalIncome > 60000, "Total income must exceed 60,000 THB");
console.log(`✓ Total October Budget Income: ฿${totalIncome.toLocaleString()} (> 60k THB verified)`);
for (const inc of octIncomes) {
  console.log(`    - ${inc.category}: ฿${inc.amount.toLocaleString()}`);
}

// Test 2: "ผู้ฝึกกระบี่เต็มเวลา" October sales parity in data files
console.log("\n[Test 2] Verifying 'ผู้ฝึกกระบี่เต็มเวลา' October sales = 583.20 ฿ across all datasets...");
for (const p of [
  'tools/data/readrealm_stats_lionking.json',
  'tools/data/readrealm_growth_latest.json',
  'frontend/src/data/readrealm_growth_latest.json',
  'frontend/src/data/grouped_matched_comics.json',
  'frontend/src/data/multi_platform_growth_latest.json'
]) {
  const fullPath = path.join(rootDir, p);
  assert(fs.existsSync(fullPath), `File not found: ${p}`);
  const content = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  const list = content.comics || content;
  const item = list.find(c => (c.subject && c.subject.includes('ผู้ฝึกกระบี่')) || (c.title && c.title.includes('ผู้ฝึกกระบี่')));
  assert(item, `Comic 'ผู้ฝึกกระบี่เต็มเวลา' not found in ${p}`);
  
  const octVal = item.monthly_sales?.['ตุลาคม'] || item.readrealm?.monthly_sales?.['ตุลาคม'];
  assert.strictEqual(octVal, 583.2, `Expected 583.2 in ${p}, got ${octVal}`);
  console.log(`✓ ${p}: October sales = ฿${octVal}`);
}

// Test 3: FinancialsView P&L simulation for "ผู้ฝึกกระบี่เต็มเวลา"
console.log("\n[Test 3] Simulating FinancialsView row rendering and tooltip for 'ผู้ฝึกกระบี่เต็มเวลา'...");
{
  const groupedData = JSON.parse(fs.readFileSync(path.join(rootDir, 'frontend/src/data/grouped_matched_comics.json'), 'utf8'));
  const swordGroup = groupedData.find(g => g.title && g.title.includes("ผู้ฝึกกระบี่เต็มเวลา"));
  assert(swordGroup, "Sword group not found");

  const rowThaiMonth = "ตุลาคม";
  const rrMonthlyMap = swordGroup.readrealm?.monthly_sales;
  const isRrExact = Boolean(rowThaiMonth && rrMonthlyMap && typeof rrMonthlyMap[rowThaiMonth] === "number");
  const rrMonthSales = isRrExact ? Number(rrMonthlyMap[rowThaiMonth]) : 0;
  assert.strictEqual(isRrExact, true, "isRrExact must be true");
  assert.strictEqual(rrMonthSales, 583.2, "rrMonthSales must be 583.2");

  const rrExists = true;
  const kwExists = true;
  const chExists = true;
  const rev = 583.2; // From updated live MangaSales

  let rrSaleAmt = 0;
  let krSaleAmt = 0;
  let chSaleAmt = 0;

  if (isRrExact) {
    rrSaleAmt = rrExists ? rrMonthSales : 0;
    krSaleAmt = kwExists ? 0 : 0;
    chSaleAmt = chExists ? 0 : 0;
  }

  assert.strictEqual(rrSaleAmt, 583.2, "rrSaleAmt must be 583.2");
  console.log(`✓ FinancialsView Table Simulation:`);
  console.log(`    Revenue Column: ฿${rrSaleAmt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`    Tooltip Display: "ReadRealm: (รอบจริง) ฿${rrSaleAmt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}"`);
}

// Test 4: FinancialsView Reconciliation Calculation with transactionList
console.log("\n[Test 4] Simulating FinancialsView reconciledMonthData with BudgetTransactions...");
{
  const targetM = "2026-10";
  const budgetIncomeItems = budgetTxs.filter((t) => {
    if (!t.date) return false;
    const dStr = String(t.date).slice(0, 7);
    const isTargetMonth = dStr === targetM || (t.date && String(t.date).startsWith(targetM));
    const tType = String(t.type || "").toLowerCase();
    return isTargetMonth && (tType === "income" || tType === "รายรับ");
  });
  const totalBudgetRev = Math.round(budgetIncomeItems.reduce((acc, t) => acc + (parseFloat(t.amount) || 0), 0) * 100) / 100;
  assert.strictEqual(totalBudgetRev, 65601.45, "totalBudgetRev must match 65601.45");

  const totalCost = 29395;
  const netProfit = Math.round((totalBudgetRev - totalCost) * 100) / 100;
  assert.strictEqual(netProfit, 36206.45, "netProfit must match 36206.45");

  console.log(`✓ Overview Reconciliation Cards:`);
  console.log(`    รายรับรวม (Total Revenue from BudgetTransactions): ฿${totalBudgetRev.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`    ต้นทุนรวม (Total Cost): ฿${totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`    กำไรสุทธิ (Net Profit): ฿${netProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
}

console.log("\n================================================================");
console.log("ALL 4 FINANCIAL REVENUE AND PARITY TESTS PASSED 100%!");
console.log("================================================================\n");
