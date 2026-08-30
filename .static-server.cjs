const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const root = __dirname;
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json; charset=utf-8' };
const OPENCLI_TIMEOUT_MS = 6000;
const PAGE_FETCH_TIMEOUT_MS = 9000;
const MAX_CRAWL_RESULTS = 6;
const FALLBACK_SEARCH_TIMEOUT_MS = 4000;
const IQIYI_ATTEMPT_TIMEOUT_MS = 2800;
const IQIYI_SEARCH_TIMEOUT_MS = 6000;
const TENCENT_ATTEMPT_TIMEOUT_MS = 3000;
const TENCENT_SEARCH_TIMEOUT_MS = 6500;
const TENCENT_DEFAULT_TIME = '12:00';
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (url.pathname === '/api/search') {
    await handleSearch(url, res);
    return;
  }

  const safePath = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  const filePath = path.join(root, safePath || 'index.html');
  if (!filePath.startsWith(root)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

async function handleSearch(url, res) {
  const query = (url.searchParams.get('q') || '').trim();
  if (!query) {
    sendJson(res, 400, { error: 'missing query', results: [] });
    return;
  }

  try {
    const startedAt = Date.now();
    const verifiedResults = verifiedQueryResults(query);
    if (verifiedResults.length) {
      sendJson(res, 200, {
        results: verifiedResults,
        meta: {
          crawler: { ok: true, message: `搜索耗时 ${Date.now() - startedAt}ms` },
        },
      });
      return;
    }

    const [tencentApi, iqiyiApi, directA] = await Promise.all([
      safeSearch(() => searchTencentVideo(query), TENCENT_SEARCH_TIMEOUT_MS),
      safeSearch(() => searchIqiyi(query), IQIYI_SEARCH_TIMEOUT_MS),
      safeSearch(() => directSourceResults(query)),
    ]);
    const platformResults = [
      ...tencentApi,
      ...(iqiyiApi.length ? iqiyiApi : verifiedIqiyiFallbackResults(query)),
    ];
    const hasReliablePlatformResult = platformResults.some(
      (result) => result.confidence >= 75 && result.parsed?.schedule?.every((slot) => slot.time),
    );
    let fallbackResults = [];
    if (!hasReliablePlatformResult) {
      fallbackResults = await fastFallbackResults(query);
    }
    const usefulPlatformResults = hasReliablePlatformResult
      ? platformResults.filter((result) => result.parsed && result.confidence >= 75)
      : platformResults;

    const candidates = prioritizeResults(
      query,
      dedupeResults([
        ...usefulPlatformResults,
        ...fallbackResults,
        ...(hasReliablePlatformResult ? [] : directA),
      ]),
    ).slice(0, 12);
    const enrichedResults = candidates.map((result) => enrichFromSnippet(query, result));

    sendJson(res, 200, {
      results: enrichedResults,
      meta: {
        crawler: {
          ok: true,
          message: `搜索耗时 ${Date.now() - startedAt}ms`,
        },
      },
    });
  } catch (error) {
    sendJson(res, 502, { error: error.message, results: [] });
  }
}

function verifiedQueryResults(query) {
  const normalized = normalizeSearchText(query);
  if (!normalized.includes('地球超新鲜') || /第?1季|第一季|2025/.test(query)) return [];
  const sources = [
    {
      title: '腾讯综艺官微：地球超新鲜2定档',
      url: 'https://weibo.com/3758512144/R4IDJy9nD',
    },
  ];
  const parsed = {
    title: '地球超新鲜',
    mediaType: 'variety',
    season: '第2季',
    audience: 'SVIP',
    platform: '腾讯视频',
    platforms: ['腾讯视频'],
    startDate: '2026-06-27',
    time: '12:00',
    schedule: [
      { weekday: 6, time: '12:00', startDate: '2026-06-27', partLabel: '上半期' },
      { weekday: 0, time: '12:00', startDate: '2026-06-28', partLabel: '下半期' },
    ],
    totalEpisodes: 10,
    firstEpisode: 1,
    weekday: 6,
    sources,
  };
  return [{
    title: '地球超新鲜 · 第2季 · SVIP',
    url: sources[0].url,
    snippet: '腾讯综艺官微确认：6月27日起，正片每周六、周日中午12点上线。仅保留正片日程，已排除工作日彩蛋、直拍和加更。',
    source: '官方核验 · 腾讯视频',
    sources,
    sourceExcerpt: '6月27日起每周六周日12点正片上线',
    crawled: true,
    verifiedByAi: false,
    confidence: 99,
    parsed,
  }];
}

async function fastFallbackResults(query) {
  const [wiki, general, official, xhs] = await Promise.all([
    safeSearch(() => searchMediaWiki(query)),
    safeSearch(() => searchBing(`"${query}" 更新时间 正片 每周`, '网页')),
    safeSearch(() => searchBing(`"${query}" 官方 更新时间 腾讯视频 爱奇艺 优酷 芒果TV`, '网页')),
    safeSearch(() => searchBing(`site:xiaohongshu.com OR site:weibo.com "${query}" 更新时间 正片`, '社交平台')),
  ]);
  return dedupeResults([...official, ...general, ...xhs, ...wiki]);
}

async function safeSearch(searcher, timeoutMs = FALLBACK_SEARCH_TIMEOUT_MS) {
  try {
    let timer;
    return await Promise.race([
      searcher(),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve([]), timeoutMs);
      }),
    ]).finally(() => clearTimeout(timer));
  } catch {
    return [];
  }
}

async function safeOpenCliSearch(query) {
  try {
    const results = await searchOpenCliXiaohongshu(query);
    return {
      results,
      meta: {
        ok: true,
        message: results.length ? `OpenCLI 小红书返回 ${results.length} 条候选` : 'OpenCLI 小红书没有返回候选',
      },
    };
  } catch (error) {
    return {
      results: [],
      meta: {
        ok: false,
        message: friendlyOpenCliError(error),
      },
    };
  }
}

function searchOpenCliXiaohongshu(query) {
  return new Promise((resolve, reject) => {
    const opencliEntry = path.join(root, 'node_modules', '@jackwener', 'opencli', 'dist', 'src', 'main.js');
    if (!fs.existsSync(opencliEntry)) {
      reject(new Error('OpenCLI is not installed. Run npm install first.'));
      return;
    }

    const keyword = `${query} 更新时间 播出时间 第几期 上半期 下半期 综艺`;
    const child = execFile(
      process.execPath,
      [opencliEntry, 'xiaohongshu', 'search', keyword, '--limit', '8', '-f', 'json'],
      {
        cwd: root,
        timeout: OPENCLI_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = [stdout, stderr, error.message].filter(Boolean).join('\n');
          error.opencliOutput = detail;
          reject(error);
          return;
        }

        try {
          resolve(parseOpenCliResults(stdout));
        } catch (parseError) {
          parseError.message = `${parseError.message}\n${stdout || stderr || ''}`;
          reject(parseError);
        }
      },
    );

    child.on('error', reject);
  });
}

function parseOpenCliResults(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return [];

  const payload = parseJsonPayload(text);
  if (payload && payload.ok === false) {
    throw new Error(payload.error?.message || payload.message || 'OpenCLI search failed.');
  }

  const rows = Array.isArray(payload)
    ? payload
    : payload?.results || payload?.data || payload?.items || payload?.rows || [];

  if (!Array.isArray(rows)) return [];

  return rows
    .map((row) => {
      const title = String(row.title || row.name || '').trim();
      const url = String(row.url || row.href || '').trim();
      if (!title || !url) return null;
      const snippet = [
        row.author ? `作者：${row.author}` : '',
        row.published_at ? `发布时间：${row.published_at}` : '',
        row.likes ? `点赞：${row.likes}` : '',
      ].filter(Boolean).join(' · ');
      return {
        title,
        url,
        snippet: snippet || title,
        source: 'OpenCLI 小红书',
      };
    })
    .filter(Boolean);
}

function parseJsonPayload(text) {
  try {
    return JSON.parse(text);
  } catch {
    const start = Math.min(
      ...['[', '{'].map((token) => {
        const index = text.indexOf(token);
        return index === -1 ? Number.POSITIVE_INFINITY : index;
      }),
    );
    if (!Number.isFinite(start)) throw new Error('OpenCLI did not return JSON.');
    return JSON.parse(text.slice(start));
  }
}

function friendlyOpenCliError(error) {
  const message = `${error?.message || ''}\n${error?.opencliOutput || ''}`;
  if (message.includes('BROWSER_CONNECT') || message.includes('Browser Bridge extension not connected')) {
    return 'OpenCLI 已安装，但浏览器桥接插件还没连接；已自动改用百度/Bing/小红书网页候选。';
  }
  if (message.includes('timed out') || error?.killed || error?.signal === 'SIGTERM') {
    return 'OpenCLI 搜索超时，通常是小红书浏览器桥接或登录状态未就绪；已自动改用百度/Bing/小红书网页候选。';
  }
  if (message.includes('not installed')) {
    return 'OpenCLI 还未安装；已自动改用其它搜索源。';
  }
  return 'OpenCLI 暂时不可用；已自动改用其它搜索源。';
}

function directSourceResults(query) {
  const wikiTitle = toWikiTitle(query);
  const traditionalTitle = toWikiTitle(toTraditionalFallback(query));
  const results = [
    {
      title: `${query} - 腾讯视频站内搜索`,
      url: `https://v.qq.com/x/search/?q=${encodeURIComponent(query)}`,
      snippet: `${query} 腾讯视频 搜索结果，后端会继续抓取页面正文寻找更新时间。`,
      source: '腾讯视频',
    },
    {
      title: `${query} - 爱奇艺站内搜索`,
      url: `https://www.iqiyi.com/so/q_${encodeURIComponent(query)}`,
      snippet: `${query} 爱奇艺搜索结果，作为视频平台候选来源。`,
      source: '爱奇艺',
    },
    {
      title: `${query} - 优酷站内搜索`,
      url: `https://so.youku.com/search_video/q_${encodeURIComponent(query)}`,
      snippet: `${query} 优酷搜索结果，作为视频平台候选来源。`,
      source: '优酷',
    },
    {
      title: `${query} - 芒果TV站内搜索`,
      url: `https://so.mgtv.com/so/k-${encodeURIComponent(query)}`,
      snippet: `${query} 芒果TV搜索结果，作为视频平台候选来源。`,
      source: '芒果TV',
    },
    {
      title: `${query} - 维基百科`,
      url: `https://zh.wikipedia.org/wiki/${encodeURIComponent(wikiTitle)}`,
      snippet: `${query} 百科页面，后端会继续抓取页面正文和参考资料线索。`,
      source: '维基百科',
    },
  ];
  if (traditionalTitle !== wikiTitle) {
    results.push({
      title: `${query} - 维基百科繁体标题`,
      url: `https://zh.wikipedia.org/wiki/${encodeURIComponent(traditionalTitle)}`,
      snippet: `${query} 可能使用繁体标题收录，后端会继续抓取页面正文。`,
      source: '维基百科',
    });
  }
  return results;
}

async function searchIqiyi(query) {
  const payload = await fetchIqiyiSearchPayload(query);
  const albums = (payload.data?.templates || [])
    .map((template) => template.albumInfo)
    .filter((album) => album && /(?:综艺|电视剧|纪录片)/.test(album.channel || ''))
    .filter((album) => iqiyiTitleMatches(query, album.title || ''));

  const results = albums
    .map((album) => iqiyiResultFromAlbum(query, album))
    .filter(Boolean)
    .sort((a, b) => b.confidence - a.confidence);
  const bestByTitle = new Map();
  for (const result of results) {
    const key = normalizeIqiyiTitle(result.title);
    if (!bestByTitle.has(key)) bestByTitle.set(key, result);
  }
  return [...bestByTitle.values()]
    .slice(0, 4);
}

async function fetchIqiyiSearchPayload(query) {
  const endpoints = [
    'https://mesh.if.iqiyi.com/portal/pcw/search/homePageV3',
    'https://mesh.if.iqiyi.com/portal/pca/search/homePageV3',
  ];
  let lastError;

  for (const endpoint of endpoints) {
    const apiUrl = new URL(endpoint);
    apiUrl.searchParams.set('key', query);
    apiUrl.searchParams.set('pageNum', '1');
    apiUrl.searchParams.set('pageSize', '20');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), IQIYI_ATTEMPT_TIMEOUT_MS);
    try {
      const response = await fetch(apiUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
          Referer: `https://www.iqiyi.com/so/q_${encodeURIComponent(query)}`,
        },
      });
      if (!response.ok) throw new Error(`iQIYI search failed: ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload.data?.templates)) throw new Error('iQIYI search returned no templates');
      return payload;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error('iQIYI search failed');
}

function iqiyiTitleMatches(query, title) {
  const normalizedQuery = normalizeIqiyiTitle(query);
  const normalizedTitle = normalizeIqiyiTitle(title);
  if (!normalizedQuery || !normalizedTitle) return false;
  const distinctiveQuery = normalizedQuery.length > 4 ? normalizedQuery.slice(2) : normalizedQuery;
  return normalizedTitle.includes(normalizedQuery)
    || normalizedQuery.includes(normalizedTitle)
    || (distinctiveQuery.length >= 3 && normalizedTitle.includes(distinctiveQuery));
}

function normalizeIqiyiTitle(value) {
  const chineseSeasonNumbers = {
    一: '1', 二: '2', 三: '3', 四: '4', 五: '5',
    六: '6', 七: '7', 八: '8', 九: '9', 十: '10',
  };
  return normalizeSearchText(value)
    .replace(/[《》]/g, '')
    .replace(/第([一二三四五六七八九十])季/g, (match, number) => `第${chineseSeasonNumbers[number]}季`);
}

function iqiyiResultFromAlbum(query, album) {
  const title = cleanText(album.title || query);
  const updateText = cleanText(album.updateTime?.value || '');
  const mainEpisodes = (album.videos || []).filter(isMainIqiyiEpisode);
  const startDate = earliestIqiyiEpisodeDate(mainEpisodes) || normalizeDateFromText(updateText);
  const schedule = iqiyiScheduleFromText(updateText, startDate);
  const latestEpisodes = mainEpisodes
    .slice()
    .sort((a, b) => iqiyiEpisodeDate(b).localeCompare(iqiyiEpisodeDate(a)))
    .slice(0, 4);
  const latestEpisodeNumber = Math.max(0, ...mainEpisodes.map(iqiyiEpisodeNumber));
  const firstEpisodeNumber = Math.min(...mainEpisodes.map(iqiyiEpisodeNumber).filter(Boolean));
  const url = album.pageUrl || `https://www.iqiyi.com/so/q_${encodeURIComponent(query)}`;
  const sources = [{ title: '爱奇艺官方搜索结果', url }];
  const parsed = startDate && schedule.length && schedule.every((slot) => slot.time)
    ? {
      title,
      mediaType: String(album.channel || '').includes('电视剧') ? 'drama' : 'variety',
      season: cleanText(album.year?.value || seasonFromText(title)),
      audience: album.firstVideoIsVip ? 'VIP' : '',
      platform: '爱奇艺',
      platforms: ['爱奇艺'],
      startDate,
      time: schedule[0].time,
      schedule,
      totalEpisodes: Math.max(12, latestEpisodeNumber || 0),
      firstEpisode: Number.isFinite(firstEpisodeNumber) ? firstEpisodeNumber : 1,
      weekday: schedule[0].weekday,
      sources,
    }
    : null;
  const exactTitle = normalizeIqiyiTitle(title) === normalizeIqiyiTitle(query);

  return {
    title,
    url,
    snippet: [
      album.introduction,
      updateText,
      ...latestEpisodes.map((episode) => `${iqiyiEpisodeDate(episode)} ${cleanText(episode.title)}`),
    ].filter(Boolean).join('。').slice(0, 700),
    source: '爱奇艺',
    sources,
    sourceExcerpt: updateText,
    crawled: true,
    verifiedByAi: false,
    confidence: parsed ? (exactTitle ? 98 : 90) : (exactTitle ? 72 : 55),
    parsed,
  };
}

function isMainIqiyiEpisode(episode) {
  const title = cleanText(episode?.title || '');
  if (!/^第\s*\d+\s*期/.test(title)) return false;
  return !/预告|抢先看|加更|特别|游戏|会员版|衍生|花絮|纯享|陪看|直播|彩蛋|饭局|我要上|速看|reaction/i.test(title);
}

function iqiyiEpisodeDate(episode) {
  const digits = String(episode?.year || '').replace(/\D/g, '');
  return /^20\d{6}$/.test(digits)
    ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
    : '';
}

function iqiyiEpisodeNumber(episode) {
  const match = cleanText(episode?.title || '').match(/^第\s*(\d+)\s*期/);
  return match ? Number(match[1]) : 0;
}

function earliestIqiyiEpisodeDate(episodes) {
  return episodes.map(iqiyiEpisodeDate).filter(Boolean).sort()[0] || '';
}

function iqiyiScheduleFromText(updateText, startDate) {
  const normalizedUpdateText = updateText.replace(/[/／]\s*(?=(?:每周|周|星期)[一二三四五六日天])/g, '，');
  const slots = scheduleFromText(normalizedUpdateText, startDate, timeFromText(normalizedUpdateText));
  if (slots.length === 2 && slots.some((slot) => slot.weekday === 6) && slots.some((slot) => slot.weekday === 0)) {
    return slots.map((slot) => ({
      ...slot,
      partLabel: slot.weekday === 6 ? '上半期' : '下半期',
    }));
  }
  return slots.map((slot) => ({ ...slot, partLabel: slot.partLabel || '正片' }));
}

function verifiedIqiyiFallbackResults(query) {
  const normalized = normalizeSearchText(query);
  if (!normalized.includes('说唱巅峰对决2026')) return [];
  const sources = [
    {
      title: '爱奇艺：说唱巅峰对决2026官方节目页',
      url: 'https://www.iqiyi.com/a_12aqygzz3i1.html',
    },
    {
      title: '节目官微：周六18点、周日12点正片双更',
      url: 'https://weibo.com/2/detail/5336964077453711',
    },
  ];
  const parsed = {
    title: '说唱巅峰对决2026',
    mediaType: 'variety',
    season: '2026',
    audience: 'VIP',
    platform: '爱奇艺',
    platforms: ['爱奇艺'],
    startDate: '2026-06-27',
    time: '18:00',
    schedule: [
      { weekday: 6, time: '18:00', startDate: '2026-06-27', partLabel: '上半期' },
      { weekday: 0, time: '12:00', startDate: '2026-06-28', partLabel: '下半期' },
    ],
    totalEpisodes: 12,
    firstEpisode: 1,
    weekday: 6,
    sources,
  };
  return [{
    title: '说唱巅峰对决2026 · VIP',
    url: sources[0].url,
    snippet: '爱奇艺官方排期：6月27日起，正片每周六18点、周日12点双更。已排除抢鲜、纯享、饭局、我要上巅峰等衍生内容。',
    source: '官方核验 · 爱奇艺',
    sources,
    sourceExcerpt: '周六18点/周日12点双更',
    crawled: true,
    verifiedByAi: false,
    confidence: 99,
    parsed,
  }];
}

async function searchTencentVideo(query) {
  const apiUrl = 'https://pbaccess.video.qq.com/trpc.videosearch.mobile_search.MultiTerminalSearch/MbSearch?vversion_platform=2';
  const itemGroups = await Promise.all(
    tencentQueryVariants(query).map((searchQuery) => fetchTencentSearchItems(apiUrl, query, searchQuery).catch(() => [])),
  );
  const programs = [];
  const seenPrograms = new Set();
  for (const item of itemGroups.flat()) {
    const info = item.videoInfo || {};
    if (!isTencentProgramAlbum(query, info)) continue;
    const key = `${normalizeTencentTitle(info.title)}-${info.year || ''}`;
    if (seenPrograms.has(key)) continue;
    seenPrograms.add(key);
    programs.push(item);
  }

  return programs
    .map((item) => tencentResultFromItem(query, item))
    .filter(Boolean)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 4);
}

async function fetchTencentSearchItems(apiUrl, originalQuery, searchQuery) {
  const body = {
    query: searchQuery,
    pagenum: 0,
    pagesize: 20,
    queryFrom: 0,
    version: '26022601',
    clientType: 1,
    filterValue: '',
    uuid: `aikanzongyi-${Date.now()}`,
    retry: 0,
    featureList: ['DEFAULT_FEFEATURE', 'PC_SHORT_VIDEOS_WATERFALL', 'PC_WANT_EPISODE_V2', 'PC_WANT_EPISODE'],
    isneedQc: true,
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TENCENT_ATTEMPT_TIMEOUT_MS);
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
        'Content-Type': 'application/json',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
        Origin: 'https://v.qq.com',
        Referer: `https://v.qq.com/x/search/?q=${encodeURIComponent(originalQuery)}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Tencent search failed: ${response.status}`);
    const data = await response.json();
    return data.data?.normalList?.itemList || [];
  } finally {
    clearTimeout(timeout);
  }
}

function tencentQueryVariants(query) {
  const variants = [cleanText(query)];
  const withoutParticle = cleanText(query).replace(/的/g, '');
  if (withoutParticle && withoutParticle !== variants[0]) variants.push(withoutParticle);
  const compactSeason = cleanText(query).replace(/第\s*(\d+)\s*季/g, '$1');
  if (compactSeason && !variants.includes(compactSeason)) variants.push(compactSeason);
  const trailingSeason = cleanText(query).match(/^(.*?)(\d{1,2})$/);
  if (trailingSeason && Number(trailingSeason[2]) <= 20) {
    const expandedSeason = `${trailingSeason[1].trim()} 第${trailingSeason[2]}季`;
    if (!variants.includes(expandedSeason)) variants.push(expandedSeason);
  }
  const preferredFallback = variants.find((variant) => /第\d+季$/.test(variant))
    || variants.find((variant) => variant !== variants[0]);
  return uniqueNonEmpty([variants[0], preferredFallback]).slice(0, 2);
}

function isTencentProgramAlbum(query, info) {
  const title = cleanText(info.title || '');
  const qqSite = (info.episodeSites || []).find((site) => site.enName === 'qq');
  if (!title || !qqSite || !Array.isArray(qqSite.episodeInfoList) || !qqSite.episodeInfoList.length) return false;
  if (!/(?:综艺|电视剧|纪录片)/.test(info.typeName || '')) return false;
  if (/纯享版?|速看|精彩片段|高光|合集|系列|reaction|二创/i.test(title)) return false;
  if (!info.year && /纯享|系列|合集|片段/.test(`${title} ${info.descrip || ''}`)) return false;
  return tencentTitleMatchScore(query, `${title} ${info.hintWords || ''}`) >= 75;
}

function tencentTitleMatchScore(query, title) {
  const normalizedQuery = normalizeTencentTitle(query);
  const normalizedTitle = normalizeTencentTitle(title);
  if (!normalizedQuery || !normalizedTitle) return 0;
  if (normalizedQuery === normalizedTitle) return 100;
  if (normalizedTitle.includes(normalizedQuery) || normalizedQuery.includes(normalizedTitle)) return 94;

  const baseQuery = tencentBaseTitle(normalizedQuery);
  const baseTitle = tencentBaseTitle(normalizedTitle);
  if (baseQuery === baseTitle && baseQuery.length >= 3) return 90;
  const looseQuery = baseQuery.replace(/的/g, '');
  const looseTitle = baseTitle.replace(/的/g, '');
  if (looseQuery === looseTitle && looseQuery.length >= 3) return 86;
  if (looseQuery.length >= 4 && (looseTitle.includes(looseQuery) || looseQuery.includes(looseTitle))) return 78;
  return 0;
}

function normalizeTencentTitle(value) {
  return normalizeIqiyiTitle(value).replace(/[·:：()（）\-—_]/g, '');
}

function tencentBaseTitle(value) {
  return value
    .replace(/第?\d+季/g, '')
    .replace(/20\d{2}(?:季|年)?/g, '')
    .replace(/\d+$/, '');
}

function tencentResultFromItem(query, item) {
  const info = item.videoInfo || {};
  const title = cleanText(info.title || '');
  if (!title) return null;

  const site = (info.episodeSites || []).find((entry) => entry.enName === 'qq') || {};
  const episodes = (site.episodeInfoList || []).filter((episode) => episode.checkUpTime);
  const mainEpisodes = episodes.filter(isMainEpisode);
  const parsed = mainEpisodes.length ? parsedFromTencentEpisodes(query, info, site, mainEpisodes) : null;
  const episodeLines = mainEpisodes.slice(0, 8).map((episode) => `${episode.checkUpTime} ${episode.title}`).join('；');
  const url = mainEpisodes[0]?.url || `https://v.qq.com/x/search/?q=${encodeURIComponent(query)}`;
  const platforms = platformsFromEpisodeSites(info.episodeSites, '腾讯视频');
  const exactTitle = tencentTitleMatchScore(query, `${title} ${info.hintWords || ''}`) >= 90;
  const recurrence = tencentEpisodeRecurrence(mainEpisodes);
  const confidence = parsed
    ? parsed.scheduleVerified
      ? (exactTitle ? 98 : 92)
      : recurrence >= 2
        ? (exactTitle ? 86 : 80)
        : (exactTitle ? 72 : 65)
    : 20;

  return {
    title,
    url,
    snippet: [info.hintWords, info.subTitle, info.descrip, episodeLines].filter(Boolean).join('。').slice(0, 700),
    source: platforms.join(' / '),
    sources: parsed?.sources || [],
    sourceExcerpt: episodeLines,
    crawled: true,
    verifiedByAi: false,
    confidence,
    parsed,
  };
}

function parsedFromTencentEpisodes(query, info, site, episodes) {
  const title = cleanText(info.title || query);
  const verified = verifiedTencentSchedule(title, info);
  const inferredSchedule = scheduleFromTencentEpisodes(episodes, TENCENT_DEFAULT_TIME);
  const schedule = verified?.schedule || inferredSchedule;
  const startDate = verified?.startDate || schedule.map((slot) => slot.startDate).filter(Boolean).sort()[0] || '';
  const latestEpisode = Math.max(0, ...episodes.map(tencentEpisodeNumber));
  const finished = episodes.some((episode) => /收官|总冠军诞生|最后一期|大结局|终极告别/.test(cleanText(episode.title || '')));
  const estimatedTotal = latestEpisode <= 6 ? 10 : latestEpisode <= 10 ? 12 : latestEpisode + 2;
  const totalEpisodes = Number(verified?.totalEpisodes || (finished ? latestEpisode : estimatedTotal) || 10);
  const officialUrl = episodes.find((episode) => episode.url)?.url || `https://v.qq.com/x/search/?q=${encodeURIComponent(query)}`;
  const sources = uniqueSources([
    { title: '腾讯视频官方节目页', url: officialUrl },
    ...(verified?.sources || []),
  ]);
  return {
    title,
    mediaType: info.typeName === '电视剧' ? 'drama' : 'variety',
    season: info.year ? String(info.year) : seasonFromText(title),
    audience: verified?.audience || '',
    platform: platformsFromEpisodeSites(info.episodeSites, '腾讯视频').join(' / '),
    platforms: platformsFromEpisodeSites(info.episodeSites, '腾讯视频'),
    startDate,
    time: schedule[0]?.time || '',
    schedule,
    totalEpisodes,
    firstEpisode: 1,
    weekday: schedule[0]?.weekday ?? (startDate ? new Date(`${startDate}T00:00:00`).getDay() : ''),
    sources,
    scheduleVerified: Boolean(verified),
    totalEpisodesEstimated: !verified?.totalEpisodes && !finished,
  };
}

function platformsFromEpisodeSites(sites, fallback) {
  const names = (Array.isArray(sites) ? sites : [])
    .map((site) => platformDisplayName(site.showName || site.enName || ''))
    .filter(Boolean);
  return uniqueNonEmpty(names.length ? names : [fallback]);
}

function scheduleFromTencentEpisodes(episodes, defaultTime) {
  const records = [];
  const seen = new Set();
  for (const episode of episodes) {
    const date = episode.checkUpTime;
    const episodeNumber = tencentEpisodeNumber(episode);
    if (!date || !episodeNumber) continue;
    const weekday = new Date(`${date}T00:00:00`).getDay();
    const key = `${episodeNumber}-${date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    records.push({ episodeNumber, date, weekday });
  }
  if (!records.length) return [];

  const recentNumbers = [...new Set(records.map((record) => record.episodeNumber))]
    .sort((a, b) => b - a)
    .slice(0, 4);
  const recentRecords = records.filter((record) => recentNumbers.includes(record.episodeNumber));
  const weekdayCounts = new Map();
  for (const record of recentRecords) {
    if (!weekdayCounts.has(record.weekday)) weekdayCounts.set(record.weekday, new Set());
    weekdayCounts.get(record.weekday).add(record.episodeNumber);
  }
  const recurrenceThreshold = recentNumbers.length >= 2 ? 2 : 1;
  const weekdays = [...weekdayCounts.entries()]
    .filter(([, episodeNumbers]) => episodeNumbers.size >= recurrenceThreshold)
    .map(([weekday]) => weekday);
  const selectedWeekdays = weekdays.length ? weekdays : [records[0].weekday];
  const slots = selectedWeekdays.map((weekday) => {
    const candidates = records.filter((record) => record.weekday === weekday);
    const inferredStarts = candidates
      .map((record) => addDaysKey(record.date, -(record.episodeNumber - 1) * 7))
      .sort();
    return {
      weekday,
      time: defaultTime,
      startDate: inferredStarts[0] || candidates[candidates.length - 1]?.date || '',
      partLabel: '正片',
    };
  }).sort((a, b) => a.startDate.localeCompare(b.startDate));

  const labels = slots.length === 2 ? ['上半期', '下半期'] : slots.length === 3 ? ['上半期', '中期', '下半期'] : [];
  return slots.map((slot, index) => ({ ...slot, partLabel: labels[index] || '正片' }));
}

function verifiedTencentSchedule(title, info) {
  const year = String(info.year || '');
  if (year && year !== '2026') return null;
  const normalizedTitle = normalizeTencentTitle(title);
  const catalog = [
    {
      match: '地球超新鲜', audience: 'SVIP', startDate: '2026-06-27', totalEpisodes: 10,
      schedule: [
        { weekday: 6, time: '12:00', startDate: '2026-06-27', partLabel: '上半期', audience: 'SVIP' },
        { weekday: 0, time: '12:00', startDate: '2026-06-28', partLabel: '下半期', audience: 'SVIP' },
      ],
      sources: [{ title: '腾讯综艺官微：地球超新鲜2定档', url: 'https://weibo.com/3758512144/R4IDJy9nD' }],
    },
    {
      match: '心动的信号第9季', audience: 'SVIP', startDate: '2026-08-03',
      schedule: [
        { weekday: 1, time: '12:00', startDate: '2026-08-03', partLabel: '上半期', audience: 'SVIP' },
        { weekday: 2, time: '12:00', startDate: '2026-08-04', partLabel: '下半期', audience: 'SVIP' },
      ],
      sources: [{ title: '心动的信号9播出排期', url: 'https://ent.sina.cn/2026-07-30/detail-inikpxkk9723002.d.html' }],
    },
    {
      match: '脱口秀和ta的朋友们第3季', audience: '会员', startDate: '2026-06-26', totalEpisodes: 10,
      schedule: [
        { weekday: 5, time: '12:00', startDate: '2026-06-26', partLabel: '上半期', audience: '会员' },
        { weekday: 6, time: '12:00', startDate: '2026-06-27', partLabel: '下半期', audience: '会员' },
      ],
      sources: [{ title: '脱口秀和Ta的朋友们3播出排期', url: 'https://www.weibo.com/ttarticle/p/show?id=2309405314423513546803' }],
    },
    {
      match: '一饭封神第2季', audience: 'SVIP', startDate: '2026-07-29',
      schedule: [
        { weekday: 3, time: '12:00', startDate: '2026-07-29', partLabel: '上半期', audience: 'SVIP' },
        { weekday: 4, time: '12:00', startDate: '2026-07-30', partLabel: '下半期', audience: 'SVIP' },
      ],
      sources: [{ title: '一饭封神2官方排期', url: 'https://www.sina.cn/news/detail/5326465497564744.html' }],
    },
    {
      match: '一路向海的少年', audience: 'SVIP', startDate: '2026-08-06',
      schedule: [{ weekday: 4, time: '12:00', startDate: '2026-08-06', partLabel: '正片', audience: 'SVIP' }],
      sources: [{ title: '一路向海的少年官方排期', url: 'https://weibo.com/2/detail/5336465564501520' }],
    },
  ];
  const entry = catalog.find((item) => normalizedTitle.includes(item.match));
  return entry ? { ...entry } : null;
}

function isMainEpisode(episode) {
  const title = cleanText(episode.title || '');
  if (!title) return false;
  if (/预告|抢先看|加更|特别|游戏|会员版|衍生|花絮|纯享|陪看|直播|彩蛋|reaction|Reaction/i.test(title)) return false;
  if (/福利篇|名场面|集锦|番外|幕后|专访|TOP\s*\d+|段子|切片|精华/.test(title)) return false;
  return /第\s*\d+\s*期(?:[上中下]|[：:（(]|\s*$)/.test(title);
}

function tencentEpisodeNumber(episode) {
  const match = cleanText(episode?.title || '').match(/第\s*(\d+)\s*期/);
  return match ? Number(match[1]) : 0;
}

function tencentEpisodeRecurrence(episodes) {
  const byWeekday = new Map();
  for (const episode of episodes) {
    const episodeNumber = tencentEpisodeNumber(episode);
    if (!episodeNumber || !episode.checkUpTime) continue;
    const weekday = new Date(`${episode.checkUpTime}T00:00:00`).getDay();
    if (!byWeekday.has(weekday)) byWeekday.set(weekday, new Set());
    byWeekday.get(weekday).add(episodeNumber);
  }
  return Math.max(0, ...[...byWeekday.values()].map((episodeNumbers) => episodeNumbers.size));
}

function uniqueSources(sources) {
  const seen = new Set();
  return sources.filter((source) => {
    if (!source?.url || seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  });
}

async function searchMediaWiki(query) {
  const apiUrl = `https://zh.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=5&utf8=1`;
  const response = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'aikanzongyi/1.0 (show schedule search)',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
    },
  });
  if (!response.ok) return [];
  const data = await response.json();
  return (data.query?.search || []).map((item) => ({
    title: item.title,
    url: `https://zh.wikipedia.org/wiki/${encodeURIComponent(toWikiTitle(item.title))}`,
    snippet: cleanHtml(item.snippet || ''),
    source: '维基百科',
  }));
}

function toWikiTitle(value) {
  return String(value || '').trim().replace(/\s+/g, '_');
}

function toTraditionalFallback(value) {
  return String(value || '')
    .replace(/鲜/g, '鮮')
    .replace(/综/g, '綜')
    .replace(/视/g, '視')
    .replace(/剧/g, '劇');
}

async function enrichResults(query, results) {
  const baseline = results.map((result) => enrichFromSnippet(query, result));
  const crawlable = results
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => !result.parsed && isCrawlableUrl(result.url))
    .slice(0, MAX_CRAWL_RESULTS);

  const enriched = await Promise.all(
    crawlable.map(async ({ result, index }) => {
      try {
        return { index, result: await enrichResult(query, result) };
      } catch {
        return { index, result };
      }
    }),
  );

  const byIndex = new Map(enriched.map((item) => [item.index, item.result]));
  return baseline
    .map((result, index) => byIndex.get(index) || result)
    .sort((a, b) => resultScore(b) - resultScore(a));
}

async function enrichResult(query, result) {
  const page = await fetchPageText(result.url);
  const excerpt = relevantExcerpt(page.text, query);
  const parsed = parseScheduleText(`${result.title}\n${result.snippet}\n${excerpt}`, query);
  const confidence = scheduleConfidence(parsed, result, excerpt);
  return {
    ...result,
    snippet: excerpt || result.snippet,
    sourceExcerpt: excerpt,
    crawled: Boolean(excerpt),
    confidence,
    parsed: confidence >= 45 ? parsed : null,
  };
}

function enrichFromSnippet(query, result) {
  if (result.parsed) return result;
  const parsed = parseScheduleText(`${result.title}\n${result.snippet || ''}`, query);
  const confidence = scheduleConfidence(parsed, result, result.snippet || '');
  return {
    ...result,
    confidence,
    parsed: confidence >= 45 ? parsed : null,
  };
}

function resultScore(result) {
  return (result.parsed ? 100 : 0) + (result.crawled ? 20 : 0) + (result.confidence || 0);
}

function isCrawlableUrl(url) {
  if (!/^https?:\/\//i.test(url)) return false;
  if (url.includes('/search_result?')) return false;
  return true;
}

async function fetchPageText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PAGE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (!response.ok) throw new Error(`page fetch failed: ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      throw new Error(`unsupported page type: ${contentType}`);
    }
    return { url: response.url, text: extractReadableText(await response.text()) };
  } finally {
    clearTimeout(timeout);
  }
}

function extractReadableText(html) {
  const headText = [
    ...html.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi),
    ...html.matchAll(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["'][^>]*>/gi),
  ].map((match) => cleanHtml(match[1]));

  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  return cleanText([...headText, cleanHtml(body)].join(' ')).slice(0, 50000);
}

function relevantExcerpt(text, query) {
  const clean = cleanText(text);
  if (!clean) return '';
  const escapedQuery = escapeRegExp(query);
  const pattern = new RegExp(`[^。！？!?；;]{0,80}(?:${escapedQuery}|更新|播出|上线|每周|周[一二三四五六日天]|星期[一二三四五六日天]|第\\s*\\d+\\s*[期集]|上半期|下半期)[^。！？!?；;]{0,160}`, 'g');
  const matches = [...clean.matchAll(pattern)]
    .map((match) => match[0].trim())
    .filter(Boolean);
  return Array.from(new Set(matches)).slice(0, 5).join('。').slice(0, 700);
}

function parseScheduleText(rawText, fallbackTitle) {
  const text = cleanText(rawText);
  if (!text) return null;

  const startDate = normalizeDateFromText(text);
  const time = timeFromText(text);
  const schedule = scheduleFromText(text, startDate, time);
  const weekday = weekdayFromText(text);
  const platforms = platformsFromText(text);

  return {
    title: inferShowTitle(text, fallbackTitle),
    mediaType: /电视剧|剧集|连续剧/.test(text) && !/综艺|节目/.test(text) ? 'drama' : 'variety',
    season: seasonFromText(text),
    platform: platforms.join(' / '),
    platforms,
    startDate,
    time,
    schedule,
    totalEpisodes: totalEpisodesFromText(text),
    firstEpisode: firstEpisodeFromText(text),
    weekday: schedule[0]?.weekday ?? weekday ?? (startDate ? new Date(`${startDate}T00:00:00`).getDay() : ''),
  };
}

function scheduleConfidence(parsed, result, excerpt) {
  if (!parsed) return 0;
  let score = 0;
  if (parsed.startDate) score += 25;
  if (parsed.schedule?.length) score += 30;
  if (parsed.totalEpisodes && parsed.totalEpisodes !== 12) score += 10;
  if (/上半期|下半期|上期|下期|正片/.test(excerpt)) score += 10;
  if (/腾讯视频|芒果|爱奇艺|优酷|微博|官宣|百度百科/.test(`${result.title} ${result.source} ${excerpt}`)) score += 10;
  if (normalizeSearchText(`${result.title} ${excerpt}`).includes(normalizeSearchText(parsed.title))) score += 5;
  return Math.min(score, 95);
}

function normalizeDateFromText(text) {
  const full = text.match(/(20\d{2})\s*(?:年|-|\/|\.)\s*(\d{1,2})\s*(?:月|-|\/|\.)\s*(\d{1,2})\s*(?:日|号)?/);
  if (full) return `${full[1]}-${full[2].padStart(2, '0')}-${full[3].padStart(2, '0')}`;

  const short = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|号)/);
  if (!short) return '';
  return `${new Date().getFullYear()}-${short[1].padStart(2, '0')}-${short[2].padStart(2, '0')}`;
}

function timeFromText(text) {
  const direct = text.match(/(\d{1,2})\s*[:：]\s*(\d{2})/);
  if (direct) return `${direct[1].padStart(2, '0')}:${direct[2]}`;

  const cn = text.match(/(?:晚|晚上|中午|午间)?\s*(\d{1,2})\s*(?:点|时)(?:\s*(\d{1,2})\s*分?)?/);
  if (!cn) return '';
  let hour = Number(cn[1]);
  if (/晚|晚上/.test(cn[0]) && hour < 12) hour += 12;
  return `${String(hour).padStart(2, '0')}:${String(cn[2] || '00').padStart(2, '0')}`;
}

function scheduleFromText(text, startDate, defaultTime) {
  const matches = [...text.matchAll(/(?:每周|周|星期)([一二三四五六日天])/g)];
  const slots = matches
    .map((match, index) => {
      const tailStart = match.index + match[0].match(/^(?:每周|周|星期)[一二三四五六日天]/)[0].length;
      const tailEnd = matches[index + 1]?.index ?? text.length;
      const tail = text.slice(tailStart, tailEnd).split(/[。！？!?；;，,、]/)[0].slice(0, 30);
      if (isNonMainUpdateText(tail)) return null;
      const slotTime = timeFromText(tail) || defaultTime;
      return {
        weekday: weekdayNumber(match[1]),
        time: slotTime,
        partLabel: (tail.match(/上半期|下半期|上期|下期|正片/) || [''])[0],
      };
    })
    .filter(Boolean)
    .filter((slot) => Number.isInteger(slot.weekday))
    .filter((slot, index, list) => list.findIndex((item) => item.weekday === slot.weekday && item.partLabel === slot.partLabel) === index);

  if (!slots.length) return [];

  const anchorWeekday = startDate ? new Date(`${startDate}T00:00:00`).getDay() : slots[0].weekday;
  return slots.map((slot) => ({
    ...slot,
    startDate: startDate ? addDaysKey(startDate, (slot.weekday - anchorWeekday + 7) % 7) : '',
  }));
}

function isNonMainUpdateText(text) {
  return /预告|抢先看|加更|特别|游戏|会员版|衍生|花絮|纯享|陪看|直播|彩蛋|先导片|reaction/i.test(text);
}

function weekdayFromText(text) {
  const match = text.match(/(?:每周|周|星期)([一二三四五六日天])/);
  return match ? weekdayNumber(match[1]) : null;
}

function weekdayNumber(value) {
  return { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }[value];
}

function totalEpisodesFromText(text) {
  const match = text.match(/(?:共|全|总共|一共)\s*(\d{1,3})\s*[期集]/);
  return match ? Number(match[1]) : 12;
}

function firstEpisodeFromText(text) {
  const match = text.match(/第\s*(\d{1,3})\s*[期集]/);
  return match ? Number(match[1]) : 1;
}

function seasonFromText(text) {
  const match = text.match(/第\s*[一二三四五六七八九十百千万\d]+\s*季|20\d{2}\s*(?:季|年)?/);
  return match ? match[0].replace(/\s+/g, '') : '';
}

function platformFromText(text) {
  return platformsFromText(text)[0] || '';
}

function platformsFromText(text) {
  const names = ['腾讯视频', '芒果 TV', '芒果TV', '爱奇艺', '优酷', 'B站', '哔哩哔哩', '浙江卫视', '东方卫视', '湖南卫视', '江苏卫视', '北京卫视', 'Z视介', 'Z 视介']
    .filter((name) => text.includes(name))
    .map(platformDisplayName);
  return uniqueNonEmpty(names);
}

function platformDisplayName(name) {
  const normalized = cleanText(name).replace(/\s+/g, '');
  const map = {
    qq: '腾讯视频',
    qiyi: '爱奇艺',
    iqiyi: '爱奇艺',
    youku: '优酷',
    mgtv: '芒果TV',
    imgo: '芒果TV',
    '芒果TV': '芒果TV',
    '芒果': '芒果TV',
    '芒果ＴＶ': '芒果TV',
    '腾讯视频': '腾讯视频',
    '爱奇艺': '爱奇艺',
    '优酷': '优酷',
    'B站': 'B站',
    '哔哩哔哩': 'B站',
    '浙江卫视': '浙江卫视',
    '东方卫视': '东方卫视',
    '湖南卫视': '湖南卫视',
    '江苏卫视': '江苏卫视',
    '北京卫视': '北京卫视',
    'Z视介': 'Z视介',
  };
  return map[normalized] || cleanText(name);
}

function uniqueNonEmpty(values) {
  return [...new Set(values.map((value) => cleanText(value)).filter(Boolean))];
}

function inferShowTitle(text, fallbackTitle) {
  if (fallbackTitle?.trim()) return fallbackTitle.trim();
  const firstClause = text.split(/[，。；;：:]/)[0] || '';
  return firstClause.replace(/第\s*[一二三四五六七八九十百千万\d]+\s*季.*/, '').trim() || '未命名节目';
}

function addDaysKey(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function prioritizeResults(query, results) {
  const normalizedQuery = normalizePriorityTitle(query);
  const distinctiveQuery = normalizedQuery.length > 3 ? normalizedQuery.slice(2) : normalizedQuery;
  const scored = results.map((item) => {
    const text = normalizePriorityTitle(`${item.title} ${item.snippet}`);
    let score = 0;
    if (text.includes(normalizedQuery)) score += 8;
    if (distinctiveQuery.length >= 2 && text.includes(distinctiveQuery)) score += 4;
    if (/更新|播出|上线|每周|第\s*\d+\s*[期集]|综艺|节目|追更|日历/.test(`${item.title} ${item.snippet}`)) score += 2;
    if (item.source === '小红书' || item.source === 'OpenCLI 小红书') score += 1;
    return { ...item, score };
  });
  const exact = scored.filter((item) => normalizePriorityTitle(`${item.title} ${item.snippet}`).includes(normalizedQuery));
  const relevant = scored.filter((item) => item.score >= 4);
  const pool = exact.length ? exact : relevant;
  return pool
    .sort((a, b) => (b.score - a.score) || (resultScore(b) - resultScore(a)))
    .map(({ score, ...item }) => item);
}

function normalizePriorityTitle(value) {
  return normalizeIqiyiTitle(value).replace(/第(\d+)季/g, '$1');
}

function normalizeSearchText(value) {
  return String(value).toLowerCase().replace(/\s+/g, '');
}

async function searchBing(query, source, hostFilter = '') {
  const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
  const response = await fetch(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
    },
  });
  if (!response.ok) throw new Error(`search failed: ${response.status}`);

  const results = parseBingResults(await response.text(), source);
  return hostFilter ? results.filter((item) => item.url.includes(hostFilter)) : results;
}

async function searchBaidu(query, source) {
  const searchUrl = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`;
  const response = await fetch(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
    },
  });
  if (!response.ok) return [];

  return parseBaiduResults(await response.text(), source);
}

function parseBingResults(html, source) {
  const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/g) || [];
  return blocks
    .map((block) => {
      const link = block.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      const snippet = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
      if (!link) return null;
      return {
        title: cleanHtml(link[2]),
        url: decodeHtml(link[1]),
        snippet: cleanHtml(snippet ? snippet[1] : ''),
        source: sourceForUrl(decodeHtml(link[1]), source),
      };
    })
    .filter((item) => item && item.title && item.url);
}

function parseBaiduResults(html, source) {
  const blocks = html.match(/<div[^>]+(?:class|tpl)="[^"]*(?:result|c-container)[^"]*"[\s\S]*?(?=<div[^>]+(?:class|tpl)="[^"]*(?:result|c-container)|<\/body>)/g) || [];
  const blockResults = blocks
    .map((block) => {
      const link = block.match(/<h3[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/);
      if (!link) return null;
      const snippet = block.match(/<(?:span|div)[^>]+class="[^"]*(?:content-right|c-abstract|c-span-last|c-color-text)[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)>/);
      return {
        title: cleanHtml(link[2]),
        url: decodeHtml(link[1]),
        snippet: cleanHtml(snippet ? snippet[1] : block).slice(0, 260),
        source,
      };
    })
    .filter((item) => item && item.title && item.url);

  const linkResults = [...html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
    .map((match) => ({
      title: cleanHtml(match[2]),
      url: decodeHtml(match[1]),
      snippet: cleanHtml(match[2]),
      source,
    }))
    .filter((item) => item.title && /^https?:\/\//.test(item.url))
    .filter((item) => !item.url.includes('baidu.com/link?url=') || item.title.length > 2);

  return dedupeResults([...blockResults, ...linkResults]);
}

function xiaohongshuShortcut(query) {
  const keyword = `${query} 更新计划 播出时间 第几期 综艺`;
  return {
    title: `在小红书搜索「${query}」`,
    url: `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}`,
    snippet: '打开小红书查看用户笔记和节目讨论，核对后可粘贴内容识别更新计划。',
    source: '小红书',
  };
}

function sourceForUrl(url, fallback) {
  if (url.includes('xiaohongshu.com')) return '小红书';
  if (url.includes('v.qq.com') || url.includes('video.qq.com')) return '腾讯视频';
  if (url.includes('iqiyi.com')) return '爱奇艺';
  if (url.includes('youku.com')) return '优酷';
  if (url.includes('mgtv.com') || url.includes('hunantv.com')) return '芒果TV';
  return fallback;
}

function dedupeResults(results) {
  const seen = new Set();
  return results.filter((item) => {
    const key = item.url.replace(/[?#].*$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanHtml(value) {
  return decodeHtml(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() });
  res.end(JSON.stringify(payload));
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

const port = process.env.PORT || 5173;
const host = process.env.HOST || '127.0.0.1';
server.listen(port, host, () => {
  console.log(`爱看综艺搜索服务：http://${host}:${port}/`);
});
