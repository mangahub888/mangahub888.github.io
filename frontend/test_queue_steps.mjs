import assert from 'assert'
import {
  isStepDone,
  isQueueStepDone,
  matchesStepFilter,
  getQueueCurrentStep,
  QUEUE_STEPS,
} from './src/lib/utils.ts'

console.log('--- COMPREHENSIVE TEST SUITE: Queue Step Strict Sequencing & Filters ---')

// Test 1: USER's exact reported bug:
// 1. อัป Raw: เสร็จแล้ว, 2. ดึงคำออโต้: เสร็จแล้ว, 3. QC ดึงคำ: รอเริ่ม (Kikkuk), แปล: รอเริ่ม (เร)
// MUST NOT show up in "แปล" filter! MUST show up in "3. QC ดึงคำ"!
console.log('\n[Test 1] Reported User Bug: 3. QC ดึงคำ is รอเริ่ม -> Must NOT match "translate"')
const bugItem = {
  uploadstatus: 'เสร็จแล้ว',
  ocrstatus: 'เสร็จแล้ว',
  extractstatus: 'รอเริ่ม',
  extractorname: 'Kikkuk',
  translatestatus: 'รอเริ่ม',
  translatorname: 'เร',
  typesetstatus: 'รอเริ่ม',
  publishstatus: 'รอเริ่ม',
  poststatus: 'รอเริ่ม',
}
assert.strictEqual(isQueueStepDone(bugItem, 'upload'), true, 'Upload is done')
assert.strictEqual(isQueueStepDone(bugItem, 'ocr'), true, 'OCR is done')
assert.strictEqual(isQueueStepDone(bugItem, 'extract'), false, 'QC extract is NOT done')
assert.strictEqual(isQueueStepDone(bugItem, 'translate'), false, 'Translate is NOT done')
assert.strictEqual(matchesStepFilter(bugItem, 'translate'), false, 'CRITICAL: Must NOT show in translate filter!')
assert.strictEqual(matchesStepFilter(bugItem, 'extract'), true, 'Must show in extract filter!')
assert.strictEqual(matchesStepFilter(bugItem, 'ocr'), false, 'Must NOT show in ocr filter')
assert.strictEqual(matchesStepFilter(bugItem, 'upload'), false, 'Must NOT show in upload filter')
assert.strictEqual(getQueueCurrentStep(bugItem), 'extract', 'Current step must be extract')
console.log('✓ Test 1 Passed: Bug item successfully blocked from translate filter and directed to extract')

// Test 2: QC ดึงคำ is actively กำลังทำ -> Must NOT match "translate"
console.log('\n[Test 2] QC ดึงคำ is กำลังทำ -> Must NOT match "translate"')
const inProgressExtractItem = {
  ...bugItem,
  extractstatus: 'กำลังทำ',
}
assert.strictEqual(isQueueStepDone(inProgressExtractItem, 'extract'), false, 'Extract in progress is NOT done')
assert.strictEqual(matchesStepFilter(inProgressExtractItem, 'translate'), false, 'Must NOT show in translate filter')
assert.strictEqual(matchesStepFilter(inProgressExtractItem, 'extract'), true, 'Must show in extract filter')
console.log('✓ Test 2 Passed: In-progress extract correctly blocks translate filter')

// Test 3: Normal Translate Ready: 3 first columns done -> Shows in "translate"
console.log('\n[Test 3] All 3 first steps (upload, ocr, extract) done -> Shows in "translate"')
const readyTranslateItem = {
  uploadstatus: 'เสร็จแล้ว',
  ocrstatus: 'เสร็จแล้ว',
  extractstatus: 'เสร็จแล้ว',
  extractorname: 'Kikkuk',
  translatestatus: 'รอเริ่ม',
  translatorname: 'เร',
  typesetstatus: 'รอเริ่ม',
  publishstatus: 'รอเริ่ม',
  poststatus: 'รอเริ่ม',
}
assert.strictEqual(isQueueStepDone(readyTranslateItem, 'upload'), true)
assert.strictEqual(isQueueStepDone(readyTranslateItem, 'ocr'), true)
assert.strictEqual(isQueueStepDone(readyTranslateItem, 'extract'), true)
assert.strictEqual(isQueueStepDone(readyTranslateItem, 'translate'), false)
assert.strictEqual(matchesStepFilter(readyTranslateItem, 'translate'), true, 'Must show in translate filter')
assert.strictEqual(matchesStepFilter(readyTranslateItem, 'extract'), false, 'Extract is already done')
assert.strictEqual(getQueueCurrentStep(readyTranslateItem), 'translate', 'Current step must be translate')
console.log('✓ Test 3 Passed: 3 first steps done -> matches translate filter')

// Test 4: Translate In Progress -> Shows in "translate"
console.log('\n[Test 4] Translate is กำลังทำ -> Shows in "translate"')
const inProgressTranslateItem = {
  ...readyTranslateItem,
  translatestatus: 'กำลังทำ',
}
assert.strictEqual(isQueueStepDone(inProgressTranslateItem, 'translate'), false, 'กำลังทำ is not done')
assert.strictEqual(matchesStepFilter(inProgressTranslateItem, 'translate'), true, 'Must show in translate filter')
assert.strictEqual(getQueueCurrentStep(inProgressTranslateItem), 'translate', 'Current step is translate')
console.log('✓ Test 4 Passed: Translate in progress matches translate filter')

// Test 5: Translate Done -> Advances to Typeset (ลงคำ)
console.log('\n[Test 5] Translate is done -> Advances to "typeset"')
const doneTranslateItem = {
  ...readyTranslateItem,
  translatestatus: 'เสร็จแล้ว',
  typesetstatus: 'รอเริ่ม',
}
assert.strictEqual(isQueueStepDone(doneTranslateItem, 'translate'), true)
assert.strictEqual(matchesStepFilter(doneTranslateItem, 'translate'), false, 'Target step already done')
assert.strictEqual(matchesStepFilter(doneTranslateItem, 'typeset'), true, 'Must show in typeset filter')
assert.strictEqual(getQueueCurrentStep(doneTranslateItem), 'typeset', 'Current step is typeset')
console.log('✓ Test 5 Passed: Translate done advances cleanly to typeset')

// Test 6: Typeset strict sequencing (Translating must be done first)
console.log('\n[Test 6] Typeset strict sequencing: Translate must be done before Typeset')
const notReadyTypesetItem = {
  ...readyTranslateItem,
  translatestatus: 'กำลังทำ',
  typesetstatus: 'รอเริ่ม',
}
assert.strictEqual(matchesStepFilter(notReadyTypesetItem, 'typeset'), false, 'Typeset blocked because translate not done')
console.log('✓ Test 6 Passed: Typeset blocked while translation is pending')

// Test 7: Publish & Post strict sequencing
console.log('\n[Test 7] Publish & Post strict sequencing')
const readyPublishItem = {
  uploadstatus: 'เสร็จแล้ว',
  ocrstatus: 'เสร็จแล้ว',
  extractstatus: 'เสร็จแล้ว',
  translatestatus: 'เสร็จแล้ว',
  typesetstatus: 'เสร็จแล้ว',
  publishstatus: 'รอเริ่ม',
  poststatus: 'รอเริ่ม',
}
assert.strictEqual(matchesStepFilter(readyPublishItem, 'publish'), true, 'Ready for publish')
assert.strictEqual(matchesStepFilter(readyPublishItem, 'post'), false, 'Post blocked because publish not done')
assert.strictEqual(matchesStepFilter(readyPublishItem, 'publish_post'), true, 'Matches publish_post filter')

const readyPostItem = {
  ...readyPublishItem,
  publishstatus: 'เสร็จแล้ว',
}
assert.strictEqual(matchesStepFilter(readyPostItem, 'publish'), false, 'Publish already done')
assert.strictEqual(matchesStepFilter(readyPostItem, 'post'), true, 'Ready for post')
assert.strictEqual(matchesStepFilter(readyPostItem, 'publish_post'), true, 'Matches publish_post filter')
console.log('✓ Test 7 Passed: Publish & Post sequential gating works perfectly')

// Test 8: Pratchaya Rule: Auto-skips OCR & Extract when set to skip
console.log('\n[Test 8] Pratchaya rule: Auto-skips OCR & Extract')
const pratchayaItem = {
  uploadstatus: 'เสร็จแล้ว',
  ocrstatus: 'skip',
  extractstatus: 'skip',
  translatestatus: 'รอเริ่ม',
  translatorname: 'Pratchaya',
  typesetstatus: 'รอเริ่ม',
  publishstatus: 'รอเริ่ม',
  poststatus: 'รอเริ่ม',
}
assert.strictEqual(isQueueStepDone(pratchayaItem, 'upload'), true)
assert.strictEqual(isQueueStepDone(pratchayaItem, 'ocr'), true)
assert.strictEqual(isQueueStepDone(pratchayaItem, 'extract'), true)
assert.strictEqual(matchesStepFilter(pratchayaItem, 'translate'), true, 'Pratchaya enters translate immediately after upload')
assert.strictEqual(getQueueCurrentStep(pratchayaItem), 'translate')
console.log('✓ Test 8 Passed: Pratchaya rule enters translate queue as expected')

// Test 9: Pratchaya with active extract: Extract status explicitly รอเริ่ม or กำลังทำ
console.log('\n[Test 9] Pratchaya with explicitly assigned active extract')
const pratchayaActiveExtract = {
  uploadstatus: 'เสร็จแล้ว',
  ocrstatus: 'เสร็จแล้ว',
  extractstatus: 'รอเริ่ม',
  extractorname: 'Kikkuk',
  translatestatus: 'รอเริ่ม',
  translatorname: 'Pratchaya',
}
assert.strictEqual(isQueueStepDone(pratchayaActiveExtract, 'extract'), false, 'Active extract must not be bypassed')
assert.strictEqual(matchesStepFilter(pratchayaActiveExtract, 'translate'), false, 'Must not show in translate while extract is waiting')
assert.strictEqual(matchesStepFilter(pratchayaActiveExtract, 'extract'), true, 'Must show in extract')
console.log('✓ Test 9 Passed: Pratchaya with active extract is not prematurely bypassed')

// Test 10: Kikkuk Extract Bypasses OCR
console.log('\n[Test 10] Kikkuk Extract Bypasses OCR')
const kikkukDoneOcrPending = {
  uploadstatus: 'เสร็จแล้ว',
  ocrstatus: 'รอเริ่ม',
  extractstatus: 'เสร็จแล้ว',
  extractorname: 'Kikkuk',
  translatestatus: 'กำลังทำ',
  translatorname: 'เร',
}
assert.strictEqual(isQueueStepDone(kikkukDoneOcrPending, 'ocr'), true, 'OCR considered done because Kikkuk already extracted')
assert.strictEqual(isQueueStepDone(kikkukDoneOcrPending, 'extract'), true)
assert.strictEqual(matchesStepFilter(kikkukDoneOcrPending, 'translate'), true, 'Shows in translate')
console.log('✓ Test 10 Passed: Kikkuk extract completion correctly marks OCR as bypassed/done')

// Test 11: Upload Step (First step)
console.log('\n[Test 11] Upload Step (First step)')
const rawWaitingItem = {
  uploadstatus: 'รอเริ่ม',
  ocrstatus: 'รอเริ่ม',
  extractstatus: 'รอเริ่ม',
  translatestatus: 'รอเริ่ม',
}
assert.strictEqual(matchesStepFilter(rawWaitingItem, 'upload'), true)
assert.strictEqual(matchesStepFilter(rawWaitingItem, 'ocr'), false)
assert.strictEqual(matchesStepFilter(rawWaitingItem, 'extract'), false)
assert.strictEqual(matchesStepFilter(rawWaitingItem, 'translate'), false)
assert.strictEqual(getQueueCurrentStep(rawWaitingItem), 'upload')
console.log('✓ Test 11 Passed: Upload step has no previous dependencies and catches new raws')

// Test 12: Pipeline progression consistency
console.log('\n[Test 12] Complete pipeline progression consistency check across all steps')
const steps = ['upload', 'ocr', 'extract', 'translate', 'typeset', 'publish', 'post']
const progressiveItem = {
  uploadstatus: 'รอเริ่ม',
  ocrstatus: 'รอเริ่ม',
  extractstatus: 'รอเริ่ม',
  translatestatus: 'รอเริ่ม',
  typesetstatus: 'รอเริ่ม',
  publishstatus: 'รอเริ่ม',
  poststatus: 'รอเริ่ม',
  translatorname: 'เร',
  extractorname: 'Kikkuk',
}

for (let s = 0; s < steps.length; s++) {
  const currentStep = steps[s]
  assert.strictEqual(getQueueCurrentStep(progressiveItem), currentStep, `Current step at stage ${s} should be ${currentStep}`)
  assert.strictEqual(matchesStepFilter(progressiveItem, currentStep), true, `matchesStepFilter should be true for ${currentStep}`)

  // Verify all OTHER steps return false
  for (let other of steps) {
    if (other !== currentStep) {
      assert.strictEqual(matchesStepFilter(progressiveItem, other), false, `matchesStepFilter should be false for ${other} while at ${currentStep}`)
    }
  }

  // Advance current step to done
  progressiveItem[currentStep + 'status'] = 'เสร็จแล้ว'
}

assert.strictEqual(getQueueCurrentStep(progressiveItem), 'finished')
assert.strictEqual(isStepDone(progressiveItem.poststatus), true)
console.log('✓ Test 12 Passed: Complete pipeline progression strictly consistent end-to-end')

console.log('\n>>> ALL 12 QUEUE STEP SEQUENCING TESTS PASSED 100%! <<<\n')
