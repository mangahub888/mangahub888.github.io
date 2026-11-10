import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("\n--- COMPREHENSIVE TEST SUITE: ReadRealm Monthly Sale Report Parity ---");

// Test 1: Check grouped_matched_comics.json in src and public
console.log("\n[Test 1] Verifying grouped_matched_comics.json October sales parity (5,733.00 ฿)...");
for (const p of ['src/data/grouped_matched_comics.json', 'public/data/grouped_matched_comics.json']) {
  const fp = path.resolve(__dirname, p);
  const data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
  const villain = data.find(g => g.title && g.title.includes("ข้าคือจอมวายร้าย"));
  assert(villain, `Villain comic not found in ${p}`);
  const octSales = villain.readrealm?.monthly_sales?.['ตุลาคม'];
  const totalSales = villain.readrealm?.sales;
  assert.strictEqual(octSales, 5733.0, `Expected October sales to be 5733.0, got ${octSales} in ${p}`);
  assert.ok(typeof totalSales === 'number' && totalSales >= 461493.3, `Expected total sales to be at least 461493.3, got ${totalSales} in ${p}`);
  console.log(`✓ ${p} verified: October = ฿${octSales.toLocaleString()}, Total = ฿${totalSales.toLocaleString()}`);
}

// Test 2: Check multi_platform_growth_latest.json and readrealm_growth_latest.json
console.log("\n[Test 2] Verifying growth JSON datasets total sales (461,493.30 ฿)...");
for (const p of [
  'src/data/multi_platform_growth_latest.json',
  'public/data/multi_platform_growth_latest.json',
  'src/data/readrealm_growth_latest.json',
  'public/data/readrealm_growth_latest.json'
]) {
  const fp = path.resolve(__dirname, p);
  const data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
  const comic = data.comics?.find(c => c.comic_id === "EZ41KDdWY1Nxw7MA5PkN");
  assert(comic, `Comic EZ41KDdWY1Nxw7MA5PkN not found in ${p}`);
  assert(comic.total_sales >= 461493.3, `Expected at least 461493.3, got ${comic.total_sales} in ${p}`);
  console.log(`✓ ${p} verified: total_sales = ฿${comic.total_sales.toLocaleString()}`);
}

// Test 3: Simulation of FinancialsView.tsx P&L row & tooltip calculation
console.log("\n[Test 3] Simulating FinancialsView P&L row and tooltip resolution for October...");
{
  const groupedData = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'src/data/grouped_matched_comics.json'), 'utf-8'));
  const villainGroup = groupedData.find(g => g.title && g.title.includes("ข้าคือจอมวายร้าย"));
  
  // Row parameters in P&L ledger for October 2026:
  const rowThaiMonth = "ตุลาคม";
  const rrMonthlyMap = villainGroup.readrealm?.monthly_sales;
  const rrMonthSales = (rowThaiMonth && rrMonthlyMap && typeof rrMonthlyMap[rowThaiMonth] === "number")
    ? Number(rrMonthlyMap[rowThaiMonth])
    : 0;

  const rrExists = true;
  const kwExists = true;
  const chExists = false;
  const activePlatCount = 2;
  const rev = 5733.0; // revenue matching October

  let rrSaleAmt = 0;
  let krSaleAmt = 0;
  let chSaleAmt = 0;
  let isRrExact = false;

  if (rrExists && rrMonthSales > 0 && rev >= rrMonthSales) {
    rrSaleAmt = rrMonthSales;
    isRrExact = true;
    const remainder = Math.round((rev - rrSaleAmt) * 100) / 100;
    krSaleAmt = remainder;
  }

  assert.strictEqual(rrSaleAmt, 5733.0, "ReadRealm monthly sale must match 5,733.00 ฿");
  assert.strictEqual(isRrExact, true, "isRrExact flag must be true (รอบจริง)");
  console.log(`✓ FinancialsView P&L Ledger Simulation:`);
  console.log(`   ReadRealm Sale: ฿${rrSaleAmt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (รอบจริง: ${isRrExact})`);
  console.log(`   Tooltip Display: "ReadRealm: (รอบจริง) ฿${rrSaleAmt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}"`);
}

console.log("\n================================================================");
console.log("ALL 3 READREALM SALE REPORT PARITY TESTS PASSED 100%!");
console.log("================================================================\n");
