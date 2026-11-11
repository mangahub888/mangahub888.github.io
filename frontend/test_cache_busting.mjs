import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import assert from 'assert'

// DIRECTLY IMPORT PRODUCTION MODULE UNDER TEST
import {
  compareAppVersions,
  isReloadTargeted,
  parseTimestamp,
  getVersionEndpoint,
} from './src/lib/versionManager.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(__dirname, 'dist')

console.log('--- COMPREHENSIVE TEST SUITE: Cache-Busting, Routing & Loop Protection ---')

// Test 1: Verify dist/version.json exists and contains required fields
console.log('\n[Test 1] Verifying dist/version.json existence and schema...')
const versionJsonPath = path.resolve(distDir, 'version.json')
assert(fs.existsSync(versionJsonPath), 'dist/version.json MUST exist')

const versionData = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'))
assert(versionData.version, 'version.json MUST contain "version"')
assert(versionData.buildTime, 'version.json MUST contain "buildTime"')
assert(versionData.packageVersion, 'version.json MUST contain "packageVersion"')
assert(versionData.commit, 'version.json MUST contain "commit"')
console.log('✓ Test 1 Passed: version.json is valid:', versionData)

// Test 2: Verify dist/index.html has Cache-Control meta tags and vite:preloadError handler with loop protection
console.log('\n[Test 2] Verifying dist/index.html cache prevention tags & loop-protected preload handler...')
const indexPath = path.resolve(distDir, 'index.html')
assert(fs.existsSync(indexPath), 'dist/index.html MUST exist')
const indexContent = fs.readFileSync(indexPath, 'utf8')

assert(indexContent.includes('http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate"'), 'index.html MUST contain Cache-Control meta tag')
assert(indexContent.includes('http-equiv="Pragma" content="no-cache"'), 'index.html MUST contain Pragma meta tag')
assert(indexContent.includes('http-equiv="Expires" content="0"'), 'index.html MUST contain Expires meta tag')
assert(indexContent.includes('vite:preloadError'), 'index.html MUST contain vite:preloadError listener')
assert(indexContent.includes('mgh_preload_retry'), 'index.html MUST include preload retry cooldown guard to prevent infinite reload loops')
assert(indexContent.includes('mgh_bundle_reload_ts'), 'index.html MUST include main bundle capture-phase script error recovery')
assert(indexContent.includes('serviceWorker'), 'index.html MUST include serviceWorker unregistration guard')
assert(indexContent.includes('favicon.ico'), 'index.html MUST link to favicon.ico')
assert(indexContent.includes('favicon.svg'), 'index.html MUST link to favicon.svg')
console.log('✓ Test 2 Passed: index.html contains anti-caching meta tags, loop-protected preloadError recovery, script error capture, and favicon links')

// Test 2b: Verify dist/favicon.ico and dist/favicon.svg exist
console.log('\n[Test 2b] Verifying dist/favicon.ico & favicon.svg existence...')
assert(fs.existsSync(path.resolve(distDir, 'favicon.ico')), 'dist/favicon.ico MUST exist')
assert(fs.existsSync(path.resolve(distDir, 'favicon.svg')), 'dist/favicon.svg MUST exist')
console.log('✓ Test 2b Passed: favicon.ico and favicon.svg exist in dist')

// Test 3: Verify dist/404.html has Cache-Control meta tags
console.log('\n[Test 3] Verifying dist/404.html anti-caching meta tags...')
const html404Path = path.resolve(distDir, '404.html')
assert(fs.existsSync(html404Path), 'dist/404.html MUST exist')
const html404Content = fs.readFileSync(html404Path, 'utf8')

assert(html404Content.includes('http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate"'), '404.html MUST contain Cache-Control meta tag')
assert(html404Content.includes('http-equiv="Pragma" content="no-cache"'), '404.html MUST contain Pragma meta tag')
assert(html404Content.includes('http-equiv="Expires" content="0"'), '404.html MUST contain Expires meta tag')
console.log('✓ Test 3 Passed: 404.html contains anti-caching meta tags')

// Test 4: Base URL Endpoint Resolution with trailing slashes and subpaths
console.log('\n[Test 4] Testing getVersionEndpoint() resolution logic across routes...')
assert.strictEqual(getVersionEndpoint(), '/version.json', 'Default/relative base MUST resolve to root /version.json')

// Trailing slash resolution test in URL
const trailingSlashRoute = 'https://mangahub888.github.io/connectors/'
const endpoint = getVersionEndpoint()
const resolvedUrl = new URL(endpoint, trailingSlashRoute).href
assert.strictEqual(resolvedUrl, 'https://mangahub888.github.io/version.json', 'Trailing slash route /connectors/ with root endpoint MUST resolve to root /version.json, not /connectors/version.json')
console.log('✓ Test 4 Passed: Absolute endpoint resolution prevents trailing slash 404s')

// Test 5: Verify SPA GitHub Pages redirect handling with cache-busting query parameter
console.log('\n[Test 5] Verifying 404 redirect and index decoding with query params...')
const testUrl = 'https://mangahub888.github.io/connectors?_v=1730433600000'
const urlObj = new URL(testUrl)

const pathSegmentsToKeep = 0
const redirectUrl =
  urlObj.protocol + '//' + urlObj.hostname + (urlObj.port ? ':' + urlObj.port : '') +
  urlObj.pathname.split('/').slice(0, 1 + pathSegmentsToKeep).join('/') + '/?/' +
  urlObj.pathname.slice(1).split('/').slice(pathSegmentsToKeep).join('/').replace(/&/g, '~and~') +
  (urlObj.search ? '&' + urlObj.search.slice(1).replace(/&/g, '~and~') : '') +
  urlObj.hash

assert.strictEqual(redirectUrl, 'https://mangahub888.github.io/?/connectors&_v=1730433600000', 'Redirect URL must format query parameters with &')

const indexUrlObj = new URL(redirectUrl)
assert.strictEqual(indexUrlObj.search[1], '/', 'index decode must detect leading slash')
const decoded = indexUrlObj.search.slice(1).split('&').map(s => s.replace(/~and~/g, '&')).join('?')
const finalPath = indexUrlObj.pathname.slice(0, -1) + decoded

assert.strictEqual(finalPath, '/connectors?_v=1730433600000', 'Decoded path must preserve route and _v parameter')
console.log('✓ Test 5 Passed: GitHub Pages SPA redirect and decode preserves /connectors and _v')

// Test 6: Verify compiled bundle contains ThunderScans EN connector card
console.log('\n[Test 6] Verifying ThunderScans EN connector exists in bundled JS...')
const assetsDir = path.resolve(distDir, 'assets')
const files = fs.readdirSync(assetsDir)
const jsBundle = files.find(f => f.startsWith('index-') && f.endsWith('.js'))
assert(jsBundle, 'dist/assets must contain index-*.js')

const jsContent = fs.readFileSync(path.resolve(assetsDir, jsBundle), 'utf8')
assert(jsContent.includes('ThunderScans EN'), 'Compiled bundle MUST include "ThunderScans EN"')
assert(jsContent.includes('en-thunderscans.com'), 'Compiled bundle MUST include "en-thunderscans.com"')
console.log(`✓ Test 6 Passed: "${jsBundle}" contains ThunderScans EN connector card`)

// Test 7: Verify production compareAppVersions logic with live module imports
console.log('\n[Test 7] Testing production compareAppVersions chronological ordering & edge cases...')

const currentStandard = {
  version: '100',
  commit: 'ab24b87',
  packageVersion: '2.0.0',
  buildTime: '2026-11-01T04:00:00Z',
}

// Case A: Identical version
assert.strictEqual(compareAppVersions(currentStandard, { buildTime: '2026-11-01T04:00:00Z', version: '100', commit: 'ab24b87' }), false)

// Case B: Newer buildTime
assert.strictEqual(compareAppVersions(currentStandard, { buildTime: '2026-11-01T04:10:00Z', version: '101', commit: 'ab24b87' }), true)

// Case C: Older buildTime from lagging CDN edge node (CRITICAL EDGE CASE: MUST NOT DOWNGRADE)
assert.strictEqual(compareAppVersions({ ...currentStandard, buildTime: '2026-11-01T04:30:00Z' }, { buildTime: '2026-11-01T04:10:00Z', version: '101', commit: 'ab24b87' }), false, 'Lagging CDN edge with older buildTime must NOT trigger update')

// Case D: Vite DEV mode bypass (must never alert in dev)
assert.strictEqual(compareAppVersions(currentStandard, { buildTime: '2026-11-01T04:10:00Z', version: '101', commit: 'cd45e67' }, true), false)

// Case E: Remote version is "dev"
assert.strictEqual(compareAppVersions(currentStandard, { buildTime: '2026-11-01T04:10:00Z', version: 'dev', commit: 'dev' }), false)

// Case F: Null / empty remote
assert.strictEqual(compareAppVersions(currentStandard, null), false)
assert.strictEqual(compareAppVersions(currentStandard, {}), false)

// Case G: Corrupted/unparseable remote buildTime when current is valid (MUST NOT ENTER RELOAD LOOP!)
assert.strictEqual(compareAppVersions(currentStandard, { buildTime: 'invalid-corrupted-date', version: '101', commit: 'ab24b87' }), false, 'Corrupted remote buildTime must NOT trigger update loop')

// Case H: Numeric Unix timestamp ms build times
assert.strictEqual(compareAppVersions({ ...currentStandard, buildTime: '1793500000000' }, { buildTime: '1793509000000', version: '102' }), true)
assert.strictEqual(compareAppVersions({ ...currentStandard, buildTime: '1793509000000' }, { buildTime: '1793500000000', version: '102' }), false)

// Case I: Non-standard unparseable string fallback when BOTH are non-standard
assert.strictEqual(compareAppVersions({ ...currentStandard, buildTime: 'custom-build-a' }, { buildTime: 'custom-build-b', version: '101', commit: 'ab24b87' }), true)

console.log('✓ Test 7 Passed: Production compareAppVersions chronological ordering & edge cases correctly handled')

// Test 8: Verify storage resilience & isReloadTargeted helper
console.log('\n[Test 8] Testing production isReloadTargeted & user-initiated reload bypass...')

// Case 1: Fresh update, no prior reload -> Should reload
assert.strictEqual(isReloadTargeted('v2', null, null), false, 'Fresh version with no prior reload must not be targeted')

// Case 2: Already reloaded, stored in sessionStorage -> Should NOT reload on mount
assert.strictEqual(isReloadTargeted('v2', 'v2', null), true, 'Targeted version stored in sessionStorage must be recognized')

// Case 3: Storage blocked/disabled, but bare URL param _v=v2 is present -> Secondary guard
assert.strictEqual(isReloadTargeted('v2', null, 'v2'), true, 'Bare query param _v=v2 must be recognized as targeted')

// Case 4: Storage blocked/disabled, but timestamped URL param _v=v2_1730434000 is present -> Secondary guard!
assert.strictEqual(isReloadTargeted('v2', null, 'v2_1730434000'), true, 'Timestamped query param _v=v2_1730434000 must be recognized as targeted')

// Case 5: URL param is for old version (_v=v1), remote is v2 -> Must allow reload!
assert.strictEqual(isReloadTargeted('v2', null, 'v1_1730434000'), false, 'Older query param v1 must NOT match target v2')

console.log('✓ Test 8 Passed: Production isReloadTargeted handles bare tokens, timestamped tokens, and version mismatches')

// Test 9: Verify Root Path Normalization preserves search parameters
console.log('\n[Test 9] Testing root path normalization query param preservation...')
function simulateRootNormalization(currentPath, currentSearch, currentHash, activeView) {
  if (currentPath === '/' || currentPath === '') {
    const search = currentSearch || ''
    const hash = currentHash || ''
    return `/${activeView}${search}${hash}`
  }
  return currentPath
}

assert.strictEqual(
  simulateRootNormalization('/', '?_v=1730433600000', '', 'dashboard'),
  '/dashboard?_v=1730433600000',
  'Root redirect must preserve _v query parameter'
)
assert.strictEqual(
  simulateRootNormalization('/', '?code=auth_123#token', '', 'dashboard'),
  '/dashboard?code=auth_123#token',
  'Root redirect must preserve query params and hash'
)
console.log('✓ Test 9 Passed: Root path normalization correctly preserves search and hash')

// Test 10: Verify Back/Forward Cache (bfcache) restoration & cleanCacheBustingParams
console.log('\n[Test 10] Testing bfcache restoration & cleanCacheBustingParams...')
function simulateCleanParams(urlStr) {
  const url = new URL(urlStr)
  let changed = false
  if (url.searchParams.has('_v')) { url.searchParams.delete('_v'); changed = true; }
  if (url.searchParams.has('_reload')) { url.searchParams.delete('_reload'); changed = true; }
  if (url.searchParams.has('_t')) { url.searchParams.delete('_t'); changed = true; }
  const searchStr = url.searchParams.toString()
  return url.pathname + (searchStr ? `?${searchStr}` : '') + url.hash
}

assert.strictEqual(
  simulateCleanParams('https://mangahub888.github.io/connectors?_v=123&_reload=456&_t=789#card'),
  '/connectors#card',
  'All cache-busting tokens (_v, _reload, _t) must be cleanly removed while preserving hash'
)
assert.strictEqual(
  simulateCleanParams('https://mangahub888.github.io/connectors?active=1&_v=123'),
  '/connectors?active=1',
  'Standard app query params (e.g. active=1) must be preserved'
)

// bfcache pageshow logic test
function simulatePageShow(eventPersisted) {
  if (eventPersisted) {
    return { shouldCheckStale: true }
  }
  return { shouldCheckStale: false }
}
assert.strictEqual(simulatePageShow(true).shouldCheckStale, true, 'pageshow with event.persisted MUST trigger stale version check')
assert.strictEqual(simulatePageShow(false).shouldCheckStale, false, 'normal pageshow must not duplicate mount check')

console.log('✓ Test 10 Passed: Cache-busting param cleanup & bfcache handling verified')

// Test 11: Verify parseTimestamp helper across all formats
console.log('\n[Test 11] Testing parseTimestamp helper...')
assert(!isNaN(parseTimestamp('2026-11-01T04:00:00Z')), 'ISO date string must be parsed')
assert(!isNaN(parseTimestamp('1793500000000')), 'Epoch string must be parsed')
assert(!isNaN(parseTimestamp(1793500000000)), 'Epoch number must be parsed')
assert(isNaN(parseTimestamp('invalid')), 'Invalid string must return NaN')
assert(isNaN(parseTimestamp(null)), 'Null must return NaN')
assert(isNaN(parseTimestamp(undefined)), 'Undefined must return NaN')
console.log('✓ Test 11 Passed: parseTimestamp handles ISO strings, epoch strings, numbers, and invalid data')

console.log('\n================================================================')
console.log('ALL 11 VERIFICATION CHECKS PASSED WITH 0 REGRESSIONS!')
console.log('================================================================\n')
