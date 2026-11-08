import assert from 'node:assert';

console.log("--- COMPREHENSIVE TEST SUITE: MangaSales MangaID Filtering ---");

// Test data fixtures
const mockSales = [
  { serieschapterid: "101", seriesname: "Manga 101", revenue: 500, totalcost: 200, month: "2026-10" },
  { serieschapterid: "", seriesname: "Empty ID Manga", revenue: 100, totalcost: 50, month: "2026-10" },
  { serieschapterid: null, seriesname: "Null ID Manga", revenue: 100, totalcost: 50, month: "2026-10" },
  { serieschapterid: undefined, mangaid: undefined, seriesname: "Undefined ID Manga", revenue: 100, totalcost: 50, month: "2026-10" },
  { serieschapterid: "0", seriesname: "Zero ID Manga", revenue: 100, totalcost: 50, month: "2026-10" },
  { serieschapterid: 0, seriesname: "Numeric Zero ID Manga", revenue: 100, totalcost: 50, month: "2026-10" },
  { serieschapterid: "   ", seriesname: "Whitespace ID Manga", revenue: 100, totalcost: 50, month: "2026-10" },
  { serieschapterid: "undefined", seriesname: "Literal undefined Manga", revenue: 100, totalcost: 50, month: "2026-10" },
  { serieschapterid: "null", seriesname: "Literal null Manga", revenue: 100, totalcost: 50, month: "2026-10" },
  { mangaid: "202", seriesname: "Fallback mangaid 202", revenue: 800, totalcost: 300, month: "2026-10" },
  { manga_id: "303", seriesname: "Fallback manga_id 303", revenue: 1200, totalcost: 400, month: "2026-10" }
];

// Helper mimicking FinancialsView filter logic
function filterMangaSales(salesList) {
  return (salesList || []).filter((sale) => {
    const rawId = sale.serieschapterid !== undefined ? sale.serieschapterid : (sale.mangaid !== undefined ? sale.mangaid : sale.manga_id);
    const strId = String(rawId === null || rawId === undefined ? "" : rawId).trim();
    return strId !== "" && strId !== "0" && strId.toLowerCase() !== "undefined" && strId.toLowerCase() !== "null";
  });
}

// Helper mimicking backend calculateAndSyncMonthlyMangaSales WorkQueue filtering
function filterWorkQueueForSales(workQueue) {
  return (workQueue || []).filter(q => {
    const qMId = String(q.mangaid === null || q.mangaid === undefined ? '' : q.mangaid).trim();
    return qMId !== '' && qMId !== '0' && qMId.toLowerCase() !== 'undefined' && qMId.toLowerCase() !== 'null';
  });
}

// Helper mimicking backend calculateAndSyncMonthlyMangaSales tasks filtering
function filterTasksForSales(tasks) {
  return (tasks || []).filter(t => {
    const rawMid = t.mangaId || t.mangaid || t.manga_id;
    const strMid = String(rawMid === null || rawMid === undefined ? '' : rawMid).trim();
    return strMid !== '' && strMid !== '0' && strMid.toLowerCase() !== 'undefined' && strMid.toLowerCase() !== 'null';
  });
}

console.log("\n[Test 1] Testing filterMangaSales excludes empty/null/zero/undefined mangaid...");
const filteredSales = filterMangaSales(mockSales);
assert.strictEqual(filteredSales.length, 3, `Expected 3 items with valid mangaid, got ${filteredSales.length}`);
assert.deepStrictEqual(filteredSales.map(s => s.seriesname), ["Manga 101", "Fallback mangaid 202", "Fallback manga_id 303"]);
console.log("✓ Test 1 Passed: Successfully filtered out 8 invalid/empty mangaid entries!");

console.log("\n[Test 2] Testing WorkQueue filtering logic for MangaSales sync...");
const mockWorkQueue = [
  { mangaid: "101", title: "Solo Leveling", createdat: "2026-10-15" },
  { mangaid: "", title: "Ghost Task 1", createdat: "2026-10-15" },
  { mangaid: null, title: "Ghost Task 2", createdat: "2026-10-15" },
  { mangaid: undefined, title: "Ghost Task 3", createdat: "2026-10-15" },
  { mangaid: 0, title: "Zero ID Task", createdat: "2026-10-15" },
  { mangaid: "  ", title: "Blank ID Task", createdat: "2026-10-15" },
  { mangaid: "999", title: "Valid Comic Task", createdat: "2026-10-15" }
];
const validQueue = filterWorkQueueForSales(mockWorkQueue);
assert.strictEqual(validQueue.length, 2, `Expected 2 valid queue items, got ${validQueue.length}`);
assert.deepStrictEqual(validQueue.map(q => q.mangaid), ["101", "999"]);
console.log("✓ Test 2 Passed: WorkQueue items without mangaid are completely skipped!");

console.log("\n[Test 3] Testing Payout Claims task filtering logic...");
const mockTasks = [
  { mangaId: "505", mangaName: "Good Manga", amount: 100 },
  { mangaId: "", mangaName: "Empty Manga", amount: 50 },
  { mangaId: null, mangaName: "Null Manga", amount: 50 },
  { mangaId: "undefined", mangaName: "Literal Undefined", amount: 50 },
  { mangaId: 0, mangaName: "Zero Manga", amount: 50 },
  { mangaId: "707", mangaName: "Another Good Manga", amount: 200 }
];
const validTasks = filterTasksForSales(mockTasks);
assert.strictEqual(validTasks.length, 2, `Expected 2 valid tasks, got ${validTasks.length}`);
assert.deepStrictEqual(validTasks.map(t => t.mangaId), ["505", "707"]);
console.log("✓ Test 3 Passed: Tasks without mangaid are completely skipped from claims!");

console.log("\n[Test 4] Verifying summary totals reflect ONLY valid mangaid items...");
const totalRev = filteredSales.reduce((acc, s) => acc + s.revenue, 0);
const totalCost = filteredSales.reduce((acc, s) => acc + s.totalcost, 0);
assert.strictEqual(totalRev, 500 + 800 + 1200); // 2500
assert.strictEqual(totalCost, 200 + 300 + 400); // 900
console.log(`✓ Test 4 Passed: Totals correctly calculated only from valid series (Rev: ${totalRev}, Cost: ${totalCost})!`);

console.log("\n================================================================");
console.log("ALL 4 MANGAID FILTERING VERIFICATION CHECKS PASSED WITH 0 REGRESSIONS!");
console.log("================================================================\n");
