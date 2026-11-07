/**
 * Google Apps Script Backend for Manga Management System
 * แบบปรับปรุง: บันทึกข้อมูลตามหัวตาราง (Dynamic Mapping)
 */

const SPREADSHEET_ID = '14rpvJNG7KsAn69jlaDYeCmBRyNzjVxEwaM6D0hvZHDU';
const SHEET_NAME = 'MangaList';
const QUEUE_SHEET_NAME = 'WorkQueue';
const TEAM_SHEET_NAME = 'TeamMembers';
const BUDGET_PAYEE_SHEET_NAME = 'BudgetPayees';
const BUDGET_TRANSACTION_SHEET_NAME = 'BudgetTransactions';
const MANGA_SALES_SHEET_NAME = 'MangaSales';
const WEBSITE_SHEET_NAME = 'Websites';
const ACCESS_PASSCODE = PropertiesService.getScriptProperties().getProperty('ACCESS_PASSCODE') || '';

// --- TELEGRAM CONFIGURATION ---
const TELEGRAM_BOT_TOKEN = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN') || ''; // Stored in ScriptProperties
const TELEGRAM_CHAT_ID = PropertiesService.getScriptProperties().getProperty('TELEGRAM_CHAT_ID') || '';     // Stored in ScriptProperties

// --- AUTO UPDATE CONFIGURATION ---
const AUTO_UPDATE_API_URL = 'https://nonstoptoon.pages.dev/api/autoupdate';
const AUTO_UPDATE_SECRET = PropertiesService.getScriptProperties().getProperty('AUTO_UPDATE_SECRET') || '';

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


// Cache Helper Functions
function getCachedData(key, fetchFunction, ttlSeconds = 300) {
  const cache = CacheService.getScriptCache();
  let data = cache.get(key);
  
  if (data) {
    try {
      return JSON.parse(data);
    } catch (e) {
      console.error('Cache parse error:', e);
      cache.remove(key);
    }
  }
  
  const result = fetchFunction();
  try {
    cache.put(key, JSON.stringify(result), ttlSeconds);
  } catch (e) {
    console.error('Cache put error:', e);
  }
  return result;
}

function invalidateCache(keys) {
  const cache = CacheService.getScriptCache();
  if (Array.isArray(keys)) {
    cache.removeAll(keys);
  } else {
    cache.remove(keys);
  }
}

function getSheet(name = SHEET_NAME) {
  let ss;
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  } catch (e) {
    ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  }
  
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (name === SHEET_NAME) {
      sheet.appendRow(['MangaID', 'MangaName', 'OriginalName', 'OriginalUrl', 'Status', 'LastChapter', 'LastUpdated', 'NeedsExtract', 'ReleaseDay']);
      sheet.getRange(1, 1, 1, 9).setFontWeight('bold').setBackground('#4f46e5').setFontColor('#ffffff');
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
      // Adding sample data
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
      // Default Values
      const defaults = [['ReadRealm แปลจนเมื่อย'], ['ReadRealm น้องแมวส้ม'], ['ReadRealm แปลแล้วแปลอีก'], ['ReadRealm แปลจนแขนหัก'], ['Other']];
      sheet.getRange(2, 1, defaults.length, 1).setValues(defaults);
    }
  }
  
  // Ensure headers exist (Migration support)
  if (name === SHEET_NAME) {
    const lastCol = sheet.getLastColumn();
    if (lastCol > 0) {
      const currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => h.toString().toLowerCase().trim());
      if (currentHeaders.indexOf('needsextract') === -1) {
        const newCol = lastCol + 1;
        sheet.getRange(1, newCol).setValue('NeedsExtract');
        if (sheet.getLastRow() > 1) {
          sheet.getRange(2, newCol, sheet.getLastRow() - 1, 1).setValue(true);
        }
      }
      // Migration for ReleaseDay
      const currentHeadersUpdated = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => h.toString().toLowerCase().trim());
      if (currentHeadersUpdated.indexOf('releaseday') === -1) {
        const newCol = sheet.getLastColumn() + 1;
        sheet.getRange(1, newCol).setValue('ReleaseDay');
        if (sheet.getLastRow() > 1) {
          sheet.getRange(2, newCol, sheet.getLastRow() - 1, 1).setValue('None'); // Default to None
        }
      }
      // Migration for CostPerChapter
      const currentHeadersFinal = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => h.toString().toLowerCase().trim());
      if (currentHeadersFinal.indexOf('costperchapter') === -1) {
        const newCol = sheet.getLastColumn() + 1;
        sheet.getRange(1, newCol).setValue('CostPerChapter');
        if (sheet.getLastRow() > 1) {
          sheet.getRange(2, newCol, sheet.getLastRow() - 1, 1).setValue(0);
        }
      }
      // Migration for LockedTranslator
      const currentHeadersLast = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => h.toString().toLowerCase().trim());
      if (currentHeadersLast.indexOf('lockedtranslator') === -1) {
        const newCol = sheet.getLastColumn() + 1;
        sheet.getRange(1, newCol).setValue('LockedTranslator');
      }
      // Migration for NotifyOnAdd
      const currentHeadersFinalWithNoti = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => h.toString().toLowerCase().trim());
      if (currentHeadersFinalWithNoti.indexOf('notifyonadd') === -1) {
        const newCol = sheet.getLastColumn() + 1;
        sheet.getRange(1, newCol).setValue('NotifyOnAdd');
        if (sheet.getLastRow() > 1) {
          sheet.getRange(2, newCol, sheet.getLastRow() - 1, 1).setValue(false);
        }
      }
      // Migration for Slug
      const currentHeadersWithSlug = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => h.toString().toLowerCase().trim());
      if (currentHeadersWithSlug.indexOf('slug') === -1) {
        const newCol = sheet.getLastColumn() + 1;
        sheet.getRange(1, newCol).setValue('Slug');
      }
      // Migration for IsUrgent (งานด่วน)
      const currentHeadersWithUrgent = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => h.toString().toLowerCase().trim());
      if (currentHeadersWithUrgent.indexOf('isurgent') === -1) {
        const newCol = sheet.getLastColumn() + 1;
        sheet.getRange(1, newCol).setValue('IsUrgent');
        if (sheet.getLastRow() > 1) {
          sheet.getRange(2, newCol, sheet.getLastRow() - 1, 1).setValue(false);
        }
      }
    }
  }

  if (name === QUEUE_SHEET_NAME) {
    const lastCol = sheet.getLastColumn();
    if (lastCol > 0) {
      const currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => h.toString().toLowerCase().trim());
      const required = ['poststatus', 'postername', 'posttime', 'isediting', 'editingby', 'editingtime'];
      const displayMap = {
        'poststatus': 'PostStatus',
        'postername': 'PosterName',
        'posttime': 'PostTime',
        'isediting': 'IsEditing',
        'editingby': 'EditingBy',
        'editingtime': 'EditingTime'
      };
      required.forEach(req => {
        if (currentHeaders.indexOf(req) === -1) {
          const newCol = sheet.getLastColumn() + 1;
          sheet.getRange(1, newCol).setValue(displayMap[req] || (req.charAt(0).toUpperCase() + req.slice(1)));
        }
      });
    }
  }
  
  return sheet;
}

function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('MangaHub - Management System')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * READ: ดึงข้อมูลและแปลงเป็น Object ตามหัวตาราง
 */
function getMangaList() {
  return getCachedData('mangaList', () => {
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
          // แปลง Date เป็น ISO String เพื่อความชัวร์ในการส่งผ่าน JSON
          if (val instanceof Date) {
            val = val.toISOString();
          }
          obj[header] = val;
        });
        return obj;
      }).filter(item => item.manganame); // กรองแถวว่างออก
    } catch (err) {
      console.error('getMangaList Error:', err);
      return [];
    }
  }, 600); // 10 minutes for production
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
  try {
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
  }
}

function addTeamMember(member) {
  try {
    const sheet = getSheet(TEAM_SHEET_NAME);
    const id = 'T' + new Date().getTime();
    sheet.appendRow([id, member.name, member.role, member.status || 'Active']);
    invalidateCache('teamList');
    return getTeamMembers();
  } catch (err) {
    return { error: 'Add Member Failed: ' + err.toString() };
  }
}

function deleteTeamMember(id) {
  try {
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
  }
}

function updateTeamMember(id, updatedMember) {
  try {
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
  }
}

/**
 * UPDATE: แก้ไขข้อมูล
 */
function updateManga(id, updatedManga) {
  try {
    const sheet = getSheet();
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => h.toString().toLowerCase().trim());
    
    for (let i = 1; i < data.length; i++) {
      // เปรียบเทียบทั้งแบบ String และ Number
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
        return getMangaList();
      }
    }
    return { error: 'ไม่พบข้อมูล ID: ' + id };
  } catch (err) {
    return { error: 'Update Failed: ' + err.toString() };
  }
}

/**
 * DELETE: ลบข้อมูล
 */
function deleteManga(id) {
  try {
    const sheet = getSheet();
    const data = sheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toString() === id.toString()) {
        sheet.deleteRow(i + 1);
        invalidateCache('mangaList');
        return getMangaList();
      }
    }
    return { error: 'ไม่พบข้อมูลในการลบ' };
  } catch (err) {
    return { error: 'Delete Failed: ' + err.toString() };
  }
}

/**
 * QUEUE OPERATIONS
 */
function getWorkQueue(forceRefresh = false) {
  if (forceRefresh) {
      invalidateCache('workQueue');
  }
  return getCachedData('workQueue', () => {
    try {
      const sheet = getSheet(QUEUE_SHEET_NAME);
      const data = sheet.getDataRange().getValues();
      if (data.length <= 1) return [];

      const headers = data.shift().map(h => h.toString().toLowerCase().trim());
      return data.map(row => {
        let obj = {};
        headers.forEach((header, i) => {
          let val = row[i];
          if (val instanceof Date) val = val.toISOString();
          obj[header] = val;
        });
        // Default empty step statuses to 'รอเริ่ม'
        if (!obj.poststatus || String(obj.poststatus).trim() === '') {
          obj.poststatus = 'รอเริ่ม';
        }
        if (!obj.uploadstatus || String(obj.uploadstatus).trim() === '') {
          obj.uploadstatus = 'รอเริ่ม';
        }
        if (!obj.translatestatus || String(obj.translatestatus).trim() === '') {
          obj.translatestatus = 'รอเริ่ม';
        }
        if (!obj.typesetstatus || String(obj.typesetstatus).trim() === '') {
          obj.typesetstatus = 'รอเริ่ม';
        }
        if (!obj.publishstatus || String(obj.publishstatus).trim() === '') {
          obj.publishstatus = 'รอเริ่ม';
        }
        return obj;
      });
    } catch (err) {
      return [];
    }
  }, 600); // 10 minutes for production
}



function addQueue(queueData) {
  try {
    const sheet = getSheet(QUEUE_SHEET_NAME);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => h.toString().toLowerCase().trim());
    
    const id = new Date().getTime(); 
    const now = new Date();
    
    const newRow = headers.map(header => {
      if (header === 'queueid') return id;
      if (header === 'createdat') return now;
      if (header === 'mangaid') return queueData.mangaid;
      if (header === 'chapter') return queueData.chapter;
      
      // Default statuses
      if (header === 'uploadstatus') return queueData.uploadstatus || 'รอเริ่ม';
      if (header === 'extractstatus') return queueData.extractstatus || 'รอเริ่ม';
      if (header === 'translatestatus') return queueData.translatestatus || 'รอเริ่ม';
      if (header === 'typesetstatus') return queueData.typesetstatus || 'รอเริ่ม';
      if (header === 'publishstatus') return queueData.publishstatus || 'รอเริ่ม';
      if (header === 'poststatus') return queueData.poststatus || 'รอเริ่ม';

      // Names
      if (header === 'uploadername') return queueData.uploadername || '';
      if (header === 'extractorname') return queueData.extractorname || '';
      if (header === 'translatorname') return queueData.translatorname || '';
      if (header === 'typesettername') return queueData.typesettername || '';
      if (header === 'publishername') return queueData.publishername || '';
      if (header === 'postername') return queueData.postername || '';

      // Auto-select Locked Translator if status is 'รอเริ่ม' and no translator provided
      if (header === 'translatorname' && !queueData.translatorname) {
        const mangaList = getMangaList();
        const manga = mangaList.find(m => m.mangaid.toString() === queueData.mangaid.toString());
        if (manga && manga.lockedtranslator) {
          return manga.lockedtranslator;
        }
      }

      // Links & Notes
      if (header === 'worklink') return queueData.worklink || '';
      if (header === 'note') return queueData.note || '';

      // Timestamps (Initially empty)
      return '';
    });

    sheet.appendRow(newRow);
    syncMangaStatus(queueData.mangaid, queueData.chapter);
    
    // Telegram Notification on Add (Manual)
    try {
      const mangaList = getMangaList();
      const manga = mangaList.find(m => m.mangaid.toString() === queueData.mangaid.toString());
      if (manga && (manga.notifyonadd === true || manga.notifyonadd === 'true')) {
        let message = `🆕 <b>เพิ่มคิวงานใหม่! (Manual)</b>\n\nเรื่อง: <b>${manga.manganame}</b>\nตอนที่: ${queueData.chapter}\nสถานะ: เริ่มต้นเข้าระบบแล้ว`;
        if (queueData.worklink) {
          message += `\n🔗 <b>ลิงก์งาน:</b> ${queueData.worklink}`;
        }
        sendTelegramNotification(message);
      }
    }
 catch (e) {
      console.error('Error in addQueue notification:', e);
    }

    invalidateCache(['workQueue', 'mangaList']);
    return { success: true, queue: getWorkQueue() };
  } catch (err) {
    return { error: 'Add Queue Failed: ' + err.toString() };
  }
}

/**
 * Update a specific step and record timestamp
 * @param {string} queueId 
 * @param {string} step 'upload', 'extract', 'translate', 'typeset', 'publish'
 * @param {string} status 'รอเริ่ม', 'กำลังทำ', 'เสร็จแล้ว'
 * @param {string} assignee ชื่อผู้รับผิดชอบ (optional)
 * @param {string} link ลิงก์งาน (optional)
 * @param {string} note หมายเหตุ (optional)
 */
function updateQueueStep(queueId, step, status, assignee, link, note) {
  try {
    const sheet = getSheet(QUEUE_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => h.toString().toLowerCase().trim());
    
    // Map step to correct assignee column header
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
        
        // Update status
        sheet.getRange(rowNum, statusCol).setValue(status);
        
        // If publish is marked as 'เสร็จแล้ว', ensure poststatus is initialized to 'รอเริ่ม' if empty
        if (step.toLowerCase() === 'publish' && status === 'เสร็จแล้ว') {
          const postStatusCol = headers.indexOf('poststatus') + 1;
          if (postStatusCol > 0) {
            const currentPostStatus = data[i][postStatusCol - 1];
            if (!currentPostStatus || currentPostStatus.toString().trim() === '') {
              sheet.getRange(rowNum, postStatusCol).setValue('รอเริ่ม');
            }
          }
        }
        
        // Update assignee (allow clearing)
        if (nameCol > 0 && assignee !== undefined) {
          sheet.getRange(rowNum, nameCol).setValue(assignee);
        }
        
        // Record timestamp if finished
        if (status === 'เสร็จแล้ว') {
          // Check if it was ALREADY finished to avoid notification spam
          const oldStatus = data[i][statusCol - 1];
          if (oldStatus !== 'เสร็จแล้ว') {
            console.log(`Step "${step}" updated to "เสร็จแล้ว" for QueueID: ${queueId}`);
            if (timeCol > 0) sheet.getRange(rowNum, timeCol).setValue(new Date());
            
            // Telegram Notification
            try {
              const mangaId = data[i][headers.indexOf('mangaid')];
              const chapter = data[i][headers.indexOf('chapter')];
              const mangaName = getMangaNameById(mangaId);
              const stepLabel = getStepLabel(step);
              
              let message = `✅ <b>งานเสร็จแล้ว!</b>\n\nเรื่อง: <b>${mangaName}</b>\nตอนที่: ${chapter}\nขั้นตอน: <b>${stepLabel}</b>\nโดย: ${assignee || 'ไม่ระบุ'}`;
              
              // Priority: 1. Current passed link, 2. Existing worklink from sheet (using flexible key-based extraction)
              const existingLinks = data[i][linkCol - 1] || '';
              const finalLink = link || extractLinkForStep(existingLinks, step); // Pass step key 'upload', 'extract', etc.
              
              if (finalLink) {
                message += `\n🔗 <b>ลิงก์งาน:</b> ${finalLink}`;
              }
              sendTelegramNotification(message);

              // --- AUTO UPDATE WEBSITE TRIGGER ---
              if (step.toLowerCase() === 'publish') {
                try {
                  const mangaList = getMangaList();
                  const manga = mangaList.find(m => m.mangaid.toString() === mangaId.toString());
                  if (manga && manga.slug) {
                    const range = parseChapterRange(chapter);
                    updateMangaEpisodeOnWebsite(manga.slug, range.end);
                  } else {
                    console.log(`Auto-update skipped for ${mangaName}: No slug configured.`);
                  }
                } catch (aue) {
                  console.error('Error triggering auto-update in updateQueueStep:', aue);
                }
              }
            } catch (te) {
              console.error('Telegram notification error in updateQueueStep:', te);
            }
          }
        }
        
        // Update link if provided
        if (link && linkCol > 0) {
          const currentLink = data[i][linkCol - 1] || '';
          const stepLabel = getStepLabel(step);
          
          // Parse existing links
          let links = currentLink.toString().split('\n').filter(l => l.trim());
          
          // Remove existing link for this step (if any)
          links = links.filter(l => !l.startsWith('[' + stepLabel + ']'));
          
          // Add new link
          if (link.trim()) {
            links.push('[' + stepLabel + '] ' + link.trim());
          }
          
          const newLink = links.join('\n');
          sheet.getRange(rowNum, linkCol).setValue(newLink);
        }
        
        // Update note if provided
        if (note && noteCol > 0) {
          const currentNote = data[i][noteCol - 1] || '';
          // Append new note with step prefix
          const stepLabel = getStepLabel(step);
          const newNote = currentNote ? currentNote + '\n[' + stepLabel + '] ' + note : '[' + stepLabel + '] ' + note;
          sheet.getRange(rowNum, noteCol).setValue(newNote);
        }
        
        invalidateCache('workQueue');
        return { success: true, queue: getWorkQueue() };
      }
    }
    return { error: 'Queue ID not found' };
  } catch (err) {
    return { error: 'Update Step Failed: ' + err.toString() };
  }
}

/**
 * Bulk update step status and optional assignee for multiple queue items
 * @param {Array<string|number>} queueIds - รายการ queueId ที่ต้องการอัปเดต
 * @param {string} step - ขั้นตอน เช่น 'upload', 'extract', 'translate', 'typeset', 'publish', 'post'
 * @param {string} status - สถานะ เช่น 'เสร็จแล้ว', 'กำลังทำ', 'รอเริ่ม', 'Skipped'
 * @param {string} [assignee] - ชื่อผู้รับผิดชอบ (ถ้าเป็น '__KEEP__' หรือ undefined/empty จะไม่เปลี่ยน)
 */
function bulkUpdateQueueStep(queueIds, step, status, assignee) {
  try {
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

        // Update status
        data[i][statusColIndex] = status;

        // If publish is updated to 'เสร็จแล้ว', ensure poststatus is initialized to 'รอเริ่ม' if empty
        if (stepLower === 'publish' && status === 'เสร็จแล้ว' && postStatusColIndex !== -1) {
          const currentPostVal = data[i][postStatusColIndex];
          if (!currentPostVal || currentPostVal.toString().trim() === '') {
            data[i][postStatusColIndex] = 'รอเริ่ม';
          }
        }

        // Update assignee if specified
        if (shouldUpdateAssignee && nameColIndex !== -1) {
          data[i][nameColIndex] = assignee;
        }

        // Check if status changed to 'เสร็จแล้ว'
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
      // Write back data in a single batch operation
      sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
      invalidateCache('workQueue');

      // Notifications and external triggers
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

          // Trigger auto-update website if publish or post
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
              }
            } catch (aue) {
              console.error('Error triggering auto-update in bulkUpdateQueueStep:', aue);
            }
          }
        } catch (te) {
          console.error('Telegram notification error in bulkUpdateQueueStep:', te);
        }
      }

      return { success: true, count: updatedCount, queue: getWorkQueue() };
    }

    return { error: 'ไม่พบรายการคิวงานที่ตรงกับที่เลือก' };
  } catch (err) {
    console.error('bulkUpdateQueueStep error:', err);
    return { error: 'Bulk Update Failed: ' + err.toString() };
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

/**
 * Set visual lock status for a queue item
 */


/**
 * Helper: Parse chapter string (e.g., "1", "1-10", "5.5-7")
 * @returns {object} { start, end, count }
 */
function parseChapterRange(chapterStr) {
  if (!chapterStr) return { start: 0, end: 0, count: 0 };
  const s = chapterStr.toString().trim();
  
  if (s.includes('-')) {
    const parts = s.split('-').map(p => parseFloat(p.trim()));
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      const start = Math.min(parts[0], parts[1]);
      const end = Math.max(parts[0], parts[1]);
      // Assuming standard increment of 1. If it's 1-10, count is 10.
      const count = end - start + 1;
      return { start, end, count: Math.max(0, count) };
    }
  }
  
  const val = parseFloat(s) || 0;
  return { start: val, end: val, count: 1 };
}

/**
 * Sync logic: Update last chapter and last updated in MangaList
 */
function syncMangaStatus(mangaId, chapter) {
  try {
    const sheet = getSheet(SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => h.toString().toLowerCase().trim());
    
    for (let i = 1; i < data.length; i++) {
        if (data[i][0].toString() === mangaId.toString()) {
            const rowNum = i + 1;
            const currentChapter = parseFloat(data[i][4]) || 0;
            
            const range = parseChapterRange(chapter);
            const newChapter = range.end;
            
            // Only update if the new chapter is greater or equal
            if (newChapter >= currentChapter) {
                headers.forEach((header, index) => {
                    const colNum = index + 1;
                    if (header === 'lastchapter') sheet.getRange(rowNum, colNum).setValue(newChapter);
                    if (header === 'lastupdated') sheet.getRange(rowNum, colNum).setValue(new Date());
                });
            }
            break;
        }
    }
  } catch (e) {
    console.error('Sync Error:', e);
  }
}

function deleteQueueItem(id) {
  try {
    const sheet = getSheet(QUEUE_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toString() === id.toString()) {
        sheet.deleteRow(i + 1);
        invalidateCache('workQueue');
        return { success: true, queue: getWorkQueue() };
      }
    }
    return { error: 'Not found' };
  } catch (err) {
    return { error: err.toString() };
  }
}

function extractLinkForStep(allLinks, stepKey) {
  if (!allLinks) return null;
  const lines = allLinks.toString().split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  // Step aliases for flexible matching (Case-Insensitive)
  const aliases = {
    'upload': ['อัป Raw', 'Raw', 'อัป RAW', 'Upload'],
    'extract': ['ดึงคำ', 'Extract', 'Extractor'],
    'translate': ['แปล', 'Translate', 'Translator'],
    'typeset': ['ลงคำ', 'Typeset', 'Typesetter'],
    'publish': ['Publisher', 'เผยแพร่', 'ลงเว็บ', 'Publish'],
    'post': ['โพสต์', 'Post']
  };

  const possibleLabels = (aliases[stepKey.toLowerCase()] || [stepKey]).map(l => l.toLowerCase());

  // 1. Try to find the step-specific link with brackets [Label]
  for (let l of lines) {
    const bracketEnd = l.indexOf(']');
    if (l.startsWith('[') && bracketEnd > 0) {
      const label = l.substring(1, bracketEnd).toLowerCase();
      if (possibleLabels.includes(label)) {
        return l.substring(bracketEnd + 1).trim();
      }
    }
  }

  // 2. Fallback: If no bracketed match, and the first line has no brackets at all, treat as default link
  if (!lines[0].startsWith('[')) {
    return lines[0];
  }

  return null;
}

/**
 * Update ALL fields of a queue item (Master Edit)
 */
function updateFullQueueItem(queueId, updateData) {
  try {
    const sheet = getSheet(QUEUE_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => h.toString().toLowerCase().trim());

    for (let i = 1; i < data.length; i++) {
        if (data[i][0].toString() === queueId.toString()) {
            const rowNum = i + 1;
            
            // Helper to update cell if field exists in updateData
            const updateCell = (header, val) => {
                const col = headers.indexOf(header) + 1;
                if (col > 0 && val !== undefined) {
                    sheet.getRange(rowNum, col).setValue(val);
                }
            };

            // Update Basic Info
            updateCell('chapter', updateData.chapter);

            // Update Statuses
            updateCell('uploadstatus', updateData.uploadstatus);
            updateCell('extractstatus', updateData.extractstatus);
            updateCell('translatestatus', updateData.translatestatus);
            updateCell('typesetstatus', updateData.typesetstatus);
            updateCell('publishstatus', updateData.publishstatus);

            // Update Names
            updateCell('uploadername', updateData.uploadername);
            updateCell('extractorname', updateData.extractorname);
            updateCell('translatorname', updateData.translatorname);
            updateCell('typesettername', updateData.typesettername);
            updateCell('publishername', updateData.publishername);
            updateCell('poststatus', updateData.poststatus);
            updateCell('postername', updateData.postername);

            // --- Telegram Notification Logic ---
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
                  const stepLabel = getStepLabel(field.replace('status', ''));
                  console.log(`Detected status change to "เสร็จแล้ว" in FullUpdate for field: ${field}`);
                  const assignee = updateData[assigneeMap[field]] || '';
                  let message = `✅ <b>งานเสร็จแล้ว!</b>\n\nเรื่อง: <b>${mangaNameForNoti}</b>\nตอนที่: ${chapterForNoti}\nขั้นตอน: <b>${stepLabel}</b>\nโดย: ${assignee || 'ไม่ระบุ'}`;
                  
                  const stepLink = extractLinkForStep(updateData.worklink, stepLabel);
                  if (stepLink) {
                    message += `\n🔗 <b>ลิงก์งาน:</b> ${stepLink}`;
                  }
                  
                  sendTelegramNotification(message);

                  // --- AUTO UPDATE WEBSITE TRIGGER ---
                  if (field === 'poststatus') {
                    try {
                      const mangaList = getMangaList();
                      const manga = mangaList.find(m => m.mangaid.toString() === mangaIdForNoti.toString());
                      if (manga && manga.slug) {
                        const range = parseChapterRange(chapterForNoti);
                        updateMangaEpisodeOnWebsite(manga.slug, range.end);
                      } else {
                        console.log(`Auto-update skipped for ${mangaNameForNoti}: No slug configured.`);
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


            // Update Links & Notes
            updateCell('worklink', updateData.worklink);
            updateCell('note', updateData.note);
            
            // Special handling for inline links (Raw & Extract) could go here if needed
            // But for simplicity, we rely on 'worklink' or just strictly mapping inputs to logic later if the user wants separate columns.
            // Currently our structure has 'worklink' as a main column. 
            // If the user wants to update specific link notes, they can use the Note field or we can append to note.
            // *Edit*: Based on previous code, links are often appended to note or worklink. 
            
            invalidateCache('workQueue');
            return { success: true, queue: getWorkQueue() };
        }
    }
    return { error: 'Queue ID not found' };
  } catch (e) {
      return { error: 'Update Failed: ' + e.toString() };
  }
}

function getTeamMembers() {
  return getCachedData('teamList', () => {
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
  }, 3600); // Cache for 1 hour
}

/**
 * CRON: รันทุกวันเพื่อดึงมังงะเข้าคิวอัตโนมัติ
 */
/**
 * CRON: รันทุกวันเพื่อดึงมังงะเข้าคิวอัตโนมัติ (Batch Optimized)
 */
function processAutoQueue() {
  const today = getTodayDayName(); // เช่น "วันพุธ"
  const mangaList = getMangaList();
  const queueList = getWorkQueue(); // ดึงข้อมูลครั้งเดียวข้างนอก Loop
  
  const scheduled = mangaList.filter(m => 
    m.status === 'Ongoing' && 
    m.releaseday && m.releaseday.split(',').map(d => d.trim()).includes(today)
  );
  
  if (scheduled.length === 0) return;

  const lock = LockService.getScriptLock();
  try {
      lock.waitLock(30000); // Lock ทีเดียว
      const sheet = getSheet(QUEUE_SHEET_NAME);
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => h.toString().toLowerCase().trim());
      
      const newRows = [];
      const mangaUpdates = []; // เก็บรายการที่จะอัปเดตไว้ก่อน

      const timestamp = new Date();
      const todayStr = timestamp.toLocaleDateString('th-TH');

      scheduled.forEach(m => {
        // 1. ตรวจสอบจาก List ที่ดึงมาพักไว้ (Memory Check) เพื่อป้องกันการสร้างซ้ำ
        // ตรวจทั้ง "สร้างวันนี้" และ "มีงานค้างอยู่แล้ว" ป้องกัน cross-month duplicate
        const alreadyAdded = queueList.some(q => {
          if (q.mangaid.toString() !== m.mangaid.toString()) return false;
          // บล็อกถ้าสร้างวันนี้แล้ว
          const qDate = new Date(q.createdat).toLocaleDateString('th-TH');
          if (qDate === todayStr) return true;
          // บล็อกถ้ามีงานค้างอยู่ (ยังไม่เสร็จ) ไม่ว่าจะเดือนไหน
          if (q.poststatus !== 'เสร็จแล้ว') return true;
          return false;
        });
        
        if (alreadyAdded) return;

        // 2. เตรียมข้อมูลคิวงาน
        let nextChapter = (parseFloat(m.lastchapter) || 0) + 1;
        const id = new Date().getTime() + Math.floor(Math.random() * 1000); // สร้าง ID

        const rowData = headers.map(header => {
            if (header === 'queueid') return id;
            if (header === 'createdat') return timestamp;
            if (header === 'mangaid') return m.mangaid;
            if (header === 'chapter') return nextChapter.toString();
            if (header === 'uploadstatus') return 'รอเริ่ม';
            if (header === 'extractstatus') return (m.needsextract === true || m.needsextract === 'true') ? 'รอเริ่ม' : 'Skipped';
            if (header === 'translatestatus') return 'รอเริ่ม';
            if (header === 'typesetstatus') return 'รอเริ่ม';
            if (header === 'publishstatus') return 'รอเริ่ม';
            if (header === 'poststatus') return 'รอเริ่ม';
            if (header === 'translatorname') return m.lockedtranslator || '';
            return ''; // Column อื่นๆ ปล่อยว่าง
        });
        
        newRows.push(rowData);

        // Telegram Notification on Add (Auto)
        if (m.notifyonadd === true || m.notifyonadd === 'true') {
           const message = `🤖 <b>เพิ่มคิวงานอัตโนมัติ!</b>\n\nเรื่อง: <b>${m.manganame}</b>\nตอนที่: ${nextChapter}\nสถานะ: เข้าระบบตามตารางเวลาแล้ว`;
           sendTelegramNotification(message);
        }
        
        // เก็บข้อมูลสำหรับอัปเดต MangaList (ชื่อฟังก์ชัน batch... สื่อความหมายว่าทำทีเดียว)
        mangaUpdates.push({
            mangaId: m.mangaid,
            newChapter: nextChapter.toString()
        });
      });

      // 3. เขียนลง Sheet Queue ทีเดียว (Batch Write)
      if (newRows.length > 0) {
          const startRow = sheet.getLastRow() + 1;
          sheet.getRange(startRow, 1, newRows.length, headers.length).setValues(newRows);
          console.log(`Added ${newRows.length} items to queue.`);
      }
      
      // 4. อัปเดต MangaList ทีเดียว (Batch Update)
      if (mangaUpdates.length > 0) {
          batchSyncMangaStatus(mangaUpdates);
      }

  } catch (err) {
      console.error('Auto Queue Error:', err);
  } finally {
      lock.releaseLock();
  }
}

/**
 * ฟังก์ชันอัปเดตสถานะมังงะแบบ Batch (อ่านครั้งเดียว เขียนครั้งเดียว)
 */
function batchSyncMangaStatus(updates) {
  try {
    const sheet = getSheet(SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => h.toString().toLowerCase().trim());
    
    // หาตำแหน่ง Column
    const idColIndex = 0; 
    const lastChapterColIndex = headers.indexOf('lastchapter');
    const lastUpdatedColIndex = headers.indexOf('lastupdated');
    
    if (lastChapterColIndex === -1 || lastUpdatedColIndex === -1) return;

    let hasChanges = false;
    const now = new Date();

    // สร้าง Map เพื่อให้ค้นหา ID เร็วๆ
    const updateMap = new Map();
    updates.forEach(u => updateMap.set(u.mangaId.toString(), parseFloat(u.newChapter)));

    // วน Loop ข้อมูลใน Sheet (ใน Memory)
    for (let i = 1; i < data.length; i++) {
        const currentId = data[i][idColIndex].toString();
        
        if (updateMap.has(currentId)) {
            const rawNewChapter = updateMap.get(currentId);
            const range = parseChapterRange(rawNewChapter);
            const newChapter = range.end;
            const currentChapter = parseFloat(data[i][lastChapterColIndex]) || 0;

            if (newChapter >= currentChapter) {
                // แก้ไขค่าใน Array
                data[i][lastChapterColIndex] = newChapter;
                data[i][lastUpdatedColIndex] = now;
                hasChanges = true;
            }
        }
    }

    // เขียนข้อมูลกลับลง Sheet ทีเดียว (ถ้ามีการแก้ไข)
    if (hasChanges) {
        sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
        console.log('Batch synced manga statuses.');
    }

  } catch (e) {
    console.error('Batch Sync Error:', e);
  }
}

function getTodayDayName() {
  const days = ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'];
  return days[new Date().getDay()];
}

/**
 * ฟังก์ชันสำหรับสร้าง Trigger เพื่อรันระบบอัตโนมัติ
 */
function createAutoQueueTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'processAutoQueue') ScriptApp.deleteTrigger(t);
  });
  
  ScriptApp.newTrigger('processAutoQueue')
    .timeBased()
    .everyDays(1)
    .atHour(2) // รันตอนตี 2 ตามที่ขอ
    .create();
    
  return "สร้างระบบตั้งเวลาอัตโนมัติเรียบร้อยแล้ว! (รันทุกวันเวลา 02:00 น.)";
}

/**
 * ย้ายงานที่ยังโพสต์ไม่เสร็จจากเดือนก่อนๆ ให้มาอยู่ในเดือนปัจจุบัน
 * โดยการอัปเดต CreatedAt เป็นวันที่ปัจจุบัน
 */
function movePendingQueueToCurrentMonth() {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const sheet = getSheet(QUEUE_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => h.toString().toLowerCase().trim());
    
    const createdAtCol = headers.indexOf('createdat');
    const postStatusCol = headers.indexOf('poststatus');
    const queueIdCol = 0; // QueueID is usually Col A

    if (createdAtCol === -1 || postStatusCol === -1) return "Error: Headers mapping failed";

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    let updatedCount = 0;

    for (let i = 1; i < data.length; i++) {
      const postStatus = data[i][postStatusCol];
      const createdAtRaw = data[i][createdAtCol];
      const createdAt = createdAtRaw instanceof Date ? createdAtRaw : new Date(createdAtRaw);

      // ย้ายเฉพาะงานที่ PostStatus != 'เสร็จแล้ว' และไม่ได้อยู่ในเดือนปัจจุบัน
      if (postStatus !== 'เสร็จแล้ว') {
        const isLegacyMonth = createdAt.getMonth() !== currentMonth || createdAt.getFullYear() !== currentYear;
        
        if (isLegacyMonth) {
          // อัปเดต CreatedAt ใน Array (Memory)
          // หมายเหตุ: เราตั้งให้เป็นวันที่ปัจจุบัน เวลา 00:00:01 เพื่อให้เรียงลำดับอยู่บนๆ ของวันใหม่
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
      console.log(`Moved ${updatedCount} items to current month.`);
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

/**
 * สร้าง Trigger สำหรับย้ายงานค้างมาเดือนปัจจุบันอัตโนมัติ
 * (รันทุกวัน เวลา 03:00 น. หลังจาก processAutoQueue)
 */
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
  try {
    const sheet = getSheet(BUDGET_PAYEE_SHEET_NAME);
    const id = 'P' + new Date().getTime();
    sheet.appendRow([id, payee.name, payee.taxid, payee.bankaccount || '', payee.bankname || '', payee.note || '']);
    return { success: true, payees: getBudgetPayees() };
  } catch (err) {
    return { error: 'Add Payee Failed: ' + err.toString() };
  }
}

function updateBudgetPayee(id, updated) {
  try {
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
        return { success: true, payees: getBudgetPayees() };
      }
    }
    return { error: 'Payee not found' };
  } catch (err) {
    return { error: 'Update Payee Failed: ' + err.toString() };
  }
}

function deleteBudgetPayee(id) {
  try {
    const sheet = getSheet(BUDGET_PAYEE_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toString() === id.toString()) {
        sheet.deleteRow(i + 1);
        return { success: true, payees: getBudgetPayees() };
      }
    }
    return { error: 'Payee not found' };
  } catch (err) {
    return { error: 'Delete Payee Failed: ' + err.toString() };
  }
}

// --- BUDGET TRANSACTIONS ---
function getBudgetTransactions() {
  return readSheetData(BUDGET_TRANSACTION_SHEET_NAME);
}

function addBudgetTransaction(trans) {
  try {
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
    return { success: true, transactions: getBudgetTransactions() };
  } catch (err) {
    return { error: 'Add Transaction Failed: ' + err.toString() };
  }
}

function deleteBudgetTransaction(id) {
  try {
    const sheet = getSheet(BUDGET_TRANSACTION_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toString() === id.toString()) {
        sheet.deleteRow(i + 1);
        return { success: true, transactions: getBudgetTransactions() };
      }
    }
    return { error: 'Transaction not found' };
  } catch (err) {
    return { error: 'Delete Transaction Failed: ' + err.toString() };
  }
}

// --- GENERIC GENERIC HELPER ---
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

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Optimized GET: ดึงข้อมูลรวมเพื่อลดจำนวน Request
 */
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

function getDashboardData() {
  return {
    manga: getMangaList(),
    queue: getWorkQueue(),
    team: getTeamMembers(),
    sales: getMangaSales(),
    payees: getBudgetPayees(),
    transactions: getBudgetTransactions(),
    websites: getWebsiteList()
  };
}

/**
 * Check if queue item is locked and if lock has expired (>10 minutes)
 */
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
        
        // Check if lock has expired (>10 minutes)
        if (editingTime) {
          const lockTime = new Date(editingTime);
          const now = new Date();
          const diffMinutes = (now - lockTime) / (1000 * 60);
          
          if (diffMinutes > 10) {
            // Lock expired, auto-release it
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
    
    return data.map(row => {
      let obj = {};
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
    
    // Pre-calculate website list for efficient checking
    const websiteSheet = getSheet(WEBSITE_SHEET_NAME);
    const existingWebsites = getWebsiteList();
    
    const newRows = salesArray.map(sale => {
      // Add website if it doesn't exist
      if (sale.website && !existingWebsites.includes(sale.website)) {
        websiteSheet.appendRow([sale.website]);
        existingWebsites.push(sale.website);
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
    
    invalidateCache(['financial_sales']);
    return { success: true, count: newRows.length };
  } catch (err) {
    console.error('bulkAddMangaSales Error:', err);
    return { error: 'Bulk Add Failed: ' + err.toString() };
  } finally {
    lock.releaseLock();
  }
}

function deleteMangaSale(index) {
  try {
    const sheet = getSheet(MANGA_SALES_SHEET_NAME);
    // index is 0-based from the filtered list usually, but here we expect a true row index if possible 
    // or we'll need a unique ID. Since the image doesn't show a unique ID, we'll use a match on date/series if needed 
    // but for now let's assume simple row deletion for the demo.
    sheet.deleteRow(index + 2); // +2 for 1-indexing and header
    return { success: true, list: getMangaSales() };
  } catch (err) {
    return { error: 'Delete Sale Failed: ' + err.toString() };
  }
}

/**
 * READ-ONLY: Count finished chapters from WorkQueue for a manga and month
 */
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
    if (data.length <= 1) return []; // Should not happen given init defaults

    const rawHeaders = data.shift();
    // Assuming single column 'WebsiteName'
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

/**
 * Send notification to Telegram
 */
function sendTelegramNotification(message) {
  console.log('Triggered sendTelegramNotification with message:', message);
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'YOUR_BOT_TOKEN_HERE') {
    console.warn('Telegram Bot Token not configured properly.');
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
    const response = UrlFetchApp.fetch(url, options);
    console.log('Telegram response:', response.getContentText());
  } catch (e) {
    console.error('Telegram notification failed:', e);
  }
}

function getMangaNameById(mangaId) {
  const mangaList = getMangaList();
  const manga = mangaList.find(m => m.mangaid.toString() === mangaId.toString());
  return manga ? manga.manganame : 'มังงะไม่ทราบชื่อ';
}

/**
 * Handle Telegram Webhook
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return;
    const contents = JSON.parse(e.postData.contents);
    if (!contents.message) return;

    const chatId = contents.message.chat.id;
    const text = contents.message.text;

    if (text && text.startsWith('/')) {
      const commandParts = text.split(' ');
      const command = commandParts[0].toLowerCase().split('@')[0];
      const args = commandParts.slice(1);
      
      handleTelegramCommand(chatId, command, args);
    }
  } catch (err) {
    console.error('Error in doPost:', err);
  }
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
    case '/ready_upload': // Alias
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
  
  const isDone = (s) => s === 'เสร็จแล้ว' || s === 'Skipped' || s === 'ข้าม';
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
    stepTitle = "ดึงคำเสร็จ -> รอแปล";
    list = queue.filter(q => q.extractstatus === 'เสร็จแล้ว' && q.translatestatus !== 'เสร็จแล้ว' && q.translatestatus !== 'ข้าม');
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

/**
 * Utility: Run this once from GAS Editor to set the webhook
 */
function setTelegramWebhook() {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${ScriptApp.getService().getUrl()}`;
  const response = UrlFetchApp.fetch(url);
  Logger.log(response.getContentText());
  return response.getContentText();
}
