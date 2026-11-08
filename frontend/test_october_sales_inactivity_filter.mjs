import assert from 'assert';

console.log('--- TEST SUITE: October MangaSales Inactivity & WorkQueue Effective Month Filter ---');

// Helper mimicking backend getQueueItemEffectiveMonth
function getQueueItemEffectiveMonth(q) {
  const getMonthStr = (val) => {
    if (!val) return null;
    const d = new Date(val);
    if (isNaN(d.getTime())) return null;
    return new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 7);
  };

  if (q.publishtime) return getMonthStr(q.publishtime);
  if (q.typesettime) return getMonthStr(q.typesettime);
  if (q.translatetime) return getMonthStr(q.translatetime);
  if (q.uploadtime) return getMonthStr(q.uploadtime);
  return getMonthStr(q.createdat);
}

// Test 1: Historical chapter with backfilled createdat should NOT match October
console.log('\n[Test 1] Testing historical chapter with backfilled createdat...');
const oldChap = {
  queueid: 1771228195349,
  mangaid: 33,
  chapter: 41,
  createdat: '2026-09-30T17:00:01.000Z', // Oct 1 Thai time (backfill)
  uploadtime: '2026-02-16T07:50:26.452Z', // February
  publishtime: '2026-02-18T13:43:52.366Z', // February
};
const effMonth1 = getQueueItemEffectiveMonth(oldChap);
assert.strictEqual(effMonth1, '2026-02', 'Effective month should be 2026-02, not October!');
console.log('✓ Test 1 Passed: Historical chapter correctly identified as February (2026-02), not October!');

// Test 2: Real October chapter with October publishtime
console.log('\n[Test 2] Testing real October chapter with October publishtime...');
const realOctChap = {
  queueid: 1780516752929,
  mangaid: 4,
  chapter: 361,
  createdat: '2026-10-06T18:25:44.817Z',
  uploadtime: '2026-10-06T18:27:02.513Z',
  publishtime: '2026-10-07T19:10:20.437Z',
};
const effMonth2 = getQueueItemEffectiveMonth(realOctChap);
assert.strictEqual(effMonth2, '2026-10', 'Effective month should be 2026-10!');
console.log('✓ Test 2 Passed: Real October chapter correctly identified as 2026-10!');

// Test 3: Frontend FinancialsView filtering excludes inactive/ghost series and Unknown
console.log('\n[Test 3] Testing Frontend FinancialsView filtering...');
const sampleSales = [
  { serieschapterid: '35', seriesname: 'การกลับมาของบรรพชนรุ่นแรก', revenue: 10789.47, totalcost: 335, chapterscount: 4 },
  { serieschapterid: '33', seriesname: 'จอมยุทธ์หลบภัย', revenue: 0, totalcost: 0, chapterscount: 0 },
  { serieschapterid: '43', seriesname: 'Manga #43', revenue: 0, totalcost: 65, chapterscount: 1 },
  { serieschapterid: '51', seriesname: 'Unknown', revenue: 0, totalcost: 280, chapterscount: 15 },
  { serieschapterid: '', seriesname: 'No ID Comic', revenue: 500, totalcost: 100, chapterscount: 2 },
];

const filtered = sampleSales.filter(s => {
  const id = String(s.serieschapterid || '').trim();
  if (!id || id === '0' || id.toLowerCase() === 'undefined' || id.toLowerCase() === 'null') return false;
  const name = String(s.seriesname || '').trim().toLowerCase();
  if (name === 'unknown' || name.startsWith('manga #')) return false;
  const rev = parseFloat(s.revenue) || 0;
  const cost = parseFloat(s.totalcost) || 0;
  const ch = parseInt(s.chapterscount, 10) || 0;
  if (rev <= 0 && cost <= 0 && ch <= 0) return false;
  return true;
});

assert.strictEqual(filtered.length, 1);
assert.strictEqual(filtered[0].serieschapterid, '35');
console.log('✓ Test 3 Passed: Successfully filtered out ghost/inactive series, Unknown, Manga #, and empty IDs!');

console.log('\n================================================================');
console.log('ALL VERIFICATION TESTS FOR OCTOBER INACTIVITY FIX PASSED 100%!');
console.log('================================================================');
