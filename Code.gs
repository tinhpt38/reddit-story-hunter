/**
 * Reddit Story Hunter
 * Read-only Reddit Data API -> Google Sheets collector.
 *
 * Required Script Properties:
 *   SPREADSHEET_ID
 *   REDDIT_CLIENT_ID
 *   REDDIT_CLIENT_SECRET
 *   REDDIT_USER_AGENT
 */

const TAB_STORIES = 'STORIES';
const TAB_SOURCES = 'SOURCES';
const TAB_CONFIG = 'CONFIG';

const STORY_COLUMNS = 26;
const REDDIT_OAUTH_BASE = 'https://oauth.reddit.com';
const REDDIT_TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Reddit Hunter')
    .addItem('Test Reddit API', 'testRedditConnection')
    .addItem('Crawl Reddit Now', 'crawlReddit')
    .addSeparator()
    .addItem('Install 1-hour Trigger', 'installHourlyTrigger')
    .addItem('Remove Crawler Triggers', 'removeCrawlerTriggers')
    .addToUi();
}

function crawlReddit() {
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(5000)) {
    console.log('Crawler already running.');
    return;
  }

  try {
    const ss = getSpreadsheet_();
    const sourceSheet = requireSheet_(ss, TAB_SOURCES);
    const storySheet = requireSheet_(ss, TAB_STORIES);
    const config = getConfig_(ss);

    const maxPostAgeHours = toPositiveNumber_(config.max_post_age_hours, 72);
    const retentionHours = toPositiveNumber_(config.retention_hours, maxPostAgeHours);
    const maxPostsPerSource = Math.min(
      100,
      Math.max(1, Math.floor(toPositiveNumber_(config.max_posts_per_market_per_run, 50)))
    );

    const sources = readEnabledSources_(sourceSheet);
    let rows = readStoryRows_(storySheet);

    const postMap = new Map();
    rows.forEach((row, index) => {
      const id = String(row[4] || '').trim();
      if (id) postMap.set(id, index);
    });

    const now = new Date();

    for (const source of sources) {
      console.log(`Fetching r/${source.subreddit}`);

      const posts = fetchSubredditNew_(source.subreddit, maxPostsPerSource);

      for (const post of posts) {
        const d = post && post.data ? post.data : null;
        if (!d || !d.id) continue;

        // MVP focuses on Reddit-hosted text discussions, not external link posts.
        if (d.is_self === false) continue;

        const postedAt = new Date(Number(d.created_utc) * 1000);
        const ageHours = Math.max(0, (now.getTime() - postedAt.getTime()) / 3600000);

        if (ageHours > maxPostAgeHours) continue;

        const postScore = Number(d.score || 0);
        const comments = Number(d.num_comments || 0);
        const denominator = Math.max(ageHours, 0.5);

        const scorePerHour = round_(postScore / denominator, 2);
        const commentsPerHour = round_(comments / denominator, 2);
        const redditUrl = 'https://www.reddit.com' + String(d.permalink || '');

        if (postMap.has(d.id)) {
          const index = postMap.get(d.id);
          const row = rows[index];

          row[1] = source.market;
          row[2] = source.language;
          row[3] = source.subreddit;
          row[5] = d.title || '';
          row[6] = redditUrl;
          row[7] = postedAt;
          row[8] = round_(ageHours, 2);
          row[9] = postScore;
          row[10] = comments;
          row[11] = scorePerHour;
          row[12] = commentsPerHour;
          row[25] = now;
          continue;
        }

        const newRow = [
          now,                    // A  Found At
          source.market,          // B  Market
          source.language,        // C  Language
          source.subreddit,       // D  Subreddit
          d.id,                   // E  Reddit Post ID
          d.title || '',          // F  Title
          redditUrl,              // G  URL
          postedAt,               // H  Posted At
          round_(ageHours, 2),    // I  Age (h)
          postScore,              // J  Post Score
          comments,               // K  Comments
          scorePerHour,           // L  Score/h
          commentsPerHour,        // M  Comments/h
          '',                     // N  Family Score
          '',                     // O  Conflict Score
          '',                     // P  Hook Score
          '',                     // Q  Twist Score
          '',                     // R  Serial Score
          '',                     // S  Viral Score
          'NEW',                  // T  Status
          '',                     // U  Theme
          '',                     // V  Short Summary
          '',                     // W  Why Viral
          '',                     // X  Notes
          '',                     // Y  Duplicate Group
          now                     // Z  Last Checked
        ];

        postMap.set(d.id, rows.length);
        rows.push(newRow);
      }

      // Keep request pacing conservative.
      Utilities.sleep(350);
    }

    // Keep only a short, configurable discovery window.
    rows = rows.filter(row => {
      const postedAt = row[7];
      if (!(postedAt instanceof Date) || isNaN(postedAt.getTime())) return true;
      const age = Math.max(0, (now.getTime() - postedAt.getTime()) / 3600000);
      return age <= retentionHours;
    });

    writeStoryRows_(storySheet, rows);

    console.log(`Crawler complete. Active rows: ${rows.length}`);
  } finally {
    lock.releaseLock();
  }
}

function fetchSubredditNew_(subreddit, limit) {
  const token = getRedditAccessToken_();
  const userAgent = getRequiredProperty_('REDDIT_USER_AGENT');

  const url =
    REDDIT_OAUTH_BASE +
    '/r/' +
    encodeURIComponent(subreddit) +
    '/new?limit=' +
    Number(limit || 50) +
    '&raw_json=1';

  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + token,
      'User-Agent': userAgent,
      Accept: 'application/json'
    },
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  const body = response.getContentText();

  if (status !== 200) {
    throw new Error(`Reddit API HTTP ${status} for r/${subreddit}: ${body}`);
  }

  const json = JSON.parse(body);

  return json && json.data && Array.isArray(json.data.children)
    ? json.data.children
    : [];
}

function getRedditAccessToken_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('reddit_access_token');

  if (cached) return cached;

  const clientId = getRequiredProperty_('REDDIT_CLIENT_ID');
  const clientSecret = getRequiredProperty_('REDDIT_CLIENT_SECRET');
  const userAgent = getRequiredProperty_('REDDIT_USER_AGENT');

  const auth = Utilities.base64Encode(clientId + ':' + clientSecret);

  const response = UrlFetchApp.fetch(REDDIT_TOKEN_URL, {
    method: 'post',
    payload: {
      grant_type: 'client_credentials'
    },
    headers: {
      Authorization: 'Basic ' + auth,
      'User-Agent': userAgent
    },
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  const body = response.getContentText();

  if (status !== 200) {
    throw new Error(`Reddit OAuth HTTP ${status}: ${body}`);
  }

  const json = JSON.parse(body);

  if (!json.access_token) {
    throw new Error('Reddit did not return access_token.');
  }

  const ttl = Math.max(
    60,
    Math.min(Number(json.expires_in || 3600) - 60, 3300)
  );

  cache.put('reddit_access_token', json.access_token, ttl);
  return json.access_token;
}

function testRedditConnection() {
  const posts = fetchSubredditNew_('AITAH', 3);

  SpreadsheetApp.getUi().alert(
    'Reddit API OK\n' +
    posts.length +
    ' public posts received from r/AITAH.'
  );
}

function installHourlyTrigger() {
  removeCrawlerTriggers();

  ScriptApp.newTrigger('crawlReddit')
    .timeBased()
    .everyHours(1)
    .create();

  SpreadsheetApp.getUi().alert('Hourly Reddit crawler installed.');
}

function removeCrawlerTriggers() {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'crawlReddit') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function getSpreadsheet_() {
  return SpreadsheetApp.openById(getRequiredProperty_('SPREADSHEET_ID'));
}

function requireSheet_(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error(`Missing required sheet: ${name}`);
  return sheet;
}

function readEnabledSources_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  return sheet
    .getRange(2, 1, lastRow - 1, 6)
    .getValues()
    .map(row => ({
      market: String(row[0] || '').trim(),
      language: String(row[1] || '').trim(),
      subreddit: String(row[2] || '').trim(),
      enabled:
        row[3] === true ||
        String(row[3] || '').toUpperCase() === 'TRUE'
    }))
    .filter(source => source.enabled && source.subreddit);
}

function readStoryRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, STORY_COLUMNS).getValues();
}

function writeStoryRows_(sheet, rows) {
  const currentLastRow = sheet.getLastRow();

  if (currentLastRow >= 2) {
    sheet
      .getRange(2, 1, currentLastRow - 1, STORY_COLUMNS)
      .clearContent();
  }

  if (rows.length > 0) {
    sheet
      .getRange(2, 1, rows.length, STORY_COLUMNS)
      .setValues(rows);
  }
}

function getConfig_(ss) {
  const sheet = requireSheet_(ss, TAB_CONFIG);
  const values = sheet.getDataRange().getValues();
  const config = {};

  values.slice(1).forEach(row => {
    const key = String(row[0] || '').trim();
    if (key) config[key] = row[1];
  });

  return config;
}

function getRequiredProperty_(key) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) {
    throw new Error(`Missing Script Property: ${key}`);
  }
  return value;
}

function toPositiveNumber_(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function round_(number, digits) {
  const factor = Math.pow(10, digits || 0);
  return Math.round(Number(number) * factor) / factor;
}
