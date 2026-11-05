/**
 * Google Apps Script Core JSON API Backend for MangaHub Management System
 * Connected to Google Sheet: 1u3bKrBok0dwhgT_m7FHV_fhXX5mlspitWFiWv3g4B7A
 */

const SPREADSHEET_ID = '1u3bKrBok0dwhgT_m7FHV_fhXX5mlspitWFiWv3g4B7A';
const SHEET_NAME = 'MangaList';
const QUEUE_SHEET_NAME = 'WorkQueue';
const TEAM_SHEET_NAME = 'TeamMembers';
const BUDGET_PAYEE_SHEET_NAME = 'BudgetPayees';
const BUDGET_TRANSACTION_SHEET_NAME = 'BudgetTransactions';
const MANGA_SALES_SHEET_NAME = 'MangaSales';
const WEBSITE_SHEET_NAME = 'Websites';
const ACCESS_PASSCODE = '10211032';
const FINANCIAL_PASSCODE = '720102';
const RAW_TRACKER_SHEET_NAME = 'RawTracker';
const PAYOUT_CLAIMS_SHEET_NAME = 'PayoutClaims';
const READREALM_GROWTH_SHEET_NAME = 'ReadRealmGrowth';
const READREALM_TIMELINE_SHEET_NAME = 'ReadRealm_Timeline_Summary';
const READREALM_WORKFLOW_FILE = 'readrealm_tracker.yml';
const PROJECT_IDEAS_WORKFLOW_FILE = 'project_ideas_crawler.yml';
const KAIREW_GROWTH_SHEET_NAME = 'KairewGrowth';
const KAIREW_TIMELINE_SHEET_NAME = 'Kairew_Timeline_Summary';
const CHAPLY_GROWTH_SHEET_NAME = 'ChaplyGrowth';
const CHAPLY_TIMELINE_SHEET_NAME = 'Chaply_Timeline_Summary';

// --- TELEGRAM CONFIGURATION ---
const TELEGRAM_BOT_TOKEN = '7836927758:AAHpsoCToMUxoeAzo5UMtMum3Ix5rIO_VOc';
const TELEGRAM_CHAT_ID = '-1003994957418';

// --- AUTO UPDATE CONFIGURATION ---
const AUTO_UPDATE_API_URL = 'https://nonstoptoon.pages.dev/api/autoupdate';
const AUTO_UPDATE_SECRET = 'ADOBE445@CHIM9987';

/**
 * Create a standardized JSON response for GAS Web App
 */
function createJsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * GET Handler (Health check & read-only queries)
 */
function doGet(e) {
  try {
    const params = (e && e.parameter) ? e.parameter : {};
    const action = params.action || 'HEALTH';

    if (action === 'HEALTH') {
      return createJsonResponse({
        status: 'success',
        data: {
          service: 'MangaHub Core GAS API',
          version: '2.0.0',
          spreadsheetId: SPREADSHEET_ID,
          timestamp: new Date().toISOString()
        }
      });
    }

    if (params.passcode !== ACCESS_PASSCODE && params.passcode !== FINANCIAL_PASSCODE) {
      return createJsonResponse({ status: 'error', message: 'รหัสผ่านไม่ถูกต้อง (Unauthorized)' });
    }

    if (action === 'GET_DASHBOARD_DATA') {
      return createJsonResponse({ status: 'success', data: getDashboardData(params.forceRefresh === 'true') });
    }

    return createJsonResponse({ status: 'error', message: 'Unknown GET action: ' + action });
  } catch (err) {
    return createJsonResponse({ status: 'error', message: err.toString() });
  }
}

/**
 * POST Handler (Handles both Frontend JSON API and Telegram Webhook)
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return createJsonResponse({ status: 'error', message: 'Empty request body' });
    }

    const contents = JSON.parse(e.postData.contents);

    // 1. Check if this is a Telegram Bot Webhook update
    if (contents.message) {
      const chatId = contents.message.chat.id;
      const text = contents.message.text;

      if (text && text.startsWith('/')) {
        const commandParts = text.split(' ');
        const command = commandParts[0].toLowerCase().split('@')[0];
        const args = commandParts.slice(1);
        handleTelegramCommand(chatId, command, args);
      }
      return createJsonResponse({ ok: true });
    }

    // 2. Frontend JSON API Dispatcher
    const { action, payload = {}, passcode } = contents;

    if (!action) {
      return createJsonResponse({ status: 'error', message: 'Missing action field' });
    }

    // Allow passcode verification endpoint without prior auth
    if (action === 'VERIFY_PASSCODE' || action === 'VERIFY_FINANCIAL_PASSCODE') {
      const codeToVerify = payload.passcode !== undefined ? payload.passcode : passcode;
      const isFinancial = action === 'VERIFY_FINANCIAL_PASSCODE' || payload.type === 'financial';
      const isValid = isFinancial
        ? verifyFinancialPasscode(String(codeToVerify || '').trim())
        : verifyPasscode(String(codeToVerify || '').trim());
      return createJsonResponse({
        status: 'success',
        data: { valid: isValid }
      });
    }

    // Verify passcode on every API call
    const reqPass = String(passcode || '').trim();
    if (reqPass !== ACCESS_PASSCODE && reqPass !== FINANCIAL_PASSCODE) {
      return createJsonResponse({
        status: 'error',
        code: 'UNAUTHORIZED',
        message: 'รหัสผ่านเข้าใช้งานไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่'
      });
    }

    let result;

    switch (action) {
      // --- INIT / DASHBOARD ---
      case 'INIT_SHEETS':
        result = initializeAllSheets();
        break;
      case 'GET_DASHBOARD_DATA':
        result = getDashboardData(Boolean(payload.forceRefresh), payload.month, payload.year);
        break;
      case 'GET_ALL_DATA':
        result = getAllData();
        break;

      // --- MANGA CRUD ---
      case 'GET_MANGA_LIST':
        if (payload.forceRefresh) invalidateCache('mangaList');
        result = getMangaList();
        break;
      case 'ADD_MANGA':
        result = addManga(payload);
        break;
      case 'UPDATE_MANGA':
        result = updateManga(payload.id, payload.data);
        break;
      case 'DELETE_MANGA':
        result = deleteManga(payload.id);
        break;

      // --- WORK QUEUE CRUD ---
      case 'GET_WORK_QUEUE':
        result = getWorkQueue(Boolean(payload.forceRefresh), payload.month, payload.year, Boolean(payload.includeIncomplete));
        break;
      case 'ADD_QUEUE':
        result = addQueue(payload);
        break;
      case 'UPDATE_QUEUE_STEP':
        result = updateQueueStep(
          payload.queueId,
          payload.step,
          payload.status,
          payload.assignee,
          payload.link,
          payload.note,
          payload.typesetType || payload.typesettype
        );
        break;
      case 'BULK_UPDATE_QUEUE_STEP':
        result = bulkUpdateQueueStep(
          payload.queueIds,
          payload.step,
          payload.status,
          payload.assignee
        );
        break;
      case 'UPDATE_FULL_QUEUE_ITEM':
        result = updateFullQueueItem(payload.queueId, payload.updateData);
        break;
      case 'DELETE_QUEUE_ITEM':
        result = deleteQueueItem(payload.id);
        break;
      case 'CHECK_QUEUE_LOCK':
        result = checkQueueLock(payload.queueId);
        break;

      // --- TEAM CRUD ---
      case 'GET_TEAM_MEMBERS':
        if (payload.forceRefresh) invalidateCache('teamList');
        result = getTeamMembers();
        break;
      case 'ADD_TEAM_MEMBER':
        result = addTeamMember(payload);
        break;
      case 'UPDATE_TEAM_MEMBER':
        result = updateTeamMember(payload.id, payload.data);
        break;
      case 'DELETE_TEAM_MEMBER':
        result = deleteTeamMember(payload.id);
        break;

      // --- BUDGET & ACCOUNTING CRUD ---
      case 'GET_BUDGET_DATA':
        result = getBudgetData();
        break;
      case 'GET_BUDGET_PAYEES':
        result = getBudgetPayees();
        break;
      case 'ADD_BUDGET_PAYEE':
        result = addBudgetPayee(payload);
        break;
      case 'UPDATE_BUDGET_PAYEE':
        result = updateBudgetPayee(payload.id, payload.data);
        break;
      case 'DELETE_BUDGET_PAYEE':
        result = deleteBudgetPayee(payload.id);
        break;
      case 'GET_BUDGET_TRANSACTIONS':
        result = getBudgetTransactions();
        break;
      case 'ADD_BUDGET_TRANSACTION':
        result = addBudgetTransaction(payload);
        break;
      case 'UPDATE_BUDGET_TRANSACTION':
        result = updateBudgetTransaction(payload.id, payload.data || payload);
        break;
      case 'DELETE_BUDGET_TRANSACTION':
        result = deleteBudgetTransaction(payload.id);
        break;
      case 'GET_PENDING_PAID_CLAIMS_FOR_BUDGET':
        result = getPendingPaidClaimsForBudget(payload);
        break;
      case 'SYNC_PAID_CLAIMS_TO_BUDGET':
        result = syncPaidClaimsToBudget(payload);
        break;

      // --- FINANCIALS (MANGA SALES) CRUD ---
      case 'GET_FINANCIAL_DATA':
        result = getFinancialInitData();
        break;
      case 'GET_MANGA_SALES':
        result = getMangaSales();
        break;
      case 'ADD_MANGA_SALE':
        result = addMangaSale(payload);
        break;
      case 'BULK_ADD_MANGA_SALES':
        result = bulkAddMangaSales(payload.sales);
        break;
      case 'DELETE_MANGA_SALE':
        result = deleteMangaSale(payload.index, payload.sale);
        break;
      case 'COUNT_FINISHED_CHAPTERS':
        result = countFinishedChapters(payload.mangaId, payload.year, payload.month);
        break;

      // --- SYSTEM TRIGGERS & AUTOMATION ---
      case 'CREATE_AUTO_QUEUE_TRIGGER':
        result = { message: createAutoQueueTrigger() };
        break;
      case 'CREATE_MOVE_PENDING_TRIGGER':
        result = { message: createMovePendingTrigger() };
        break;
      case 'MOVE_PENDING_QUEUE':
        result = { message: movePendingQueueToCurrentMonth(), queue: getWorkQueue(true) };
        break;
      case 'PROCESS_AUTO_QUEUE':
        processAutoQueue();
        result = { message: 'ระบบเพิ่มคิวอัตโนมัติตามวันปล่อยดิบ (Release Day) ถูกปิดใช้งานแล้ว', queue: getWorkQueue(true) };
        break;

      // --- PAYOUT CLAIMS (เบิกจ่ายค่าจ้าง) ---
      case 'GET_PAYOUT_CLAIMS':
        result = getPayoutClaims();
        break;
      case 'SUBMIT_PAYOUT_CLAIM':
        result = submitPayoutClaim(payload);
        break;
      case 'UPDATE_PAYOUT_CLAIM_STATUS':
        result = updatePayoutClaimStatus(payload.claimId, payload.status, payload.note);
        break;
      case 'UPDATE_PAYOUT_CLAIM':
        result = updatePayoutClaim(payload.claimId, payload.updateData || payload);
        break;

      // --- RAW TRACKER (ต้นฉบับ UPDATE) ---
      case 'GET_RAW_TRACKER_LIST':
        result = getRawTrackerList();
        break;
      case 'ADD_RAW_TRACKER':
        result = addRawTracker(payload);
        break;
      case 'UPDATE_RAW_TRACKER':
        result = updateRawTracker(payload.id, payload.data);
        break;
      case 'DELETE_RAW_TRACKER':
        result = deleteRawTracker(payload.id);
        break;
      case 'SCRAPE_RAW_URL':
        result = scrapeRawUrl(payload.url, payload.pattern);
        break;
      case 'CHECK_ALL_RAW_TRACKERS':
        result = checkAllRawTrackers(Boolean(payload.notifyTelegram));
        break;
      case 'IMPORT_FROM_MANGA_LIST':
        result = importTrackersFromMangaList();
        break;
      case 'SYNC_SINGLE_RAW_TRACKER':
        result = syncSingleRawTrackerWithManga(payload.id || payload.trackerId);
        break;
      case 'SETUP_HOURLY_TRACKER_TRIGGER':
        result = setupHourlyTrackerTrigger();
        break;
      case 'TRIGGER_RAW_TRACKER_PIPELINE':
        result = triggerGitHubRawTrackerPipeline(payload ? payload.source : 'frontend_ui');
        break;

      // --- READREALM TRACKER (6-HOUR AUTOMATION) ---
      case 'TRIGGER_READREALM_TRACKER':
        result = triggerGitHubReadRealmTrackerPipeline(payload ? payload.source : 'gas_trigger');
        break;
      case 'SETUP_READREALM_6H_TRIGGER':
        result = { message: createReadRealm6HourTrigger() };
        break;
      case 'DELETE_READREALM_6H_TRIGGER':
        result = { message: deleteReadRealm6HourTrigger() };
        break;
      // --- PROJECT IDEAS DISCOVERY (6-HOUR AUTOMATION) ---
      case 'TRIGGER_PROJECT_IDEAS_PIPELINE':
        result = triggerGitHubProjectIdeasPipeline(payload ? payload.source : 'frontend_ui');
        break;
      case 'CREATE_PROJECT_IDEAS_TRIGGER':
        result = { message: createProjectIdeas6HourTrigger() };
        break;
      case 'DELETE_PROJECT_IDEAS_TRIGGER':
        result = { message: deleteProjectIdeasTrigger() };
        break;
      case 'GET_PROJECT_IDEAS_TRIGGER_STATUS':
        result = getProjectIdeasTriggerStatus();
        break;

      case 'GET_READREALM_TRACKER_STATUS':
        result = getReadRealmTrackerStatus();
        break;
      case 'SAVE_KAIREW_GROWTH_DATA':
        result = saveKairewGrowthData(payload);
        break;
      case 'GET_KAIREW_GROWTH_DATA':
        result = getKairewGrowthData();
        break;
      case 'SAVE_CHAPLY_GROWTH_DATA':
        result = saveChaplyGrowthData(payload);
        break;
      case 'GET_CHAPLY_GROWTH_DATA':
        result = getChaplyGrowthData();
        break;
      case 'SAVE_READREALM_GROWTH_DATA':
        result = saveReadRealmGrowthData(payload);
        break;
      case 'GET_READREALM_GROWTH_DATA':
        result = getReadRealmGrowthData();
        break;
      case 'GET_AUTO_TRACKER_STATUS':
        result = getAutoTrackerStatus();
        break;
      case 'SET_GITHUB_TOKEN':
        result = setGitHubToken(payload ? payload.token : '');
        break;
      case 'GET_RAW_TRACKER_PENDING_CHAPTERS':
        result = getRawTrackerPendingChapters(payload ? payload.trackerId : null);
        break;
      case 'COMPLETE_RAW_TRACKER_CHAPTER':
        result = completeRawTrackerChapter(payload);
        break;

      // --- KUAIKAN VIP & WECHAT AUTH ---
      case 'GET_KUAIKAN_QR':
        result = getKuaikanQrSession();
        break;
      case 'CHECK_KUAIKAN_QR':
        result = checkKuaikanQrStatus(payload);
        break;
      case 'SAVE_KUAIKAN_AUTH':
        result = saveKuaikanAuth(payload);
        break;
      case 'GET_KUAIKAN_AUTH':
      case 'GET_KUAIKAN_SESSION':
      case 'GET_KUAIKAN_AUTH_STATUS':
        result = getKuaikanAuthStatus();
        break;
      case 'CHECK_KUAIKAN_WALLET':
        result = checkKuaikanWalletStatus();
        break;
      case 'SET_KUAIKAN_COIN_ALERT':
        result = setKuaikanCoinAlert(payload);
        break;
      case 'DISMISS_KUAIKAN_COIN_ALERT':
      case 'CLEAR_KUAIKAN_COIN_ALERT':
        result = dismissKuaikanCoinAlert();
        break;
      case 'CLEAR_KUAIKAN_AUTH':
        result = clearKuaikanAuth();
        break;
      case 'TEST_KUAIKAN_CHAPTER':
        result = testKuaikanLatestChapter(payload ? payload.comicId : null, null, payload);
        break;
      case 'PURCHASE_KUAIKAN_CHAPTER':
      case 'BUY_KUAIKAN_CHAPTER':
        result = purchaseKuaikanChapter(payload);
        break;
      case 'DOWNLOAD_KUAIKAN_CHAPTER':
        result = downloadKuaikanChapterToDrive(payload);
        break;
      case 'UPLOAD_CHAPTER_STITCHED_PART':
        result = uploadChapterStitchedPart(payload);
        break;

      // --- THUNDERSCANS EN CONNECTOR ---
      case 'GET_THUNDERSCANS_SESSION':
      case 'GET_THUNDERSCANS_AUTH':
        result = getThunderscansSession();
        break;
      case 'SAVE_THUNDERSCANS_SESSION':
      case 'SAVE_THUNDERSCANS_AUTH':
        result = saveThunderscansSession(payload);
        break;
      case 'CLEAR_THUNDERSCANS_SESSION':
      case 'CLEAR_THUNDERSCANS_AUTH':
        result = clearThunderscansSession();
        break;
      case 'TEST_THUNDERSCANS_CHAPTER':
        const thUrl = payload ? (payload.chapterUrl || payload.url || payload.chapter_url || '') : '';
        const thCookie = payload ? (payload.cookie || payload.directCookie || '') : '';
        result = testThunderscansChapter(thUrl, thCookie);
        break;
      case 'PROXY_THUNDERSCANS_IMAGE':
        result = proxyThunderScansImage(payload);
        break;

      default:
        return createJsonResponse({ status: 'error', message: 'Unknown action: ' + action });
    }

    if (result && result.error) {
      return createJsonResponse({ status: result.status || 'error', message: result.error, data: result });
    }

    if (result && result.status && result.data !== undefined) {
      return createJsonResponse(result);
    }

    return createJsonResponse({ status: 'success', data: result });
  } catch (err) {
    console.error('Error in doPost:', err);
    return createJsonResponse({ status: 'error', message: err.toString() });
  }
}

function initializeAllSheets() {
  const sheetNames = [
    SHEET_NAME,
    QUEUE_SHEET_NAME,
    TEAM_SHEET_NAME,
    BUDGET_PAYEE_SHEET_NAME,
    BUDGET_TRANSACTION_SHEET_NAME,
    MANGA_SALES_SHEET_NAME,
    WEBSITE_SHEET_NAME,
    PAYOUT_CLAIMS_SHEET_NAME
  ];
  sheetNames.forEach(name => getSheet(name));
  return { initialized: sheetNames };
}

/**
 * Sends an HTTP POST request to update manga episode count on the website.
 * @param {string} mangaSlug The slug identifier for the manga (titleId)
 * @param {number} episodeNumber The episode number to update
 */
function updateMangaEpisodeOnWebsite(mangaSlug, episodeNumber) {
  console.log(`Triggered updateMangaEpisodeOnWebsite for slug: ${mangaSlug}, episode: ${episodeNumber}`);
  
  if (!AUTO_UPDATE_API_URL || AUTO_UPDATE_API_URL === 'YOUR_API_URL_HERE') {
    console.warn('AUTO_UPDATE_API_URL is not configured. Skipping website update.');
    return;
  }

  const payload = {
    "title": mangaSlug,
    "episode": episodeNumber,
    "secret": AUTO_UPDATE_SECRET
  };

  const options = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };

  try {
    const response = UrlFetchApp.fetch(AUTO_UPDATE_API_URL, options);
    const statusCode = response.getResponseCode();
    const content = response.getContentText();
    
    if (statusCode >= 200 && statusCode < 300) {
      console.log(`Successfully updated ${mangaSlug} to episode ${episodeNumber}. Response: ${content}`);
    } else {
      console.error(`Failed to update ${mangaSlug}. Status: ${statusCode}. Response: ${content}`);
    }
  } catch (e) {
    console.error(`Error updating manga episode: ${e.toString()}`);
  }
}

// Spreadsheet Singleton & Cache Helper Functions
let _globalSpreadsheetInstance = null;
function getSpreadsheet() {
  if (!_globalSpreadsheetInstance) {
    _globalSpreadsheetInstance = SpreadsheetApp.openById(SPREADSHEET_ID);
  }
  return _globalSpreadsheetInstance;
}

function getCachedData(key, fetchFunction, ttlSeconds = 600) {
  const cache = CacheService.getScriptCache();
  try {
    const metaStr = cache.get(key + '_meta');
    if (metaStr) {
      const numChunks = parseInt(metaStr, 10);
      const chunkKeys = [];
      for (let i = 0; i < numChunks; i++) chunkKeys.push(key + '_' + i);
      const chunksMap = cache.getAll(chunkKeys);
      let combined = '';
      let isComplete = true;
      for (let i = 0; i < numChunks; i++) {
        const part = chunksMap[key + '_' + i];
        if (part === undefined || part === null) {
          isComplete = false;
          break;
        }
        combined += part;
      }
      if (isComplete && combined) {
        return JSON.parse(combined);
      }
    } else {
      const single = cache.get(key);
      if (single) {
        return JSON.parse(single);
      }
    }
  } catch (e) {
    console.warn('Cache read error (' + key + '):', e);
  }

  // Cache Miss: Run fetchFunction
  const result = fetchFunction();
  try {
    const serialized = JSON.stringify(result);
    const CHUNK_SIZE = 90000;
    if (serialized.length <= CHUNK_SIZE) {
      cache.put(key, serialized, ttlSeconds);
    } else {
      const numChunks = Math.ceil(serialized.length / CHUNK_SIZE);
      const chunkMap = {};
      chunkMap[key + '_meta'] = String(numChunks);
      for (let i = 0; i < numChunks; i++) {
        chunkMap[key + '_' + i] = serialized.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      }
      cache.putAll(chunkMap, ttlSeconds);
    }
  } catch (e) {
    console.error('Cache write error (' + key + '):', e);
  }
  return result;
}

function invalidateCache(keys) {
  const cache = CacheService.getScriptCache();
  const keysArray = Array.isArray(keys) ? keys : [keys];
  const toRemove = [];
  keysArray.forEach(k => {
    toRemove.push(k);
    toRemove.push(k + '_meta');
    for (let i = 0; i < 20; i++) {
      toRemove.push(k + '_' + i);
    }
  });
  cache.removeAll(toRemove);
}

function ensureSheetHeaders(sheet, name) {
  if (name === SHEET_NAME) {
    const lastCol = sheet.getLastColumn();
    if (lastCol > 0) {
      const ensureCol = (colName, defaultVal) => {
        const currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => h.toString().toLowerCase().trim());
        if (currentHeaders.indexOf(colName.toLowerCase()) === -1) {
          const newCol = sheet.getLastColumn() + 1;
          sheet.getRange(1, newCol).setValue(colName);
          if (defaultVal !== undefined && sheet.getLastRow() > 1) {
            sheet.getRange(2, newCol, sheet.getLastRow() - 1, 1).setValue(defaultVal);
          }
        }
      };
      ensureCol('NeedsExtract', true);
      ensureCol('ReleaseDay', 'None');
      ensureCol('CostPerChapter', 0);
      ensureCol('LockedTranslator', '');
      ensureCol('NotifyOnAdd', false);
      ensureCol('Slug', '');
      ensureCol('IsUrgent', false);
    }
  }

  if (name === QUEUE_SHEET_NAME) {
    const lastCol = sheet.getLastColumn();
    if (lastCol > 0) {
      const currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => h.toString().toLowerCase().trim());
      const required = ['poststatus', 'postername', 'posttime', 'isediting', 'editingby', 'editingtime', 'typesettype'];
      const displayMap = {
        'poststatus': 'PostStatus',
        'postername': 'PosterName',
        'posttime': 'PostTime',
        'isediting': 'IsEditing',
        'editingby': 'EditingBy',
        'editingtime': 'EditingTime',
        'typesettype': 'TypesetType'
      };
      required.forEach(req => {
        if (currentHeaders.indexOf(req) === -1) {
          const newCol = sheet.getLastColumn() + 1;
          sheet.getRange(1, newCol).setValue(displayMap[req] || (req.charAt(0).toUpperCase() + req.slice(1)));
        }
      });
    }
  }

  if (name === PAYOUT_CLAIMS_SHEET_NAME) {
    const lastCol = sheet.getLastColumn();
    if (lastCol > 0) {
      const currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => h.toString().toLowerCase().trim());
      const required = ['startdate', 'enddate'];
      const displayMap = {
        'startdate': 'StartDate',
        'enddate': 'EndDate'
      };
      required.forEach(req => {
        if (currentHeaders.indexOf(req) === -1) {
          const newCol = sheet.getLastColumn() + 1;
          sheet.getRange(1, newCol).setValue(displayMap[req]);
        }
      });
    }
  }

  if (name === RAW_TRACKER_SHEET_NAME) {
    const lastCol = sheet.getLastColumn();
    if (lastCol > 0) {
      const currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => h.toString().toLowerCase().trim());
      if (currentHeaders.indexOf('currentchapter') === -1) {
        const newCol = sheet.getLastColumn() + 1;
        sheet.getRange(1, newCol).setValue('CurrentChapter');
      }
    }
  }
}

function getSheet(name = SHEET_NAME) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (sheet) {
    ensureSheetHeaders(sheet, name);
  }
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (name === SHEET_NAME) {
      sheet.appendRow([
        'MangaID', 'MangaName', 'OriginalName', 'OriginalUrl', 'Status',
        'LastChapter', 'LastUpdated', 'NeedsExtract', 'ReleaseDay',
        'CostPerChapter', 'LockedTranslator', 'NotifyOnAdd', 'Slug', 'IsUrgent'
      ]);
      sheet.getRange(1, 1, 1, 14).setFontWeight('bold').setBackground('#4f46e5').setFontColor('#ffffff');
    } else if (name === QUEUE_SHEET_NAME) {
      const headers = [
        'QueueID', 'CreatedAt', 'MangaID', 'Chapter', 
        'UploadStatus', 'UploaderName', 'UploadTime',
        'ExtractStatus', 'ExtractorName', 'ExtractTime',
        'TranslateStatus', 'TranslatorName', 'TranslateTime',
        'TypesetStatus', 'TypesetterName', 'TypesetTime',
        'PublishStatus', 'PublisherName', 'PublishTime', 
        'PostStatus', 'PosterName', 'PostTime',
        'WorkLink', 'Note',
        'IsEditing', 'EditingBy', 'EditingTime'
      ];
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#3730a3').setFontColor('#ffffff');
    } else if (name === TEAM_SHEET_NAME) {
      const headers = ['MemberID', 'Name', 'Role', 'Status'];
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#10b981').setFontColor('#ffffff');
      sheet.appendRow(['T1', 'ตัวอย่าง สมาชิก1', 'Translator', 'Active']);
    } else if (name === BUDGET_PAYEE_SHEET_NAME) {
      const headers = ['PayeeID', 'Name', 'TaxID', 'BankAccount', 'BankName', 'Note'];
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#0ea5e9').setFontColor('#ffffff');
    } else if (name === BUDGET_TRANSACTION_SHEET_NAME) {
      const headers = ['TransactionID', 'Date', 'Type', 'Amount', 'Category', 'Reference', 'Note'];
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#f59e0b').setFontColor('#ffffff');
    } else if (name === MANGA_SALES_SHEET_NAME) {
      const headers = [
        'Date', 'Month', 'SeriesChapterID', 'SeriesName', 'ChaptersCount', 
        'Category', 'Website', 'Page', 'TargetPerChapter', 'TotalTarget', 
        'CostPerChapter', 'TotalCost', 'Revenue', 'Profit'
      ];
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#6366f1').setFontColor('#ffffff');
    } else if (name === WEBSITE_SHEET_NAME) {
      const headers = ['WebsiteName'];
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#6366f1').setFontColor('#ffffff');
      const defaults = [
        ['ReadRealm แปลจนเมื่อย'],
        ['ReadRealm น้องแมวส้ม'],
        ['ReadRealm แปลแล้วแปลอีก'],
        ['ReadRealm แปลจนแขนหัก'],
        ['Other']
      ];
      sheet.getRange(2, 1, defaults.length, 1).setValues(defaults);
    } else if (name === RAW_TRACKER_SHEET_NAME) {
      const headers = [
        'TrackerID', 'MangaID', 'MangaName', 'Url', 'Pattern',
        'LastRawText', 'LastRawCount', 'Status', 'LastChecked', 'UpdatedAt', 'AutoCheck', 'CurrentChapter'
      ];
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#ec4899').setFontColor('#ffffff');
    } else if (name === PAYOUT_CLAIMS_SHEET_NAME) {
      const headers = [
        'ClaimID', 'CreatedAt', 'StaffName', 'Role', 'DateRange', 'StartDate', 'EndDate',
        'TotalChapters', 'TotalAmount', 'Status', 'ApprovedAt', 'PaidAt', 'Note', 'QueueItemIds'
      ];
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#10b981').setFontColor('#ffffff');
    } else if (name === READREALM_GROWTH_SHEET_NAME) {
      const headers = [
        'RecordedAt', 'Date', 'ComicID', 'Subject', 'Account',
        'TotalSales', 'TotalViews', 'ChaptersCount', 'LastChapterUpdate', 'DaysInactive',
        'SalesDelta7d', 'SalesGrowthPct7d', 'ViewsDelta7d', 'ViewsGrowthPct7d',
        'SalesDelta30d', 'SalesGrowthPct30d', 'ViewsDelta30d', 'ViewsGrowthPct30d'
      ];
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#3b82f6').setFontColor('#ffffff');
    } else if (name === KAIREW_GROWTH_SHEET_NAME) {
      const headers = [
        'RecordedAt', 'Date', 'ComicID', 'Subject', 'Account',
        'TotalSales', 'TotalViews', 'ChaptersCount', 'LastChapterUpdate', 'DaysInactive',
        'SalesDelta7d', 'SalesGrowthPct7d', 'ViewsDelta7d', 'ViewsGrowthPct7d',
        'SalesDelta30d', 'SalesGrowthPct30d', 'ViewsDelta30d', 'ViewsGrowthPct30d'
      ];
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#059669').setFontColor('#ffffff');
    } else if (name === KAIREW_TIMELINE_SHEET_NAME) {
      const headers = [
        'RecordedAt', 'Date', 'Time', 'TotalSalesPortfolio', 'TotalViewsPortfolio', 'TotalComics',
        'TopSalesComic', 'InactiveCount30d', 'ActiveCount30d', 'Note'
      ];
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#10b981').setFontColor('#ffffff');
    } else if (name === CHAPLY_GROWTH_SHEET_NAME) {
      const headers = [
        'RecordedAt', 'Date', 'ComicID', 'Subject', 'Account',
        'TotalSales', 'TotalViews', 'ChaptersCount', 'LastChapterUpdate', 'DaysInactive',
        'SalesDelta7d', 'SalesGrowthPct7d', 'ViewsDelta7d', 'ViewsGrowthPct7d',
        'SalesDelta30d', 'SalesGrowthPct30d', 'ViewsDelta30d', 'ViewsGrowthPct30d'
      ];
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#ea580c').setFontColor('#ffffff');
    } else if (name === CHAPLY_TIMELINE_SHEET_NAME) {
      const headers = [
        'RecordedAt', 'Date', 'Time', 'TotalSalesPortfolio', 'TotalViewsPortfolio', 'TotalComics',
        'TopSalesComic', 'InactiveCount30d', 'ActiveCount30d', 'Note'
      ];
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#f97316').setFontColor('#ffffff');
    } else if (name === READREALM_TIMELINE_SHEET_NAME) {
      const headers = [
        'RecordedAt', 'Date', 'Time', 'TotalSalesPortfolio', 'TotalViewsPortfolio', 'TotalComics',
        'LionkingSales', 'LionkingViews', 'AdieuSales', 'AdieuViews',
        'TopSalesComic', 'TopGrowthComic7d', 'TopGrowthComic30d', 'Note'
      ];
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#6366f1').setFontColor('#ffffff');
    }
    ensureSheetHeaders(sheet, name);
  }
  return sheet;
}

/**
 * READ: ดึงข้อมูลและแปลงเป็น Object ตามหัวตาราง
 */
function getMangaList() {
  try {
    const sheet = getSheet();
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];

    const rawHeaders = data.shift();
    const headers = rawHeaders.map(h => h.toString().toLowerCase().trim());
    
    return data.map(row => {
      let obj = {};
      headers.forEach((header, i) => {
        let val = row[i];
        if (val instanceof Date) {
          val = val.toISOString();
        }
        obj[header] = val;
      });
      return obj;
    }).filter(item => item.manganame);
  } catch (err) {
    console.error('getMangaList Error:', err);
    return [];
  }
}

/**
 * Helper: หา ID ถัดไป
 */
function getNextId() {
  try {
    const sheet = getSheet();
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return 1;
    
    let maxId = 0;
    for (let i = 1; i < data.length; i++) {
      const id = parseInt(data[i][0]);
      if (!isNaN(id) && id > maxId) maxId = id;
    }
    return maxId + 1;
  } catch (e) {
    return 1;
  }
}

/**
 * CREATE: บันทึกข้อมูลใหม่
 */
function addManga(manga) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const sheet = getSheet();
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => h.toString().toLowerCase().trim());
    
    const id = getNextId();
    const timestamp = new Date();
    
    const newRow = headers.map(header => {
      if (header === 'mangaid') return id;
      if (header === 'manganame') return manga.manganame || '';
      if (header === 'originalname') return manga.originalname || '';
      if (header === 'originalurl') return manga.originalurl || '';
      if (header === 'status') return manga.status || 'Ongoing';
      if (header === 'lastchapter') return manga.lastchapter || '0';
      if (header === 'lastupdated') return timestamp;
      if (header === 'needsextract') return manga.needsextract !== undefined ? manga.needsextract : true;
      if (header === 'releaseday') return manga.releaseday || 'None';
      if (header === 'costperchapter') return manga.costperchapter || 0;
      if (header === 'lockedtranslator') return manga.lockedtranslator || '';
      if (header === 'notifyonadd') return manga.notifyonadd !== undefined ? manga.notifyonadd : false;
      if (header === 'slug') return manga.slug || '';
      if (header === 'isurgent') return manga.isurgent !== undefined ? manga.isurgent : false;
      return '';
    });

    sheet.appendRow(newRow);
    invalidateCache('mangaList');
    return {
      success: true,
      mangaId: id,
      list: getMangaList()
    };
  } catch (err) {
    return { error: 'Add Failed: ' + err.toString() };
  } finally {
    lock.releaseLock();
  }
}

function addTeamMember(member) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const sheet = getSheet(TEAM_SHEET_NAME);
    const id = 'T' + new Date().getTime();
    sheet.appendRow([id, member.name, member.role, member.status || 'Active']);
    invalidateCache('teamList');
    return getTeamMembers();
  } catch (err) {
    return { error: 'Add Member Failed: ' + err.toString() };
  } finally {
    lock.releaseLock();
  }
}

function deleteTeamMember(id) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const sheet = getSheet(TEAM_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toString() === id.toString()) {
        sheet.deleteRow(i + 1);
        invalidateCache('teamList');
        return getTeamMembers();
      }
    }
    return { error: 'Member not found' };
  } catch (err) {
    return { error: 'Delete Member Failed: ' + err.toString() };
  } finally {
    lock.releaseLock();
  }
}

function updateTeamMember(id, updatedMember) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const sheet = getSheet(TEAM_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => h.toString().toLowerCase().trim());
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toString() === id.toString()) {
        const rowNum = i + 1;
        headers.forEach((header, index) => {
          const colNum = index + 1;
          if (header === 'name') sheet.getRange(rowNum, colNum).setValue(updatedMember.name);
          if (header === 'role') sheet.getRange(rowNum, colNum).setValue(updatedMember.role);
          if (header === 'status') sheet.getRange(rowNum, colNum).setValue(updatedMember.status);
        });
        invalidateCache('teamList');
        return getTeamMembers();
      }
    }
    return { error: 'Member not found: ' + id };
  } catch (err) {
    return { error: 'Update Member Failed: ' + err.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * UPDATE: แก้ไขข้อมูลมังงะ
 */
function updateManga(id, updatedManga) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const sheet = getSheet();
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => h.toString().toLowerCase().trim());
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toString() === id.toString()) {
        const rowNum = i + 1;
        headers.forEach((header, index) => {
          const colNum = index + 1;
          if (header === 'manganame') sheet.getRange(rowNum, colNum).setValue(updatedManga.manganame);
          if (header === 'originalname') sheet.getRange(rowNum, colNum).setValue(updatedManga.originalname);
          if (header === 'originalurl') sheet.getRange(rowNum, colNum).setValue(updatedManga.originalurl);
          if (header === 'status') sheet.getRange(rowNum, colNum).setValue(updatedManga.status);
          if (header === 'lastchapter') sheet.getRange(rowNum, colNum).setValue(updatedManga.lastchapter);
          if (header === 'lastupdated') sheet.getRange(rowNum, colNum).setValue(new Date());
          if (header === 'needsextract') sheet.getRange(rowNum, colNum).setValue(updatedManga.needsextract !== undefined ? updatedManga.needsextract : true);
          if (header === 'releaseday') sheet.getRange(rowNum, colNum).setValue(updatedManga.releaseday || 'None');
          if (header === 'costperchapter') sheet.getRange(rowNum, colNum).setValue(updatedManga.costperchapter || 0);
          if (header === 'lockedtranslator') sheet.getRange(rowNum, colNum).setValue(updatedManga.lockedtranslator || '');
          if (header === 'notifyonadd') sheet.getRange(rowNum, colNum).setValue(updatedManga.notifyonadd !== undefined ? updatedManga.notifyonadd : false);
          if (header === 'slug') sheet.getRange(rowNum, colNum).setValue(updatedManga.slug || '');
          if (header === 'isurgent') sheet.getRange(rowNum, colNum).setValue(updatedManga.isurgent !== undefined ? updatedManga.isurgent : false);
        });
        invalidateCache('mangaList');
        
        // ซิงค์ชื่อ, URL และเลขตอนล่าสุด ไปยัง RawTracker sheet ด้วย
        try {
          syncRawTrackerMangaInfo(id, updatedManga.manganame, updatedManga.originalurl, updatedManga.lastchapter);
        } catch (trkErr) {
          console.warn('Could not sync RawTracker info:', trkErr);
        }

        return getMangaList();
      }
    }
    return { error: 'ไม่พบข้อมูล ID: ' + id };
  } catch (err) {
    return { error: 'Update Failed: ' + err.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * DELETE: ลบข้อมูลมังงะ
 */
function deleteManga(id) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const sheet = getSheet();
    const data = sheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toString() === id.toString()) {
        sheet.deleteRow(i + 1);
        invalidateCache('mangaList');

        // ลบออกจาก RawTracker sheet ด้วยเพื่อไม่ให้ตกค้างในระบบติดตาม
        try {
          deleteRawTrackerByMangaId(id);
        } catch (trkErr) {
          console.warn('Could not delete from RawTracker:', trkErr);
        }

        return getMangaList();
      }
    }
    return { error: 'ไม่พบข้อมูลในการลบ' };
  } catch (err) {
    return { error: 'Delete Failed: ' + err.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * QUEUE OPERATIONS (Direct Dynamic Query)
 */
function getWorkQueue(forceRefresh = false, month = 'all', year = 'all', includeIncomplete = false) {
  try {
    const sheet = getSheet(QUEUE_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];

    const headers = data.shift().map(h => h.toString().toLowerCase().trim());
    const mStr = month !== undefined && month !== null && month !== '' ? String(month) : 'all';
    const yStr = year !== undefined && year !== null && year !== '' ? String(year) : 'all';

    const results = [];
    for (let r = 0; r < data.length; r++) {
      const row = data[r];
      let obj = {};
      for (let i = 0; i < headers.length; i++) {
        let val = row[i];
        if (val instanceof Date) val = val.toISOString();
        obj[headers[i]] = val;
      }
      if (!obj.poststatus || String(obj.poststatus).trim() === '') obj.poststatus = 'รอเริ่ม';
      if (!obj.uploadstatus || String(obj.uploadstatus).trim() === '') obj.uploadstatus = 'รอเริ่ม';
      if (!obj.translatestatus || String(obj.translatestatus).trim() === '') obj.translatestatus = 'รอเริ่ม';
      if (!obj.typesetstatus || String(obj.typesetstatus).trim() === '') obj.typesetstatus = 'รอเริ่ม';
      if (!obj.publishstatus || String(obj.publishstatus).trim() === '') obj.publishstatus = 'รอเริ่ม';

      if (mStr === 'all' && yStr === 'all') {
        results.push(obj);
      } else {
        let d = null;
        const idNum = parseInt(obj.queueid);
        if (!isNaN(idNum) && idNum > 1000000000000 && idNum < 2500000000000) {
          d = new Date(idNum);
        } else if (obj.createdat) {
          d = new Date(obj.createdat);
        }
        
        const isDateValid = d && !isNaN(d.getTime());
        const isMatchingPeriod = isDateValid && (mStr === 'all' || String(d.getMonth() + 1) === mStr) && (yStr === 'all' || String(d.getFullYear()) === yStr);
        const isIncomplete = obj.poststatus !== 'เสร็จแล้ว';

        if (isMatchingPeriod || (includeIncomplete && isIncomplete)) {
          results.push(obj);
        }
      }
    }
    return results;
  } catch (err) {
    console.error('getWorkQueue Error:', err);
    return [];
  }
}

function addQueue(queueData) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const sheet = getSheet(QUEUE_SHEET_NAME);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => h.toString().toLowerCase().trim());
    
    const id = new Date().getTime(); 
    const now = new Date();
    const mangaList = getMangaList();
    const manga = mangaList.find(m => m.mangaid.toString() === queueData.mangaid.toString());
    
    const newRow = headers.map(header => {
      if (header === 'queueid') return id;
      if (header === 'createdat') return now;
      if (header === 'mangaid') return queueData.mangaid;
      if (header === 'chapter') return queueData.chapter;
      
      if (header === 'uploadstatus') return queueData.uploadstatus || 'รอเริ่ม';
      if (header === 'extractstatus') {
        if (queueData.extractstatus && String(queueData.extractstatus).trim() !== '') {
          return queueData.extractstatus;
        }
        const isExtractNeeded = manga && (manga.needsextract === true || String(manga.needsextract).toLowerCase() === 'true');
        return isExtractNeeded ? 'รอเริ่ม' : 'skip';
      }
      if (header === 'translatestatus') return queueData.translatestatus || 'รอเริ่ม';
      if (header === 'typesetstatus') return queueData.typesetstatus || 'รอเริ่ม';
      if (header === 'publishstatus') return queueData.publishstatus || 'รอเริ่ม';
      if (header === 'poststatus') return queueData.poststatus || 'รอเริ่ม';

      if (header === 'uploadername') return queueData.uploadername || '';
      if (header === 'extractorname') return queueData.extractorname || '';
      if (header === 'translatorname') {
        if (queueData.translatorname) return queueData.translatorname;
        if (manga && manga.lockedtranslator) return manga.lockedtranslator;
        return '';
      }
      if (header === 'typesettername') return queueData.typesettername || '';
      if (header === 'typesettype' || header === 'typesetratetype') return queueData.typesettype || queueData.typesetratetype || 'จีน';
      if (header === 'publishername') return queueData.publishername || '';
      if (header === 'postername') return queueData.postername || '';

      if (header === 'worklink') return queueData.worklink || '';
      if (header === 'note') return queueData.note || '';

      return '';
    });

    sheet.appendRow(newRow);
    // อัปเดตเลขตอนล่าสุดใน Mangas เฉพาะเมื่อคิวถูกเพิ่มเข้ามาด้วยสถานะเสร็จสิ้นแล้วเท่านั้น (เช่น โพสต์หรือเผยแพร่แล้ว)
    const isQueueFinished = (queueData.poststatus === 'เสร็จแล้ว') || (queueData.publishstatus === 'เสร็จแล้ว');
    if (isQueueFinished) {
      syncMangaStatus(queueData.mangaid, queueData.chapter);
    }
    
    try {
      if (manga && (manga.notifyonadd === true || manga.notifyonadd === 'true')) {
        let message = `🆕 <b>เพิ่มคิวงานใหม่! (Manual)</b>\n\nเรื่อง: <b>${manga.manganame}</b>\nตอนที่: ${queueData.chapter}\nสถานะ: เริ่มต้นเข้าระบบแล้ว`;
        if (queueData.worklink) {
          message += `\n🔗 <b>ลิงก์งาน:</b> ${queueData.worklink}`;
        }
        sendTelegramNotification(message);
      }
    } catch (e) {
      console.error('Error in addQueue notification:', e);
    }

    invalidateCache(['workQueue', 'mangaList']);
    return { success: true, queue: getWorkQueue(true), manga: getMangaList() };
  } catch (err) {
    return { error: 'Add Queue Failed: ' + err.toString() };
  } finally {
    lock.releaseLock();
  }
}

function updateQueueStep(queueId, step, status, assignee, link, note, typesetType) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const sheet = getSheet(QUEUE_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => h.toString().toLowerCase().trim());
    
    const assigneeHeaders = {
      'upload': 'uploadername',
      'extract': 'extractorname',
      'translate': 'translatorname',
      'typeset': 'typesettername',
      'publish': 'publishername',
      'post': 'postername'
    };
    const assigneeHeader = assigneeHeaders[step.toLowerCase()] || (step.toLowerCase() + 'name');

    const statusCol = headers.indexOf(step.toLowerCase() + 'status') + 1;
    const nameCol = headers.indexOf(assigneeHeader) + 1;
    const timeCol = headers.indexOf(step.toLowerCase() + 'time') + 1;
    const linkCol = headers.indexOf('worklink') + 1;
    const noteCol = headers.indexOf('note') + 1;
    
    if (statusCol === 0) throw new Error('Step not found: ' + step);

    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toString() === queueId.toString()) {
        const rowNum = i + 1;
        
        sheet.getRange(rowNum, statusCol).setValue(status);
        
        if (step.toLowerCase() === 'publish' && status === 'เสร็จแล้ว') {
          const postStatusCol = headers.indexOf('poststatus') + 1;
          if (postStatusCol > 0) {
            const currentPostStatus = data[i][postStatusCol - 1];
            if (!currentPostStatus || currentPostStatus.toString().trim() === '') {
              sheet.getRange(rowNum, postStatusCol).setValue('รอเริ่ม');
            }
          }
        }
        
        if (nameCol > 0 && assignee !== undefined) {
          sheet.getRange(rowNum, nameCol).setValue(assignee);
        }
        
        if (typesetType) {
          const typesetTypeCol = headers.indexOf('typesettype') + 1;
          if (typesetTypeCol > 0) {
            sheet.getRange(rowNum, typesetTypeCol).setValue(typesetType);
          }
        }
        
        if (status === 'เสร็จแล้ว') {
          const oldStatus = data[i][statusCol - 1];
          if (oldStatus !== 'เสร็จแล้ว') {
            if (timeCol > 0) sheet.getRange(rowNum, timeCol).setValue(new Date());
            
            try {
              const mangaId = data[i][headers.indexOf('mangaid')];
              const chapter = data[i][headers.indexOf('chapter')];
              const mangaName = getMangaNameById(mangaId);
              const stepLabel = getStepLabel(step);
              
              let message = `✅ <b>งานเสร็จแล้ว!</b>\n\nเรื่อง: <b>${mangaName}</b>\nตอนที่: ${chapter}\nขั้นตอน: <b>${stepLabel}</b>\nโดย: ${assignee || 'ไม่ระบุ'}`;
              
              const existingLinks = data[i][linkCol - 1] || '';
              const finalLink = link || extractLinkForStep(existingLinks, step);
              
              if (finalLink) {
                message += `\n🔗 <b>ลิงก์งาน:</b> ${finalLink}`;
              }
              sendTelegramNotification(message);

              if (step.toLowerCase() === 'publish' || step.toLowerCase() === 'post') {
                try {
                  const mangaList = getMangaList();
                  const manga = mangaList.find(m => m.mangaid.toString() === mangaId.toString());
                  if (manga && manga.slug) {
                    const range = parseChapterRange(chapter);
                    updateMangaEpisodeOnWebsite(manga.slug, range.end);
                  }
                } catch (aue) {
                  console.error('Error triggering auto-update in updateQueueStep:', aue);
                }
                // เมื่อขั้นตอนเผยแพร่หรือโพสต์เสร็จแล้ว ให้ซิงค์เลขตอนล่าสุดไปยังตาราง Mangas และ RawTracker
                syncMangaStatus(mangaId, chapter);
              }
            } catch (te) {
              console.error('Telegram notification error in updateQueueStep:', te);
            }
          }
        }
        
        if (link && linkCol > 0) {
          const currentLink = data[i][linkCol - 1] || '';
          const stepLabel = getStepLabel(step);
          let links = currentLink.toString().split('\n').filter(l => l.trim());
          links = links.filter(l => !l.startsWith('[' + stepLabel + ']'));
          if (link.trim()) {
            links.push('[' + stepLabel + '] ' + link.trim());
          }
          const newLink = links.join('\n');
          sheet.getRange(rowNum, linkCol).setValue(newLink);
        }
        
        if (note && noteCol > 0) {
          const currentNote = data[i][noteCol - 1] || '';
          const stepLabel = getStepLabel(step);
          const newNote = currentNote ? currentNote + '\n[' + stepLabel + '] ' + note : '[' + stepLabel + '] ' + note;
          sheet.getRange(rowNum, noteCol).setValue(newNote);
        }
        
        invalidateCache('workQueue');
        return { success: true, queue: getWorkQueue(true) };
      }
    }
    return { error: 'Queue ID not found' };
  } catch (err) {
    return { error: 'Update Step Failed: ' + err.toString() };
  } finally {
    lock.releaseLock();
  }
}

function bulkUpdateQueueStep(queueIds, step, status, assignee) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    if (!queueIds || !Array.isArray(queueIds) || queueIds.length === 0) {
      return { error: 'กรุณาเลือกรายการคิวงานที่ต้องการอัปเดต' };
    }
    if (!step) {
      return { error: 'ไม่พบขั้นตอนที่ต้องการอัปเดต' };
    }

    const sheet = getSheet(QUEUE_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      return { error: 'ไม่มีข้อมูลคิวงานในระบบ' };
    }

    const headers = data[0].map(h => h.toString().toLowerCase().trim());
    const stepLower = step.toLowerCase().trim();

    const assigneeHeaders = {
      'upload': 'uploadername',
      'extract': 'extractorname',
      'translate': 'translatorname',
      'typeset': 'typesettername',
      'publish': 'publishername',
      'post': 'postername'
    };
    const assigneeHeader = assigneeHeaders[stepLower] || (stepLower + 'name');

    const statusColIndex = headers.indexOf(stepLower + 'status');
    const nameColIndex = headers.indexOf(assigneeHeader);
    const timeColIndex = headers.indexOf(stepLower + 'time');
    const mangaIdColIndex = headers.indexOf('mangaid');
    const chapterColIndex = headers.indexOf('chapter');
    const postStatusColIndex = headers.indexOf('poststatus');

    if (statusColIndex === -1) {
      return { error: 'ไม่พบคอลัมน์สำหรับขั้นตอน: ' + step };
    }

    const targetIds = new Set(queueIds.map(id => id.toString().trim()));
    const now = new Date();
    let updatedCount = 0;
    const finishedItems = [];
    const shouldUpdateAssignee = assignee !== undefined && assignee !== null && assignee !== '' && assignee !== '__KEEP__';

    for (let i = 1; i < data.length; i++) {
      const currentId = data[i][0].toString().trim();
      if (targetIds.has(currentId)) {
        const oldStatus = data[i][statusColIndex];

        data[i][statusColIndex] = status;

        if (stepLower === 'publish' && status === 'เสร็จแล้ว' && postStatusColIndex !== -1) {
          const currentPostVal = data[i][postStatusColIndex];
          if (!currentPostVal || currentPostVal.toString().trim() === '') {
            data[i][postStatusColIndex] = 'รอเริ่ม';
          }
        }

        if (shouldUpdateAssignee && nameColIndex !== -1) {
          data[i][nameColIndex] = assignee;
        }

        if (status === 'เสร็จแล้ว' && oldStatus !== 'เสร็จแล้ว') {
          if (timeColIndex !== -1) {
            data[i][timeColIndex] = now;
          }

          const mangaId = mangaIdColIndex !== -1 ? data[i][mangaIdColIndex] : '';
          const chapter = chapterColIndex !== -1 ? data[i][chapterColIndex] : '';
          const mangaName = getMangaNameById(mangaId);
          const currentAssignee = shouldUpdateAssignee
            ? assignee
            : (nameColIndex !== -1 ? data[i][nameColIndex] : '');

          finishedItems.push({
            queueId: currentId,
            mangaId: mangaId,
            mangaName: mangaName,
            chapter: chapter,
            assignee: currentAssignee
          });
        }

        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
      invalidateCache('workQueue');

      if (finishedItems.length > 0) {
        try {
          const stepLabel = getStepLabel(step);
          if (finishedItems.length === 1) {
            const item = finishedItems[0];
            let message = `✅ <b>งานเสร็จแล้ว!</b>\n\nเรื่อง: <b>${item.mangaName}</b>\nตอนที่: ${item.chapter}\nขั้นตอน: <b>${stepLabel}</b>\nโดย: ${item.assignee || 'ไม่ระบุ'}`;
            sendTelegramNotification(message);
          } else {
            let message = `✅ <b>อัปเดตงานเสร็จแล้ว (${finishedItems.length} ตอน)!</b>\nขั้นตอน: <b>${stepLabel}</b>\n\n`;
            const listText = finishedItems.slice(0, 15).map(it => `• <b>${it.mangaName}</b> ตอนที่ ${it.chapter}`).join('\n');
            message += listText;
            if (finishedItems.length > 15) {
              message += `\n...และอีก ${finishedItems.length - 15} ตอน`;
            }
            sendTelegramNotification(message);
          }

          if (stepLower === 'publish' || stepLower === 'post') {
            try {
              const mangaList = getMangaList();
              const maxChapters = {};
              finishedItems.forEach(item => {
                if (item.mangaId) {
                  const range = parseChapterRange(item.chapter);
                  if (!maxChapters[item.mangaId] || range.end > maxChapters[item.mangaId]) {
                    maxChapters[item.mangaId] = range.end;
                  }
                }
              });

              for (const mId in maxChapters) {
                const manga = mangaList.find(m => m.mangaid && m.mangaid.toString() === mId.toString());
                if (manga && manga.slug) {
                  updateMangaEpisodeOnWebsite(manga.slug, maxChapters[mId]);
                }
                // ซิงค์เลขตอนล่าสุดไปยัง Mangas และ RawTracker เมื่อมีคิวที่เสร็จสมบูรณ์
                syncMangaStatus(mId, maxChapters[mId]);
              }
            } catch (aue) {
              console.error('Error triggering auto-update in bulkUpdateQueueStep:', aue);
            }
          }
        } catch (te) {
          console.error('Telegram notification error in bulkUpdateQueueStep:', te);
        }
      }

      return { success: true, count: updatedCount, queue: getWorkQueue(true) };
    }

    return { error: 'ไม่พบรายการคิวงานที่ตรงกับที่เลือก' };
  } catch (err) {
    console.error('bulkUpdateQueueStep error:', err);
    return { error: 'Bulk Update Failed: ' + err.toString() };
  } finally {
    lock.releaseLock();
  }
}

function getStepLabel(step) {
  const labels = {
    'upload': 'อัป Raw',
    'extract': 'ดึงคำ',
    'translate': 'แปล',
    'typeset': 'ลงคำ',
    'publish': 'เผยแพร่',
    'post': 'โพสต์'
  };
  return labels[step.toLowerCase()] || step;
}

function parseChapterRange(chapterStr) {
  if (!chapterStr) return { start: 0, end: 0, count: 0 };
  const s = chapterStr.toString().trim();
  
  if (s.includes('-')) {
    const parts = s.split('-').map(p => parseFloat(p.trim()));
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      const start = Math.min(parts[0], parts[1]);
      const end = Math.max(parts[0], parts[1]);
      const count = end - start + 1;
      return { start, end, count: Math.max(0, count) };
    }
  }
  
  const val = parseFloat(s) || 0;
  return { start: val, end: val, count: 1 };
}

function syncMangaStatus(mangaId, chapter) {
  try {
    const sheet = getSheet(SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => h.toString().toLowerCase().trim());
    const lastChapterIdx = headers.indexOf('lastchapter');
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toString() === mangaId.toString()) {
        const rowNum = i + 1;
        const currentChapter = parseFloat(lastChapterIdx !== -1 ? data[i][lastChapterIdx] : data[i][5]) || 0;
        
        const range = parseChapterRange(chapter);
        const newChapter = range.end;
        
        if (newChapter >= currentChapter) {
          headers.forEach((header, index) => {
            const colNum = index + 1;
            if (header === 'lastchapter') sheet.getRange(rowNum, colNum).setValue(newChapter);
            if (header === 'lastupdated') sheet.getRange(rowNum, colNum).setValue(new Date());
          });
          invalidateCache('mangaList');
          // ซิงค์เลขตอนที่ทำเสร็จแล้วไปยัง RawTracker ให้สอดคล้องกันทันที
          try {
            syncRawTrackerMangaInfo(mangaId, null, null, newChapter);
          } catch (trkErr) {
            console.warn('Could not sync RawTracker info in syncMangaStatus:', trkErr);
          }
        }
        break;
      }
    }
  } catch (e) {
    console.error('Sync Error:', e);
  }
}

function deleteQueueItem(id) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const sheet = getSheet(QUEUE_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toString() === id.toString()) {
        sheet.deleteRow(i + 1);
        invalidateCache('workQueue');
        return { success: true, queue: getWorkQueue(true) };
      }
    }
    return { error: 'Not found' };
  } catch (err) {
    return { error: err.toString() };
  } finally {
    lock.releaseLock();
  }
}

function extractLinkForStep(allLinks, stepKey) {
  if (!allLinks) return null;
  const lines = allLinks.toString().split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  const aliases = {
    'upload': ['อัป Raw', 'Raw', 'อัป RAW', 'Upload'],
    'extract': ['ดึงคำ', 'Extract', 'Extractor'],
    'translate': ['แปล', 'Translate', 'Translator'],
    'typeset': ['ลงคำ', 'Typeset', 'Typesetter'],
    'publish': ['Publisher', 'เผยแพร่', 'ลงเว็บ', 'Publish'],
    'post': ['โพสต์', 'Post']
  };

  const possibleLabels = (aliases[stepKey.toLowerCase()] || [stepKey]).map(l => l.toLowerCase());

  for (let l of lines) {
    const bracketEnd = l.indexOf(']');
    if (l.startsWith('[') && bracketEnd > 0) {
      const label = l.substring(1, bracketEnd).toLowerCase();
      if (possibleLabels.includes(label)) {
        return l.substring(bracketEnd + 1).trim();
      }
    }
  }

  if (!lines[0].startsWith('[')) {
    return lines[0];
  }

  return null;
}

function updateFullQueueItem(queueId, updateData) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const sheet = getSheet(QUEUE_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => h.toString().toLowerCase().trim());

    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toString() === queueId.toString()) {
        const rowNum = i + 1;
        
        const updateCell = (header, val) => {
          const col = headers.indexOf(header) + 1;
          if (col > 0 && val !== undefined) {
            sheet.getRange(rowNum, col).setValue(val);
          }
        };

        updateCell('chapter', updateData.chapter);
        updateCell('uploadstatus', updateData.uploadstatus);
        updateCell('extractstatus', updateData.extractstatus);
        updateCell('translatestatus', updateData.translatestatus);
        updateCell('typesetstatus', updateData.typesetstatus);
        updateCell('publishstatus', updateData.publishstatus);
        updateCell('poststatus', updateData.poststatus);

        updateCell('uploadername', updateData.uploadername);
        updateCell('extractorname', updateData.extractorname);
        updateCell('translatorname', updateData.translatorname);
        updateCell('typesettername', updateData.typesettername);
        if (updateData.typesettype !== undefined || updateData.typesetratetype !== undefined) {
          updateCell('typesettype', updateData.typesettype || updateData.typesetratetype || 'จีน');
        }
        updateCell('publishername', updateData.publishername);
        updateCell('postername', updateData.postername);

        try {
          const mangaIdForNoti = data[i][headers.indexOf('mangaid')];
          const chapterForNoti = updateData.chapter || data[i][headers.indexOf('chapter')];
          const mangaNameForNoti = getMangaNameById(mangaIdForNoti);

          const statusFields = ['uploadstatus', 'extractstatus', 'translatestatus', 'typesetstatus', 'publishstatus', 'poststatus'];
          const assigneeMap = {
            'uploadstatus': 'uploadername',
            'extractstatus': 'extractorname',
            'translatestatus': 'translatorname',
            'typesetstatus': 'typesettername',
            'publishstatus': 'publishername',
            'poststatus': 'postername'
          };

          statusFields.forEach(field => {
            const newVal = updateData[field];
            const oldVal = data[i][headers.indexOf(field)];
            if (newVal === 'เสร็จแล้ว' && oldVal !== 'เสร็จแล้ว') {
              const stepKey = field.replace('status', '');
              const timeCol = headers.indexOf(stepKey + 'time') + 1;
              if (timeCol > 0) sheet.getRange(rowNum, timeCol).setValue(new Date());

              const stepLabel = getStepLabel(stepKey);
              const assignee = updateData[assigneeMap[field]] || '';
              let message = `✅ <b>งานเสร็จแล้ว!</b>\n\nเรื่อง: <b>${mangaNameForNoti}</b>\nตอนที่: ${chapterForNoti}\nขั้นตอน: <b>${stepLabel}</b>\nโดย: ${assignee || 'ไม่ระบุ'}`;
              
              const stepLink = extractLinkForStep(updateData.worklink, stepLabel);
              if (stepLink) {
                message += `\n🔗 <b>ลิงก์งาน:</b> ${stepLink}`;
              }
              
              sendTelegramNotification(message);

              if (field === 'poststatus' || field === 'publishstatus') {
                try {
                  const mangaList = getMangaList();
                  const manga = mangaList.find(m => m.mangaid.toString() === mangaIdForNoti.toString());
                  if (manga && manga.slug) {
                    const range = parseChapterRange(chapterForNoti);
                    updateMangaEpisodeOnWebsite(manga.slug, range.end);
                  }
                } catch (aue) {
                  console.error('Error triggering auto-update in updateFullQueueItem:', aue);
                }
              }
            }
          });
        } catch (te) {
          console.error('Telegram notification error in updateFullQueueItem:', te);
        }

        updateCell('worklink', updateData.worklink);
        updateCell('note', updateData.note);
        
        invalidateCache('workQueue');
        return { success: true, queue: getWorkQueue(true) };
      }
    }
    return { error: 'Queue ID not found' };
  } catch (e) {
    return { error: 'Update Failed: ' + e.toString() };
  } finally {
    lock.releaseLock();
  }
}

function getTeamMembers() {
  try {
    const sheet = getSheet(TEAM_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];

    const headers = data.shift().map(h => h.toString().toLowerCase().trim());
    return data.map(row => {
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = row[index];
      });
      return obj;
    });
  } catch (err) {
    console.error('getTeamMembers Error:', err);
    return [];
  }
}

/**
 * CRON: รันทุกวันเพื่อดึงมังงะเข้าคิวอัตโนมัติ (Batch Optimized)
 * [ปิดการทำงาน] ยกเลิกระบบเพิ่มคิวอัตโนมัติตามวันปล่อยดิบ (Release Day) ตามคำสั่งผู้ใช้
 */
function processAutoQueue() {
  console.log('processAutoQueue: ระบบเพิ่มคิวอัตโนมัติตามวันปล่อยดิบ (Release Day) ถูกปิดใช้งานแล้ว');
  return;
}

function batchSyncMangaStatus(updates) {
  try {
    const sheet = getSheet(SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => h.toString().toLowerCase().trim());
    
    const idColIndex = 0; 
    const lastChapterColIndex = headers.indexOf('lastchapter');
    const lastUpdatedColIndex = headers.indexOf('lastupdated');
    
    if (lastChapterColIndex === -1 || lastUpdatedColIndex === -1) return;

    let hasChanges = false;
    const now = new Date();

    const updateMap = new Map();
    updates.forEach(u => updateMap.set(u.mangaId.toString(), parseFloat(u.newChapter)));

    for (let i = 1; i < data.length; i++) {
      const currentId = data[i][idColIndex].toString();
      
      if (updateMap.has(currentId)) {
        const rawNewChapter = updateMap.get(currentId);
        const range = parseChapterRange(rawNewChapter);
        const newChapter = range.end;
        const currentChapter = parseFloat(data[i][lastChapterColIndex]) || 0;

        if (newChapter >= currentChapter) {
          data[i][lastChapterColIndex] = newChapter;
          data[i][lastUpdatedColIndex] = now;
          hasChanges = true;
        }
      }
    }

    if (hasChanges) {
      sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
    }
  } catch (e) {
    console.error('Batch Sync Error:', e);
  }
}

function getTodayDayName() {
  const days = ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'];
  return days[new Date().getDay()];
}

function createAutoQueueTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let deletedCount = 0;
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'processAutoQueue') {
      ScriptApp.deleteTrigger(t);
      deletedCount++;
    }
  });
  
  console.log(`createAutoQueueTrigger: ลบ Trigger processAutoQueue ทั้งหมด ${deletedCount} ตัวเรียบร้อยแล้ว (ระบบปิดใช้งานถาวร)`);
  return "ระบบเพิ่มคิวอัตโนมัติตามวันปล่อยดิบ (Release Day) ถูกปิดใช้งานแล้ว และได้ลบ Trigger ทั้งหมดเรียบร้อยแล้ว";
}

function movePendingQueueToCurrentMonth() {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const sheet = getSheet(QUEUE_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => h.toString().toLowerCase().trim());
    
    const createdAtCol = headers.indexOf('createdat');
    const postStatusCol = headers.indexOf('poststatus');

    if (createdAtCol === -1 || postStatusCol === -1) return "Error: Headers mapping failed";

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    let updatedCount = 0;

    for (let i = 1; i < data.length; i++) {
      const postStatus = data[i][postStatusCol];
      const createdAtRaw = data[i][createdAtCol];
      const createdAt = createdAtRaw instanceof Date ? createdAtRaw : new Date(createdAtRaw);

      if (postStatus !== 'เสร็จแล้ว') {
        const isLegacyMonth = createdAt.getMonth() !== currentMonth || createdAt.getFullYear() !== currentYear;
        
        if (isLegacyMonth) {
          const newDate = new Date();
          newDate.setHours(0, 0, 1, 0);
          data[i][createdAtCol] = newDate;
          updatedCount++;
        }
      }
    }

    if (updatedCount > 0) {
      sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
      invalidateCache('workQueue');
      return `ย้ายงานค้าง ${updatedCount} รายการมายังเดือนปัจจุบันเรียบร้อยแล้ว`;
    }

    return "ไม่มีงานค้างเดือนก่อนหน้าที่ต้องย้าย";
  } catch (err) {
    console.error('Move Pending Error:', err);
    return "เกิดข้อผิดพลาด: " + err.toString();
  } finally {
    lock.releaseLock();
  }
}

function createMovePendingTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'movePendingQueueToCurrentMonth') ScriptApp.deleteTrigger(t);
  });
  
  ScriptApp.newTrigger('movePendingQueueToCurrentMonth')
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .create();
    
  return "สร้างระบบตั้งเวลาย้ายงานค้างอัตโนมัติเรียบร้อยแล้ว! (รันทุกวันเวลา 03:00 น.)";
}

// --- BUDGET PAYEES ---
function getBudgetPayees() {
  return readSheetData(BUDGET_PAYEE_SHEET_NAME);
}

function addBudgetPayee(payee) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const sheet = getSheet(BUDGET_PAYEE_SHEET_NAME);
    const id = 'P' + new Date().getTime();
    sheet.appendRow([id, payee.name, payee.taxid, payee.bankaccount || '', payee.bankname || '', payee.note || '']);
    invalidateCache('budget_payees');
    return { success: true, payees: getBudgetPayees() };
  } catch (err) {
    return { error: 'Add Payee Failed: ' + err.toString() };
  } finally {
    lock.releaseLock();
  }
}

function updateBudgetPayee(id, updated) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const sheet = getSheet(BUDGET_PAYEE_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => h.toString().toLowerCase().trim());
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toString() === id.toString()) {
        const rowNum = i + 1;
        headers.forEach((header, index) => {
          const colNum = index + 1;
          if (header === 'name') sheet.getRange(rowNum, colNum).setValue(updated.name);
          if (header === 'taxid') sheet.getRange(rowNum, colNum).setValue(updated.taxid);
          if (header === 'bankaccount') sheet.getRange(rowNum, colNum).setValue(updated.bankaccount);
          if (header === 'bankname') sheet.getRange(rowNum, colNum).setValue(updated.bankname);
          if (header === 'note') sheet.getRange(rowNum, colNum).setValue(updated.note);
        });
        invalidateCache('budget_payees');
        return { success: true, payees: getBudgetPayees() };
      }
    }
    return { error: 'Payee not found' };
  } catch (err) {
    return { error: 'Update Payee Failed: ' + err.toString() };
  } finally {
    lock.releaseLock();
  }
}

function deleteBudgetPayee(id) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const sheet = getSheet(BUDGET_PAYEE_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toString() === id.toString()) {
        sheet.deleteRow(i + 1);
        invalidateCache('budget_payees');
        return { success: true, payees: getBudgetPayees() };
      }
    }
    return { error: 'Payee not found' };
  } catch (err) {
    return { error: 'Delete Payee Failed: ' + err.toString() };
  } finally {
    lock.releaseLock();
  }
}

// --- BUDGET TRANSACTIONS ---
function getBudgetTransactions() {
  return readSheetData(BUDGET_TRANSACTION_SHEET_NAME);
}

function addBudgetTransaction(trans) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const sheet = getSheet(BUDGET_TRANSACTION_SHEET_NAME);
    const id = 'TR' + new Date().getTime();
    const date = trans.date ? new Date(trans.date) : new Date();
    
    sheet.appendRow([
      id, 
      date, 
      trans.type, 
      parseFloat(trans.amount) || 0, 
      trans.category || '', 
      trans.reference || '', 
      trans.note || ''
    ]);
    invalidateCache('budget_transactions');
    return { success: true, transactions: getBudgetTransactions() };
  } catch (err) {
    return { error: 'Add Transaction Failed: ' + err.toString() };
  } finally {
    lock.releaseLock();
  }
}

function updateBudgetTransaction(id, trans) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const sheet = getSheet(BUDGET_TRANSACTION_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { error: 'No data' };
    const headers = data[0].map(h => h.toString().toLowerCase().trim());
    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toString() === id.toString()) {
        if (trans.date !== undefined && headers.indexOf('date') !== -1) {
          sheet.getRange(i + 1, headers.indexOf('date') + 1).setValue(new Date(trans.date));
        }
        if (trans.type !== undefined && headers.indexOf('type') !== -1) {
          sheet.getRange(i + 1, headers.indexOf('type') + 1).setValue(trans.type);
        }
        if (trans.amount !== undefined && headers.indexOf('amount') !== -1) {
          sheet.getRange(i + 1, headers.indexOf('amount') + 1).setValue(parseFloat(trans.amount) || 0);
        }
        if (trans.category !== undefined && headers.indexOf('category') !== -1) {
          sheet.getRange(i + 1, headers.indexOf('category') + 1).setValue(trans.category);
        }
        if (trans.reference !== undefined && headers.indexOf('reference') !== -1) {
          sheet.getRange(i + 1, headers.indexOf('reference') + 1).setValue(trans.reference);
        }
        if (trans.note !== undefined && headers.indexOf('note') !== -1) {
          sheet.getRange(i + 1, headers.indexOf('note') + 1).setValue(trans.note);
        }
        invalidateCache('budget_transactions');
        return { success: true, transactions: getBudgetTransactions() };
      }
    }
    return { error: 'Transaction not found' };
  } catch (err) {
    return { error: 'Update Transaction Failed: ' + err.toString() };
  } finally {
    lock.releaseLock();
  }
}

function deleteBudgetTransaction(id) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const sheet = getSheet(BUDGET_TRANSACTION_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toString() === id.toString()) {
        sheet.deleteRow(i + 1);
        invalidateCache('budget_transactions');
        return { success: true, transactions: getBudgetTransactions() };
      }
    }
    return { error: 'Transaction not found' };
  } catch (err) {
    return { error: 'Delete Transaction Failed: ' + err.toString() };
  } finally {
    lock.releaseLock();
  }
}

function getPendingPaidClaimsForBudget(payload) {
  try {
    payload = payload || {};
    const month = payload.month !== undefined && payload.month !== null && payload.month !== '' && payload.month !== 'all' ? Number(payload.month) : null;
    const year = payload.year !== undefined && payload.year !== null && payload.year !== '' && payload.year !== 'all' ? Number(payload.year) : null;

    const claims = getPayoutClaims();
    const transactions = getBudgetTransactions();

    const existingRefs = new Set();
    transactions.forEach(t => {
      if (t.reference) {
        existingRefs.add(String(t.reference).trim().toLowerCase());
      }
    });

    const paidClaims = claims.filter(c => {
      const status = String(c.status || '').trim().toLowerCase();
      if (status !== 'paid') return false;

      if (month !== null || year !== null) {
        const dateStr = c.paidat || c.createdat || c.startdate;
        if (!dateStr) return false;
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return false;

        if (month !== null && (d.getMonth() + 1) !== month) {
          return false;
        }
        if (year !== null && d.getFullYear() !== year) {
          return false;
        }
      }

      return true;
    });

    const result = paidClaims.map(c => {
      const isImported = existingRefs.has(String(c.claimid || '').trim().toLowerCase());
      return {
        ...c,
        alreadyImported: isImported
      };
    });

    return {
      success: true,
      claims: result
    };
  } catch (err) {
    console.error('getPendingPaidClaimsForBudget error:', err);
    return { error: 'Get Pending Paid Claims Failed: ' + err.toString() };
  }
}

function syncPaidClaimsToBudget(payload) {
  if (!payload || !Array.isArray(payload.claimIds) || payload.claimIds.length === 0) {
    return { error: 'กรุณาระบุ Claim IDs ที่ต้องการนำเข้า' };
  }

  const targetIds = new Set(payload.claimIds.map(id => String(id).trim().toLowerCase()));
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const sheet = getSheet(BUDGET_TRANSACTION_SHEET_NAME);
    const claims = getPayoutClaims();
    const transactions = getBudgetTransactions();

    const existingRefs = new Set();
    transactions.forEach(t => {
      if (t.reference) {
        existingRefs.add(String(t.reference).trim().toLowerCase());
      }
    });

    const claimsToImport = claims.filter(c => {
      const cid = String(c.claimid || '').trim().toLowerCase();
      const status = String(c.status || '').trim().toLowerCase();
      return targetIds.has(cid) && status === 'paid' && !existingRefs.has(cid);
    });

    if (claimsToImport.length === 0) {
      return {
        success: true,
        importedCount: 0,
        message: 'ไม่มีรายการใหม่ที่ต้องนำเข้า (อาจถูกนำเข้าไปแล้วหรือไม่มีสถานะ Paid)',
        transactions: getBudgetTransactions()
      };
    }

    const rowsToAppend = [];
    const now = new Date();
    claimsToImport.forEach((c, index) => {
      const transId = 'TR' + (now.getTime() + index);
      let transDate = null;
      if (c.enddate) {
        const d = new Date(c.enddate);
        if (!isNaN(d.getTime())) transDate = d;
      }
      if (!transDate && c.daterange && c.daterange.indexOf('ถึง') !== -1) {
        const parts = c.daterange.split('ถึง');
        if (parts.length > 1) {
          const d = new Date(parts[1].trim());
          if (!isNaN(d.getTime())) transDate = d;
        }
      }
      if (!transDate) {
        transDate = c.paidat ? new Date(c.paidat) : (c.createdat ? new Date(c.createdat) : now);
      }
      if (isNaN(transDate.getTime())) transDate = now;

      const staff = c.staffname || '';
      const role = c.role ? ` [${c.role}]` : '';
      const dateRange = c.daterange ? ` (${c.daterange})` : '';
      const note = `ค่าตอบแทน: ${staff}${role}${dateRange}`.trim();

      rowsToAppend.push([
        transId,
        transDate,
        'Expense',
        parseFloat(c.totalamount) || 0,
        'ค่าตอบแทนทีมงาน',
        c.claimid,
        note
      ]);
    });

    if (rowsToAppend.length > 0) {
      rowsToAppend.forEach(row => {
        sheet.appendRow(row);
      });
      invalidateCache('budget_transactions');
    }

    return {
      success: true,
      importedCount: rowsToAppend.length,
      transactions: getBudgetTransactions()
    };
  } catch (err) {
    console.error('syncPaidClaimsToBudget error:', err);
    return { error: 'Sync Paid Claims Failed: ' + err.toString() };
  } finally {
    lock.releaseLock();
  }
}

function readSheetData(sheetName) {
  try {
    const sheet = getSheet(sheetName);
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];

    const rawHeaders = data.shift();
    const headers = rawHeaders.map(h => h.toString().toLowerCase().trim());
    
    return data.map(row => {
      let obj = {};
      headers.forEach((header, i) => {
        let val = row[i];
        if (val instanceof Date) {
          val = val.toISOString();
        }
        obj[header] = val;
      });
      return obj;
    });
  } catch (err) {
    console.error('readSheetData Error (' + sheetName + '):', err);
    return [];
  }
}

function getBudgetData() {
  return {
    payees: getBudgetPayees(),
    transactions: getBudgetTransactions(),
    websites: getWebsiteList()
  };
}

function getAllData() {
  return {
    manga: getMangaList(),
    queue: getWorkQueue(),
    team: getTeamMembers(),
    payees: getBudgetPayees(),
    transactions: getBudgetTransactions(),
    websites: getWebsiteList()
  };
}

function getDashboardData(forceRefresh = false, month, year) {
  const now = new Date();
  const targetMonth = month !== undefined && month !== null && month !== '' ? month : String(now.getMonth() + 1);
  const targetYear = year !== undefined && year !== null && year !== '' ? year : String(now.getFullYear());
  return {
    manga: getMangaList(),
    queue: getWorkQueue(forceRefresh, targetMonth, targetYear, true),
    team: getTeamMembers()
  };
}

function checkQueueLock(queueId) {
  try {
    const sheet = getSheet(QUEUE_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => h.toString().toLowerCase().trim());
    
    const lockCol = headers.indexOf('isediting');
    const byCol = headers.indexOf('editingby');
    const timeCol = headers.indexOf('editingtime');
    
    if (lockCol === -1) return { canEdit: true, reason: 'No lock system' };

    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toString() === queueId.toString()) {
        const isLocked = data[i][lockCol];
        const editingBy = data[i][byCol] || '';
        const editingTime = data[i][timeCol];
        
        if (!isLocked) {
          return { canEdit: true };
        }
        
        if (editingTime) {
          const lockTime = new Date(editingTime);
          const now = new Date();
          const diffMinutes = (now - lockTime) / (1000 * 60);
          
          if (diffMinutes > 10) {
            const rowNum = i + 1;
            sheet.getRange(rowNum, lockCol + 1, 1, 3).setValues([[false, '', '']]);
            return { 
              canEdit: true, 
              wasExpired: true,
              reason: 'Lock expired and auto-released'
            };
          }
        }
        
        return { 
          canEdit: false, 
          lockedBy: editingBy,
          lockedAt: editingTime,
          reason: `กำลังถูกแก้ไขโดย ${editingBy || 'ผู้ใช้อื่น'}`
        };
      }
    }
    return { canEdit: true, reason: 'Item not found' };
  } catch (e) {
    return { canEdit: true, error: e.toString() };
  }
}

/**
 * MANGA SALES (Financials) CRUD
 */
function getMangaSales() {
  try {
    const sheet = getSheet(MANGA_SALES_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];

    const rawHeaders = data.shift();
    const headers = rawHeaders.map(h => h.toString().toLowerCase().trim());
    
    return data.map((row, idx) => {
      let obj = { _rowIndex: idx };
      headers.forEach((header, i) => {
        let val = row[i];
        if (val instanceof Date) val = val.toISOString();
        obj[header] = val;
      });
      return obj;
    });
  } catch (err) {
    console.error('getMangaSales Error:', err);
    return [];
  }
}

function addMangaSale(sale) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const sheet = getSheet(MANGA_SALES_SHEET_NAME);
    const lastCol = sheet.getLastColumn();
    if (lastCol === 0) throw new Error("MangaSales sheet headers missing.");
    
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => h.toString().toLowerCase().trim());
    
    const newRow = headers.map(header => {
      if (header === 'date') return sale.date ? new Date(sale.date) : new Date();
      if (header === 'month') return sale.month || '';
      if (header === 'serieschapterid') return sale.serieschapterid || '';
      if (header === 'seriesname') return sale.seriesname || '';
      if (header === 'chapterscount') return sale.chapterscount || 0;
      if (header === 'category') return sale.category || '';
      if (header === 'website') return sale.website || '';
      if (header === 'page') return sale.page || '';
      if (header === 'targetperchapter') return sale.targetperchapter || 0;
      if (header === 'totaltarget') return sale.totaltarget || 0;
      if (header === 'costperchapter') return sale.costperchapter || 0;
      if (header === 'totalcost') return sale.totalcost || 0;
      if (header === 'revenue') return sale.revenue || 0;
      if (header === 'profit') return (parseFloat(sale.revenue) || 0) - (parseFloat(sale.totalcost) || 0);
      return '';
    });

    sheet.appendRow(newRow);
    invalidateCache('manga_sales');
    return { success: true, list: getMangaSales() };
  } catch (err) {
    console.error('addMangaSale Error:', err);
    return { error: 'Add Sale Failed: ' + err.toString() };
  } finally {
    lock.releaseLock();
  }
}

function bulkAddMangaSales(salesArray) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(60000);
    const sheet = getSheet(MANGA_SALES_SHEET_NAME);
    const lastCol = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => h.toString().toLowerCase().trim());
    
    const websiteSheet = getSheet(WEBSITE_SHEET_NAME);
    const existingWebsites = getWebsiteList();
    
    const newRows = salesArray.map(sale => {
      if (sale.website && !existingWebsites.includes(sale.website)) {
        websiteSheet.appendRow([sale.website]);
        existingWebsites.push(sale.website);
        invalidateCache('website_list');
      }
      
      return headers.map(header => {
        if (header === 'date') return sale.date ? new Date(sale.date) : new Date();
        if (header === 'month') return sale.month || '';
        if (header === 'serieschapterid') return sale.serieschapterid || '';
        if (header === 'seriesname') return sale.seriesname || '';
        if (header === 'chapterscount') return sale.chapterscount || 0;
        if (header === 'category') return sale.category || '';
        if (header === 'website') return sale.website || '';
        if (header === 'page') return sale.page || '';
        if (header === 'targetperchapter') return sale.targetperchapter || 0;
        if (header === 'totaltarget') return sale.totaltarget || 0;
        if (header === 'costperchapter') return sale.costperchapter || 0;
        if (header === 'totalcost') return sale.totalcost || 0;
        if (header === 'revenue') return sale.revenue || sale.totaltarget || 0;
        if (header === 'profit') {
          const rev = parseFloat(sale.revenue || sale.totaltarget) || 0;
          const cost = parseFloat(sale.totalcost) || 0;
          return rev - cost;
        }
        return '';
      });
    });

    if (newRows.length > 0) {
      const range = sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, headers.length);
      range.setValues(newRows);
    }
    
    invalidateCache(['manga_sales', 'financial_sales']);
    return { success: true, count: newRows.length, list: getMangaSales(), websites: getWebsiteList() };
  } catch (err) {
    console.error('bulkAddMangaSales Error:', err);
    return { error: 'Bulk Add Failed: ' + err.toString() };
  } finally {
    lock.releaseLock();
  }
}

function deleteMangaSale(index) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const sheet = getSheet(MANGA_SALES_SHEET_NAME);
    sheet.deleteRow(Number(index) + 2);
    invalidateCache('manga_sales');
    return { success: true, list: getMangaSales() };
  } catch (err) {
    return { error: 'Delete Sale Failed: ' + err.toString() };
  } finally {
    lock.releaseLock();
  }
}

function countFinishedChapters(mangaId, year, month) {
  try {
    const queue = getWorkQueue();
    let totalCount = 0;
    queue.forEach(q => {
      if (q.mangaid.toString() !== mangaId.toString()) return;
      if (q.poststatus !== 'เสร็จแล้ว') return;
      
      const d = new Date(q.createdat);
      if (d.getFullYear() === parseInt(year) && (d.getMonth() + 1) === parseInt(month)) {
        const range = parseChapterRange(q.chapter);
        totalCount += range.count;
      }
    });
    
    return totalCount;
  } catch (e) {
    return 0;
  }
}

function getWebsiteList() {
  try {
    const sheet = getSheet(WEBSITE_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];

    data.shift();
    return data.map(row => row[0]).filter(Boolean);
  } catch (err) {
    console.error('getWebsiteList Error:', err);
    return [];
  }
}

function getFinancialInitData() {
  return {
    manga: getMangaList(),
    sales: getMangaSales(),
    websites: getWebsiteList()
  };
}

function verifyPasscode(pass) {
  return pass === ACCESS_PASSCODE;
}

function verifyFinancialPasscode(pass) {
  return pass === FINANCIAL_PASSCODE;
}

/**
 * Send notification to Telegram
 */
function sendTelegramNotification(message) {
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'YOUR_BOT_TOKEN_HERE') {
    return;
  }
  
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const payload = {
    'chat_id': TELEGRAM_CHAT_ID,
    'text': message,
    'parse_mode': 'HTML'
  };
  
  const options = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };
  
  try {
    UrlFetchApp.fetch(url, options);
  } catch (e) {
    console.error('Telegram notification failed:', e);
  }
}

function getMangaNameById(mangaId) {
  const mangaList = getMangaList();
  const manga = mangaList.find(m => m.mangaid.toString() === mangaId.toString());
  return manga ? manga.manganame : 'มังงะไม่ทราบชื่อ';
}

function handleTelegramCommand(chatId, command, args) {
  let response = '';
  
  switch (command) {
    case '/start':
    case '/help':
      response = "<b>📚 ระบบ MangaHub Bot</b>\n\n" +
                 "คำสั่งที่ใช้งานได้:\n" +
                 "/status - ดูภาพรวมงานค้างทั้งหมด\n" +
                 "/waiting [ขั้นตอน] - ดูรายชื่อตอนที่รอทำ\n" +
                 "/ready_publish - ดูงานที่ลงคำเสร็จแล้ว (รอ Publish/อัปเว็บ)\n" +
                 "/ready_typeset - ดูงานที่แปลเสร็จแล้ว (รอลงคำ)\n" +
                 "/ready_translate - ดูงานที่ดึงคำเสร็จแล้ว (รอแปล)\n\n" +
                 "ขั้นตอนที่ระบุได้: <code>raw, extract, translate, typeset, publish, post</code>";
      break;
      
    case '/status':
      response = getTelegramStatusSummary();
      break;
      
    case '/waiting':
      response = getTelegramWaitingList(args[0]);
      break;
      
    case '/ready_publish':
    case '/ready_upload':
      response = getTelegramReadyList('publish');
      break;
      
    case '/ready_typeset':
      response = getTelegramReadyList('typeset');
      break;
      
    case '/ready_translate':
      response = getTelegramReadyList('translate');
      break;

    default:
      if (command.startsWith('/')) {
        response = "ขออภัย ไม่รู้จักคำสั่งนี้ พิมพ์ /help เพื่อดูคำสั่งทั้งหมด";
      }
  }
  
  if (response) {
    sendTelegramDirect(chatId, response);
  }
}

function sendTelegramDirect(chatId, message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const payload = {
    'chat_id': chatId,
    'text': message,
    'parse_mode': 'HTML'
  };
  
  const options = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };
  
  try {
    UrlFetchApp.fetch(url, options);
  } catch (e) {
    console.error('Failed to send direct Telegram message:', e);
  }
}

function getTelegramStatusSummary() {
  const queue = getWorkQueue();
  let waitUpload = 0, waitExtract = 0, waitTranslate = 0, waitTypeset = 0, waitPublish = 0, waitPost = 0;
  
  const isDone = (s) => s === 'เสร็จแล้ว' || s === 'Skipped' || s === 'ข้าม' || String(s).toLowerCase() === 'skip';
  queue.forEach(q => {
    if (isDone(q.poststatus)) return;

    if (!isDone(q.uploadstatus)) waitUpload++;
    else if (!isDone(q.extractstatus)) waitExtract++;
    else if (!isDone(q.translatestatus)) waitTranslate++;
    else if (!isDone(q.typesetstatus)) waitTypeset++;
    else if (!isDone(q.publishstatus)) waitPublish++;
    else waitPost++;
  });
  
  return "<b>📊 สรุปงานค้างแยกตามขั้นตอน</b>\n\n" +
         `🔼 รออัป Raw: ${waitUpload}\n` +
         `📝 รอดึงคำ: ${waitExtract}\n` +
         `🌐 รอแปล: ${waitTranslate}\n` +
         `✍️ รอลงคำ: ${waitTypeset}\n` +
         `📤 รอ Publish: ${waitPublish}\n` +
         `✉️ รอโพสต์: ${waitPost}\n\n` +
         "พิมพ์ <code>/waiting [ขั้นตอน]</code> เพื่อดูรายละเอียด";
}

function getTelegramWaitingList(step) {
  if (!step) return "กรุณาระบุขั้นตอน เช่น <code>/waiting translate</code>\n(raw, extract, translate, typeset, publish, post)";
  
  const queue = getWorkQueue();
  const mangaList = getMangaList();
  const stepMap = {
    'upload': 'uploadstatus',
    'raw': 'uploadstatus',
    'extract': 'extractstatus',
    'translate': 'translatestatus',
    'typeset': 'typesetstatus',
    'publish': 'publishstatus',
    'post': 'poststatus'
  };
  
  const field = stepMap[step.toLowerCase()];
  if (!field) return "ไม่รู้จักขั้นตอนที่ระบุ กรุณาใช้: raw, extract, translate, typeset, publish, post";
  
  const list = queue.filter(q => q[field] !== 'เสร็จแล้ว' && q[field] !== 'ข้าม');
  
  if (list.length === 0) return `✅ ไม่มีงานค้างในขั้นตอน <b>${step}</b>`;
  
  let msg = `<b>📋 รายการงานค้าง [${step.toUpperCase()}]</b>\n\n`;
  list.slice(0, 25).forEach((q, i) => {
    const manga = mangaList.find(m => m.mangaid.toString() === q.mangaid.toString());
    const name = manga ? manga.manganame : 'มังงะไม่ทราบชื่อ';
    msg += `${i+1}. ${name} ตอนที่ ${q.chapter} (สถานะ: ${q[field]})\n`;
  });
  
  if (list.length > 25) msg += `\n<i>... และอื่นๆ อีก ${list.length - 25} รายการ</i>`;
  
  return msg;
}

function getTelegramReadyList(targetStep) {
  const queue = getWorkQueue();
  const mangaList = getMangaList();
  
  let list = [];
  let stepTitle = "";
  
  if (targetStep === 'publish') {
    stepTitle = "ลงคำเสร็จ -> รอ Publish";
    list = queue.filter(q => q.typesetstatus === 'เสร็จแล้ว' && q.publishstatus !== 'เสร็จแล้ว' && q.publishstatus !== 'ข้าม');
  } else if (targetStep === 'typeset') {
    stepTitle = "แปลเสร็จ -> รอลงคำ";
    list = queue.filter(q => q.translatestatus === 'เสร็จแล้ว' && q.typesetstatus !== 'เสร็จแล้ว' && q.typesetstatus !== 'ข้าม');
  } else if (targetStep === 'translate') {
    stepTitle = "ดึงคำเสร็จ/ข้าม -> รอแปล";
    list = queue.filter(q => (q.extractstatus === 'เสร็จแล้ว' || q.extractstatus === 'Skipped' || q.extractstatus === 'ข้าม' || String(q.extractstatus).toLowerCase() === 'skip') && q.translatestatus !== 'เสร็จแล้ว' && q.translatestatus !== 'ข้าม' && String(q.translatestatus).toLowerCase() !== 'skip');
  }
  
  if (list.length === 0) return `✅ ไม่มีงานที่ <b>${stepTitle}</b>`;
  
  let msg = `<b>🚀 ${stepTitle} (${list.length} ตอน)</b>\n\n`;
  list.slice(0, 25).forEach((q, i) => {
    const manga = mangaList.find(m => m.mangaid.toString() === q.mangaid.toString());
    const name = manga ? manga.manganame : 'มังงะไม่ทราบชื่อ';
    msg += `${i+1}. ${name} ตอนที่ ${q.chapter}\n`;
  });
  
  if (list.length > 25) msg += `\n<i>... และอื่นๆ อีก ${list.length - 25} รายการ</i>`;
  
  return msg;
}

function setTelegramWebhook() {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${ScriptApp.getService().getUrl()}`;
  const response = UrlFetchApp.fetch(url);
  Logger.log(response.getContentText());
  return response.getContentText();
}

// ==========================================
// RAW TRACKER & WEBSCRAPING MODULE
// ==========================================

function getRawTrackerList() {
  try {
    const sheet = getSheet(RAW_TRACKER_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    
    // Auto import if empty
    if (data.length <= 1) {
      const imp = importTrackersFromMangaList();
      return Array.isArray(imp) ? imp : (imp.list || []);
    }

    const headers = data[0].map(h => h.toString().toLowerCase().trim());
    const mangaList = getMangaList();
    const mangaMap = {};
    const validMangaNameMap = {};
    mangaList.forEach(m => {
      mangaMap[String(m.mangaid).trim()] = m;
      if (m.manganame) validMangaNameMap[m.manganame.trim().toLowerCase()] = m;
    });

    const results = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const obj = {};
      for (let c = 0; c < headers.length; c++) {
        let val = row[c];
        if (val instanceof Date) val = val.toISOString();
        obj[headers[c]] = val;
      }

      const mId = String(obj.mangaid || '').trim();
      const mName = String(obj.manganame || '').trim().toLowerCase();
      const manga = mId ? mangaMap[mId] : (mName ? validMangaNameMap[mName] : null);

      // กรองมังงะที่ถูกลบออกจากระบบแล้ว ไม่นำมาแสดงผล
      if (mId && !manga) {
        continue;
      }

      // Authoritative current chapter from Mangas sheet (falling back to obj.currentchapter)
      let currentChap = 0;
      if (manga && manga.lastchapter !== undefined && manga.lastchapter !== null && String(manga.lastchapter).trim() !== '') {
        const mMatch = String(manga.lastchapter).match(/(\d+(?:\.\d+)?)/);
        currentChap = mMatch ? parseFloat(mMatch[1]) : (parseFloat(manga.lastchapter) || 0);
        if (isNaN(currentChap) || !isFinite(currentChap) || currentChap < 0) currentChap = 0;
      } else if (obj.currentchapter !== undefined && obj.currentchapter !== null && String(obj.currentchapter).trim() !== '') {
        const cMatch = String(obj.currentchapter).match(/(\d+(?:\.\d+)?)/);
        currentChap = cMatch ? parseFloat(cMatch[1]) : (parseFloat(obj.currentchapter) || 0);
        if (isNaN(currentChap) || !isFinite(currentChap) || currentChap < 0) currentChap = 0;
      }

      const currentChapStr = currentChap > 0 ? String(currentChap) : (manga ? String(manga.lastchapter || '0') : String(obj.currentchapter || '0'));
      obj.currentChapter = currentChapStr;
      obj.currentchapter = currentChapStr; // Ensure lowercase consistency across scripts/UI
      if (!obj.manganame && manga) obj.manganame = manga.manganame;

      // Ensure status is 100% accurate & NEVER contains NaN:
      let rawCount = parseFloat(obj.lastrawcount);
      if (isNaN(rawCount) || !isFinite(rawCount) || rawCount < 0) {
        const rMatch = String(obj.lastrawcount || '').match(/(\d+(?:\.\d+)?)/);
        rawCount = rMatch ? parseFloat(rMatch[1]) : 0;
      }
      if (isNaN(rawCount) || !isFinite(rawCount) || rawCount < 0) rawCount = 0;
      obj.lastrawcount = rawCount > 0 ? rawCount : (obj.lastrawcount === 'NaN' ? 0 : (obj.lastrawcount || 0));

      // Clean up any historical NaN in status
      if (obj.status && (String(obj.status).indexOf('NaN') !== -1 || String(obj.status).indexOf('nan') !== -1)) {
        obj.status = 'เป็นปัจจุบัน';
      }

      if (rawCount > 0 && currentChap > 0) {
        if (rawCount <= currentChap) {
          obj.status = 'เป็นปัจจุบัน';
        } else {
          const diff = Math.round((rawCount - currentChap) * 100) / 100;
          obj.status = 'มีตอนใหม่ (+' + diff + ' ตอน)';
        }
      } else if (rawCount > 0 && currentChap === 0) {
        obj.status = 'มีตอนใหม่ (+' + rawCount + ' ตอน)';
      }
      results.push(obj);
    }
    return results;
  } catch (err) {
    console.error('getRawTrackerList Error:', err);
    return [];
  }
}

function scrapeRawUrl(url, pattern) {
  if (!url || typeof url !== 'string' || !url.trim().startsWith('http')) {
    return { success: false, error: 'URL ไม่ถูกต้อง' };
  }

  try {
    const cleanUrl = url.trim();
    const options = {
      method: 'get',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,th;q=0.8,en;q=0.7',
      },
      muteHttpExceptions: true,
      followRedirects: true
    };

    const response = UrlFetchApp.fetch(cleanUrl, options);
    const code = response.getResponseCode();
    if (code !== 200) {
      return { success: false, error: 'HTTP Code: ' + code };
    }

    const html = response.getContentText('UTF-8') || response.getContentText();

    let matchedText = '';
    let chapterCount = 0;

    // 1. If custom regex provided
    if (pattern && pattern.trim()) {
      try {
        const regex = new RegExp(pattern.trim());
        const match = html.match(regex);
        if (match) {
          matchedText = match[0];
          if (match[1]) {
            const num = parseFloat(match[1].replace(/,/g, ''));
            if (!isNaN(num)) {
              chapterCount = num;
            } else {
              const innerNum = match[1].match(/(?:第)?\s*(\d+(?:\.\d+)?)\s*(?:话|集)?/);
              if (innerNum) chapterCount = parseFloat(innerNum[1]);
            }
          }
        }
      } catch (e) {
        console.error('Custom regex error:', e);
      }
    }

    // 2. QQ Comic (ac.qq.com) pattern: 最新话：[第277话 哪个才是真的？]2026.10.30
    // Matches exact HTML structure: <li><span class="ui-font-fb">最新话：</span><a class="works-ft-new" ...>[第277话 哪个才是真的？]</a><span class="ui-pl10 ui-text-gray6">2026.10.30</span></li>
    if (!matchedText && (cleanUrl.indexOf('ac.qq.com') !== -1 || html.indexOf('最新话') !== -1)) {
      const qqLiMatch = html.match(/<li[^>]*>(?:(?!<\/li>)[\s\S])*?最新话(?:(?!<\/li>)[\s\S])*?<\/li>/i);
      if (qqLiMatch) {
        const rawLi = qqLiMatch[0];
        const titleMatch = rawLi.match(/\[([^\]]+)\]/);
        const dateMatch = rawLi.match(/(\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2})/);
        if (titleMatch) {
          const innerTitle = titleMatch[1].trim();
          const dateStr = dateMatch ? dateMatch[1].trim() : '';
          matchedText = '最新话：[' + innerTitle + ']' + (dateStr ? dateStr : '');
          const chapNumMatch = innerTitle.match(/(?:第)?\s*(\d+(?:\.\d+)?)\s*(?:话|集)?/);
          if (chapNumMatch) {
            chapterCount = parseFloat(chapNumMatch[1]);
          }
        }
      } else {
        const rawQqMatch = html.match(/最新话[：:][\s\S]*?\[([^\]]+)\](?:[\s\S]*?(\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}))?/);
        if (rawQqMatch) {
          const innerTitle = rawQqMatch[1].trim();
          const dateStr = rawQqMatch[2] ? rawQqMatch[2].trim() : '';
          matchedText = '最新话：[' + innerTitle + ']' + (dateStr ? dateStr : '');
          const chapNumMatch = innerTitle.match(/(?:第)?\s*(\d+(?:\.\d+)?)\s*(?:话|集)?/);
          if (chapNumMatch) {
            chapterCount = parseFloat(chapNumMatch[1]);
          }
        }
      }
    }

    // 3. EN-THUNDERSCANS (en-thunderscans.com) pattern: New Chapter -> Chapter 73
    // Matches: <span>New Chapter</span> ... <span class="epcur epcurlast">Chapter 73</span>
    if (!matchedText && (cleanUrl.indexOf('thunderscans') !== -1 || html.indexOf('New Chapter') !== -1)) {
      const thunderMatch = html.match(/(?:New\s*Chapter|Latest\s*Chapter)[\s\S]{1,250}?((?:Chapter|Ch\.)\s*(\d+(?:\.\d+)?))/i);
      if (thunderMatch) {
        matchedText = 'New Chapter: ' + thunderMatch[1].trim();
        chapterCount = parseFloat(thunderMatch[2]);
      } else {
        const epcurMatch = html.match(/class="[^"]*epcurlast[^"]*"[^>]*>\s*((?:Chapter|Ch\.)\s*(\d+(?:\.\d+)?))/i);
        if (epcurMatch) {
          matchedText = 'New Chapter: ' + epcurMatch[1].trim();
          chapterCount = parseFloat(epcurMatch[2]);
        }
      }
    }

    // 4. Kuaikanmanhua default pattern: 共366篇正文 (or fallback: 共...个内容)
    if (!matchedText) {
      const matchKuaikan = html.match(/共\s*(\d+)\s*篇正文/) || html.match(/共\s*(\d+)\s*个内容/);
      if (matchKuaikan) {
        matchedText = matchKuaikan[0];
        chapterCount = parseInt(matchKuaikan[1], 10);
      }
    }

    // 5. QQ Comic fallback patterns: 第...话 or 更新至...话
    if (!matchedText) {
      const matchQq = html.match(/更新至\s*(\d+)\s*话/) || html.match(/共\s*(\d+)\s*话/);
      if (matchQq) {
        matchedText = matchQq[0];
        chapterCount = parseInt(matchQq[1], 10);
      } else {
        const allMatches = html.match(/第\s*(\d+)\s*话/g);
        if (allMatches && allMatches.length > 0) {
          let maxNum = 0;
          allMatches.forEach(m => {
            const n = parseInt(m.replace(/\D/g, ''), 10);
            if (!isNaN(n) && n > maxNum) maxNum = n;
          });
          if (maxNum > 0) {
            matchedText = '第' + maxNum + '话';
            chapterCount = maxNum;
          }
        }
      }
    }

    // 6. Other common patterns
    if (!matchedText) {
      const generic = html.match(/(?:更新至|連載至|连载至|Chapter|Ch\.)\s*(\d+)/i);
      if (generic) {
        matchedText = generic[0];
        chapterCount = parseInt(generic[1], 10);
      }
    }

    if (!matchedText) {
      return {
        success: false,
        error: 'ไม่พบข้อความจำนวนตอน (เช่น 共...个内容) ในหน้าเว็บนี้'
      };
    }

    if (isNaN(chapterCount) || !isFinite(chapterCount) || chapterCount < 0) {
      chapterCount = 0;
    }

    return {
      success: true,
      rawText: matchedText,
      chapterCount: chapterCount,
      url: cleanUrl,
      timestamp: new Date().toISOString()
    };
  } catch (err) {
    return {
      success: false,
      error: 'ดึงข้อมูลไม่สำเร็จ: ' + err.toString()
    };
  }
}

function addRawTracker(item) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const sheet = getSheet(RAW_TRACKER_SHEET_NAME);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => h.toString().toLowerCase().trim());

    const id = 'TRK' + new Date().getTime();
    const now = new Date();
    
    // Resolve current chapter
    let currentChapVal = item.currentchapter !== undefined ? item.currentchapter : (item.currentChapter !== undefined ? item.currentChapter : '');
    if (!currentChapVal && item.mangaid) {
      const mList = getMangaList();
      const mMatch = mList.find(m => String(m.mangaid) === String(item.mangaid));
      if (mMatch && mMatch.lastchapter) currentChapVal = String(mMatch.lastchapter);
    }
    const currentChapNum = parseFloat(currentChapVal) || 0;

    // Test scrape initial
    let initialText = '';
    let initialCount = 0;
    let initialStatus = 'กำลังรอตรวจสอบ';
    if (item.url) {
      const sc = scrapeRawUrl(item.url, item.pattern);
      if (sc.success) {
        initialText = sc.rawText;
        initialCount = sc.chapterCount;
        if (initialCount > 0 && currentChapNum > 0) {
          if (initialCount > currentChapNum) {
            const diff = Math.round((initialCount - currentChapNum) * 100) / 100;
            initialStatus = 'มีตอนใหม่ (+' + diff + ' ตอน)';
          } else {
            initialStatus = 'เป็นปัจจุบัน';
          }
        } else {
          initialStatus = 'เป็นปัจจุบัน';
        }
      }
    }

    const newRow = headers.map(header => {
      if (header === 'trackerid') return id;
      if (header === 'mangaid') return item.mangaid || '';
      if (header === 'manganame') return item.manganame || '';
      if (header === 'url') return item.url || '';
      if (header === 'pattern') return item.pattern || '';
      if (header === 'lastrawtext') return initialText;
      if (header === 'lastrawcount') return initialCount;
      if (header === 'status') return initialStatus;
      if (header === 'lastchecked') return now;
      if (header === 'updatedat') return now;
      if (header === 'autocheck') return item.autocheck !== undefined ? item.autocheck : true;
      if (header === 'currentchapter') return String(currentChapVal || '0');
      return '';
    });

    sheet.appendRow(newRow);
    return getRawTrackerList();
  } catch (err) {
    return { error: 'Add Tracker Failed: ' + err.toString() };
  } finally {
    lock.releaseLock();
  }
}

function updateRawTracker(trackerId, updateData) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const sheet = getSheet(RAW_TRACKER_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => h.toString().toLowerCase().trim());
    const idCol = headers.indexOf('trackerid');

    for (let i = 1; i < data.length; i++) {
      if (data[i][idCol].toString() === trackerId.toString()) {
        const rowNum = i + 1;
        Object.keys(updateData).forEach(key => {
          const colIndex = headers.indexOf(key.toLowerCase());
          if (colIndex !== -1) {
            sheet.getRange(rowNum, colIndex + 1).setValue(updateData[key]);
          }
        });

        // If currentchapter was updated, recalculate status if not explicitly given
        const updatedChapVal = updateData.currentchapter !== undefined ? updateData.currentchapter : updateData.currentChapter;
        if (updatedChapVal !== undefined && updateData.status === undefined) {
          const chapNum = parseFloat(updatedChapVal) || 0;
          const countCol = headers.indexOf('lastrawcount');
          const statusCol = headers.indexOf('status');
          const rawCount = updateData.lastrawcount !== undefined ? (parseFloat(updateData.lastrawcount) || 0) : (countCol !== -1 ? (parseFloat(data[i][countCol]) || 0) : 0);
          let newStatus = 'เป็นปัจจุบัน';
          if (rawCount > 0 && chapNum > 0) {
            if (rawCount > chapNum) {
              const diff = Math.round((rawCount - chapNum) * 100) / 100;
              newStatus = 'มีตอนใหม่ (+' + diff + ' ตอน)';
            } else {
              newStatus = 'เป็นปัจจุบัน';
            }
          } else if (rawCount > 0 && chapNum === 0) {
            newStatus = 'มีตอนใหม่ (+' + rawCount + ' ตอน)';
          }
          if (statusCol !== -1) {
            sheet.getRange(rowNum, statusCol + 1).setValue(newStatus);
          }
        }
        break;
      }
    }
    return getRawTrackerList();
  } catch (err) {
    return { error: 'Update Tracker Failed: ' + err.toString() };
  } finally {
    lock.releaseLock();
  }
}

function deleteRawTracker(trackerId) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const sheet = getSheet(RAW_TRACKER_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const idCol = data[0].map(h => h.toString().toLowerCase().trim()).indexOf('trackerid');

    for (let i = 1; i < data.length; i++) {
      if (data[i][idCol].toString() === trackerId.toString()) {
        sheet.deleteRow(i + 1);
        break;
      }
    }
    return getRawTrackerList();
  } catch (err) {
    return { error: 'Delete Tracker Failed: ' + err.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * ลบ Tracker ใน RawTracker เมื่อมังงะถูกลบออกจาก Mangas
 */
function deleteRawTrackerByMangaId(mangaId) {
  if (!mangaId) return;
  const sheet = getSheet(RAW_TRACKER_SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;
  const headers = data[0].map(h => h.toString().toLowerCase().trim());
  const mIdCol = headers.indexOf('mangaid');
  if (mIdCol === -1) return;

  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][mIdCol]).trim() === String(mangaId).trim()) {
      sheet.deleteRow(i + 1);
    }
  }
}

/**
 * อัปเดตชื่อเรื่อง, URL และเลขตอนล่าสุด ใน RawTracker ให้ตรงกับหน้าตั้งค่ามังงะเสมอ
 */
function syncRawTrackerMangaInfo(mangaId, newName, newUrl, newLastChapter) {
  if (!mangaId) return;
  const sheet = getSheet(RAW_TRACKER_SHEET_NAME);
  ensureSheetHeaders(sheet, RAW_TRACKER_SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;
  const headers = data[0].map(h => h.toString().toLowerCase().trim());
  const mIdCol = headers.indexOf('mangaid');
  const nameCol = headers.indexOf('manganame');
  const urlCol = headers.indexOf('url');
  const chapCol = headers.indexOf('currentchapter');
  const countCol = headers.indexOf('lastrawcount');
  const statusCol = headers.indexOf('status');
  const updatedCol = headers.indexOf('updatedat');
  if (mIdCol === -1) return;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][mIdCol]).trim() === String(mangaId).trim()) {
      const rowNum = i + 1;
      if (nameCol !== -1 && newName) {
        sheet.getRange(rowNum, nameCol + 1).setValue(newName);
      }
      if (urlCol !== -1 && newUrl) {
        sheet.getRange(rowNum, urlCol + 1).setValue(newUrl);
      }
      if (chapCol !== -1 && newLastChapter !== undefined && newLastChapter !== null && String(newLastChapter).trim() !== '') {
        const chapStr = String(newLastChapter).trim();
        sheet.getRange(rowNum, chapCol + 1).setValue(chapStr);

        // Recalculate status
        const rawCount = countCol !== -1 ? (parseFloat(data[i][countCol]) || 0) : 0;
        const chapNum = parseFloat(chapStr) || 0;
        let newStatus = 'เป็นปัจจุบัน';
        if (rawCount > 0 && chapNum > 0) {
          if (rawCount > chapNum) {
            const diff = Math.round((rawCount - chapNum) * 100) / 100;
            newStatus = 'มีตอนใหม่ (+' + diff + ' ตอน)';
          } else {
            newStatus = 'เป็นปัจจุบัน';
          }
        } else if (rawCount > 0 && chapNum === 0) {
          newStatus = 'มีตอนใหม่ (+' + rawCount + ' ตอน)';
        }
        if (statusCol !== -1) {
          sheet.getRange(rowNum, statusCol + 1).setValue(newStatus);
        }
      }
      if (updatedCol !== -1) {
        sheet.getRange(rowNum, updatedCol + 1).setValue(new Date());
      }
    }
  }
}

/**
 * ซิงค์เลขตอนล่าสุดและสถานะของ Tracker รายการเดี่ยวจากตาราง Mangas
 */
function syncSingleRawTrackerWithManga(trackerId) {
  if (!trackerId) return { error: 'Tracker ID required' };
  const sheet = getSheet(RAW_TRACKER_SHEET_NAME);
  ensureSheetHeaders(sheet, RAW_TRACKER_SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { error: 'No tracker data' };
  
  const headers = data[0].map(h => h.toString().toLowerCase().trim());
  const idCol = headers.indexOf('trackerid');
  const mIdCol = headers.indexOf('mangaid');
  const nameCol = headers.indexOf('manganame');
  const chapCol = headers.indexOf('currentchapter');
  const countCol = headers.indexOf('lastrawcount');
  const statusCol = headers.indexOf('status');
  const updatedCol = headers.indexOf('updatedat');

  const mangaList = getMangaList();
  const mangaMap = {};
  mangaList.forEach(m => { mangaMap[String(m.mangaid).trim()] = m; });

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]).trim() === String(trackerId).trim()) {
      const rowNum = i + 1;
      const mId = mIdCol !== -1 ? String(data[i][mIdCol] || '').trim() : '';
      const manga = mId ? mangaMap[mId] : null;
      if (!manga) {
        return { error: 'ไม่พบมังงะที่เชื่อมโยงกับ Tracker นี้ในตาราง Mangas' };
      }

      let mChapNum = 0;
      if (manga.lastchapter !== undefined && manga.lastchapter !== null && String(manga.lastchapter).trim() !== '') {
        const mMatch = String(manga.lastchapter).match(/(\d+(?:\.\d+)?)/);
        mChapNum = mMatch ? parseFloat(mMatch[1]) : (parseFloat(manga.lastchapter) || 0);
        if (isNaN(mChapNum) || !isFinite(mChapNum) || mChapNum < 0) mChapNum = 0;
      }
      const mChapStr = mChapNum > 0 ? String(mChapNum) : String(manga.lastchapter || '0');

      if (chapCol !== -1) {
        sheet.getRange(rowNum, chapCol + 1).setValue(mChapStr);
      }

      // Recalculate status
      const rawCount = countCol !== -1 ? (parseFloat(data[i][countCol]) || 0) : 0;
      let newStatus = 'เป็นปัจจุบัน';
      if (rawCount > 0 && mChapNum > 0) {
        if (rawCount > mChapNum) {
          const diff = Math.round((rawCount - mChapNum) * 100) / 100;
          newStatus = 'มีตอนใหม่ (+' + diff + ' ตอน)';
        } else {
          newStatus = 'เป็นปัจจุบัน';
        }
      } else if (rawCount > 0 && mChapNum === 0) {
        newStatus = 'มีตอนใหม่ (+' + rawCount + ' ตอน)';
      }

      if (statusCol !== -1) {
        sheet.getRange(rowNum, statusCol + 1).setValue(newStatus);
      }
      if (updatedCol !== -1) {
        sheet.getRange(rowNum, updatedCol + 1).setValue(new Date());
      }

      return {
        success: true,
        trackerId: trackerId,
        mangaId: mId,
        currentChapter: mChapStr,
        status: newStatus,
        list: getRawTrackerList()
      };
    }
  }

  return { error: 'Tracker not found' };
}

/**
 * ซิงค์ข้อมูลกับตารางมังงะ:
 * 1. ลบเรื่องที่ถูกลบออกจาก Mangas ทิ้งไป
 * 2. เพิ่มเรื่องที่มี Original URL แต่ยังไม่ได้ติดตาม
 * 3. อัปเดตชื่อเรื่องและ URL ของเรื่องเดิมให้เป็นปัจจุบัน
 */
function importTrackersFromMangaList() {
  const mangaList = getMangaList();
  const validMangaIdSet = new Set(mangaList.map(m => String(m.mangaid).trim()));
  const validMangaNameMap = {};
  mangaList.forEach(m => {
    if (m.manganame) validMangaNameMap[m.manganame.trim().toLowerCase()] = m;
  });

  const mangaMap = {};
  mangaList.forEach(m => { mangaMap[String(m.mangaid).trim()] = m; });

  const sheet = getSheet(RAW_TRACKER_SHEET_NAME);
  ensureSheetHeaders(sheet, RAW_TRACKER_SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => h.toString().toLowerCase().trim());
  
  const mIdCol = headers.indexOf('mangaid');
  const nameCol = headers.indexOf('manganame');
  const urlCol = headers.indexOf('url');
  const chapCol = headers.indexOf('currentchapter');
  const countCol = headers.indexOf('lastrawcount');
  const statusCol = headers.indexOf('status');
  const updatedCol = headers.indexOf('updatedat');
  
  const existingMangaIds = new Set();
  const existingUrls = new Set();
  let deletedCount = 0;
  let syncedCount = 0;

  // 1. ตรวจสอบแถวเดิมใน RawTracker: ถ้าเรื่องถูกลบออกจาก Mangas แล้ว หรือมีแถวซ้ำ ให้ลบแถวออกจาก RawTracker
  //    และอัปเดตข้อมูลมังงะ (ชื่อ, originalurl, และ currentChapter ล่าสุดจากตาราง Mangas พร้อมคำนวณ status ใหม่)
  if (data.length > 1) {
    for (let i = data.length - 1; i >= 1; i--) {
      const rowMangaId = mIdCol !== -1 ? String(data[i][mIdCol] || '').trim() : '';
      const rowMangaName = nameCol !== -1 ? String(data[i][nameCol] || '').trim().toLowerCase() : '';
      const rowUrl = urlCol !== -1 ? String(data[i][urlCol] || '').trim().toLowerCase().replace(/\/+$/, '') : '';
      
      let isOrphaned = false;
      if (rowMangaId) {
        if (!validMangaIdSet.has(rowMangaId)) {
          isOrphaned = true;
        }
      } else if (rowMangaName) {
        if (!validMangaNameMap[rowMangaName]) {
          isOrphaned = true;
        }
      }

      const isDuplicate = (rowMangaId && existingMangaIds.has(rowMangaId)) ||
                          (rowUrl && existingUrls.has(rowUrl));

      if (isOrphaned || isDuplicate) {
        sheet.deleteRow(i + 1);
        deletedCount++;
      } else {
        if (rowMangaId) {
          existingMangaIds.add(rowMangaId);
          // อัปเดตข้อมูลมังงะ (ชื่อ, originalurl, และ currentchapter) ให้ตรงกับหน้าตั้งค่ามังงะเสมอ
          const m = mangaMap[rowMangaId];
          if (m) {
            const rowNum = i + 1;
            if (nameCol !== -1 && m.manganame && data[i][nameCol] !== m.manganame) {
              sheet.getRange(rowNum, nameCol + 1).setValue(m.manganame);
            }
            if (urlCol !== -1 && m.originalurl && m.originalurl.trim().startsWith('http') && data[i][urlCol] !== m.originalurl.trim()) {
              sheet.getRange(rowNum, urlCol + 1).setValue(m.originalurl.trim());
            }

            // Sync currentChapter from Mangas
            let mChapNum = 0;
            if (m.lastchapter !== undefined && m.lastchapter !== null && String(m.lastchapter).trim() !== '') {
              const mMatch = String(m.lastchapter).match(/(\d+(?:\.\d+)?)/);
              mChapNum = mMatch ? parseFloat(mMatch[1]) : (parseFloat(m.lastchapter) || 0);
              if (isNaN(mChapNum) || !isFinite(mChapNum) || mChapNum < 0) mChapNum = 0;
            }
            const mChapStr = mChapNum > 0 ? String(mChapNum) : String(m.lastchapter || '0');

            if (chapCol !== -1 && String(data[i][chapCol]).trim() !== mChapStr) {
              sheet.getRange(rowNum, chapCol + 1).setValue(mChapStr);
            }

            // Recalculate status and diff based on updated currentChapter
            const rawCount = countCol !== -1 ? (parseFloat(data[i][countCol]) || 0) : 0;
            let newStatus = 'เป็นปัจจุบัน';
            if (rawCount > 0 && mChapNum > 0) {
              if (rawCount > mChapNum) {
                const diff = Math.round((rawCount - mChapNum) * 100) / 100;
                newStatus = 'มีตอนใหม่ (+' + diff + ' ตอน)';
              } else {
                newStatus = 'เป็นปัจจุบัน';
              }
            } else if (rawCount > 0 && mChapNum === 0) {
              newStatus = 'มีตอนใหม่ (+' + rawCount + ' ตอน)';
            } else if (!data[i][statusCol] || String(data[i][statusCol]).trim() === '') {
              newStatus = 'รอตรวจสอบครั้งแรก';
            } else {
              newStatus = data[i][statusCol];
            }

            if (statusCol !== -1 && data[i][statusCol] !== newStatus) {
              sheet.getRange(rowNum, statusCol + 1).setValue(newStatus);
            }
            if (updatedCol !== -1) {
              sheet.getRange(rowNum, updatedCol + 1).setValue(new Date());
            }
            syncedCount++;
          }
        }
        if (rowUrl) {
          existingUrls.add(rowUrl);
        }
      }
    }
  }

  // 2. เพิ่มมังงะใน Mangas ที่มี originalurl แต่ยังไม่มีใน RawTracker
  const rowsToAdd = [];
  const now = new Date();
  mangaList.forEach(m => {
    const mIdStr = String(m.mangaid).trim();
    if (m.originalurl && m.originalurl.trim().startsWith('http') && !existingMangaIds.has(mIdStr)) {
      const id = 'TRK' + new Date().getTime() + '_' + m.mangaid;
      let mChapNum = 0;
      if (m.lastchapter !== undefined && m.lastchapter !== null && String(m.lastchapter).trim() !== '') {
        const mMatch = String(m.lastchapter).match(/(\d+(?:\.\d+)?)/);
        mChapNum = mMatch ? parseFloat(mMatch[1]) : (parseFloat(m.lastchapter) || 0);
      }
      const mChapStr = mChapNum > 0 ? String(mChapNum) : String(m.lastchapter || '0');

      const row = headers.map(header => {
        if (header === 'trackerid') return id;
        if (header === 'mangaid') return m.mangaid;
        if (header === 'manganame') return m.manganame;
        if (header === 'url') return m.originalurl.trim();
        if (header === 'pattern') return '';
        if (header === 'lastrawtext') return '';
        if (header === 'lastrawcount') return 0;
        if (header === 'status') return 'รอตรวจสอบครั้งแรก';
        if (header === 'lastchecked') return now;
        if (header === 'updatedat') return now;
        if (header === 'autocheck') return true;
        if (header === 'currentchapter') return mChapStr;
        return '';
      });
      rowsToAdd.push(row);
      existingMangaIds.add(mIdStr);
    }
  });

  if (rowsToAdd.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAdd.length, headers.length).setValues(rowsToAdd);
  }

  return {
    deletedCount: deletedCount,
    addedCount: rowsToAdd.length,
    syncedCount: syncedCount,
    list: getRawTrackerList()
  };
}

function checkAllRawTrackers(notifyTelegram = false) {
  const sheet = getSheet(RAW_TRACKER_SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { checked: 0, newUpdates: [], list: [] };

  const headers = data[0].map(h => h.toString().toLowerCase().trim());
  const idCol = headers.indexOf('trackerid') + 1;
  const mangaIdCol = headers.indexOf('mangaid') + 1;
  const nameCol = headers.indexOf('manganame') + 1;
  const urlCol = headers.indexOf('url') + 1;
  const patternCol = headers.indexOf('pattern') + 1;
  const lastTextCol = headers.indexOf('lastrawtext') + 1;
  const lastCountCol = headers.indexOf('lastrawcount') + 1;
  const statusCol = headers.indexOf('status') + 1;
  const lastCheckedCol = headers.indexOf('lastchecked') + 1;
  const updatedAtCol = headers.indexOf('updatedat') + 1;
  const autoCheckCol = headers.indexOf('autocheck') + 1;
  const currentChapCol = headers.indexOf('currentchapter') + 1;

  const mangaList = getMangaList();
  const mangaMap = {};
  mangaList.forEach(m => { mangaMap[String(m.mangaid)] = m; });

  const newUpdates = [];
  const now = new Date();

  for (let i = 1; i < data.length; i++) {
    const rowNum = i + 1;
    const trackerId = data[i][idCol - 1];
    const mangaId = mangaIdCol > 0 ? data[i][mangaIdCol - 1] : '';
    const mangaName = data[i][nameCol - 1];
    const url = data[i][urlCol - 1];
    const pattern = patternCol > 0 ? data[i][patternCol - 1] : '';
    const oldText = lastTextCol > 0 ? String(data[i][lastTextCol - 1] || '').trim() : '';
    const oldCount = lastCountCol > 0 ? (parseFloat(data[i][lastCountCol - 1]) || 0) : 0;
    const autoCheck = autoCheckCol > 0 ? String(data[i][autoCheckCol - 1]).toLowerCase() !== 'false' : true;

    if (!autoCheck || !url || !String(url).trim().startsWith('http')) continue;

    // ถ้ามังงะเรื่องนี้ถูกลบไปแล้ว ให้ข้าม ไม่ต้อง scrape
    if (mangaId && !mangaMap[String(mangaId)]) continue;

    const res = scrapeRawUrl(url, pattern);
    if (res.success) {
      const newText = res.rawText || '';
      let newCount = parseFloat(res.chapterCount);
      if (isNaN(newCount) || !isFinite(newCount) || newCount < 0) newCount = 0;

      const manga = mangaMap[String(mangaId)];
      let systemChap = 0;
      if (manga && manga.lastchapter) {
        const mMatch = String(manga.lastchapter).match(/(\d+(?:\.\d+)?)/);
        systemChap = mMatch ? parseFloat(mMatch[1]) : (parseFloat(manga.lastchapter) || 0);
        if (isNaN(systemChap) || !isFinite(systemChap) || systemChap < 0) systemChap = 0;
      }
      
      let isChanged = false;
      let diff = 0;

      // Strict check: Only count as new chapter if newCount > systemChap
      if (newCount > 0 && systemChap > 0) {
        if (newCount > systemChap) {
          isChanged = true;
          diff = Math.round((newCount - systemChap) * 100) / 100;
        } else {
          isChanged = false;
          diff = 0;
        }
      } else if (newCount > 0 && systemChap === 0) {
        if (oldCount > 0 && newCount > oldCount) {
          isChanged = true;
          diff = Math.round((newCount - oldCount) * 100) / 100;
        } else if (oldCount === 0) {
          isChanged = true;
          diff = newCount;
        }
      } else if (oldText !== '' && oldText !== newText) {
        // Fallback only if no numeric chapter count could be parsed
        isChanged = true;
        diff = 1;
      }

      if (isNaN(diff) || !isFinite(diff) || diff < 0) {
        diff = isChanged ? 1 : 0;
      }

      let status = 'เป็นปัจจุบัน';
      if (isChanged && diff > 0) {
        status = 'มีตอนใหม่ (+' + diff + ' ตอน)';
        newUpdates.push({
          mangaName: mangaName,
          oldText: oldText,
          newText: newText,
          url: url,
          newCount: newCount
        });
        if (updatedAtCol > 0) sheet.getRange(rowNum, updatedAtCol).setValue(now);
      }

      const systemChapStr = systemChap > 0 ? String(systemChap) : (manga ? String(manga.lastchapter || '0') : '0');
      if (currentChapCol > 0) sheet.getRange(rowNum, currentChapCol).setValue(systemChapStr);
      if (lastTextCol > 0) sheet.getRange(rowNum, lastTextCol).setValue(newText);
      if (lastCountCol > 0) sheet.getRange(rowNum, lastCountCol).setValue(newCount);
      if (statusCol > 0) sheet.getRange(rowNum, statusCol).setValue(status);
      if (lastCheckedCol > 0) sheet.getRange(rowNum, lastCheckedCol).setValue(now);
    } else {
      if (statusCol > 0) sheet.getRange(rowNum, statusCol).setValue('ตรวจสอบไม่ได้: ' + (res.error || ''));
      if (lastCheckedCol > 0) sheet.getRange(rowNum, lastCheckedCol).setValue(now);
    }
  }

  // Send Telegram notification if updates found
  if (notifyTelegram && newUpdates.length > 0 && TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    try {
      let msg = '🚨 <b>[แจ้งเตือนต้นฉบับอัปเดตตอนใหม่!]</b>\n\n';
      newUpdates.forEach((u, idx) => {
        msg += (idx + 1) + '. 📖 <b>' + u.mangaName + '</b>\n';
        msg += '   ├ เดิม: ' + (u.oldText || 'เพิ่งเริ่มติดตาม') + '\n';
        msg += '   ├ ใหม่: <b>' + u.newText + '</b>\n';
        msg += '   └ 🔗 <a href="' + u.url + '">เปิดดูต้นฉบับ</a>\n\n';
      });
      sendTelegramMessage(TELEGRAM_CHAT_ID, msg);
    } catch (e) {
      console.error('Telegram notification error:', e);
    }
  }

  const lastCheckInfo = {
    checkedAt: now.toISOString(),
    checkedCount: data.length - 1,
    newUpdatesCount: newUpdates.length,
    newUpdates: newUpdates
  };
  try {
    PropertiesService.getScriptProperties().setProperty('RAW_TRACKER_LAST_CHECK', JSON.stringify(lastCheckInfo));
  } catch (e) {
    console.warn('Could not save RAW_TRACKER_LAST_CHECK property:', e);
  }

  return {
    success: true,
    checkedAt: now.toISOString(),
    newUpdatesCount: newUpdates.length,
    newUpdates: newUpdates,
    lastCheck: lastCheckInfo,
    list: getRawTrackerList()
  };
}

const GITHUB_REPO_OWNER = 'mangahub888';
const GITHUB_REPO_NAME = 'mangahub888.github.io';
const GITHUB_WORKFLOW_FILE = 'auto_raw_tracker.yml';
const GITHUB_TOKEN_PROP = 'GITHUB_TOKEN';
// Default token (authorized with workflow scope)
const DEFAULT_GITHUB_TOKEN = ''; // Injected via ScriptProperties (SET_GITHUB_TOKEN)

function getGitHubToken() {
  try {
    const token = PropertiesService.getScriptProperties().getProperty(GITHUB_TOKEN_PROP);
    if (token && token.trim()) return token.trim();
  } catch (e) {}
  return DEFAULT_GITHUB_TOKEN;
}

function setGitHubToken(token) {
  if (!token) return { error: 'กรุณาระบุ Token' };
  PropertiesService.getScriptProperties().setProperty(GITHUB_TOKEN_PROP, token.trim());
  return { success: true, message: 'บันทึก GitHub Token เรียบร้อยแล้ว' };
}

function triggerGitHubRawTrackerPipeline(triggerSource, checkResult) {
  try {
    const token = getGitHubToken();
    if (!token) {
      console.warn('triggerGitHubRawTrackerPipeline: GITHUB_TOKEN not available');
      return { success: false, error: 'GITHUB_TOKEN not available' };
    }

    const url = 'https://api.github.com/repos/' + GITHUB_REPO_OWNER + '/' + GITHUB_REPO_NAME + '/actions/workflows/' + GITHUB_WORKFLOW_FILE + '/dispatches';
    const payload = {
      ref: 'main',
      inputs: {
        cooldown_seconds: '300',
        max_chapters: '0'
      }
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'MangaHub-GAS-AutoTracker'
      },
      muteHttpExceptions: true
    };

    const resp = UrlFetchApp.fetch(url, options);
    const code = resp.getResponseCode();
    const now = new Date().toISOString();

    const resultStatus = {
      lastTriggeredAt: now,
      triggerSource: (typeof triggerSource === 'string' && triggerSource) ? triggerSource : 'gas_6h_time_trigger',
      statusCode: code,
      success: code === 204 || code === 200,
      response: resp.getContentText()
    };

    try {
      PropertiesService.getScriptProperties().setProperty('RAW_TRACKER_LAST_PIPELINE_TRIGGER', JSON.stringify(resultStatus));
    } catch (e) {}

    console.log('triggerGitHubRawTrackerPipeline status:', code, resultStatus);
    return resultStatus;
  } catch (err) {
    console.error('triggerGitHubRawTrackerPipeline error:', err);
    return { success: false, error: err.toString() };
  }
}

function getAutoTrackerStatus() {
  let lastCheck = null;
  let lastPipelineTrigger = null;
  let isHourlyTriggerActive = false;

  try {
    const rawCheck = PropertiesService.getScriptProperties().getProperty('RAW_TRACKER_LAST_CHECK');
    if (rawCheck) lastCheck = JSON.parse(rawCheck);
  } catch (e) {}

  try {
    const rawTrigger = PropertiesService.getScriptProperties().getProperty('RAW_TRACKER_LAST_PIPELINE_TRIGGER');
    if (rawTrigger) lastPipelineTrigger = JSON.parse(rawTrigger);
  } catch (e) {}

  try {
    const triggers = ScriptApp.getProjectTriggers();
    isHourlyTriggerActive = triggers.some(t => t.getHandlerFunction() === 'hourlyRawTrackerJob');
  } catch (e) {}

  return {
    success: true,
    isHourlyTriggerActive: isHourlyTriggerActive,
    lastCheck: lastCheck,
    lastPipelineTrigger: lastPipelineTrigger
  };
}

function setupHourlyTrackerTrigger() {
  const functionName = 'hourlyRawTrackerJob';
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === functionName) {
      ScriptApp.deleteTrigger(t);
    }
  });

  const newTrigger = ScriptApp.newTrigger(functionName)
    .timeBased()
    .everyHours(1)
    .create();

  return {
    success: true,
    triggerId: newTrigger.getUniqueId(),
    message: 'ตั้งระบบตรวจสอบต้นฉบับอัตโนมัติทุกๆ 1 ชั่วโมง (GAS Active) เรียบร้อยแล้ว'
  };
}

function hourlyRawTrackerJob() {
  console.log('hourlyRawTrackerJob started: checking all sources (快看 / QQ / Thunderscans)...');
  const checkResult = checkAllRawTrackers(true);
  // เมื่อ GAS เช็คเสร็จแล้ว สั่งรัน GitAction raw tracker pipeline ทันที
  const triggerResult = triggerGitHubRawTrackerPipeline('hourly_gas_job', checkResult);
  console.log('hourlyRawTrackerJob finished, pipeline trigger result:', triggerResult);
  return {
    success: true,
    checkResult: checkResult,
    triggerResult: triggerResult
  };
}

/**
 * ดึงรายการตอนใหม่ทั้งหมดที่รออัปโหลดและลงคิวงานจาก RawTracker
 * ตรวจสอบเฉพาะรายการที่มีสถานะ "มีตอนใหม่" หรือ lastrawcount > currentChapter
 * รองรับการดึง Chapter list จาก KuaiKan topic URL โดยอัตโนมัติ
 */
function getRawTrackerPendingChapters(targetTrackerId) {
  try {
    const trackerList = getRawTrackerList();
    const mangaList = getMangaList();
    const mangaMap = {};
    mangaList.forEach(m => { mangaMap[String(m.mangaid)] = m; });

    // ดึงคิวงานเพื่อป้องกันการดึงตอนที่อยู่ในคิวซ้ำซ้อน
    const existingQueue = getWorkQueue(false);
    const queuedChaptersByManga = {};
    existingQueue.forEach(q => {
      const mKey = String(q.mangaid);
      if (!queuedChaptersByManga[mKey]) queuedChaptersByManga[mKey] = new Set();
      const cStr = String(q.chapter || '').trim();
      if (cStr) {
        queuedChaptersByManga[mKey].add(cStr);
        const match = cStr.match(/(\d+(?:\.\d+)?)/);
        if (match) queuedChaptersByManga[mKey].add(String(parseFloat(match[1])));
      }
    });

    const pendingTasks = [];

    for (let i = 0; i < trackerList.length; i++) {
      const item = trackerList[i];
      if (targetTrackerId && String(item.trackerid) !== String(targetTrackerId)) {
        continue;
      }

      const manga = mangaMap[String(item.mangaid)];
      // ข้ามมังงะที่ถูกลบออกจากระบบแล้ว
      if (item.mangaid && !manga) continue;

      const currentChap = parseFloat(item.currentChapter || (manga ? manga.lastchapter : 0)) || 0;
      const rawCount = parseFloat(item.lastrawcount || 0) || 0;
      const hasNew = (rawCount > currentChap) || (item.status && item.status.indexOf('มีตอนใหม่') !== -1);

      if (!hasNew) continue;

      const url = String(item.url || '').trim();
      const isKuaikan = url.indexOf('kuaikanmanhua.com') !== -1;

      if (isKuaikan) {
        // สกัด topic ID เช่น 12602 หรือ 19109 จาก /web/topic/19109/ หรือ /mobile/27689/
        const topicMatch = url.match(/\/(?:topic|mobile)\/(\d+)/i);
        if (topicMatch) {
          const topicId = topicMatch[1];
          const topicUrl = 'https://www.kuaikanmanhua.com/web/topic/' + topicId + '/';
          try {
            const resp = UrlFetchApp.fetch(topicUrl, {
              method: 'get',
              muteHttpExceptions: true,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
              }
            });
            const html = resp.getContentText();
            // Regex สกัด (comicId, title, chapterNum) ครอบคลุมทั้ง 第X话, 第X集, 第X回, และตัวเลขนำหน้า เช่น "4 苦战", "5 交卷离场"
            const chapterMatches = [];
            const regex = /(\d{5,9}),"([^"]*?)"/g;
            let m;
            while ((m = regex.exec(html)) !== null) {
              const cid = m[1];
              const title = m[2].trim();
              
              // 1. ลองหาแบบ 第X话 / 第X集 / 第X回
              let numMatch = title.match(/(?:第)?\s*(\d+(?:\.\d+)?)\s*(?:话|集|回)/i);
              // 2. ถ้าไม่พบ ลองหาตัวเลขขึ้นต้น เช่น "4 苦战" หรือ "04. 苦战"
              if (!numMatch) {
                numMatch = title.match(/^(?:第)?\s*(\d+(?:\.\d+)?)/i);
              }
              // 3. ถ้าไม่พบ ลองหา Chapter / Ch. / Ep. / ตอนที่
              if (!numMatch) {
                numMatch = title.match(/(?:Chapter|Ch\.|Ep\.|ตอน(?:ที่)?)\s*(\d+(?:\.\d+)?)/i);
              }
              
              if (numMatch) {
                const cNum = parseFloat(numMatch[1]);
                // กรองข้ามปี พ.ศ./ค.ศ. เช่น 2024, 2025, 2026 ที่มักเป็นประกาศปีใหม่
                if (cNum >= 1900 && cNum <= 2100 && !/(?:话|集|回)/.test(title)) {
                  continue;
                }
                if (!isNaN(cNum) && cNum > 0 && cNum < 1900) {
                  // ป้องกันซ้ำ
                  if (!chapterMatches.some(function(item) { return item.comicId === cid; })) {
                    chapterMatches.push({
                      comicId: cid,
                      chapterTitle: title,
                      chapterNum: cNum
                    });
                  }
                }
              }
            }

            // จัดเรียงเลขตอนจากน้อยไปหามาก
            chapterMatches.sort(function(a, b) { return a.chapterNum - b.chapterNum; });

            // คัดเฉพาะตอนใหม่ที่เลขตอน > currentChap และยังไม่ได้อยู่ในคิวงาน
            chapterMatches.forEach(function(chap) {
              const cStr = String(chap.chapterNum);
              const mQueued = queuedChaptersByManga[String(item.mangaid)];
              const isAlreadyQueued = mQueued && (mQueued.has(cStr) || mQueued.has(String(Math.floor(chap.chapterNum))));
              if (chap.chapterNum > currentChap && !isAlreadyQueued) {
                pendingTasks.push({
                  trackerId: item.trackerid,
                  mangaId: item.mangaid,
                  mangaName: item.manganame || (manga ? manga.manganame : ''),
                  topicId: topicId,
                  comicId: chap.comicId,
                  chapterNum: chap.chapterNum,
                  chapterTitle: chap.chapterTitle,
                  sourceUrl: item.url,
                  connector: 'kuaikan'
                });
              }
            });
          } catch (fetchErr) {
            console.error('Error fetching KuaiKan topic ' + topicId + ':', fetchErr);
          }
        }
      }
    }

    return {
      success: true,
      pendingCount: pendingTasks.length,
      tasks: pendingTasks
    };
  } catch (err) {
    console.error('getRawTrackerPendingChapters error:', err);
    return { success: false, error: err.toString(), tasks: [] };
  }
}

/**
 * บันทึกความสมบูรณ์หลังจากเย็บและอัปโหลดตอนเสร็จสิ้น:
 * 1. อัปเดตเลขตอนล่าสุดใน Mangas sheet (lastchapter)
 * 2. อัปเดต RawTracker sheet (currentChapter, lastrawcount, status -> 'เป็นปัจจุบัน' หรือ 'มีตอนใหม่')
 * 3. ส่งสัญญาณกลับเพื่อให้ลูปทำงานตอนต่อไป
 */
function completeRawTrackerChapter(payload) {
  try {
    if (!payload || !payload.mangaId || !payload.chapterNum) {
      return { error: 'mangaId and chapterNum required' };
    }

    const mangaId = String(payload.mangaId);
    const chapterNum = parseFloat(payload.chapterNum);
    const chapterStr = String(chapterNum);
    // ป้องกันการปรับ lastchapter/currentchapter ล่วงหน้า:
    // จะอัปเดตเลขตอนในระบบเฉพาะเมื่อระบุว่างานเสร็จสิ้นจริง (isWorkCompleted หรือ updateCurrentChapter)
    const shouldUpdateCurrent = payload.updateCurrentChapter === true || payload.isWorkCompleted === true;

    if (shouldUpdateCurrent) {
      // 1. Update Mangas sheet
      const mangaSheet = getSheet();
      const mData = mangaSheet.getDataRange().getValues();
      const mHeaders = mData[0].map(h => h.toString().toLowerCase().trim());
      const idCol = mHeaders.indexOf('mangaid') + 1;
      const lastChapCol = mHeaders.indexOf('lastchapter') + 1;
      const updatedCol = mHeaders.indexOf('lastupdated') + 1;

      for (let i = 1; i < mData.length; i++) {
        if (String(mData[i][idCol - 1]) === mangaId) {
          if (lastChapCol > 0) mangaSheet.getRange(i + 1, lastChapCol).setValue(chapterStr);
          if (updatedCol > 0) mangaSheet.getRange(i + 1, updatedCol).setValue(new Date());
          break;
        }
      }
      invalidateCache('mangaList');

      // 2. Update RawTracker sheet
      const rtSheet = getSheet(RAW_TRACKER_SHEET_NAME);
      ensureSheetHeaders(rtSheet, RAW_TRACKER_SHEET_NAME);
      const rtData = rtSheet.getDataRange().getValues();
      const rtHeaders = rtData[0].map(h => h.toString().toLowerCase().trim());
      const rtMangaIdCol = rtHeaders.indexOf('mangaid') + 1;
      const rtLastCountCol = rtHeaders.indexOf('lastrawcount') + 1;
      const rtCurrentChapCol = rtHeaders.indexOf('currentchapter') + 1;
      const rtStatusCol = rtHeaders.indexOf('status') + 1;
      const rtCheckedCol = rtHeaders.indexOf('lastchecked') + 1;
      const rtUpdatedCol = rtHeaders.indexOf('updatedat') + 1;

      for (let j = 1; j < rtData.length; j++) {
        if (String(rtData[j][rtMangaIdCol - 1]) === mangaId) {
          const rawCount = parseFloat(rtData[j][rtLastCountCol - 1]) || 0;
          let newStatus = 'เป็นปัจจุบัน';
          if (rawCount > chapterNum) {
            const diff = Math.round((rawCount - chapterNum) * 100) / 100;
            newStatus = 'มีตอนใหม่ (+' + diff + ' ตอน)';
          }
          if (rtCurrentChapCol > 0) rtSheet.getRange(j + 1, rtCurrentChapCol).setValue(chapterStr);
          if (rtStatusCol > 0) rtSheet.getRange(j + 1, rtStatusCol).setValue(newStatus);
          if (rtCheckedCol > 0) rtSheet.getRange(j + 1, rtCheckedCol).setValue(new Date());
          if (rtUpdatedCol > 0) rtSheet.getRange(j + 1, rtUpdatedCol).setValue(new Date());
          break;
        }
      }
    }

    return {
      success: true,
      message: shouldUpdateCurrent
        ? 'อัปเดตสถานะตอน ' + chapterNum + ' ใน Mangas และ RawTracker สำเร็จ'
        : 'บันทึกการดาวน์โหลด RAW ตอน ' + chapterNum + ' สำเร็จ (ไม่ปรับเลขตอนแปลเสร็จ)',
      mangaId: mangaId,
      newChapter: chapterStr
    };
  } catch (err) {
    console.error('completeRawTrackerChapter error:', err);
    return { error: err.toString() };
  }
}

// ==========================================
// KUAIKAN MANHUA (快看漫画) VIP & WECHAT AUTH
// ==========================================

const KUAIKAN_PROP_KEY = 'KUAIKAN_SESSION';

function getKuaikanSessionData() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(KUAIKAN_PROP_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error('getKuaikanSessionData error:', e);
    return null;
  }
}

function getKuaikanAuthStatus() {
  const session = getKuaikanSessionData();
  if (!session || !session.cookie) {
    return {
      loggedIn: false,
      message: 'ยังไม่ได้เชื่อมต่อบัญชี KuaiKan',
      coinAlert: null,
      coinBalance: null,
      insufficientCoins: false,
      isVip: false,
      vipInfo: null
    };
  }

  const isVipRequired = Boolean(session.vipRequired || (session.coinAlert && session.coinAlert.vipRequired));
  const coinAlert = session.coinAlert || ((session.insufficientCoins || isVipRequired) ? {
    hasAlert: true,
    message: session.coinAlertMessage || (isVipRequired ? 'ตอนเป็น VIP Early Access ต้องมีสถานะสมาชิก KuaiKan VIP' : 'เหรียญ KuaiKan หมด หรือไม่เพียงพอสำหรับการปลดล็อคตอน VIP กรุณาเติมเหรียญ'),
    comicTitle: session.lastFailedComicTitle || '',
    chapterTitle: session.lastFailedChapterTitle || '',
    comicId: session.lastFailedComicId || '',
    requiredCoins: session.requiredCoins || null,
    currentBalance: session.coinBalance !== undefined ? session.coinBalance : 0,
    vipRequired: isVipRequired,
    timestamp: session.coinAlertTimestamp || session.updatedAt || new Date().toISOString()
  } : null);

  const isVip = Boolean(session.isVip || (session.vipInfo && session.vipInfo.isVip));

  return {
    loggedIn: true,
    updatedAt: session.updatedAt || '',
    isVip: isVip,
    vipInfo: session.vipInfo || null,
    user: session.user || null,
    walletDetails: session.walletDetails || null,
    cookie: session.cookie || '',
    cookiePreview: session.cookie.substring(0, 20) + '...',
    coinBalance: session.coinBalance !== undefined ? session.coinBalance : null,
    insufficientCoins: Boolean(session.insufficientCoins && (!coinAlert || !coinAlert.dismissed)),
    vipRequired: isVipRequired,
    coinAlert: coinAlert
  };
}

function setKuaikanCoinAlert(payload) {
  const session = getKuaikanSessionData() || {};
  const isVipRequired = Boolean(payload && payload.vipRequired);
  session.vipRequired = isVipRequired;
  session.insufficientCoins = payload && payload.outOfCoins !== undefined ? Boolean(payload.outOfCoins) : !isVipRequired;
  session.coinAlertMessage = (payload && payload.message) || (isVipRequired ? 'ตอนเป็น VIP Early Access (抢先看) ต้องมีสถานะสมาชิก KuaiKan VIP' : 'เหรียญ KuaiKan ไม่เพียงพอสำหรับการปลดล็อคตอน VIP กรุณาเติมเหรียญ');
  session.lastFailedComicTitle = (payload && (payload.comicTitle || payload.mangaName)) || '';
  session.lastFailedChapterTitle = (payload && (payload.chapterTitle || payload.title)) || '';
  session.lastFailedComicId = (payload && (payload.comicId || payload.comic_id)) || '';
  session.requiredCoins = payload && payload.requiredCoins !== undefined ? payload.requiredCoins : null;
  if (payload && payload.currentBalance !== undefined) {
    session.coinBalance = payload.currentBalance;
  }
  session.coinAlertTimestamp = new Date().toISOString();
  session.coinAlert = {
    hasAlert: true,
    message: session.coinAlertMessage,
    comicTitle: session.lastFailedComicTitle,
    chapterTitle: session.lastFailedChapterTitle,
    comicId: session.lastFailedComicId,
    requiredCoins: session.requiredCoins,
    currentBalance: session.coinBalance !== undefined ? session.coinBalance : 0,
    vipRequired: isVipRequired,
    timestamp: session.coinAlertTimestamp,
    dismissed: false
  };
  PropertiesService.getScriptProperties().setProperty(KUAIKAN_PROP_KEY, JSON.stringify(session));
  return { success: true, message: 'บันทึกสถานะแจ้งเตือนเรียบร้อยแล้ว', coinAlert: session.coinAlert };
}

function dismissKuaikanCoinAlert() {
  const session = getKuaikanSessionData();
  if (session) {
    session.insufficientCoins = false;
    session.vipRequired = false;
    if (session.coinAlert) {
      session.coinAlert.hasAlert = false;
      session.coinAlert.dismissed = true;
    }
    PropertiesService.getScriptProperties().setProperty(KUAIKAN_PROP_KEY, JSON.stringify(session));
  }
  return { success: true, message: 'ปิดการแจ้งเตือนเรียบร้อยแล้ว' };
}

function checkKuaikanWalletStatus() {
  const session = getKuaikanSessionData();
  if (!session || !session.cookie) {
    return { loggedIn: false, message: 'ยังไม่ได้เชื่อมต่อบัญชี KuaiKan' };
  }

  try {
    // 1. ตรวจสอบยอดเหรียญ KK Coins และยอดเหรียญคงเหลือจาก API จริงของ KuaiKan
    const rechargeUrl = 'https://www.kuaikanmanhua.com/v2/kb/recharge_good/pc/h5_list';
    const rechargeRes = UrlFetchApp.fetch(rechargeUrl, {
      method: 'get',
      muteHttpExceptions: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.kuaikanmanhua.com/webs/buykkb',
        'Cookie': session.cookie
      }
    });

    if (rechargeRes.getResponseCode() === 200) {
      const rData = JSON.parse(rechargeRes.getContentText());
      if (rData && rData.data && rData.data.user_account) {
        const acc = rData.data.user_account;
        const nonIos = parseFloat(acc.non_ios_balance) || 0;
        const present = parseFloat(acc.latest_present_balance) || 0;
        const ios = parseFloat(acc.ios_balance) || 0;
        session.coinBalance = nonIos + present;
        session.walletDetails = {
          nonIosBalance: nonIos,
          presentBalance: present,
          iosBalance: ios,
          totalAvailable: nonIos + present
        };
      }
    }

    // 2. ตรวจสอบข้อมูลผู้ใช้ (Nickname, Avatar)
    const userUrl = 'https://www.kuaikanmanhua.com/v2/pweb/user_info/get';
    const userRes = UrlFetchApp.fetch(userUrl, {
      method: 'get',
      muteHttpExceptions: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.kuaikanmanhua.com/',
        'Cookie': session.cookie
      }
    });
    if (userRes.getResponseCode() === 200) {
      const uData = JSON.parse(userRes.getContentText());
      if (uData && uData.data && uData.data.user_info) {
        session.user = uData.data.user_info;
      }
    }

    // 3. ตรวจสอบสถานะ VIP
    const vipUrl = 'https://www.kuaikanmanhua.com/v1/vip/pc/me';
    const vipRes = UrlFetchApp.fetch(vipUrl, {
      method: 'get',
      muteHttpExceptions: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.kuaikanmanhua.com/',
        'Cookie': session.cookie
      }
    });
    if (vipRes.getResponseCode() === 200) {
      const vData = JSON.parse(vipRes.getContentText());
      if (vData && vData.data && vData.data.vip) {
        const rawVip = vData.data.vip;
        const vipType = parseInt(rawVip.vip_type !== undefined ? rawVip.vip_type : (rawVip.vipType || 0), 10);
        const remainedDays = parseInt(rawVip.remained_days !== undefined ? rawVip.remained_days : (rawVip.remainedDays || 0), 10);
        const isVip = Boolean(vipType > 0 || remainedDays > 0 || rawVip.is_vip || rawVip.isVip);

        // คำนวณหรือสกัดวันที่หมดอายุ (expireDate ในรูปแบบ DD/MM/YYYY)
        let expireDateStr = '';
        if (rawVip.expire_date || rawVip.expireDate) {
          expireDateStr = String(rawVip.expire_date || rawVip.expireDate);
        } else if (rawVip.expire_time || rawVip.expireTime || rawVip.end_time || rawVip.due_time) {
          let ts = parseInt(rawVip.expire_time || rawVip.expireTime || rawVip.end_time || rawVip.due_time, 10);
          if (ts < 10000000000) ts = ts * 1000;
          const d = new Date(ts);
          if (!isNaN(d.getTime())) {
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            expireDateStr = `${day}/${month}/${year}`;
          }
        }

        if (!expireDateStr && remainedDays > 0) {
          const expDate = new Date(Date.now() + remainedDays * 24 * 60 * 60 * 1000);
          const day = String(expDate.getDate()).padStart(2, '0');
          const month = String(expDate.getMonth() + 1).padStart(2, '0');
          const year = expDate.getFullYear();
          expireDateStr = `${day}/${month}/${year}`;
        }

        session.isVip = isVip;
        session.vipInfo = {
          isVip: isVip,
          vipType: isNaN(vipType) ? 0 : vipType,
          remainedDays: isNaN(remainedDays) ? 0 : remainedDays,
          expireDate: expireDateStr,
          raw: rawVip
        };
      }
    }

    // 4. จัดการสถานะ Alert เหรียญหมด
    if (session.coinBalance !== undefined && session.coinBalance <= 0) {
      session.insufficientCoins = true;
      if (!session.coinAlert || !session.coinAlert.hasAlert) {
        session.coinAlert = {
          hasAlert: true,
          message: 'เหรียญ KuaiKan หมด กรุณาเติมเหรียญเพื่อปลดล็อคตอน',
          currentBalance: 0,
          timestamp: new Date().toISOString(),
          dismissed: false
        };
      }
    } else if (session.coinBalance !== undefined && session.coinBalance > 0) {
      session.insufficientCoins = false;
      if (session.coinAlert && session.coinAlert.hasAlert && (!session.coinAlert.requiredCoins || session.coinBalance >= session.coinAlert.requiredCoins)) {
        session.coinAlert.hasAlert = false;
        session.coinAlert.dismissed = true;
      }
    }

    PropertiesService.getScriptProperties().setProperty(KUAIKAN_PROP_KEY, JSON.stringify(session));
  } catch (err) {
    console.warn('checkKuaikanWalletStatus fetch error:', err);
  }

  return getKuaikanAuthStatus();
}

/**
 * สั่งซื้อตอน KuaiKan เพื่อปลดล็อคตอน VIP อัตโนมัติด้วยเหรียญในระบบ
 */
function purchaseKuaikanChapter(payload) {
  try {
    if (!payload || !payload.comicId) {
      return { status: 'error', success: false, error: 'Missing comicId' };
    }
    const comicId = String(payload.comicId).trim();
    const session = getKuaikanSessionData();
    const testResult = testKuaikanLatestChapter(comicId, session ? session.cookie : null, { skipAutoPurchase: true });

    if (testResult && testResult.imagesCount > 1 && !testResult.isLocked) {
      return {
        status: 'success',
        success: true,
        message: 'ตอนนี้ปลดล็อคอยู่แล้ว',
        comicId: comicId,
        imagesCount: testResult.imagesCount,
        test: testResult
      };
    }

    return {
      status: 'locked',
      success: false,
      isLocked: true,
      comicId: comicId,
      message: 'ตอนติดล็อค กรุณาปลดล็อคผ่าน KuaiKan Auto-Purchaser (Playwright Headless)'
    };
  } catch (err) {
    console.error('purchaseKuaikanChapter error:', err);
    return { status: 'error', success: false, error: err.toString() };
  }
}

function clearKuaikanAuth() {
  PropertiesService.getScriptProperties().deleteProperty(KUAIKAN_PROP_KEY);
  return { success: true, message: 'ลบการเชื่อมต่อบัญชี KuaiKan เรียบร้อยแล้ว' };
}

/**
 * สร้าง WeChat QR Session จาก KuaiKan Web Login
 */
function getKuaikanQrSession() {
  try {
    const initUrl = 'https://www.kuaikanmanhua.com/v1/passport/login/pc/user_wechat_login?redirect_uri=' + 
      encodeURIComponent('https://www.kuaikanmanhua.com/webs/loginh') + '&mini_id=pckuaikan:0';
    
    const initRes = UrlFetchApp.fetch(initUrl, {
      method: 'get',
      followRedirects: false,
      muteHttpExceptions: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const headers = initRes.getAllHeaders();
    let loc = headers['Location'] || headers['location'];
    if (Array.isArray(loc)) loc = loc[0];

    let rawCookies = headers['Set-Cookie'] || headers['set-cookie'] || [];
    if (typeof rawCookies === 'string') rawCookies = [rawCookies];
    const cookies = rawCookies.map(function(c) { return c.split(';')[0].trim(); });

    if (!loc) {
      return { error: 'ไม่สามารถดึง Login URL จาก Kuaikan ได้' };
    }

    const stateMatch = loc.match(/state=([a-zA-Z0-9_\-]+)/);
    const state = stateMatch ? stateMatch[1] : '';

    const qrPageRes = UrlFetchApp.fetch(loc, {
      method: 'get',
      muteHttpExceptions: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const pageHtml = qrPageRes.getContentText();
    const uuidMatch = pageHtml.match(/\/connect\/qrcode\/([a-zA-Z0-9_\-]+)/) || pageHtml.match(/uuid=([a-zA-Z0-9_\-]+)/);
    const uuid = uuidMatch ? uuidMatch[1] : '';

    if (!uuid) {
      return { error: 'ไม่สามารถสกัด WeChat QR UUID ได้' };
    }

    return {
      success: true,
      uuid: uuid,
      state: state,
      cookies: cookies,
      qrUrl: 'https://open.weixin.qq.com/connect/qrcode/' + uuid
    };
  } catch (err) {
    console.error('getKuaikanQrSession error:', err);
    return { error: 'เกิดข้อผิดพลาดในการสร้าง QR Code: ' + err.toString() };
  }
}

/**
 * ตรวจสอบสถานะการสแกน QR Code (Polling WeChat)
 */
function checkKuaikanQrStatus(payload) {
  if (!payload || !payload.uuid) {
    return { error: 'Missing uuid' };
  }

  try {
    const pollUrl = 'https://long.open.weixin.qq.com/connect/l/qrconnect?uuid=' + payload.uuid + '&_=' + new Date().getTime();
    const pollRes = UrlFetchApp.fetch(pollUrl, {
      method: 'get',
      muteHttpExceptions: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const text = pollRes.getContentText();
    
    if (text.indexOf('408') !== -1) {
      return { status: 'waiting', message: 'รอการสแกน QR Code' };
    }
    if (text.indexOf('404') !== -1) {
      return { status: 'scanned', message: 'สแกนสำเร็จแล้ว กรุณากดยืนยันบน WeChat ในมือถือของคุณ' };
    }
    if (text.indexOf('405') !== -1) {
      const codeMatch = text.match(/wx_code\s*=\s*['"]([^'"]+)['"]/);
      const wxCode = codeMatch ? codeMatch[1] : '';
      if (!wxCode) {
        return { error: 'ยืนยันแล้วแต่ไม่พบ WeChat code' };
      }

      // ทำการแลก session ทันที
      return saveKuaikanAuth({
        code: wxCode,
        state: payload.state,
        cookies: payload.cookies || []
      });
    }
    if (text.indexOf('402') !== -1) {
      return { status: 'expired', message: 'QR Code หมดอายุ กรุณารีเฟรชเพื่อสแกนใหม่' };
    }
    if (text.indexOf('403') !== -1) {
      return { status: 'cancelled', message: 'ยกเลิกการเข้าสู่ระบบบนมือถือ' };
    }

    return { status: 'unknown', text: text.substring(0, 100) };
  } catch (e) {
    console.error('checkKuaikanQrStatus error:', e);
    return { error: e.toString() };
  }
}

/**
 * ตรวจสอบและแปลง URL ภาพ KuaiKan ให้เป็น Full HD บน f2.kkmh.com
 * โดยตรวจโครงสร้างโดเมน {subdomain}.kkmh.com/image/... และตัดพารามิเตอร์ Thumbnail ออก เพื่อป้องกัน 403 Forbidden
 */
function normalizeKuaikanImageUrl(url) {
  if (!url) return '';
  let u = String(url).trim().replace(/&amp;/g, '&');
  const match = u.match(/^https?:\/\/[a-zA-Z0-9-]+\.kkmh\.com\/image\/(.+)$/i);
  if (match) {
    let path = match[1];
    // ตัด thumbnail modifier (-t.w1280.jpg.h หรือ -w1280... หรือ query string) ออก เพื่อให้ได้ภาพ HD ต้นฉบับจาก f2.kkmh.com
    path = path.replace(/-t\.w\d+.*$/i, '').replace(/-w\d+.*$/i, '').split('?')[0];
    return 'https://f2.kkmh.com/image/' + path;
  }
  if (u.startsWith('/image/')) {
    let path = u.replace(/^\/image\//, '').replace(/-t\.w\d+.*$/i, '').replace(/-w\d+.*$/i, '').split('?')[0];
    return 'https://f2.kkmh.com/image/' + path;
  }
  return u;
}

/**
 * Regex แกะภาพจากโครงสร้าง HTML ของ KuaiKan:
 * รองรับทั้ง DOM (<div class="img-box">) และ Nuxt SSR State (<script>window.__NUXT__</script>)
 * ถอดรหัส Unicode Escape (\u002F) และตัดภาพแนะนำ/ภาพโฆษณาออก 100%
 */
function extractComicImagesFromHtml(html, comicId) {
  const urls = [];
  if (!html || typeof html !== 'string') return urls;
  if (!comicId) return urls;
  const targetId = String(comicId).trim();

  // 1. ถอดรหัส Unicode escape เช่น \u002F -> / และ \/ -> /
  const decodedHtml = html.replace(/\\u002F/gi, '/').replace(/\\\//g, '/');

  const seenKeys = {};

  // 2. Regex ค้นหาภาพตอนที่มี /image/c<targetId>/ หรือ /c<targetId>/
  // หมายเหตุ: อย่าตัด & ออก เพื่อให้เก็บ query string (?sign=...&t=...) ไว้สำหรับเป็น fallback CDN
  const targetRegex = new RegExp('https?:\\/\\/[^"\'\\s<>]*(?:kkmh\\.com)\\/image\\/c' + targetId + '\\/[^"\'\\s<>]+', 'gi');
  let match;
  while ((match = targetRegex.exec(decodedHtml)) !== null) {
    const rawUrl = match[0].replace(/&amp;/g, '&');
    // ข้ามภาพ thumbnail แนะนำ/โฆษณา (w640)
    if (rawUrl.indexOf('w640') !== -1) continue;

    // ดึงคีย์ภาพที่ไม่ซ้ำ เช่น uzBt0nZ2l
    const keyMatch = rawUrl.match(/\/image\/c\d+\/\d+\/([^.]+)/i);
    const key = keyMatch ? keyMatch[1] : rawUrl;
    if (!seenKeys[key]) {
      seenKeys[key] = true;
      urls.push(rawUrl);
    }
  }

  return urls;
}

/**
 * บันทึก Auth KuaiKan (จาก WeChat Code หรือกรอก Cookie ตรง หรือรับรายชื่อภาพจากหน้าเว็บ)
 */
function saveKuaikanAuth(payload) {
  let cookieHeader = '';

  if (payload.directCookie && payload.directCookie.trim()) {
    let raw = payload.directCookie.trim();
    if (raw.indexOf('=') === -1) {
      raw = 'connect.sid=' + raw;
    }
    cookieHeader = raw;
  } else if (payload.code && payload.state) {
    const cookies = payload.cookies || [];
    const checkUrl = 'https://www.kuaikanmanhua.com/v1/passport/login/pc/user_wechat_login_check?code=' + 
      encodeURIComponent(payload.code) + '&state=' + encodeURIComponent(payload.state);
    
    const res = UrlFetchApp.fetch(checkUrl, {
      method: 'get',
      followRedirects: false,
      muteHttpExceptions: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://open.weixin.qq.com/',
        'Cookie': cookies.join('; ')
      }
    });

    const headers = res.getAllHeaders();
    let setCookies = headers['Set-Cookie'] || headers['set-cookie'] || [];
    if (typeof setCookies === 'string') setCookies = [setCookies];

    const allCookieParts = [].concat(cookies);
    setCookies.forEach(function(sc) {
      const part = sc.split(';')[0].trim();
      allCookieParts.push(part);
    });
    cookieHeader = allCookieParts.join('; ');
  }

  // หากมีการส่ง raw HTML จากแท็ก <div class="comicDetails"> หรือ <div class="imgList"> มา ให้ regex ดึงภาพอัตโนมัติ
  if (payload.html && typeof payload.html === 'string') {
    const extracted = extractComicImagesFromHtml(payload.html, payload.comicId);
    if (extracted.length > 0) {
      payload.images = extracted;
    }
  }

  if (!cookieHeader && (!payload.images || !payload.images.length)) {
    return { error: 'ไม่มี Cookie หรือ Session สำหรับบันทึก' };
  }

  // ทดสอบความถูกต้องและสิทธิ์ VIP (หากส่งรายชื่อภาพจากเบราว์เซอร์มาด้วย ใช้รายชื่อภาพนั้นได้เลย)
  let testRes = null;
  if (payload.images && Array.isArray(payload.images) && payload.images.length > 0) {
    const targetCid = String(payload.comicId || '').trim();
    // กรองเข้มงวด: ภาพตอนแท้จริงต้องมี /image/c<comicId>/ และต้องไม่เป็นภาพโฆษณา/ภาพแนะนำ (w640)
    const cleanImgs = payload.images
      .filter(function(u) {
        if (!u || typeof u !== 'string') return false;
        if (u.indexOf('w640') !== -1) return false;
        if (targetCid) {
          return u.indexOf('/image/c' + targetCid + '/') !== -1 || u.indexOf('/c' + targetCid + '/') !== -1;
        }
        return /\/image\/c\d+\//i.test(u);
      })
      .map(normalizeKuaikanImageUrl)
      .filter(Boolean);

    testRes = {
      success: cleanImgs.length > 0,
      comicId: payload.comicId || null,
      title: payload.title || '',
      topicTitle: payload.topicTitle || '',
      imagesCount: cleanImgs.length,
      isPay: true,
      isLocked: cleanImgs.length <= 1,
      isVipUnlocked: cleanImgs.length > 1,
      isLogin: true,
      sampleImages: cleanImgs.slice(0, 3),
      allImages: cleanImgs
    };
  } else {
    testRes = testKuaikanLatestChapter(payload.comicId || null, cookieHeader);
  }

  const sessionData = {
    cookie: cookieHeader || (getKuaikanSessionData() ? getKuaikanSessionData().cookie : ''),
    updatedAt: new Date().toISOString(),
    isVip: Boolean(testRes && testRes.imagesCount > 1),
    test: testRes
  };

  PropertiesService.getScriptProperties().setProperty(KUAIKAN_PROP_KEY, JSON.stringify(sessionData));

  // ดึงข้อมูล VIP & เหรียญจาก Server KuaiKan ทันทีหลังบันทึก Session
  try {
    checkKuaikanWalletStatus();
  } catch (wErr) {
    console.warn('Auto check wallet error in saveKuaikanAuth:', wErr);
  }

  const updatedAuth = getKuaikanAuthStatus();

  return {
    status: 'success',
    success: true,
    message: 'บันทึก Session KuaiKan เรียบร้อยแล้ว',
    session: updatedAuth,
    test: testRes
  };
}

/**
 * ทดสอบดึงข้อมูลตอนล่าสุดเพื่อเช็ค VIP และภาพที่ปลดล็อค
 */
function testKuaikanLatestChapter(comicId, overrideCookie, options) {
  try {
    const isExplicitId = Boolean(comicId);
    const targetComicId = isExplicitId ? String(comicId).trim() : null;
    let cookie = overrideCookie;
    const session = getKuaikanSessionData();
    if (!cookie) {
      cookie = session ? session.cookie : '';
    }

    if (cookie && cookie.indexOf('=') === -1) {
      cookie = 'connect.sid=' + cookie.trim();
    }

    let rawImages = [];
    let title = '';
    let topicTitle = '';
    let isPay = false;
    let isLogin = false;

    // ถ้าไม่มี comicId ส่งมา (เช่น กดทดสอบ connection จากหน้าเว็บ) ให้ใช้ targetComicId เป็น 855368 เพื่อทดสอบ
    const fetchComicId = targetComicId || '855368';

    // 1. ส่ง Web Scraping ไปดึง HTML ของตอนจาก KuaiKan โดยตรง (ใช้ Cookie ที่ล็อกอินไว้)
    try {
      const webUrl = 'https://www.kuaikanmanhua.com/webs/comic-next/' + fetchComicId;
      const webRes = UrlFetchApp.fetch(webUrl, {
        method: 'get',
        muteHttpExceptions: true,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.kuaikanmanhua.com/',
          'Cookie': cookie || ''
        }
      });
      const webHtml = webRes.getContentText();

      // สกัด Chapter Title และ Topic Title จากแท็ก <title> (เช่น 第366话 真真假假｜我！天命大反派漫画...)
      const titleTagMatch = webHtml.match(/<title>(.*?)<\/title>/i);
      if (titleTagMatch && titleTagMatch[1]) {
        const fullTitle = titleTagMatch[1];
        const parts = fullTitle.split('｜');
        if (parts.length > 0 && parts[0]) title = parts[0].trim();
        if (parts.length > 1 && parts[1]) topicTitle = parts[1].replace(/漫画.*$/, '').trim();
      }

      // สกัดภาพตอนแท้ทั้งหมดผ่าน extractComicImagesFromHtml
      const scrapedImgs = extractComicImagesFromHtml(webHtml, fetchComicId);
      if (scrapedImgs && scrapedImgs.length > 0) {
        rawImages = scrapedImgs;
        isLogin = true;
      }
    } catch (scrapeErr) {
      console.error('Direct web scraping error:', scrapeErr);
    }

    // 2. หาก Web Scraping ได้ภาพน้อยหรือไม่สำเร็จ ให้ Fallback ไปที่ API
    if (rawImages.length <= 1) {
      const url = 'https://api.kkmh.com/v2/comic/' + fetchComicId + '?is_preview=0';
      try {
        const res = UrlFetchApp.fetch(url, {
          method: 'get',
          muteHttpExceptions: true,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.kuaikanmanhua.com/',
            'Cookie': cookie || ''
          }
        });
        const data = JSON.parse(res.getContentText());
        if (data && data.data) {
          const comic = data.data;
          if (!title) title = comic.title || '';
          if (!topicTitle) topicTitle = comic.topic ? comic.topic.title : '';
          isPay = Boolean(comic.selling_kk_currency);
          isLogin = Boolean(comic.is_login);
          const apiImgs = comic.comic_images || comic.images || [];
          if (apiImgs.length > 0) rawImages = apiImgs;
        }
      } catch (parseErr) {
        console.error('api.kkmh.com parse error:', parseErr);
      }
    }

    // 3. Fallback: ถ้าเป็นการทดสอบทั่วไปโดยไม่ระบุ comicId เท่านั้น ถึงจะใช้ session.test.allImages ที่ตรงกับ fetchComicId
    if (!isExplicitId && rawImages.length <= 1 && session && session.test && session.test.allImages && session.test.allImages.length > 1 && String(session.test.comicId) === fetchComicId) {
      rawImages = session.test.allImages;
      if (!title) title = session.test.title || '';
      if (!topicTitle) topicTitle = session.test.topicTitle || '';
    }

    // 4. กรองภาพ rawImages ให้มีเฉพาะภาพของ fetchComicId เท่านั้น (มี /image/c<fetchComicId>/ และไม่มี w640)
    rawImages = rawImages.filter(function(img) {
      const u = typeof img === 'string' ? img : (img.url1280 || img.url || img.rawUrl);
      if (!u || u.indexOf('w640') !== -1) return false;
      return u.indexOf('/image/c' + fetchComicId + '/') !== -1 || u.indexOf('/c' + fetchComicId + '/') !== -1;
    });

    const imagesCount = rawImages.length;
    const isLocked = imagesCount <= 1;

    // หาข้อมูลมังงะภาษาไทย
    const thaiInfo = getThaiMangaInfo(topicTitle || fetchComicId);
    const thaiMangaName = (thaiInfo && thaiInfo.manganame) ? thaiInfo.manganame : (topicTitle || ('Comic_' + fetchComicId));
    const mangaId = (thaiInfo && thaiInfo.mangaid) ? thaiInfo.mangaid : null;

    // หากระบุ comicId เจาะจง แล้วติดล็อคหรือไม่มีภาพ ให้ลอง Auto Purchase (ถ้ามีสิทธิ์) หรือแจ้งเตือนตามเงื่อนไขจริง
    if (isExplicitId && isLocked) {
      return {
        status: 'error',
        success: false,
        error: 'ตอนยังติดล็อค (ComicID: ' + targetComicId + ')',
        comicId: targetComicId,
        mangaId: mangaId,
        mangaName: thaiMangaName,
        thaiTitle: thaiMangaName,
        title: title || '',
        topicTitle: topicTitle || '',
        imagesCount: 0,
        isPay: isPay,
        isLocked: true,
        insufficientCoins: false,
        outOfCoins: false,
        isVipUnlocked: false,
        isLogin: isLogin,
        sampleImages: [],
        allImages: [],
        imageDetails: []
      };
    }

    const sampleImages = rawImages.slice(0, 3).map(function(img) {
      const raw = typeof img === 'string' ? img : (img.rawUrl || img.url1280 || img.url);
      return normalizeKuaikanImageUrl(raw);
    });

    const allNormalizedImages = rawImages.map(function(img) {
      const raw = typeof img === 'string' ? img : (img.rawUrl || img.url1280 || img.url);
      return normalizeKuaikanImageUrl(raw);
    });

    const imageDetails = rawImages.map(function(img) {
      const raw = typeof img === 'string' ? img : (img.rawUrl || img.url1280 || img.url);
      return {
        url: normalizeKuaikanImageUrl(raw),
        rawUrl: raw
      };
    });

    return {
      status: 'success',
      success: true,
      comicId: fetchComicId,
      mangaId: mangaId,
      mangaName: thaiMangaName,
      thaiTitle: thaiMangaName,
      title: title || '',
      topicTitle: topicTitle || '',
      imagesCount: imagesCount,
      isPay: isPay,
      isLocked: isLocked,
      isVipUnlocked: !isLocked,
      isLogin: isLogin,
      sampleImages: sampleImages,
      allImages: allNormalizedImages,
      imageDetails: imageDetails
    };
  } catch (e) {
    console.error('testKuaikanLatestChapter error:', e);
    return { status: 'error', success: false, error: e.toString() };
  }
}

/**
 * Root Folder ID ใน Google Drive สำหรับเก็บมังงะแปล: แปลจนเมื่อย
 * https://drive.google.com/drive/folders/1hA_5XjT1gLnzrAOFpT-COVfIbuSfVG6_
 */
const KUAIKAN_DRIVE_ROOT_FOLDER_ID = '1hA_5XjT1gLnzrAOFpT-COVfIbuSfVG6_';

/**
 * ค้นหาข้อมูลมังงะจากฐานข้อมูล Mangas โดยใช้ชื่อจีน, ID, หรือ URL
 * คืนค่า { mangaid, manganame (ชื่อไทย), originalname (ชื่อจีน) }
 */
function getThaiMangaInfo(identifier) {
  if (!identifier) {
    return { mangaid: null, manganame: '', originalname: '' };
  }
  try {
    const list = getMangaList();
    const cleanId = String(identifier).trim().toLowerCase();
    
    // 1. ค้นหาจาก mangaid ตรงๆ
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (String(m.mangaid) === cleanId) {
        return { mangaid: m.mangaid, manganame: m.manganame, originalname: m.originalname || '' };
      }
    }

    // 2. ค้นหาจาก originalname (ชื่อจีน เช่น 我！天命大反派)
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (m.originalname) {
        const orig = String(m.originalname).trim().toLowerCase();
        if (orig.indexOf(cleanId) !== -1 || cleanId.indexOf(orig) !== -1) {
          return { mangaid: m.mangaid, manganame: m.manganame, originalname: m.originalname };
        }
      }
    }

    // 3. ค้นหาจาก manganame (ชื่อไทย)
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (m.manganame) {
        const name = String(m.manganame).trim().toLowerCase();
        if (name.indexOf(cleanId) !== -1 || cleanId.indexOf(name) !== -1) {
          return { mangaid: m.mangaid, manganame: m.manganame, originalname: m.originalname || '' };
        }
      }
    }

    // 4. ค้นหาจาก originalurl หรือ slug
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (m.originalurl && m.originalurl.toLowerCase().indexOf(cleanId) !== -1) {
        return { mangaid: m.mangaid, manganame: m.manganame, originalname: m.originalname || '' };
      }
      if (m.slug && m.slug.toLowerCase().indexOf(cleanId) !== -1) {
        return { mangaid: m.mangaid, manganame: m.manganame, originalname: m.originalname || '' };
      }
    }
  } catch (e) {
    console.error('getThaiMangaInfo error:', e);
  }

  return { mangaid: null, manganame: String(identifier).trim(), originalname: String(identifier).trim() };
}

/**
 * ดึงหรือสร้างโครงสร้างโฟลเดอร์ใน Google Drive:
 * แปลจนเมื่อย (1hA_5XjT1gLnzrAOFpT-COVfIbuSfVG6_) / {ชื่อเรื่องภาษาไทย} / {เลขตอน}
 */
function getOrCreateChapterFolder(mangaName, chapterName) {
  let rootFolder;
  try {
    rootFolder = DriveApp.getFolderById(KUAIKAN_DRIVE_ROOT_FOLDER_ID);
  } catch (e) {
    console.warn('Cannot get folder by ID ' + KUAIKAN_DRIVE_ROOT_FOLDER_ID + ', searching by name:', e);
    const search = DriveApp.getFoldersByName('แปลจนเมื่อย');
    if (search.hasNext()) {
      rootFolder = search.next();
    } else {
      rootFolder = DriveApp.getRootFolder();
    }
  }

  // 1. ซับโฟลเดอร์ชื่อเรื่องภาษาไทยจากฐานข้อมูล
  const thaiInfo = getThaiMangaInfo(mangaName);
  const cleanMangaName = (thaiInfo.manganame || mangaName || 'Unknown_Manga').trim();

  let mangaFolder;
  const mangaFolders = rootFolder.getFoldersByName(cleanMangaName);
  if (mangaFolders.hasNext()) {
    mangaFolder = mangaFolders.next();
  } else {
    mangaFolder = rootFolder.createFolder(cleanMangaName);
  }

  // 2. ซับโฟลเดอร์เลขตอน (เช่น 第366话)
  let cleanChapterName = (chapterName || 'Chapter_Unknown').trim();
  if (!cleanChapterName.startsWith('第') && cleanChapterName.match(/^\d+$/)) {
    cleanChapterName = '第' + cleanChapterName + '话';
  }
  let chapterFolder;
  const chapterFolders = mangaFolder.getFoldersByName(cleanChapterName);
  if (chapterFolders.hasNext()) {
    chapterFolder = chapterFolders.next();
  } else {
    chapterFolder = mangaFolder.createFolder(cleanChapterName);
  }

  return chapterFolder;
}

/**
 * บันทึกไฟล์ภาพตอนที่เย็บแล้ว (20 หน้า/ไฟล์) ลง Google Drive
 * โครงสร้าง: แปลจนเมื่อย / {ชื่อเรื่อง} / {เลขตอน} / 001.webp
 */
function uploadChapterStitchedPart(payload) {
  try {
    if (!payload || !payload.base64Data) {
      return { error: 'ไม่มีข้อมูล base64Data' };
    }

    const thaiInfo = getThaiMangaInfo(payload.mangaId || payload.mangaName || '');
    const thaiMangaName = thaiInfo.manganame || payload.mangaName || 'Unknown_Manga';
    const mangaId = payload.mangaId || thaiInfo.mangaid || '';
    const chapter = payload.chapter || 'Chapter_Unknown';
    const partIndex = payload.partIndex || 1;
    const totalParts = payload.totalParts || 1;
    const fileName = payload.fileName || (String(partIndex).padStart(3, '0') + '.webp');
    const mimeType = payload.mimeType || 'image/webp';

    // 1. Get Destination Folder (แปลจนเมื่อย / {ชื่อไทย} / {chapter})
    const targetFolder = getOrCreateChapterFolder(thaiMangaName, chapter);
    const folderUrl = targetFolder.getUrl();

    // 2. Decode base64
    let rawBase64 = payload.base64Data;
    if (rawBase64.indexOf('base64,') !== -1) {
      rawBase64 = rawBase64.split('base64,')[1];
    }
    const decodedBytes = Utilities.base64Decode(rawBase64);
    const blob = Utilities.newBlob(decodedBytes, mimeType, fileName);

    // 3. ล้างไฟล์เก่าออก หากเป็นการเริ่มต้นอัปโหลดส่วนแรก (partIndex === 1 หรือ clearFolder: true)
    if (payload.clearFolder || partIndex === 1) {
      const allFiles = targetFolder.getFiles();
      while (allFiles.hasNext()) {
        try {
          allFiles.next().setTrashed(true);
        } catch (trashErr) {}
      }
    } else {
      const existing = targetFolder.getFilesByName(fileName);
      while (existing.hasNext()) {
        try {
          existing.next().setTrashed(true);
        } catch (trashErr) {}
      }
    }

    // 4. Save file
    const createdFile = targetFolder.createFile(blob);
    const fileUrl = createdFile.getUrl();

    // 5. If last part, auto add/update WorkQueue (ข้ามหากเป็นการทดสอบ หรือกำหนด skipQueue: true)
    let queueRes = null;
    const shouldAddToQueue = payload.isLastPart && payload.mangaId && !payload.skipQueue && !payload.isTest;
    if (shouldAddToQueue) {
      try {
        const uploaderName = payload.uploadername || 'Apt';
        const uploadStatus = payload.uploadstatus || 'เสร็จแล้ว';
        const rawWorkLink = payload.worklink || ('[อัป Raw] ' + folderUrl);
        const workLink = rawWorkLink.startsWith('[อัป Raw]') ? rawWorkLink : ('[อัป Raw] ' + rawWorkLink);
        const cleanChapter = chapter.replace(/[^\d.]/g, '') || '0';

        // ตรวจสอบข้อมูลมังงะจาก getMangaList() หรือ mangaId
        const mangaList = getMangaList();
        const manga = mangaList.find(m => String(m.mangaid) === String(payload.mangaId));
        const isExtractNeeded = manga && (manga.needsextract === true || String(manga.needsextract).toLowerCase() === 'true');
        const defaultExtractStatus = isExtractNeeded ? (payload.extractstatus || 'รอเริ่ม') : 'skip';

        // ตรวจสอบว่ามีคิวงานของ mangaId และ chapter นี้อยู่แล้วหรือไม่
        const existingQueue = getWorkQueue(true);
        const existingItem = existingQueue.find(q => 
          String(q.mangaid) === String(payload.mangaId) && 
          String(q.chapter).trim() === cleanChapter
        );

        if (existingItem && existingItem.queueid) {
          let currentLink = existingItem.worklink || '';
          let links = currentLink.toString().split('\n').filter(l => l.trim());
          links = links.filter(l => !l.startsWith('[อัป Raw]'));
          links.push(workLink);
          const finalWorkLink = links.join('\n');

          const updateObj = {
            uploadstatus: uploadStatus,
            uploadername: uploaderName,
            worklink: finalWorkLink,
            note: payload.note || ('KuaiKan VIP Concat รวมเป็น ' + totalParts + ' หน้า ลง แปลจนเมื่อย')
          };

          // หากมังงะนั้นไม่ได้ติ๊ก needsextract และสถานะดึงคำเดิมยังเป็น 'รอเริ่ม' หรือยังไม่ได้ทำ/ว่าง ให้เซ็ตเป็น 'skip' ด้วย
          if (!isExtractNeeded) {
            const curExStatus = existingItem.extractstatus ? String(existingItem.extractstatus).trim() : '';
            if (!curExStatus || curExStatus === 'รอเริ่ม') {
              updateObj.extractstatus = 'skip';
            }
          }

          queueRes = updateFullQueueItem(existingItem.queueid, updateObj);
        } else {
          queueRes = addQueue({
            mangaid: payload.mangaId,
            chapter: cleanChapter,
            uploadstatus: uploadStatus,
            uploadername: uploaderName,
            worklink: workLink,
            note: payload.note || ('KuaiKan VIP Concat รวมเป็น ' + totalParts + ' หน้า ลง แปลจนเมื่อย'),
            extractstatus: defaultExtractStatus
          });
        }
      } catch (qe) {
        console.warn('Auto add/update WorkQueue error in uploadChapterStitchedPart:', qe);
      }
    }

    return {
      success: true,
      partIndex: partIndex,
      totalParts: totalParts,
      fileName: fileName,
      fileUrl: fileUrl,
      folderUrl: folderUrl,
      folderName: targetFolder.getName(),
      queueAdded: Boolean(queueRes)
    };
  } catch (err) {
    console.error('uploadChapterStitchedPart error:', err);
    return { error: err.toString() };
  }
}

/**
 * ดาวน์โหลดตอนจาก KuaiKan ลง Google Drive และเพิ่มเข้าคิวงาน
 * โครงสร้าง: แปลจนเมื่อย (1hA_5XjT1gLnzrAOFpT-COVfIbuSfVG6_) / {ชื่อเรื่อง} / {เลขตอน} / {001.webp...}
 */
function downloadKuaikanChapterToDrive(payload) {
  try {
    const comicId = (payload && payload.comicId) || 855368;
    const mangaId = (payload && payload.mangaId) || '';
    const chapter = (payload && payload.chapter) || '第366话';
    const mangaName = (payload && payload.mangaName) || '我！天命大反派';

    const session = getKuaikanSessionData();
    let cookieHeader = session ? session.cookie : '';
    if (cookieHeader && cookieHeader.indexOf('=') === -1) {
      cookieHeader = 'connect.sid=' + cookieHeader.trim();
    }

    const testRes = testKuaikanLatestChapter(comicId, cookieHeader);
    
    // Priority 1: Check if session has stored allImages from client sync
    let rawImages = [];
    if (session && session.test && session.test.allImages && session.test.allImages.length > 1) {
      rawImages = session.test.allImages;
    }

    // 1. Google Drive Folder: แปลจนเมื่อย / {mangaName} / {chapter}
    const cleanChapter = chapter.startsWith('第') ? chapter : ('第' + chapter + '话');
    const targetFolder = getOrCreateChapterFolder(mangaName, cleanChapter);
    const folderUrl = targetFolder.getUrl();

    // 2. Fetch all raw image URLs if not already available
    if (!rawImages.length) {
      const url = 'https://api.kkmh.com/v2/comic/' + comicId + '?is_preview=0';
      const res = UrlFetchApp.fetch(url, {
        method: 'get',
        muteHttpExceptions: true,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.kuaikanmanhua.com/',
          'Cookie': cookieHeader
        }
      });

      try {
        const data = JSON.parse(res.getContentText());
        if (data && data.data) {
          rawImages = data.data.comic_images || data.data.images || [];
        }
      } catch (e) {}
    }

    if (!rawImages.length && testRes && testRes.sampleImages) {
      rawImages = testRes.sampleImages;
    }

    if (!rawImages.length) {
      return { error: 'ไม่พบภาพต้นฉบับ หรือตอนยังถูกล็อคอยู่ (VIP ยังไม่ active)' };
    }

    const downloadLimit = rawImages.length;
    let downloadedCount = 0;

    for (let i = 0; i < downloadLimit; i++) {
      const imgItem = rawImages[i];
      let rawFallback = typeof imgItem === 'object' ? (imgItem.rawUrl || imgItem.url1280 || imgItem.url) : imgItem;
      let imgUrl = typeof imgItem === 'string' ? imgItem : (imgItem.url1280 || imgItem.url || imgItem.rawUrl);
      if (!imgUrl) continue;
      imgUrl = normalizeKuaikanImageUrl(imgUrl);

      const candidateUrls = [imgUrl];
      if (rawFallback && rawFallback !== imgUrl && candidateUrls.indexOf(rawFallback) === -1) {
        candidateUrls.push(rawFallback);
      }

      let downloaded = false;
      for (let cIdx = 0; cIdx < candidateUrls.length && !downloaded; cIdx++) {
        const currentUrl = candidateUrls[cIdx];
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const imgRes = UrlFetchApp.fetch(currentUrl, {
              headers: { 'Referer': 'https://www.kuaikanmanhua.com/' },
              muteHttpExceptions: true
            });
            if (imgRes.getResponseCode() === 200) {
              const blob = imgRes.getBlob();
              const ext = currentUrl.indexOf('.webp') !== -1 ? '.webp' : (currentUrl.indexOf('.png') !== -1 ? '.png' : '.jpg');
              const filename = String(i + 1).padStart(3, '0') + ext;
              blob.setName(filename);
              targetFolder.createFile(blob);
              downloadedCount++;
              downloaded = true;
              break;
            }
          } catch (err) {
            if (attempt === 2 && cIdx === candidateUrls.length - 1) {
              console.error('Image download error at ' + i + ':', err);
            }
            Utilities.sleep(400);
          }
        }
      }
    }

    // 3. Auto add to Queue (ข้ามหากเป็นการทดสอบ หรือกำหนด skipQueue: true)
    let queueRes = null;
    if (mangaId && !payload.skipQueue && !payload.isTest) {
      try {
        const uploaderName = (payload && payload.uploadername) || 'Apt';
        const uploadStatus = (payload && payload.uploadstatus) || 'เสร็จแล้ว';
        const rawWorkLink = (payload && payload.worklink) || ('[อัป Raw] ' + folderUrl);
        const workLink = rawWorkLink.startsWith('[อัป Raw]') ? rawWorkLink : ('[อัป Raw] ' + rawWorkLink);
        const cleanChapter = chapter.replace(/[^\d.]/g, '') || '366';

        // ตรวจสอบข้อมูลมังงะจาก getMangaList() หรือ mangaId
        const mangaList = getMangaList();
        const manga = mangaList.find(m => String(m.mangaid) === String(mangaId));
        const isExtractNeeded = manga && (manga.needsextract === true || String(manga.needsextract).toLowerCase() === 'true');
        const defaultExtractStatus = isExtractNeeded ? ((payload && payload.extractstatus) || 'รอเริ่ม') : 'skip';

        // ตรวจสอบว่ามีคิวงานของ mangaId และ chapter นี้อยู่แล้วหรือไม่
        const existingQueue = getWorkQueue(true);
        const existingItem = existingQueue.find(q => 
          String(q.mangaid) === String(mangaId) && 
          String(q.chapter).trim() === cleanChapter
        );

        if (existingItem && existingItem.queueid) {
          let currentLink = existingItem.worklink || '';
          let links = currentLink.toString().split('\n').filter(l => l.trim());
          links = links.filter(l => !l.startsWith('[อัป Raw]'));
          links.push(workLink);
          const finalWorkLink = links.join('\n');

          const updateObj = {
            uploadstatus: uploadStatus,
            uploadername: uploaderName,
            worklink: finalWorkLink,
            note: (payload && payload.note) || ('Auto KuaiKan VIP DL (ตอน: ' + (testRes ? testRes.title : chapter) + ') ลง แปลจนเมื่อย')
          };

          if (!isExtractNeeded) {
            const curExStatus = existingItem.extractstatus ? String(existingItem.extractstatus).trim() : '';
            if (!curExStatus || curExStatus === 'รอเริ่ม') {
              updateObj.extractstatus = 'skip';
            }
          }

          queueRes = updateFullQueueItem(existingItem.queueid, updateObj);
        } else {
          queueRes = addQueue({
            mangaid: mangaId,
            chapter: cleanChapter,
            uploadstatus: uploadStatus,
            uploadername: uploaderName,
            worklink: workLink,
            note: (payload && payload.note) || ('Auto KuaiKan VIP DL (ตอน: ' + (testRes ? testRes.title : chapter) + ') ลง แปลจนเมื่อย'),
            extractstatus: defaultExtractStatus
          });
        }
      } catch (qe) {
        console.warn('Auto add/update Queue error in downloadKuaikanChapterToDrive:', qe);
      }
    }

    return {
      success: true,
      comicId: comicId,
      title: testRes ? testRes.title : chapter,
      totalImages: rawImages.length,
      downloadedCount: downloadedCount,
      folderUrl: folderUrl,
      folderName: targetFolder.getName(),
      queueAdded: Boolean(queueRes)
    };
  } catch (err) {
    console.error('downloadKuaikanChapterToDrive error:', err);
    return { error: err.toString() };
  }
}

// ==============================================================================
// THUNDERSCANS EN (en-thunderscans.com) CONNECTOR & SCRAPER
// ==============================================================================

const THUNDERSCANS_PROP_KEY = 'THUNDERSCANS_SESSION';

function getThunderscansSession() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(THUNDERSCANS_PROP_KEY);
    if (!raw) {
      return {
        loggedIn: false,
        cookie: '',
        message: 'ยังไม่มี Cookie Session ของ ThunderScans'
      };
    }
    const session = JSON.parse(raw);
    const cookie = session.cookie || '';
    if (!cookie) {
      return {
        loggedIn: false,
        cookie: '',
        message: 'ยังไม่มี Cookie Session ของ ThunderScans'
      };
    }
    return {
      loggedIn: true,
      cookie: cookie,
      updatedAt: session.updatedAt || '',
      isGoogleLoggedIn: Boolean(session.isGoogleLoggedIn || cookie.indexOf('wordpress_logged_in') !== -1),
      cookiePreview: cookie.length > 30 ? cookie.substring(0, 30) + '...' : cookie,
      lastChapterUrl: session.lastChapterUrl || '',
      message: 'Cookie บัญชี en-thunderscans.com พร้อมใช้งาน'
    };
  } catch (e) {
    console.error('getThunderscansSession error:', e);
    return { loggedIn: false, error: e.toString() };
  }
}

function saveThunderscansSession(cookie) {
  try {
    let cookieStr = '';
    let chapterUrl = '';
    let images = [];
    let title = '';

    if (typeof cookie === 'string') {
      cookieStr = cookie;
    } else if (cookie && typeof cookie === 'object') {
      cookieStr = cookie.cookie || cookie.directCookie || '';
      chapterUrl = cookie.chapterUrl || '';
      images = cookie.images || [];
      title = cookie.title || '';
    }

    cookieStr = (cookieStr || '').trim();
    if (!cookieStr && (!images || images.length === 0)) {
      return { error: 'ไม่มี Cookie หรือข้อมูลสำหรับบันทึก' };
    }

    const sessionData = {
      cookie: cookieStr,
      isGoogleLoggedIn: Boolean(cookieStr.indexOf('wordpress_logged_in') !== -1),
      updatedAt: new Date().toISOString(),
      lastChapterUrl: chapterUrl
    };

    if (images && images.length > 0) {
      sessionData.cachedImages = images;
      sessionData.cachedTitle = title;
    }

    PropertiesService.getScriptProperties().setProperty(THUNDERSCANS_PROP_KEY, JSON.stringify(sessionData));

    return {
      success: true,
      message: 'บันทึก Cookie Session ของ ThunderScans เรียบร้อยแล้ว',
      cookiePreview: cookieStr.length > 30 ? cookieStr.substring(0, 30) + '...' : cookieStr,
      updatedAt: sessionData.updatedAt,
      isGoogleLoggedIn: sessionData.isGoogleLoggedIn,
      imagesCount: images ? images.length : 0
    };
  } catch (err) {
    console.error('saveThunderscansSession error:', err);
    return { error: err.toString() };
  }
}

function clearThunderscansSession() {
  PropertiesService.getScriptProperties().deleteProperty(THUNDERSCANS_PROP_KEY);
  return { success: true, message: 'ลบ Cookie Session ของ ThunderScans เรียบร้อยแล้ว' };
}

// Aliases for compatibility
function getThunderScansSessionData() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(THUNDERSCANS_PROP_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error('getThunderScansSessionData error:', e);
    return null;
  }
}

function getThunderScansAuthStatus() {
  return getThunderscansSession();
}

function saveThunderScansAuth(payload) {
  return saveThunderscansSession(payload);
}

function clearThunderScansAuth() {
  return clearThunderscansSession();
}

function testThunderScansChapter(chapterUrl, overrideCookie) {
  return testThunderscansChapter(chapterUrl, overrideCookie);
}

function testThunderscansChapter(chapterUrl, overrideCookie) {
  try {
    const targetUrl = (chapterUrl || '').trim() ||
      'https://en-thunderscans.com/the-clans-failure-is-a-former-continental-champion-chapter-62/';

    let cookie = overrideCookie;
    if (!cookie) {
      const session = getThunderscansSession();
      if (session && session.cookie) {
        cookie = session.cookie;
      }
    }

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Referer': 'https://en-thunderscans.com/'
    };
    if (cookie) {
      headers['Cookie'] = cookie;
    }

    let html = '';
    try {
      const resp = UrlFetchApp.fetch(targetUrl, {
        method: 'get',
        muteHttpExceptions: true,
        headers: headers
      });
      html = resp.getContentText();
    } catch (fetchErr) {
      console.warn('testThunderscansChapter UrlFetchApp error:', fetchErr);
      return {
        status: 'error',
        error: 'Fetch failed: ' + fetchErr.toString()
      };
    }

    // Extract title from <title> or h1.entry-title or h1
    let title = '';
    const h1Match = html.match(/<h1[^>]*class=["'][^"']*(?:entry-title|lock-title)[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i) ||
                    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1Match) {
      title = h1Match[1].replace(/<[^>]+>/g, '').trim();
    }
    if (!title) {
      const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
      if (titleMatch) {
        title = titleMatch[1].trim();
        title = title.replace(/\s*[-–]\s*Thunderscans.*$/i, '').trim();
      }
    }
    if (title) {
      title = title.replace(/&#8211;/g, '-').replace(/&#8217;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    }

    // Extract post_id
    let postId = null;
    const postIdMatch = html.match(/class=["'][^"']*post-(\d+)[^"']*["']/i) ||
                        html.match(/data-id=["'](\d+)["']/i) ||
                        html.match(/["']?post_id["']?\s*:\s*(\d+)/i);
    if (postIdMatch) {
      postId = parseInt(postIdMatch[1], 10);
    }

    // Check lock indicators (e.g. "This chapter is locked" or countdown timer or buy button)
    const hasLockIndicator = /chapter\s+is\s+locked|lock-status|buy\s+chapter|countdown|coin-amount/i.test(html);

    // Extract ts_reader.run({...}) JSON payload
    let tsReader = null;
    const tsMatch = html.match(/ts_reader\.run\s*\(\s*(\{[\s\S]*?\})\s*\)\s*;/);
    if (tsMatch) {
      try {
        tsReader = JSON.parse(tsMatch[1]);
      } catch (e) {
        console.warn('Failed to parse ts_reader JSON:', e);
      }
    }

    if (tsReader && tsReader.post_id) {
      postId = tsReader.post_id;
    }

    const prevUrl = tsReader ? (tsReader.prevUrl || null) : null;
    const nextUrl = tsReader ? (tsReader.nextUrl || null) : null;

    let images = [];
    if (tsReader && Array.isArray(tsReader.sources) && tsReader.sources.length > 0) {
      images = (tsReader.sources[0] && Array.isArray(tsReader.sources[0].images)) ? tsReader.sources[0].images : [];
    }

    // Fallback: Check if images were cached in session
    if (images.length === 0) {
      const sessionData = getThunderScansSessionData();
      if (sessionData && sessionData.cachedImages && sessionData.cachedImages.length > 0) {
        images = sessionData.cachedImages;
        if (sessionData.cachedTitle) title = sessionData.cachedTitle;
      }
    }

    const isLocked = Boolean(hasLockIndicator || !tsReader || images.length === 0);

    if (isLocked) {
      return {
        status: 'success',
        isLocked: true,
        message: 'Chapter is coin-locked. Cookie with purchased chapter or valid login required.',
        data: {
          title: title,
          totalImages: 0,
          images: [],
          allImages: [],
          imagesCount: 0,
          isLocked: true,
          message: 'Chapter is coin-locked. Cookie with purchased chapter or valid login required.',
          post_id: postId,
          nextUrl: nextUrl,
          prevUrl: prevUrl,
          chapterUrl: targetUrl,
          success: true
        }
      };
    }

    // Pre-fetch sample images as base64 Data URLs for safe preview (bypassing CDN CORS and hotlink blocks)
    const rawSampleUrls = images.slice(0, 6);
    let sampleDataUrls = [];
    if (rawSampleUrls.length > 0) {
      try {
        const sampleRequests = rawSampleUrls.map(function(u) {
          return {
            url: u,
            method: 'get',
            muteHttpExceptions: true,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Referer': 'https://en-thunderscans.com/'
            }
          };
        });
        const sampleResponses = UrlFetchApp.fetchAll(sampleRequests);
        sampleDataUrls = sampleResponses.map(function(resp, idx) {
          if (resp.getResponseCode() === 200) {
            const blob = resp.getBlob();
            let mime = blob.getContentType() || (rawSampleUrls[idx].indexOf('.webp') !== -1 ? 'image/webp' : 'image/jpeg');
            return 'data:' + mime + ';base64,' + Utilities.base64Encode(blob.getBytes());
          }
          return rawSampleUrls[idx];
        });
      } catch (sampleErr) {
        console.warn('Error pre-fetching sample dataUrls:', sampleErr);
        sampleDataUrls = rawSampleUrls;
      }
    }

    return {
      status: 'success',
      isLocked: false,
      data: {
        title: title,
        totalImages: images.length,
        imagesCount: images.length,
        images: images,
        allImages: images,
        sampleImages: sampleDataUrls.length > 0 ? sampleDataUrls : rawSampleUrls,
        sampleDataUrls: sampleDataUrls,
        rawSampleImages: rawSampleUrls,
        isLocked: false,
        post_id: postId,
        nextUrl: nextUrl,
        prevUrl: prevUrl,
        chapterUrl: targetUrl,
        success: true
      }
    };
  } catch (err) {
    console.error('testThunderscansChapter error:', err);
    return { error: err.toString() };
  }
}

function proxyThunderScansImage(payload) {
  try {
    let imageUrl = '';
    let imageUrls = null;

    if (typeof payload === 'string') {
      imageUrl = payload.trim();
    } else if (payload && typeof payload === 'object') {
      if (Array.isArray(payload.imageUrls)) {
        imageUrls = payload.imageUrls;
      } else {
        imageUrl = (payload.imageUrl || payload.url || '').trim();
      }
    }

    // Batch mode with UrlFetchApp.fetchAll
    if (imageUrls && Array.isArray(imageUrls) && imageUrls.length > 0) {
      const requests = imageUrls.map(function(u) {
        return {
          url: u,
          method: 'get',
          muteHttpExceptions: true,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': 'https://en-thunderscans.com/'
          }
        };
      });

      const responses = UrlFetchApp.fetchAll(requests);
      const items = responses.map(function(resp, idx) {
        const u = imageUrls[idx];
        if (resp.getResponseCode() === 200) {
          const blob = resp.getBlob();
          let mime = blob.getContentType() || (u.indexOf('.webp') !== -1 ? 'image/webp' : 'image/jpeg');
          return {
            imageUrl: u,
            dataUrl: 'data:' + mime + ';base64,' + Utilities.base64Encode(blob.getBytes()),
            success: true
          };
        }
        return {
          imageUrl: u,
          error: 'HTTP ' + resp.getResponseCode(),
          success: false
        };
      });

      return {
        success: true,
        items: items
      };
    }

    // Single mode
    if (!imageUrl) {
      return { error: 'No imageUrl provided' };
    }

    if (imageUrl.startsWith('data:')) {
      return {
        success: true,
        dataUrl: imageUrl
      };
    }

    const resp = UrlFetchApp.fetch(imageUrl, {
      method: 'get',
      muteHttpExceptions: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://en-thunderscans.com/'
      }
    });

    if (resp.getResponseCode() !== 200) {
      return { error: 'Failed to fetch image: HTTP ' + resp.getResponseCode() };
    }

    const blob = resp.getBlob();
    let contentType = blob.getContentType() || (imageUrl.indexOf('.webp') !== -1 ? 'image/webp' : 'image/jpeg');
    const base64 = Utilities.base64Encode(blob.getBytes());
    const dataUrl = 'data:' + contentType + ';base64,' + base64;

    return {
      success: true,
      dataUrl: dataUrl,
      contentType: contentType,
      size: blob.getBytes().length
    };
  } catch (err) {
    console.error('proxyThunderScansImage error:', err);
    return { error: err.toString() };
  }
}


// ==========================================
// PAYOUT CLAIMS (ระบบตัดยอดขอเบิกเงินและอนุมัติการจ่าย)
// ==========================================

function getPayoutClaims() {
  try {
    const data = readSheetData(PAYOUT_CLAIMS_SHEET_NAME);
    return data.reverse();
  } catch (err) {
    console.error('getPayoutClaims error:', err);
    return [];
  }
}

function submitPayoutClaim(payload) {
  if (!payload || !payload.staffName) {
    return { error: 'กรุณาระบุชื่อพนักงานที่ขอเบิก' };
  }
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const sheet = getSheet(PAYOUT_CLAIMS_SHEET_NAME);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => h.toString().toLowerCase().trim());
    
    const id = 'CLM-' + new Date().getTime();
    const now = new Date();
    const queueIdsStr = typeof payload.queueItemIds === 'object' ? JSON.stringify(payload.queueItemIds) : String(payload.queueItemIds || '');

    const newRow = headers.map(header => {
      if (header === 'claimid') return id;
      if (header === 'createdat') return now;
      if (header === 'staffname') return payload.staffName || '';
      if (header === 'role') return payload.role || 'All';
      if (header === 'daterange') return payload.dateRange || '';
      if (header === 'startdate') return payload.startDate || '';
      if (header === 'enddate') return payload.endDate || '';
      if (header === 'totalchapters') return Number(payload.totalChapters) || 0;
      if (header === 'totalamount') return Number(payload.totalAmount) || 0;
      if (header === 'status') return 'Pending';
      if (header === 'approvedat') return '';
      if (header === 'paidat') return '';
      if (header === 'note') return payload.note || '';
      if (header === 'queueitemids') return queueIdsStr;
      return '';
    });

    sheet.appendRow(newRow);

    try {
      const msg = `💰 <b>มีคำขอเบิกเงินใหม่! (Payout Claim)</b>\n\n` +
                  `👤 ผู้ขอเบิก: <b>${payload.staffName}</b> (${payload.role || 'พนักงาน'})\n` +
                  `📅 ช่วงเวลา: ${payload.dateRange || '-'}\n` +
                  `📚 จำนวนตอน: <b>${payload.totalChapters}</b> ตอน\n` +
                  `💵 ยอดเงิน: <b>฿${Number(payload.totalAmount).toLocaleString()}</b> บาท\n` +
                  (payload.note ? `📝 โน้ต: ${payload.note}\n` : '') +
                  `\nกรุณาเข้าสู่ระบบ MangaHub เพื่อตรวจสอบและอนุมัติการจ่าย`;
      sendTelegramNotification(msg);
    } catch (e) {
      console.warn('Telegram payout notification error:', e);
    }

    return { success: true, claimId: id, claims: getPayoutClaims() };
  } catch (err) {
    console.error('submitPayoutClaim error:', err);
    return { error: err.toString() };
  } finally {
    lock.releaseLock();
  }
}

function updatePayoutClaimStatus(claimId, status, note) {
  if (!claimId || !status) return { error: 'ข้อมูลไม่ครบถ้วน' };
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const sheet = getSheet(PAYOUT_CLAIMS_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { error: 'ไม่พบข้อมูลใบขอเบิก' };
    
    const headers = data[0].map(h => h.toString().toLowerCase().trim());
    const idCol = headers.indexOf('claimid');
    const statusCol = headers.indexOf('status');
    const approvedAtCol = headers.indexOf('approvedat');
    const paidAtCol = headers.indexOf('paidat');
    const noteCol = headers.indexOf('note');

    if (idCol === -1 || statusCol === -1) return { error: 'ตารางไม่ถูกต้อง' };

    let foundRow = -1;
    let staffName = '';
    let totalAmount = 0;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idCol]).trim() === String(claimId).trim()) {
        foundRow = i + 1;
        staffName = data[i][headers.indexOf('staffname')] || '';
        totalAmount = data[i][headers.indexOf('totalamount')] || 0;
        break;
      }
    }

    if (foundRow === -1) return { error: 'ไม่พบใบขอเบิก Claim ID นี้' };

    const now = new Date();
    sheet.getRange(foundRow, statusCol + 1).setValue(status);
    
    if (status === 'Approved' && approvedAtCol !== -1) {
      sheet.getRange(foundRow, approvedAtCol + 1).setValue(now);
    } else if (status === 'Paid') {
      if (approvedAtCol !== -1 && !sheet.getRange(foundRow, approvedAtCol + 1).getValue()) {
        sheet.getRange(foundRow, approvedAtCol + 1).setValue(now);
      }
      if (paidAtCol !== -1) {
        sheet.getRange(foundRow, paidAtCol + 1).setValue(now);
      }
      try {
        syncPaidClaimsToBudget({ claimIds: [claimId] });
      } catch (errSync) {
        console.warn('Auto sync paid claim to budget error:', errSync);
      }
    }

    if (note && noteCol !== -1) {
      sheet.getRange(foundRow, noteCol + 1).setValue(note);
    }

    try {
      const statusEmoji = status === 'Paid' ? '✅ จ่ายเงินแล้ว (Paid)' : status === 'Approved' ? '👍 อนุมัติแล้ว (Approved)' : '❌ ปฏิเสธ (Rejected)';
      const msg = `📋 <b>อัปเดตสถานะใบขอเบิกเงิน!</b>\n\n` +
                  `🔖 Claim ID: <code>${claimId}</code>\n` +
                  `👤 ผู้รับเงิน: <b>${staffName}</b>\n` +
                  `💵 ยอดเงิน: <b>฿${Number(totalAmount).toLocaleString()}</b> บาท\n` +
                  `📊 สถานะใหม่: <b>${statusEmoji}</b>\n` +
                  (note ? `📝 หมายเหตุ: ${note}` : '');
      sendTelegramNotification(msg);
    } catch (e) {
      console.warn('Telegram status notification error:', e);
    }

    return { success: true, claims: getPayoutClaims() };
  } catch (err) {
    console.error('updatePayoutClaimStatus error:', err);
    return { error: err.toString() };
  } finally {
    lock.releaseLock();
  }
}

function updatePayoutClaim(claimId, updateData) {
  if (!claimId || !updateData) return { error: 'ข้อมูลไม่ครบถ้วน' };
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const sheet = getSheet(PAYOUT_CLAIMS_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { error: 'ไม่พบข้อมูลใบขอเบิก' };
    
    const headers = data[0].map(h => h.toString().toLowerCase().trim());
    const idCol = headers.indexOf('claimid');
    if (idCol === -1) return { error: 'ตารางไม่ถูกต้อง' };

    let foundRow = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idCol]).trim() === String(claimId).trim()) {
        foundRow = i + 1;
        break;
      }
    }

    if (foundRow === -1) return { error: 'ไม่พบใบขอเบิก Claim ID นี้' };

    const updateCell = (header, val) => {
      const col = headers.indexOf(header.toLowerCase()) + 1;
      if (col > 0 && val !== undefined) {
        sheet.getRange(foundRow, col).setValue(val);
      }
    };

    if (updateData.totalAmount !== undefined) updateCell('totalamount', Number(updateData.totalAmount) || 0);
    if (updateData.totalChapters !== undefined) updateCell('totalchapters', Number(updateData.totalChapters) || 0);
    if (updateData.note !== undefined) updateCell('note', String(updateData.note));
    if (updateData.status !== undefined) updateCell('status', String(updateData.status));
    if (updateData.dateRange !== undefined) updateCell('daterange', String(updateData.dateRange));
    if (updateData.startDate !== undefined) updateCell('startdate', String(updateData.startDate));
    if (updateData.endDate !== undefined) updateCell('enddate', String(updateData.endDate));

    return { success: true, claimId, claims: getPayoutClaims() };
  } catch (err) {
    console.error('updatePayoutClaim error:', err);
    return { error: err.toString() };
  } finally {
    lock.releaseLock();
  }
}


// =============================================================================
// READREALM 6-HOUR GROWTH TRACKER & PIPELINE AUTOMATION
// =============================================================================

function triggerGitHubReadRealmTrackerPipeline(triggerSource) {
  try {
    const token = getGitHubToken();
    if (!token) {
      console.warn('triggerGitHubReadRealmTrackerPipeline: GITHUB_TOKEN not available');
      return { success: false, error: 'GITHUB_TOKEN not available' };
    }

    const url = 'https://api.github.com/repos/' + GITHUB_REPO_OWNER + '/' + GITHUB_REPO_NAME + '/actions/workflows/' + READREALM_WORKFLOW_FILE + '/dispatches';
    const payload = {
      ref: 'main',
      inputs: {
        force_refresh: 'false'
      }
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'MangaHub-GAS-ReadRealmTracker'
      },
      muteHttpExceptions: true
    };

    const resp = UrlFetchApp.fetch(url, options);
    const code = resp.getResponseCode();
    const now = new Date().toISOString();

    const resultStatus = {
      lastTriggeredAt: now,
      triggerSource: (typeof triggerSource === 'string' && triggerSource) ? triggerSource : 'gas_6h_time_trigger',
      statusCode: code,
      success: code === 204 || code === 200,
      response: resp.getContentText()
    };

    try {
      PropertiesService.getScriptProperties().setProperty('READREALM_LAST_PIPELINE_TRIGGER', JSON.stringify(resultStatus));
    } catch (e) {}

    console.log('triggerGitHubReadRealmTrackerPipeline status:', code, resultStatus);
    return resultStatus;
  } catch (err) {
    console.error('triggerGitHubReadRealmTrackerPipeline error:', err);
    return { success: false, error: err.toString() };
  }
}

function createReadRealm6HourTrigger() {
  deleteReadRealm6HourTrigger();
  const trigger = ScriptApp.newTrigger('triggerGitHubReadRealmTrackerPipeline')
    .timeBased()
    .everyHours(6)
    .create();
  return '✓ สร้าง Trigger สั่งรัน ReadRealm Tracker บน GitHub Actions ทุกๆ 6 ชั่วโมงเรียบร้อยแล้ว (TriggerID: ' + trigger.getUniqueId() + ')';
}

function deleteReadRealm6HourTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let deleted = 0;
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'triggerGitHubReadRealmTrackerPipeline') {
      ScriptApp.deleteTrigger(t);
      deleted++;
    }
  });
  return '✓ ลบ Trigger เก่าเรียบร้อยแล้ว (' + deleted + ' รายการ)';
}

function getReadRealmTrackerStatus() {
  let lastTrigger = null;
  let is6HourTriggerActive = false;
  let summary = null;

  try {
    const rawTrigger = PropertiesService.getScriptProperties().getProperty('READREALM_LAST_PIPELINE_TRIGGER');
    if (rawTrigger) lastTrigger = JSON.parse(rawTrigger);
  } catch (e) {}

  try {
    const triggers = ScriptApp.getProjectTriggers();
    is6HourTriggerActive = triggers.some(t => t.getHandlerFunction() === 'triggerGitHubReadRealmTrackerPipeline');
  } catch (e) {}

  try {
    const sStr = PropertiesService.getScriptProperties().getProperty('READREALM_GROWTH_LATEST_SUMMARY');
    if (sStr) summary = JSON.parse(sStr);
  } catch (e) {}

  return {
    success: true,
    is6HourTriggerActive: is6HourTriggerActive,
    lastPipelineTrigger: lastTrigger,
    latestSummary: summary
  };
}

function saveReadRealmGrowthData(payload) {
  if (!payload) return { error: 'No payload provided' };
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const comics = payload.comics || [];
    const recordedAt = payload.pipeline_recorded_at || new Date().toISOString();
    const dateRef = payload.date_reference || recordedAt.substring(0, 10);

    const summary = {
      pipeline_recorded_at: recordedAt,
      date_reference: dateRef,
      total_comics: payload.total_comics || comics.length,
      total_sales_portfolio: payload.total_sales_portfolio || 0,
      total_views_portfolio: payload.total_views_portfolio || 0,
      lionking_sales: payload.lionking_sales || 0,
      lionking_views: payload.lionking_views || 0,
      adieu_sales: payload.adieu_sales || 0,
      adieu_views: payload.adieu_views || 0,
      top_sales_comic: payload.top_sales_comic || '',
      top_growth_comic_7d: payload.top_growth_comic_7d || '',
      top_growth_comic_30d: payload.top_growth_comic_30d || '',
      has_7d_baseline: payload.has_7d_baseline || false,
      has_30d_baseline: payload.has_30d_baseline || false,
      updated_at: new Date().toISOString()
    };
    PropertiesService.getScriptProperties().setProperty('READREALM_GROWTH_LATEST_SUMMARY', JSON.stringify(summary));

    // -------------------------------------------------------------
    // STRATEGY 1: Overwrite Current Snapshot (Max 237 rows - Zero Bloat)
    // -------------------------------------------------------------
    if (comics.length > 0) {
      const sheet = getSheet(READREALM_GROWTH_SHEET_NAME);
      sheet.clearContents();
      const headers = [
        'RecordedAt', 'Date', 'ComicID', 'Subject', 'Account',
        'TotalSales', 'TotalViews', 'ChaptersCount', 'LastChapterUpdate', 'DaysInactive',
        'SalesDelta7d', 'SalesGrowthPct7d', 'ViewsDelta7d', 'ViewsGrowthPct7d',
        'SalesDelta30d', 'SalesGrowthPct30d', 'ViewsDelta30d', 'ViewsGrowthPct30d'
      ];
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#3b82f6').setFontColor('#ffffff');

      const rows = comics.map(c => [
        recordedAt,
        dateRef,
        c.comic_id || '',
        c.subject || '',
        c.account || '',
        c.total_sales || 0,
        c.total_views || 0,
        c.chapters_count || 0,
        c.last_chapter_updated_at || '',
        c.days_inactive != null ? c.days_inactive : 0,
        (c.growth_7d && c.growth_7d.sales_delta) || 0,
        (c.growth_7d && c.growth_7d.sales_growth_pct) || 0,
        (c.growth_7d && c.growth_7d.views_delta) || 0,
        (c.growth_7d && c.growth_7d.views_growth_pct) || 0,
        (c.growth_30d && c.growth_30d.sales_delta) || 0,
        (c.growth_30d && c.growth_30d.sales_growth_pct) || 0,
        (c.growth_30d && c.growth_30d.views_delta) || 0,
        (c.growth_30d && c.growth_30d.views_growth_pct) || 0
      ]);

      if (rows.length > 0) {
        sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
      }
    }

    // -------------------------------------------------------------
    // STRATEGY 3: Append 1 Summary Row to Portfolio Timeline Sheet
    // (~1,460 rows/year - Lightweight & Perfect for Long-term Charts)
    // -------------------------------------------------------------
    let timeStr = '';
    try {
      const dObj = new Date(recordedAt);
      timeStr = Utilities.formatDate(dObj, 'Asia/Bangkok', 'HH:mm');
    } catch (e) {
      timeStr = '';
    }

    const timelineSheet = getSheet(READREALM_TIMELINE_SHEET_NAME);
    const lastRow = timelineSheet.getLastRow();

    const summaryRow = [
      recordedAt,
      dateRef,
      timeStr,
      payload.total_sales_portfolio || 0,
      payload.total_views_portfolio || 0,
      payload.total_comics || comics.length,
      payload.lionking_sales || 0,
      payload.lionking_views || 0,
      payload.adieu_sales || 0,
      payload.adieu_views || 0,
      payload.top_sales_comic || '',
      payload.top_growth_comic_7d || '',
      payload.top_growth_comic_30d || '',
      '6H Auto Snapshot'
    ];

    let shouldUpdateLast = false;
    if (lastRow > 1) {
      const lastRecorded = timelineSheet.getRange(lastRow, 1).getValue().toString();
      if (lastRecorded) {
        const diffMs = Math.abs(new Date(recordedAt).getTime() - new Date(lastRecorded).getTime());
        // If re-triggered within 45 minutes, update last row instead of adding duplicate
        if (diffMs < 45 * 60 * 1000) {
          shouldUpdateLast = true;
        }
      }
    }

    if (shouldUpdateLast) {
      timelineSheet.getRange(lastRow, 1, 1, summaryRow.length).setValues([summaryRow]);
    } else {
      timelineSheet.appendRow(summaryRow);
    }

    return {
      success: true,
      saved_count: comics.length,
      timeline_row: shouldUpdateLast ? lastRow : lastRow + 1,
      summary: summary
    };
  } catch (err) {
    return { error: 'Save ReadRealm Growth Data Failed: ' + err.toString() };
  } finally {
    lock.releaseLock();
  }
}

function getReadRealmGrowthData() {
  try {
    let summary = null;
    try {
      const sStr = PropertiesService.getScriptProperties().getProperty('READREALM_GROWTH_LATEST_SUMMARY');
      if (sStr) summary = JSON.parse(sStr);
    } catch (e) {}

    const sheet = getSheet(READREALM_GROWTH_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      return { success: true, summary: summary, comics: [], timeline: [] };
    }

    const headers = data[0].map(h => h.toString().toLowerCase().trim());
    const comics = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      comics.push({
        recorded_at: row[headers.indexOf('recordedat')],
        date: row[headers.indexOf('date')],
        comic_id: row[headers.indexOf('comicid')],
        subject: row[headers.indexOf('subject')],
        account: row[headers.indexOf('account')],
        total_sales: row[headers.indexOf('totalsales')],
        total_views: row[headers.indexOf('totalviews')],
        chapters_count: row[headers.indexOf('chapterscount')],
        last_chapter_updated_at: headers.indexOf('lastchapterupdate') !== -1 ? row[headers.indexOf('lastchapterupdate')] : '',
        days_inactive: headers.indexOf('daysinactive') !== -1 ? row[headers.indexOf('daysinactive')] : 0,
        is_inactive_30d: (headers.indexOf('daysinactive') !== -1 ? row[headers.indexOf('daysinactive')] : 0) > 30,
        growth_7d: {
          sales_delta: row[headers.indexOf('salesdelta7d')],
          sales_growth_pct: row[headers.indexOf('salesgrowthpct7d')],
          views_delta: row[headers.indexOf('viewsdelta7d')],
          views_growth_pct: row[headers.indexOf('viewsgrowthpct7d')]
        },
        growth_30d: {
          sales_delta: row[headers.indexOf('salesdelta30d')],
          sales_growth_pct: row[headers.indexOf('salesgrowthpct30d')],
          views_delta: row[headers.indexOf('viewsdelta30d')],
          views_growth_pct: row[headers.indexOf('viewsgrowthpct30d')]
        }
      });
    }

    // Read recent Portfolio Timeline Summary entries
    let timeline = [];
    try {
      const tSheet = getSheet(READREALM_TIMELINE_SHEET_NAME);
      const tData = tSheet.getDataRange().getValues();
      if (tData.length > 1) {
        const tHeaders = tData[0].map(h => h.toString().toLowerCase().trim());
        const startIdx = Math.max(1, tData.length - 60); // latest 60 records (~15 days)
        for (let i = startIdx; i < tData.length; i++) {
          const r = tData[i];
          timeline.push({
            recorded_at: r[tHeaders.indexOf('recordedat')],
            date: r[tHeaders.indexOf('date')],
            time: r[tHeaders.indexOf('time')],
            total_sales: r[tHeaders.indexOf('totalsalesportfolio')],
            total_views: r[tHeaders.indexOf('totalviewsportfolio')],
            total_comics: r[tHeaders.indexOf('totalcomics')],
            lionking_sales: r[tHeaders.indexOf('lionkingsales')],
            lionking_views: r[tHeaders.indexOf('lionkingviews')],
            adieu_sales: r[tHeaders.indexOf('adieusales')],
            adieu_views: r[tHeaders.indexOf('adieuviews')],
            top_sales_comic: r[tHeaders.indexOf('topsalescomic')],
            top_growth_7d: r[tHeaders.indexOf('topgrowthcomic7d')],
            top_growth_30d: r[tHeaders.indexOf('topgrowthcomic30d')]
          });
        }
      }
    } catch (e) {}

    return {
      success: true,
      summary: summary,
      total_comics: comics.length,
      comics: comics,
      timeline: timeline
    };
  } catch (err) {
    return { error: 'Get ReadRealm Growth Data Failed: ' + err.toString() };
  }
}


// =========================================================================
// KAIREW GROWTH TRACKER FUNCTIONS
// =========================================================================

function saveKairewGrowthData(payload) {
  if (!payload) return { error: 'No payload provided' };
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const comics = payload.comics || [];
    const recordedAt = payload.pipeline_recorded_at || new Date().toISOString();
    const dateRef = payload.date_reference || recordedAt.substring(0, 10);

    const summary = {
      pipeline_recorded_at: recordedAt,
      date_reference: dateRef,
      total_comics: payload.total_comics || comics.length,
      total_sales_portfolio: payload.total_sales_portfolio || 0,
      total_views_portfolio: payload.total_views_portfolio || 0,
      top_sales_comic: payload.top_sales_comic || '',
      total_inactive_30d: payload.total_inactive_30d || 0,
      total_active_30d: payload.total_active_30d || 0,
      has_7d_baseline: payload.has_7d_baseline || false,
      has_30d_baseline: payload.has_30d_baseline || false,
      updated_at: new Date().toISOString()
    };
    PropertiesService.getScriptProperties().setProperty('KAIREW_GROWTH_LATEST_SUMMARY', JSON.stringify(summary));

    // STRATEGY 1: Overwrite Current Snapshot (Max 80 rows - Zero Bloat)
    if (comics.length > 0) {
      const sheet = getSheet(KAIREW_GROWTH_SHEET_NAME);
      sheet.clearContents();
      const headers = [
        'RecordedAt', 'Date', 'ComicID', 'Subject', 'Account',
        'TotalSales', 'TotalViews', 'ChaptersCount', 'LastChapterUpdate', 'DaysInactive',
        'SalesDelta7d', 'SalesGrowthPct7d', 'ViewsDelta7d', 'ViewsGrowthPct7d',
        'SalesDelta30d', 'SalesGrowthPct30d', 'ViewsDelta30d', 'ViewsGrowthPct30d'
      ];
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#059669').setFontColor('#ffffff');

      const rows = comics.map(c => [
        recordedAt,
        dateRef,
        c.comic_id || '',
        c.subject || '',
        c.account || '',
        c.total_sales || 0,
        c.total_views || 0,
        c.chapters_count || 0,
        c.last_chapter_updated_at || '',
        c.days_inactive != null ? c.days_inactive : 0,
        (c.growth_7d && c.growth_7d.sales_delta) || 0,
        (c.growth_7d && c.growth_7d.sales_growth_pct) || 0,
        (c.growth_7d && c.growth_7d.views_delta) || 0,
        (c.growth_7d && c.growth_7d.views_growth_pct) || 0,
        (c.growth_30d && c.growth_30d.sales_delta) || 0,
        (c.growth_30d && c.growth_30d.sales_growth_pct) || 0,
        (c.growth_30d && c.growth_30d.views_delta) || 0,
        (c.growth_30d && c.growth_30d.views_growth_pct) || 0
      ]);

      if (rows.length > 0) {
        sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
      }
    }

    // STRATEGY 3: Append 1 Summary Row to Timeline Sheet
    let timeStr = '';
    try {
      const dObj = new Date(recordedAt);
      timeStr = Utilities.formatDate(dObj, 'Asia/Bangkok', 'HH:mm');
    } catch (e) {
      timeStr = '';
    }

    const timelineSheet = getSheet(KAIREW_TIMELINE_SHEET_NAME);
    const lastRow = timelineSheet.getLastRow();

    const summaryRow = [
      recordedAt,
      dateRef,
      timeStr,
      payload.total_sales_portfolio || 0,
      payload.total_views_portfolio || 0,
      payload.total_comics || comics.length,
      payload.top_sales_comic || '',
      payload.total_inactive_30d || 0,
      payload.total_active_30d || 0,
      '6H Auto Snapshot'
    ];

    let shouldUpdateLast = false;
    if (lastRow > 1) {
      const lastRecorded = timelineSheet.getRange(lastRow, 1).getValue().toString();
      if (lastRecorded) {
        const diffMs = Math.abs(new Date(recordedAt).getTime() - new Date(lastRecorded).getTime());
        if (diffMs < 45 * 60 * 1000) {
          shouldUpdateLast = true;
        }
      }
    }

    if (shouldUpdateLast) {
      timelineSheet.getRange(lastRow, 1, 1, summaryRow.length).setValues([summaryRow]);
    } else {
      timelineSheet.appendRow(summaryRow);
    }

    return {
      success: true,
      saved_count: comics.length,
      timeline_row: shouldUpdateLast ? lastRow : lastRow + 1,
      summary: summary
    };
  } catch (err) {
    return { error: 'Save Kairew Growth Data Failed: ' + err.toString() };
  } finally {
    lock.releaseLock();
  }
}

function getKairewGrowthData() {
  try {
    let summary = null;
    try {
      const sStr = PropertiesService.getScriptProperties().getProperty('KAIREW_GROWTH_LATEST_SUMMARY');
      if (sStr) summary = JSON.parse(sStr);
    } catch (e) {}

    const sheet = getSheet(KAIREW_GROWTH_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      return { success: true, summary: summary, comics: [], timeline: [] };
    }

    const headers = data[0].map(h => h.toString().toLowerCase().trim());
    const comics = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      comics.push({
        recorded_at: row[headers.indexOf('recordedat')],
        date: row[headers.indexOf('date')],
        comic_id: row[headers.indexOf('comicid')],
        subject: row[headers.indexOf('subject')],
        platform: 'kairew',
        account: row[headers.indexOf('account')],
        total_sales: row[headers.indexOf('totalsales')],
        total_views: row[headers.indexOf('totalviews')],
        chapters_count: row[headers.indexOf('chapterscount')],
        last_chapter_updated_at: headers.indexOf('lastchapterupdate') !== -1 ? row[headers.indexOf('lastchapterupdate')] : '',
        days_inactive: headers.indexOf('daysinactive') !== -1 ? row[headers.indexOf('daysinactive')] : 0,
        is_inactive_30d: (headers.indexOf('daysinactive') !== -1 ? row[headers.indexOf('daysinactive')] : 0) > 30,
        growth_7d: {
          sales_delta: row[headers.indexOf('salesdelta7d')],
          sales_growth_pct: row[headers.indexOf('salesgrowthpct7d')],
          views_delta: row[headers.indexOf('viewsdelta7d')],
          views_growth_pct: row[headers.indexOf('viewsgrowthpct7d')]
        },
        growth_30d: {
          sales_delta: row[headers.indexOf('salesdelta30d')],
          sales_growth_pct: row[headers.indexOf('salesgrowthpct30d')],
          views_delta: row[headers.indexOf('viewsdelta30d')],
          views_growth_pct: row[headers.indexOf('viewsgrowthpct30d')]
        }
      });
    }

    let timeline = [];
    try {
      const tSheet = getSheet(KAIREW_TIMELINE_SHEET_NAME);
      const tData = tSheet.getDataRange().getValues();
      if (tData.length > 1) {
        const tHeaders = tData[0].map(h => h.toString().toLowerCase().trim());
        const startIdx = Math.max(1, tData.length - 60);
        for (let i = startIdx; i < tData.length; i++) {
          const r = tData[i];
          timeline.push({
            recorded_at: r[tHeaders.indexOf('recordedat')],
            date: r[tHeaders.indexOf('date')],
            time: r[tHeaders.indexOf('time')],
            total_sales: r[tHeaders.indexOf('totalsalesportfolio')],
            total_views: r[tHeaders.indexOf('totalviewsportfolio')],
            total_comics: r[tHeaders.indexOf('totalcomics')],
            top_sales_comic: r[tHeaders.indexOf('topsalescomic')],
            total_inactive_30d: r[tHeaders.indexOf('inactivecount30d')],
            total_active_30d: r[tHeaders.indexOf('activecount30d')]
          });
        }
      }
    } catch (e) {}

    return {
      success: true,
      summary: summary,
      total_comics: comics.length,
      comics: comics,
      timeline: timeline
    };
  } catch (err) {
    return { error: 'Get Kairew Growth Data Failed: ' + err.toString() };
  }
}

// =========================================================================
// CHAPLY GROWTH TRACKER FUNCTIONS
// =========================================================================

function saveChaplyGrowthData(payload) {
  if (!payload) return { error: 'No payload provided' };
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const comics = payload.comics || [];
    const recordedAt = payload.pipeline_recorded_at || new Date().toISOString();
    const dateRef = payload.date_reference || recordedAt.substring(0, 10);

    const summary = {
      pipeline_recorded_at: recordedAt,
      date_reference: dateRef,
      total_comics: payload.total_comics || comics.length,
      total_sales_portfolio: payload.total_sales_portfolio || 0,
      total_views_portfolio: payload.total_views_portfolio || 0,
      top_sales_comic: payload.top_sales_comic || '',
      total_inactive_30d: payload.total_inactive_30d || 0,
      total_active_30d: payload.total_active_30d || 0,
      has_7d_baseline: payload.has_7d_baseline || false,
      has_30d_baseline: payload.has_30d_baseline || false,
      updated_at: new Date().toISOString()
    };
    PropertiesService.getScriptProperties().setProperty('CHAPLY_GROWTH_LATEST_SUMMARY', JSON.stringify(summary));

    // STRATEGY 1: Overwrite Current Snapshot (Max 68 rows - Zero Bloat)
    if (comics.length > 0) {
      const sheet = getSheet(CHAPLY_GROWTH_SHEET_NAME);
      sheet.clearContents();
      const headers = [
        'RecordedAt', 'Date', 'ComicID', 'Subject', 'Account',
        'TotalSales', 'TotalViews', 'ChaptersCount', 'LastChapterUpdate', 'DaysInactive',
        'SalesDelta7d', 'SalesGrowthPct7d', 'ViewsDelta7d', 'ViewsGrowthPct7d',
        'SalesDelta30d', 'SalesGrowthPct30d', 'ViewsDelta30d', 'ViewsGrowthPct30d'
      ];
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#ea580c').setFontColor('#ffffff');

      const rows = comics.map(c => [
        recordedAt,
        dateRef,
        c.comic_id || '',
        c.subject || '',
        c.account || '',
        c.total_sales || 0,
        c.total_views || 0,
        c.chapters_count || 0,
        c.last_chapter_updated_at || '',
        c.days_inactive != null ? c.days_inactive : 0,
        (c.growth_7d && c.growth_7d.sales_delta) || 0,
        (c.growth_7d && c.growth_7d.sales_growth_pct) || 0,
        (c.growth_7d && c.growth_7d.views_delta) || 0,
        (c.growth_7d && c.growth_7d.views_growth_pct) || 0,
        (c.growth_30d && c.growth_30d.sales_delta) || 0,
        (c.growth_30d && c.growth_30d.sales_growth_pct) || 0,
        (c.growth_30d && c.growth_30d.views_delta) || 0,
        (c.growth_30d && c.growth_30d.views_growth_pct) || 0
      ]);

      if (rows.length > 0) {
        sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
      }
    }

    // STRATEGY 3: Append 1 Summary Row to Timeline Sheet
    let timeStr = '';
    try {
      const dObj = new Date(recordedAt);
      timeStr = Utilities.formatDate(dObj, 'Asia/Bangkok', 'HH:mm');
    } catch (e) {
      timeStr = '';
    }

    const timelineSheet = getSheet(CHAPLY_TIMELINE_SHEET_NAME);
    const lastRow = timelineSheet.getLastRow();

    const summaryRow = [
      recordedAt,
      dateRef,
      timeStr,
      payload.total_sales_portfolio || 0,
      payload.total_views_portfolio || 0,
      payload.total_comics || comics.length,
      payload.top_sales_comic || '',
      payload.total_inactive_30d || 0,
      payload.total_active_30d || 0,
      '6H Auto Snapshot'
    ];

    let shouldUpdateLast = false;
    if (lastRow > 1) {
      const lastRecorded = timelineSheet.getRange(lastRow, 1).getValue().toString();
      if (lastRecorded) {
        const diffMs = Math.abs(new Date(recordedAt).getTime() - new Date(lastRecorded).getTime());
        if (diffMs < 45 * 60 * 1000) {
          shouldUpdateLast = true;
        }
      }
    }

    if (shouldUpdateLast) {
      timelineSheet.getRange(lastRow, 1, 1, summaryRow.length).setValues([summaryRow]);
    } else {
      timelineSheet.appendRow(summaryRow);
    }

    return {
      success: true,
      saved_count: comics.length,
      timeline_row: shouldUpdateLast ? lastRow : lastRow + 1,
      summary: summary
    };
  } catch (err) {
    return { error: 'Save Chaply Growth Data Failed: ' + err.toString() };
  } finally {
    lock.releaseLock();
  }
}

function getChaplyGrowthData() {
  try {
    let summary = null;
    try {
      const sStr = PropertiesService.getScriptProperties().getProperty('CHAPLY_GROWTH_LATEST_SUMMARY');
      if (sStr) summary = JSON.parse(sStr);
    } catch (e) {}

    const sheet = getSheet(CHAPLY_GROWTH_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      return { success: true, summary: summary, comics: [], timeline: [] };
    }

    const headers = data[0].map(h => h.toString().toLowerCase().trim());
    const comics = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      comics.push({
        recorded_at: row[headers.indexOf('recordedat')],
        date: row[headers.indexOf('date')],
        comic_id: row[headers.indexOf('comicid')],
        subject: row[headers.indexOf('subject')],
        platform: 'chaply',
        account: row[headers.indexOf('account')],
        total_sales: row[headers.indexOf('totalsales')],
        total_views: row[headers.indexOf('totalviews')],
        chapters_count: row[headers.indexOf('chapterscount')],
        last_chapter_updated_at: headers.indexOf('lastchapterupdate') !== -1 ? row[headers.indexOf('lastchapterupdate')] : '',
        days_inactive: headers.indexOf('daysinactive') !== -1 ? row[headers.indexOf('daysinactive')] : 0,
        is_inactive_30d: (headers.indexOf('daysinactive') !== -1 ? row[headers.indexOf('daysinactive')] : 0) > 30,
        growth_7d: {
          sales_delta: row[headers.indexOf('salesdelta7d')],
          sales_growth_pct: row[headers.indexOf('salesgrowthpct7d')],
          views_delta: row[headers.indexOf('viewsdelta7d')],
          views_growth_pct: row[headers.indexOf('viewsgrowthpct7d')]
        },
        growth_30d: {
          sales_delta: row[headers.indexOf('salesdelta30d')],
          sales_growth_pct: row[headers.indexOf('salesgrowthpct30d')],
          views_delta: row[headers.indexOf('viewsdelta30d')],
          views_growth_pct: row[headers.indexOf('viewsgrowthpct30d')]
        }
      });
    }

    let timeline = [];
    try {
      const tSheet = getSheet(CHAPLY_TIMELINE_SHEET_NAME);
      const tData = tSheet.getDataRange().getValues();
      if (tData.length > 1) {
        const tHeaders = tData[0].map(h => h.toString().toLowerCase().trim());
        const startIdx = Math.max(1, tData.length - 60);
        for (let i = startIdx; i < tData.length; i++) {
          const r = tData[i];
          timeline.push({
            recorded_at: r[tHeaders.indexOf('recordedat')],
            date: r[tHeaders.indexOf('date')],
            time: r[tHeaders.indexOf('time')],
            total_sales: r[tHeaders.indexOf('totalsalesportfolio')],
            total_views: r[tHeaders.indexOf('totalviewsportfolio')],
            total_comics: r[tHeaders.indexOf('totalcomics')],
            top_sales_comic: r[tHeaders.indexOf('topsalescomic')],
            total_inactive_30d: r[tHeaders.indexOf('inactivecount30d')],
            total_active_30d: r[tHeaders.indexOf('activecount30d')]
          });
        }
      }
    } catch (e) {}

    return {
      success: true,
      summary: summary,
      total_comics: comics.length,
      comics: comics,
      timeline: timeline
    };
  } catch (err) {
    return { error: 'Get Chaply Growth Data Failed: ' + err.toString() };
  }
}


// =============================================================================
// PROJECT IDEAS (MGEKO DISCOVERY) 6-HOUR AUTOMATION PIPELINE
// =============================================================================

function triggerGitHubProjectIdeasPipeline(triggerSource) {
  try {
    const token = getGitHubToken();
    if (!token) {
      console.warn('triggerGitHubProjectIdeasPipeline: GITHUB_TOKEN not available');
      return { success: false, error: 'GITHUB_TOKEN not available' };
    }

    const url = 'https://api.github.com/repos/' + GITHUB_REPO_OWNER + '/' + GITHUB_REPO_NAME + '/actions/workflows/' + PROJECT_IDEAS_WORKFLOW_FILE + '/dispatches';
    const payload = {
      ref: 'main',
      inputs: {
        pages: '5',
        max_chapters: '30'
      }
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'MangaHub-GAS-ProjectIdeasCrawler'
      },
      muteHttpExceptions: true
    };

    const resp = UrlFetchApp.fetch(url, options);
    const code = resp.getResponseCode();
    const now = new Date().toISOString();

    const resultStatus = {
      lastTriggeredAt: now,
      triggerSource: (typeof triggerSource === 'string' && triggerSource) ? triggerSource : 'gas_6h_time_trigger',
      statusCode: code,
      success: code === 204 || code === 200,
      response: resp.getContentText()
    };

    try {
      PropertiesService.getScriptProperties().setProperty('PROJECT_IDEAS_LAST_PIPELINE_TRIGGER', JSON.stringify(resultStatus));
    } catch (e) {}

    console.log('triggerGitHubProjectIdeasPipeline status:', code, resultStatus);
    return resultStatus;
  } catch (err) {
    console.error('triggerGitHubProjectIdeasPipeline error:', err);
    return { success: false, error: err.toString() };
  }
}

function createProjectIdeas6HourTrigger() {
  deleteProjectIdeasTrigger();
  const trigger = ScriptApp.newTrigger('triggerGitHubProjectIdeasPipeline')
    .timeBased()
    .everyHours(6)
    .create();
  return '✓ สร้าง Trigger สั่งรัน Project Ideas Crawler บน GitHub Actions ทุกๆ 6 ชั่วโมงเรียบร้อยแล้ว (TriggerID: ' + trigger.getUniqueId() + ')';
}

function deleteProjectIdeasTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let deleted = 0;
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'triggerGitHubProjectIdeasPipeline') {
      ScriptApp.deleteTrigger(t);
      deleted++;
    }
  });
  return '✓ ลบ Trigger เก่าเรียบร้อยแล้ว (' + deleted + ' รายการ)';
}

function getProjectIdeasTriggerStatus() {
  let lastTrigger = null;
  let is6HourTriggerActive = false;

  try {
    const rawTrigger = PropertiesService.getScriptProperties().getProperty('PROJECT_IDEAS_LAST_PIPELINE_TRIGGER');
    if (rawTrigger) lastTrigger = JSON.parse(rawTrigger);
  } catch (e) {}

  try {
    const triggers = ScriptApp.getProjectTriggers();
    is6HourTriggerActive = triggers.some(t => t.getHandlerFunction() === 'triggerGitHubProjectIdeasPipeline');
  } catch (e) {}

  return {
    success: true,
    is6HourTriggerActive: is6HourTriggerActive,
    lastPipelineTrigger: lastTrigger
  };
}
