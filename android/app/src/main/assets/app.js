const STORAGE_KEY = "aikanzongyi.shows.v1";
const STATUS_LABELS = {
  watching: "观看中",
  finished: "已看完",
  dropped: "弃坑",
};
const MEDIA_LABELS = {
  variety: "综艺",
  drama: "电视剧",
};

const SHOW_CATALOG = [
  {
    title: "快乐再出发",
    mediaType: "variety",
    season: "第 3 季",
    platform: "芒果 TV",
    startDate: "2026-06-20",
    time: "12:00",
    totalEpisodes: 12,
    firstEpisode: 1,
    weekday: 6,
  },
  {
    title: "五十公里桃花坞",
    mediaType: "variety",
    season: "第 6 季",
    platform: "腾讯视频",
    startDate: "2026-06-21",
    time: "20:00",
    totalEpisodes: 10,
    firstEpisode: 1,
    weekday: 0,
  },
  {
    title: "乘风",
    mediaType: "variety",
    season: "2026",
    platform: "芒果 TV",
    startDate: "2026-06-19",
    time: "12:00",
    totalEpisodes: 13,
    firstEpisode: 1,
    weekday: 5,
  },
  {
    title: "奔跑吧",
    mediaType: "variety",
    season: "第 14 季",
    platform: "浙江卫视 / Z 视介",
    startDate: "2026-06-13",
    time: "20:20",
    totalEpisodes: 12,
    firstEpisode: 1,
    weekday: 6,
  },
];

const state = {
  view: "week",
  cursor: startOfWeek(new Date()),
  activePage: "calendarPage",
  activeStatus: "watching",
  shows: loadShows(),
  onlineResults: [],
  lastSearchQuery: "",
  searchNotice: "",
};

const els = {
  pageTitle: document.querySelector("#pageTitle"),
  todayButton: document.querySelector("#todayButton"),
  prevPeriod: document.querySelector("#prevPeriod"),
  nextPeriod: document.querySelector("#nextPeriod"),
  currentPeriodLabel: document.querySelector("#currentPeriodLabel"),
  calendarGrid: document.querySelector("#calendarGrid"),
  viewButtons: document.querySelectorAll("[data-view]"),
  navButtons: document.querySelectorAll(".bottom-nav [data-page]"),
  pages: document.querySelectorAll(".page"),
  searchForm: document.querySelector("#searchForm"),
  searchInput: document.querySelector("#searchInput"),
  webActions: document.querySelector("#webActions"),
  baiduLink: document.querySelector("#baiduLink"),
  bingLink: document.querySelector("#bingLink"),
  xhsLink: document.querySelector("#xhsLink"),
  searchStatus: document.querySelector("#searchStatus"),
  resultList: document.querySelector("#resultList"),
  manualForm: document.querySelector("#manualForm"),
  scheduleText: document.querySelector("#scheduleText"),
  recognizePlan: document.querySelector("#recognizePlan"),
  statusButtons: document.querySelectorAll("[data-status]"),
  libraryList: document.querySelector("#libraryList"),
  toast: document.querySelector("#toast"),
  emptyStateTemplate: document.querySelector("#emptyStateTemplate"),
  dayDetailModal: document.querySelector("#dayDetailModal"),
  dayModalTitle: document.querySelector("#dayModalTitle"),
  dayModalWeekday: document.querySelector("#dayModalWeekday"),
  dayModalSummary: document.querySelector("#dayModalSummary"),
  dayEventList: document.querySelector("#dayEventList"),
  dayModalClose: document.querySelector(".modal-close"),
};

seedFirstRun();
bindEvents();
render();

function bindEvents() {
  els.todayButton.addEventListener("click", () => {
    state.cursor = state.view === "week" ? startOfWeek(new Date()) : startOfMonth(new Date());
    renderCalendar();
  });

  els.prevPeriod.addEventListener("click", () => shiftPeriod(-1));
  els.nextPeriod.addEventListener("click", () => shiftPeriod(1));

  els.calendarGrid.addEventListener("click", (event) => {
    const cell = event.target.closest("[data-date-key]");
    if (cell) openDayDetail(parseDate(cell.dataset.dateKey));
  });

  els.dayDetailModal.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-day-modal]")) closeDayDetail();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.dayDetailModal.hidden) closeDayDetail();
  });

  els.viewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      state.cursor = state.view === "week" ? startOfWeek(state.cursor) : startOfMonth(state.cursor);
      renderCalendar();
      syncActiveButtons();
    });
  });

  els.navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.activePage = button.dataset.page;
      render();
    });
  });

  els.statusButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.activeStatus = button.dataset.status;
      renderLibrary();
      syncActiveButtons();
    });
  });

  els.searchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await renderSearchResults(new FormData(els.searchForm).get("query").trim());
  });

  els.manualForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(els.manualForm);
    addShow({
      title: form.get("title").trim(),
      mediaType: form.get("mediaType"),
      season: form.get("season").trim(),
      platform: form.get("platform").trim(),
      startDate: form.get("startDate"),
      time: form.get("time"),
      partLabel: form.get("partLabel").trim(),
      schedule: scheduleFromForm(form),
      totalEpisodes: Number(form.get("totalEpisodes")),
      firstEpisode: Number(form.get("firstEpisode")),
      weekday: Number(form.get("weekday")),
    });
    els.manualForm.reset();
    els.manualForm.elements.time.value = "20:00";
    els.manualForm.elements.totalEpisodes.value = 12;
    els.manualForm.elements.firstEpisode.value = 1;
    els.manualForm.elements.mediaType.value = "variety";
    els.manualForm.elements.partLabel.value = "";
    els.manualForm.elements.secondEnabled.checked = false;
    els.manualForm.elements.secondTime.value = "20:00";
    els.manualForm.elements.secondPartLabel.value = "";
  });

  els.recognizePlan.addEventListener("click", () => {
    const parsed = parseScheduleText(els.scheduleText.value, els.searchInput.value);
    if (!parsed) {
      showToast("先粘贴一段更新计划");
      return;
    }
    fillManualForm(parsed);
    showToast("已预填，可再核对后加入日历");
  });

  els.resultList.addEventListener("click", (event) => {
    const addButton = event.target.closest("[data-add-index]");
    if (addButton) {
      addShow(SHOW_CATALOG[Number(addButton.dataset.addIndex)]);
      return;
    }

    const fillOnlineButton = event.target.closest("[data-fill-online-index]");
    if (fillOnlineButton) {
      fillFromOnlineResult(Number(fillOnlineButton.dataset.fillOnlineIndex));
      return;
    }

    const addOnlineButton = event.target.closest("[data-add-online-index]");
    if (addOnlineButton) {
      addFromOnlineResult(Number(addOnlineButton.dataset.addOnlineIndex));
      return;
    }

    const fillSearchButton = event.target.closest("[data-fill-search-query]");
    if (fillSearchButton) {
      fillSearchQuery(fillSearchButton.dataset.fillSearchQuery);
    }
  });

  els.libraryList.addEventListener("click", (event) => {
    const id = event.target.closest("[data-id]")?.dataset.id;
    if (!id) return;

    const moveButton = event.target.closest("[data-move]");
    if (moveButton) {
      updateShow(id, { status: moveButton.dataset.move });
      return;
    }

    if (event.target.closest("[data-delete]")) {
      deleteShow(id);
    }
  });
}

function render() {
  syncActiveButtons();
  renderCalendar();
  renderLibrary();
}

function syncActiveButtons() {
  els.todayButton.hidden = state.activePage !== "calendarPage";

  els.pages.forEach((page) => {
    page.classList.toggle("is-active", page.id === state.activePage);
    if (page.id === state.activePage) els.pageTitle.textContent = page.dataset.title;
  });

  els.navButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.page === state.activePage);
  });

  els.viewButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.view);
  });

  els.statusButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.status === state.activeStatus);
  });
}

function renderCalendar() {
  const dates = state.view === "week" ? weekDates(state.cursor) : monthDates(state.cursor);
  const todayKey = toDateKey(new Date());
  const cursorMonth = state.cursor.getMonth();

  els.currentPeriodLabel.textContent = state.view === "week" ? weekLabel(dates) : monthLabel(state.cursor);
  els.calendarGrid.className = `calendar-grid ${state.view}`;
  els.calendarGrid.replaceChildren(
    ...dates.map((date) => {
      const dateKey = toDateKey(date);
      const events = eventsForDate(date);
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "day-cell";
      cell.dataset.dateKey = dateKey;
      cell.setAttribute("aria-label", `${monthDayLabel(date)}，${events.length ? `${events.length}档节目` : "暂无更新"}`);
      cell.classList.toggle("is-today", dateKey === todayKey);
      cell.classList.toggle("is-outside", state.view === "month" && date.getMonth() !== cursorMonth);
      cell.classList.toggle("has-events", events.length > 0);
      cell.classList.toggle("is-weekend", date.getDay() === 0 || date.getDay() === 6);

      const number = document.createElement("div");
      number.className = "day-number";
      number.innerHTML = `<span class="day-number-value">${dayCellLabel(date)}</span>${dateKey === todayKey ? '<span class="today-pill">今天</span>' : ""}`;
      cell.append(number);

      const visibleEvents = state.view === "month" ? events.slice(0, 2) : events;
      visibleEvents.forEach((item) => {
        const chip = document.createElement("div");
        chip.className = "episode-chip";
        chip.innerHTML = state.view === "month"
          ? `<span class="episode-title">${escapeHtml(item.title)}</span>`
          : `
              <span class="episode-title">${escapeHtml(item.title)}</span>
              <span class="episode-meta">${escapeHtml(item.time)} · 第 ${item.episode} ${episodeUnit(item)}${item.partLabel ? ` · ${escapeHtml(item.partLabel)}` : ""}${item.audience ? ` · ${escapeHtml(item.audience)}` : ""} · ${escapeHtml(platformLabel(item) || "未填写平台")}</span>
            `;
        cell.append(chip);
      });

      if (state.view === "month" && events.length > visibleEvents.length) {
        const more = document.createElement("span");
        more.className = "day-more-count";
        more.textContent = `还有 ${events.length - visibleEvents.length} 档`;
        cell.append(more);
      }

      return cell;
    }),
  );
}

function openDayDetail(date) {
  const events = eventsForDate(date);
  els.dayModalTitle.textContent = monthDayLabel(date);
  els.dayModalWeekday.textContent = `${date.getFullYear()}年 · ${weekdayName(date.getDay())}`;
  els.dayModalSummary.textContent = events.length ? `${events.length} 档节目将在这一天更新` : "这一天暂无节目更新";

  if (!events.length) {
    const empty = document.createElement("div");
    empty.className = "day-modal-empty";
    empty.innerHTML = "<strong>空闲的一天</strong><p>添加节目后，更新时间会出现在这里。</p>";
    els.dayEventList.replaceChildren(empty);
  } else {
    els.dayEventList.replaceChildren(...events.map(renderDayEvent));
  }

  els.dayDetailModal.hidden = false;
  document.body.classList.add("modal-open");
  requestAnimationFrame(() => els.dayDetailModal.classList.add("is-open"));
  els.dayModalClose.focus();
}

function closeDayDetail() {
  els.dayDetailModal.classList.remove("is-open");
  document.body.classList.remove("modal-open");
  window.setTimeout(() => {
    els.dayDetailModal.hidden = true;
  }, 180);
}

function renderDayEvent(item) {
  const event = document.createElement("article");
  event.className = "day-event";
  event.innerHTML = `
    <div class="day-event-time">${escapeHtml(item.time)}</div>
    <div class="day-event-content">
      <div class="day-event-heading">
        <h3>${escapeHtml(item.title)}</h3>
        <span>${escapeHtml(item.season || "当前季")}</span>
      </div>
      <p>第 ${item.episode} ${episodeUnit(item)}${item.partLabel ? ` · ${escapeHtml(item.partLabel)}` : ""}${item.audience ? ` · ${escapeHtml(item.audience)}` : ""}</p>
      <div class="platform-line">
        <span>播放平台</span>
        <strong>${escapeHtml(platformLabel(item) || "未填写平台")}</strong>
      </div>
    </div>
  `;
  return event;
}

async function renderSearchResults(query) {
  const cleanQuery = query || "";
  state.lastSearchQuery = cleanQuery;
  state.onlineResults = [];
  state.searchNotice = "";
  els.webActions.hidden = !cleanQuery || isNativeSearchAvailable();
  els.searchStatus.textContent = "";

  if (cleanQuery) {
    const searchText = buildSearchText(cleanQuery);
    const xhsText = `${cleanQuery} 更新计划 播出时间 第几期 综艺`;
    els.baiduLink.href = `https://www.baidu.com/s?wd=${encodeURIComponent(searchText)}`;
    els.bingLink.href = `https://www.bing.com/search?q=${encodeURIComponent(searchText)}`;
    els.xhsLink.href = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(xhsText)}`;
    els.searchStatus.textContent = "正在查找网页候选...";
  }

  const results = SHOW_CATALOG.filter((show) => {
    const haystack = `${show.title} ${show.season} ${platformLabel(show)} ${MEDIA_LABELS[show.mediaType]}`.toLowerCase();
    return !cleanQuery || haystack.includes(cleanQuery.toLowerCase());
  });

  if (cleanQuery) {
    const onlinePayload = await searchOnline(cleanQuery);
    state.onlineResults = onlinePayload.results;
    state.searchNotice = onlinePayload.notice;
    const noticeText = state.searchNotice ? `；${state.searchNotice}` : "";
    els.searchStatus.textContent = state.onlineResults.length
      ? `找到 ${results.length} 个本地候选和 ${state.onlineResults.length} 个网页候选${noticeText}`
      : results.length
        ? `已显示本地候选；网页候选暂时不可用，可点上方链接核对。${noticeText}`
        : `${searchUnavailableText()}${noticeText}`;
  }

  if (!results.length && !state.onlineResults.length) {
    els.resultList.replaceChildren(
      cleanQuery
        ? renderSearchAssistCard(cleanQuery)
        : emptyState("没有本地候选", "可以点上方联网查询，再用手动添加保存更新计划。"),
    );
    return;
  }

  els.resultList.replaceChildren(
    ...results.map((show) => {
      const index = SHOW_CATALOG.indexOf(show);
      const card = document.createElement("article");
      card.className = "result-card";
      card.innerHTML = `
        <div class="card-head">
          <div>
            <h2 class="card-title">${escapeHtml(show.title)} ${escapeHtml(show.season)}</h2>
            <p class="card-meta">${MEDIA_LABELS[show.mediaType]} · ${escapeHtml(platformLabel(show))} · ${weekdayName(show.weekday)} ${escapeHtml(show.time)}</p>
          </div>
          <span class="tag">${show.totalEpisodes} ${episodeUnit(show)}</span>
        </div>
        <p class="summary-line">从 ${show.startDate} 起更新，日历会显示到最后一期后自动停止。</p>
        <div class="card-actions">
          <button class="primary-button" data-add-index="${index}" type="button">加入日历</button>
          <a class="ghost-button link-button" href="https://www.baidu.com/s?wd=${encodeURIComponent(`${show.title} ${show.season} 更新计划`)}" target="_blank" rel="noreferrer">核对来源</a>
        </div>
      `;
      return card;
    }),
    ...state.onlineResults.map(renderOnlineResult),
    ...(cleanQuery ? [renderSearchAssistCard(cleanQuery)] : []),
  );
}

function buildSearchText(query) {
  return `${query} 更新计划 播出时间 更新时间 第几期 每周几 共多少期 综艺`;
}

function dayCellLabel(date) {
  if (state.view === "week") {
    return `${weekdayName(date.getDay())} ${date.getMonth() + 1}/${date.getDate()}`;
  }
  return date.getDate();
}

function monthDayLabel(date) {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function searchUnavailableText() {
  if (isNativeSearchAvailable()) {
    return "没有抓到可靠更新计划；可以先填入节目名，稍后补充播出信息。";
  }
  return location.protocol === "file:"
    ? "当前是直接打开文件模式，不能自动抓网页候选；可用下方来源搜索或填入表单。"
    : "没有抓到可靠网页候选；可用下方来源搜索，核对后填入表单。";
}

async function searchOnline(query) {
  const remoteEndpoint = configuredSearchEndpoint(query);
  if (remoteEndpoint) {
    const remoteResults = await fetchSearchEndpoint(remoteEndpoint);
    if (remoteResults.results.length || remoteResults.notice) return remoteResults;
  }

  if (isNativeSearchAvailable()) {
    return { results: await searchWithAndroidBridge(query), notice: "" };
  }

  if (location.protocol === "file:") return { results: [], notice: "" };

  return fetchSearchEndpoint(`/api/search?q=${encodeURIComponent(query)}`);
}

function configuredSearchEndpoint(query) {
  const defaultFileModeBase = location.protocol === "file:" ? "https://aikanzongyi.onrender.com" : "";
  const base = window.SEARCH_API_BASE || localStorage.getItem("aikanzongyi.searchApiBase") || defaultFileModeBase;
  if (!base.trim()) return "";
  return `${base.replace(/\/$/, "")}/api/search?q=${encodeURIComponent(query)}`;
}

async function fetchSearchEndpoint(endpoint) {
  try {
    const response = await fetch(endpoint);
    if (!response.ok) return { results: [], notice: "" };
    const data = await response.json();
    return {
      results: Array.isArray(data.results) ? data.results : [],
      notice: [data.meta?.ai?.message, data.meta?.crawler?.message, data.meta?.opencli?.ok === false ? data.meta.opencli.message : ""].filter(Boolean).join("；"),
    };
  } catch {
    return { results: [], notice: "" };
  }
}

function searchWithAndroidBridge(query) {
  return new Promise((resolve) => {
    const callbackName = `__searchCallback_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const timeout = setTimeout(() => {
      delete window[callbackName];
      resolve([]);
    }, 15000);

    window[callbackName] = (payload) => {
      clearTimeout(timeout);
      delete window[callbackName];
      try {
        const data = typeof payload === "string" ? JSON.parse(payload) : payload;
        resolve(Array.isArray(data.results) ? data.results : []);
      } catch {
        resolve([]);
      }
    };

    try {
      window.AndroidSearch.search(query, callbackName);
    } catch {
      clearTimeout(timeout);
      delete window[callbackName];
      resolve([]);
    }
  });
}

function parsedOnlineResult(result) {
  return result.parsed || parseScheduleText(`${result.title} ${result.snippet || ""} ${result.sourceExcerpt || ""}`, state.lastSearchQuery);
}

function platformLabel(show) {
  return platformsForShow(show).join(" / ") || show.platform || "";
}

function platformsForShow(show) {
  if (Array.isArray(show?.platforms) && show.platforms.length) {
    return [...new Set(show.platforms.map((item) => String(item).trim()).filter(Boolean))];
  }
  return String(show?.platform || "")
    .split(/[、/，,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function renderOnlineResult(result, index) {
  const parsed = parsedOnlineResult(result);
  const canAdd = Boolean(
    parsed?.title
      && parsed?.startDate
      && parsed?.schedule?.length
      && parsed.schedule.every((slot) => /^([01]\d|2[0-3]):[0-5]\d$/.test(slot.time || "")),
  );
  const scheduleText = parsed?.schedule?.length
    ? parsed.schedule.map((slot) => `${weekdayName(slot.weekday)} ${slot.time}${slot.partLabel ? ` · ${slot.partLabel}` : ""}`).join(" / ")
    : "";
  const onlinePlatformText = platformLabel(parsed || result) || result.source || "网页";
  const confidenceText = result.confidence ? ` · 置信度 ${result.confidence}` : "";
  const crawlText = result.verifiedByAi ? "AI 联网核验" : result.crawled ? "已抓取正文" : "网页候选";
  const audienceText = parsed?.audience ? ` · ${escapeHtml(parsed.audience)}` : "";
  const sourceLinks = Array.isArray(result.sources) && result.sources.length
    ? `<div class="source-grid">${result.sources.slice(0, 3).map((source) => `<a class="ghost-button link-button" href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.title || "核验来源")}</a>`).join("")}</div>`
    : "";
  const card = document.createElement("article");
  card.className = "result-card online-result";
  card.innerHTML = `
    <div class="card-head">
      <div>
        <h2 class="card-title">${escapeHtml(result.title)}</h2>
        <p class="card-meta">${escapeHtml(onlinePlatformText)}${audienceText} · ${parsed?.startDate ? `识别到 ${parsed.startDate}${scheduleText ? ` · ${scheduleText}` : ""}` : "待核对更新计划"}${confidenceText}</p>
      </div>
      <span class="tag">${crawlText}</span>
    </div>
    <p class="summary-line">${escapeHtml(result.snippet || "打开来源页核对播出时间后，可以粘贴文字识别。")}</p>
    ${sourceLinks}
    <div class="card-actions">
      <button class="primary-button" data-add-online-index="${index}" ${canAdd ? "" : "disabled"} type="button">加入日历</button>
      <button class="ghost-button" data-fill-online-index="${index}" type="button">填入表单</button>
    </div>
    ${sourceLinks ? "" : `<a class="ghost-button link-button" href="${escapeHtml(result.url)}" target="_blank" rel="noreferrer">打开来源核对</a>`}
  `;
  return card;
}

function renderSearchAssistCard(query) {
  const searchText = buildSearchText(query);
  const xhsText = `${query} 更新计划 播出时间 第几期 综艺`;
  const sourceLinks = isNativeSearchAvailable()
    ? ""
    : `
      <div class="source-grid">
        <a class="ghost-button link-button" href="https://www.baidu.com/s?wd=${encodeURIComponent(searchText)}" target="_blank" rel="noreferrer">百度</a>
        <a class="ghost-button link-button" href="https://www.bing.com/search?q=${encodeURIComponent(searchText)}" target="_blank" rel="noreferrer">Bing</a>
        <a class="ghost-button link-button" href="https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(xhsText)}" target="_blank" rel="noreferrer">小红书</a>
      </div>
    `;
  const card = document.createElement("article");
  card.className = "result-card search-assist-card";
  card.innerHTML = `
    <div class="card-head">
      <div>
        <h2 class="card-title">继续搜索「${escapeHtml(query)}」</h2>
        <p class="card-meta">${location.protocol === "file:" ? "本地文件模式" : "来源核对"} · 可填入表单后补充更新计划</p>
      </div>
      <span class="tag">搜索</span>
    </div>
    <p class="summary-line">${isNativeSearchAvailable() ? "App 已经在互联网抓取过候选；如果没有可靠结果，通常是公开页面没有直接写出更新日期。" : "如果候选里没有这个节目，通常是本地库还没收录，或网页结果没有直接写出更新日期。先打开来源核对，再把节目名和播出信息填进表单即可。"}</p>
    ${sourceLinks}
    <button class="primary-button" data-fill-search-query="${escapeHtml(query)}" type="button">用这个节目名填表</button>
  `;
  return card;
}

function isNativeSearchAvailable() {
  return Boolean(window.AndroidSearch?.search);
}

function fillSearchQuery(query) {
  els.manualForm.elements.title.value = query;
  els.manualForm.elements.mediaType.value = "variety";
  document.querySelector(".manual-panel").open = true;
  showToast("已填入节目名，核对更新时间后即可加入");
}

function fillFromOnlineResult(index) {
  const result = state.onlineResults[index];
  if (!result) return;
  const parsed = parsedOnlineResult(result);
  els.scheduleText.value = `${result.title}\n${result.snippet || ""}\n${result.sourceExcerpt || ""}`.trim();
  fillManualForm(parsed);
  document.querySelector(".manual-panel").open = true;
  showToast("已从网页候选预填，请核对后加入");
}

function addFromOnlineResult(index) {
  const result = state.onlineResults[index];
  if (!result) return;
  const parsed = parsedOnlineResult(result);
  addShow(parsed);
}

function renderLibrary() {
  const shows = state.shows.filter((show) => show.status === state.activeStatus);

  if (!shows.length) {
    els.libraryList.replaceChildren(emptyState("这里还没有综艺", "添加综艺后会先进入观看中，可以再移到已看完或弃坑。"));
    return;
  }

  els.libraryList.replaceChildren(
    ...shows.map((show) => {
      const card = document.createElement("article");
      card.className = "library-card";
      card.dataset.id = show.id;
      card.innerHTML = `
        <div class="card-head">
          <div>
            <h2 class="card-title">${escapeHtml(show.title)} ${escapeHtml(show.season || "")}</h2>
            <p class="card-meta">${MEDIA_LABELS[show.mediaType] || "综艺"} · ${escapeHtml(platformLabel(show) || "未填写平台")}${show.audience ? ` · ${escapeHtml(show.audience)}` : ""} · ${weekdayName(show.weekday)} ${escapeHtml(show.time)}</p>
          </div>
          <span class="tag">${STATUS_LABELS[show.status]}</span>
        </div>
        <p class="summary-line">${show.startDate} 开始 · 共 ${show.totalEpisodes} ${episodeUnit(show)} · ${completionText(show)}</p>
        <div class="move-actions">
          ${statusButton(show, "watching")}
          ${statusButton(show, "finished")}
          ${statusButton(show, "dropped")}
        </div>
        <button class="danger-button" data-delete type="button">一键删除</button>
      `;
      return card;
    }),
  );
}

function statusButton(show, status) {
  const disabled = show.status === status ? "disabled" : "";
  return `<button class="ghost-button" data-move="${status}" ${disabled} type="button">${STATUS_LABELS[status]}</button>`;
}

function addShow(show) {
  if (!show.title || !show.startDate || !show.totalEpisodes) {
    showToast("请补全综艺名、首更日期和总期数");
    return;
  }

  const duplicate = state.shows.some(
    (item) => item.title === show.title
      && item.season === show.season
      && item.startDate === show.startDate
      && (item.audience || "") === (show.audience || ""),
  );
  if (duplicate) {
    showToast("这个综艺已经在日历里了");
    return;
  }

  state.shows.push({
    id: crypto.randomUUID(),
    title: show.title,
    mediaType: show.mediaType || "variety",
    season: show.season || "",
    platform: platformLabel(show),
    platforms: platformsForShow(show),
    audience: show.audience || "",
    sources: Array.isArray(show.sources) ? show.sources : [],
    startDate: show.startDate,
    time: show.time || "20:00",
    weekday: Number(show.weekday),
    partLabel: show.partLabel || "",
    schedule: normalizeSchedule(show),
    totalEpisodes: Number(show.totalEpisodes),
    firstEpisode: Number(show.firstEpisode || 1),
    status: "watching",
    createdAt: new Date().toISOString(),
  });
  saveShows();
  render();
  showToast("已加入更新日历");
}

function updateShow(id, patch) {
  state.shows = state.shows.map((show) => (show.id === id ? { ...show, ...patch } : show));
  saveShows();
  render();
  showToast("已更新收藏状态");
}

function deleteShow(id) {
  state.shows = state.shows.filter((show) => show.id !== id);
  saveShows();
  render();
  showToast("已从日历和收藏夹删除");
}

function eventsForDate(date) {
  return state.shows
    .filter((show) => show.status === "watching")
    .flatMap((show) => eventsForShowDate(show, date))
    .filter(Boolean)
    .sort((a, b) => a.time.localeCompare(b.time));
}

function eventsForShowDate(show, date) {
  return scheduleForShow(show).map((slot) => {
    const episode = episodeForDate(show, slot, date);
    return episode ? { ...show, ...slot, episode } : null;
  });
}

function episodeForDate(show, slot, date) {
  const start = parseDate(slot.startDate || show.startDate);
  if (date < start || date.getDay() !== Number(slot.weekday)) return null;

  const weeks = Math.floor(daysBetween(start, date) / 7);
  const episode = show.firstEpisode + weeks;
  const lastEpisode = show.firstEpisode + show.totalEpisodes - 1;
  return episode <= lastEpisode ? episode : null;
}

function completionText(show) {
  const dates = scheduleForShow(show).map((slot) => addDays(parseDate(slot.startDate || show.startDate), (show.totalEpisodes - 1) * 7));
  const lastDate = new Date(Math.max(...dates.map((date) => date.getTime())));
  return `预计 ${toDateKey(lastDate)} 完结`;
}

function episodeUnit(show) {
  return show.mediaType === "drama" ? "集" : "期";
}

function parseScheduleText(rawText, fallbackTitle) {
  const text = rawText.trim();
  if (!text) return null;

  const compact = text.replace(/\s+/g, " ");
  const date = normalizeDate(compact);
  const time = compact.match(/(\d{1,2})[:：点时](\d{2})?/) || [];
  const total = compact.match(/(?:共|全|总共)?\s*(\d{1,3})\s*[期集]/);
  const firstEpisode = compact.match(/第\s*(\d{1,3})\s*[期集]/);
  const weekday = weekdayFromText(compact);
  const season = compact.match(/第\s*([一二三四五六七八九十百千万\d]+)\s*季|20\d{2}/);
  const inferredTitle = inferTitle(compact, fallbackTitle);
  const platforms = platformsFromText(compact);

  return {
    title: inferredTitle,
    mediaType: /剧|集/.test(compact) && !/综艺|节目/.test(compact) ? "drama" : "variety",
    season: season ? season[0].replace(/\s+/g, " ") : "",
    platform: platforms.join(" / "),
    platforms,
    startDate: date,
    time: time[1] ? `${time[1].padStart(2, "0")}:${(time[2] || "00").padStart(2, "0")}` : "",
    schedule: scheduleFromText(compact, date, time),
    totalEpisodes: total ? Number(total[1]) : 12,
    firstEpisode: firstEpisode ? Number(firstEpisode[1]) : 1,
    weekday: weekday ?? (date ? parseDate(date).getDay() : ""),
  };
}

function fillManualForm(data) {
  Object.entries(data).forEach(([key, value]) => {
    if (els.manualForm.elements[key] && value !== undefined && value !== "") {
      els.manualForm.elements[key].value = value;
    }
  });
  if (Array.isArray(data.schedule) && data.schedule.length) {
    const first = data.schedule[0];
    els.manualForm.elements.weekday.value = first.weekday;
    els.manualForm.elements.time.value = first.time || data.time || "20:00";
    els.manualForm.elements.partLabel.value = first.partLabel || "";

    const second = data.schedule[1];
    if (second) {
      els.manualForm.elements.secondEnabled.checked = true;
      els.manualForm.elements.secondWeekday.value = second.weekday;
      els.manualForm.elements.secondTime.value = second.time || first.time || "20:00";
      els.manualForm.elements.secondPartLabel.value = second.partLabel || "";
    }
  }
}

function scheduleForShow(show) {
  return Array.isArray(show.schedule) && show.schedule.length ? show.schedule : normalizeSchedule(show);
}

function normalizeSchedule(show) {
  const base = {
    weekday: Number(show.weekday),
    time: show.time || "20:00",
    startDate: show.startDate,
    partLabel: show.partLabel || "",
    audience: show.audience || "",
  };
  if (!Array.isArray(show.schedule) || !show.schedule.length) return [base];
  return show.schedule.map((slot) => ({
    weekday: Number(slot.weekday ?? base.weekday),
    time: slot.time || base.time,
    startDate: slot.startDate || base.startDate,
    partLabel: slot.partLabel || "",
    audience: slot.audience || base.audience,
  }));
}

function scheduleFromForm(form) {
  const startDate = form.get("startDate");
  const weekday = Number(form.get("weekday"));
  const first = {
    weekday,
    time: form.get("time"),
    startDate,
    partLabel: form.get("partLabel").trim(),
  };
  if (form.get("secondEnabled") !== "on") return [first];

  const secondWeekday = Number(form.get("secondWeekday"));
  return [
    first,
    {
      weekday: secondWeekday,
      time: form.get("secondTime") || first.time,
      startDate: toDateKey(addDays(parseDate(startDate), forwardWeekdayOffset(weekday, secondWeekday))),
      partLabel: form.get("secondPartLabel").trim(),
    },
  ];
}

function scheduleFromText(text, startDate, timeMatch) {
  const defaultTime = timeMatch[1] ? `${timeMatch[1].padStart(2, "0")}:${(timeMatch[2] || "00").padStart(2, "0")}` : "";
  const matches = [...text.matchAll(/(?:周|星期)([一二三四五六日天])([^，。；;、]*)/g)];
  const slots = matches
    .map((match) => ({
      weekday: { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }[match[1]],
      time: defaultTime,
      partLabel: updatePartLabel(match[2]),
    }))
    .filter((slot) => slot.partLabel !== null)
    .filter((slot, index, list) => list.findIndex((item) => item.weekday === slot.weekday && item.partLabel === slot.partLabel) === index);

  if (!slots.length) return [];

  const anchorWeekday = startDate ? parseDate(startDate).getDay() : slots[0].weekday;
  return slots.map((slot) => ({
    ...slot,
    startDate: startDate ? toDateKey(addDays(parseDate(startDate), forwardWeekdayOffset(anchorWeekday, slot.weekday))) : "",
  }));
}

function updatePartLabel(text) {
  if (/预告|抢先看|加更|特别|游戏|会员版|衍生|花絮|纯享|陪看|直播|彩蛋|先导片|reaction/i.test(text)) return null;
  return (text.match(/上半期|下半期|上期|下期|正片/) || [""])[0];
}

function forwardWeekdayOffset(fromWeekday, toWeekday) {
  return (toWeekday - fromWeekday + 7) % 7;
}

function inferTitle(text, fallbackTitle) {
  if (fallbackTitle.trim()) return fallbackTitle.trim();
  const firstClause = text.split(/[，,。；;]/)[0];
  return firstClause.replace(/第\s*[一二三四五六七八九十百千万\d]+\s*季.*/, "").trim() || "未命名节目";
}

function normalizeDate(text) {
  const full = text.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (full) return `${full[1]}-${full[2].padStart(2, "0")}-${full[3].padStart(2, "0")}`;

  const short = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/);
  if (!short) return "";
  return `${new Date().getFullYear()}-${short[1].padStart(2, "0")}-${short[2].padStart(2, "0")}`;
}

function weekdayFromText(text) {
  const match = text.match(/周([一二三四五六日天])|星期([一二三四五六日天])/);
  if (!match) return null;
  const value = match[1] || match[2];
  return { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }[value];
}

function platformFromText(text) {
  return platformsFromText(text)[0] || "";
}

function platformsFromText(text) {
  const candidates = ["腾讯视频", "芒果 TV", "芒果TV", "爱奇艺", "优酷", "B站", "哔哩哔哩", "浙江卫视", "东方卫视", "湖南卫视", "江苏卫视", "北京卫视", "Z视介", "Z 视介"];
  const normalized = candidates
    .filter((name) => text.includes(name))
    .map((name) => {
      if (name === "芒果 TV") return "芒果TV";
      if (name === "哔哩哔哩") return "B站";
      if (name === "Z 视介") return "Z视介";
      return name;
    });
  return [...new Set(normalized)];
}

function shiftPeriod(direction) {
  state.cursor =
    state.view === "week" ? addDays(state.cursor, direction * 7) : new Date(state.cursor.getFullYear(), state.cursor.getMonth() + direction, 1);
  renderCalendar();
}

function monthDates(date) {
  const first = startOfWeek(startOfMonth(date));
  return Array.from({ length: 42 }, (_, index) => addDays(first, index));
}

function weekDates(date) {
  const first = startOfWeek(date);
  return Array.from({ length: 7 }, (_, index) => addDays(first, index));
}

function startOfWeek(date) {
  const copy = stripTime(date);
  const offset = (copy.getDay() + 6) % 7;
  return addDays(copy, -offset);
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addDays(date, days) {
  const copy = stripTime(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function stripTime(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysBetween(start, end) {
  return Math.round((stripTime(end) - stripTime(start)) / 86400000);
}

function weekLabel(dates) {
  const first = dates[0];
  const last = dates[6];
  if (first.getMonth() === last.getMonth()) {
    return `${first.getFullYear()}年${first.getMonth() + 1}月 ${first.getDate()}-${last.getDate()}日`;
  }
  return `${first.getMonth() + 1}/${first.getDate()}-${last.getMonth() + 1}/${last.getDate()}`;
}

function monthLabel(date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function weekdayName(day) {
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][Number(day)];
}

function loadShows() {
  try {
    const shows = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    const migrated = shows.map(migrateVerifiedSchedule);
    const unique = new Map();
    migrated.forEach((show) => {
      const key = [show.title, show.season, show.startDate, show.audience || ""].join("|");
      if (!unique.has(key)) unique.set(key, show);
    });
    return [...unique.values()];
  } catch {
    return [];
  }
}

function migrateVerifiedSchedule(show) {
  const title = `${show.title || ""} ${show.season || ""}`;
  if (!title.includes("地球超新鲜") || (!/第?\s*2\s*季|2026/.test(title) && show.startDate < "2026-01-01")) return show;
  return {
    ...show,
    title: "地球超新鲜",
    mediaType: "variety",
    season: "第2季",
    platform: "腾讯视频",
    platforms: ["腾讯视频"],
    audience: "SVIP",
    startDate: "2026-06-27",
    time: "12:00",
    weekday: 6,
    partLabel: "上半期",
    schedule: [
      { weekday: 6, time: "12:00", startDate: "2026-06-27", partLabel: "上半期", audience: "SVIP" },
      { weekday: 0, time: "12:00", startDate: "2026-06-28", partLabel: "下半期", audience: "SVIP" },
    ],
    totalEpisodes: 10,
    firstEpisode: 1,
  };
}

function saveShows() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.shows));
}

function seedFirstRun() {
  if (state.shows.length) return;
  state.shows = SHOW_CATALOG.slice(0, 2).map((show) => ({
    ...show,
    id: crypto.randomUUID(),
    status: "watching",
    createdAt: new Date().toISOString(),
  }));
  saveShows();
}

function emptyState(title, body) {
  const node = els.emptyStateTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector("strong").textContent = title;
  node.querySelector("p").textContent = body;
  return node;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("is-visible"), 1800);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("./service-worker.js?v=15");
}
