const state = {
  rawRows: [],
  classifiedRows: [],
  filteredRows: [],
  excludedRows: [],
  currentStart: "",
  currentEnd: "",
  compareStart: "",
  compareEnd: "",
  pushCategoryFilter: "all",
  pushBucketFilter: "all",
  pushSearch: "",
  zeroRowFilter: "show",
};

const overviewMetrics = [
  { label: "Sessions", key: "sessions", type: "number", inverse: false },
  { label: "Users / UV", key: "users", type: "number", inverse: false },
  { label: "Purchasers", key: "purchasers", type: "number", inverse: false },
  { label: "Revenue", key: "revenue", type: "currency", inverse: false },
];

const pushCategoryLabelMap = {
  all: "All",
  manual: "Manual Push",
  automation: "Automation Push",
};

const pushBucketLabelMap = {
  all: "All Push Names",
  current: "Current Push",
  past: "Past Push",
  automation: "Automation Push",
  future: "Future Push",
  invalid: "Invalid Manual Name",
};

document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  await initializePushData();
});

function bindEvents() {
  document.getElementById("applyDateRange")?.addEventListener("click", () => {
    syncDateInputsToState();
    applyFiltersAndRender();
  });

  document.getElementById("useLatestWeek")?.addEventListener("click", () => {
    setLatestCompleteWeekRange();
    syncStateToDateInputs();
    applyFiltersAndRender();
  });

  document.getElementById("pushCategoryFilter")?.addEventListener("change", (e) => {
    state.pushCategoryFilter = e.target.value;
    applyFiltersAndRender();
  });

  document.getElementById("pushBucketFilter")?.addEventListener("change", (e) => {
    state.pushBucketFilter = e.target.value;
    applyFiltersAndRender();
  });

  document.getElementById("pushSearch")?.addEventListener("input", (e) => {
    state.pushSearch = e.target.value.trim().toLowerCase();
    applyFiltersAndRender();
  });

  document.getElementById("zeroRowFilter")?.addEventListener("change", (e) => {
    state.zeroRowFilter = e.target.value;
    applyFiltersAndRender();
  });
}

async function initializePushData() {
  try {
    const pathCandidates = [
      "./data/current.csv",
      "./data/raw/current.csv",
      "./data/raw/push.csv",
    ];

    let text = null;
    let usedPath = "";

    for (const path of pathCandidates) {
      try {
        const response = await fetch(path, { cache: "no-store" });
        if (response.ok) {
          text = await response.text();
          usedPath = path;
          break;
        }
      } catch {
        // ignore
      }
    }

    if (!text) {
      throw new Error("No app-push CSV found in ./data/");
    }

    const parsed = parsePushCsv(text);
    state.rawRows = parsed.rows;

    if (state.rawRows.length) {
      setLatestCompleteWeekRange();
      syncStateToDateInputs();
    }

    document.getElementById("fileMeta").textContent = `Loaded ${state.rawRows.length} app-push rows from ${usedPath}`;
    applyFiltersAndRender();
  } catch (error) {
    document.getElementById("fileMeta").textContent = `Failed to load app-push data: ${error.message}`;
    renderEmptyStates(error.message);
  }
}

function parsePushCsv(text) {
  const cleanLines = text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .filter((line) => !line.trim().startsWith("#"));

  const csvText = cleanLines.join("\n");
  const records = parseCsv(csvText);

  const rows = records
    .map(mapPushRow)
    .filter((row) => row.dateObj && row.pushName && row.pushName.toLowerCase() !== "grand total");

  return { rows };
}

function mapPushRow(raw) {
  const dateText = normalizeText(raw["Date"]);
  const pushName = normalizeText(raw["Session manual term"]);
  const dateObj = parseFlexibleDate(dateText);

  return {
    date: dateText,
    dateObj,
    pushName,
    sessions: parseNumber(raw["Sessions"]),
    users: parseNumber(raw["Total users"]),
    purchasers: parseNumber(raw["Total purchasers"]),
    revenue: parseNumber(raw["Total revenue"]),
  };
}

function syncDateInputsToState() {
  state.currentStart = document.getElementById("currentStart")?.value || "";
  state.currentEnd = document.getElementById("currentEnd")?.value || "";
  state.compareStart = document.getElementById("compareStart")?.value || "";
  state.compareEnd = document.getElementById("compareEnd")?.value || "";
}

function syncStateToDateInputs() {
  const currentStart = document.getElementById("currentStart");
  const currentEnd = document.getElementById("currentEnd");
  const compareStart = document.getElementById("compareStart");
  const compareEnd = document.getElementById("compareEnd");

  if (currentStart) currentStart.value = state.currentStart || "";
  if (currentEnd) currentEnd.value = state.currentEnd || "";
  if (compareStart) compareStart.value = state.compareStart || "";
  if (compareEnd) compareEnd.value = state.compareEnd || "";
}

function setLatestCompleteWeekRange() {
  const latestRange = getLatestCompletedWeekRange(state.rawRows);
  if (!latestRange) return;

  state.currentStart = formatDateInput(latestRange.currentStart);
  state.currentEnd = formatDateInput(latestRange.currentEnd);
  state.compareStart = formatDateInput(latestRange.compareStart);
  state.compareEnd = formatDateInput(latestRange.compareEnd);
}

function getLatestCompletedWeekRange(rows) {
  const dates = (rows || [])
    .map((row) => row.dateObj)
    .filter(Boolean)
    .sort((a, b) => a - b);

  if (!dates.length) return null;

  const latestDataDate = dates[dates.length - 1];
  const currentEnd = getPreviousOrSameSaturday(latestDataDate);
  const currentStart = addDays(currentEnd, -6);
  const compareEnd = addDays(currentStart, -1);
  const compareStart = addDays(compareEnd, -6);

  return { currentStart, currentEnd, compareStart, compareEnd };
}

function applyFiltersAndRender() {
  const currentStart = parseInputDate(state.currentStart);
  const currentEnd = parseInputDate(state.currentEnd);

  if (!currentStart || !currentEnd || currentStart > currentEnd) {
    renderEmptyStates("Please select a valid current period.");
    return;
  }

  state.classifiedRows = state.rawRows.map((row) => classifyRow(row, currentStart, currentEnd));
  state.excludedRows = state.classifiedRows.filter((row) => row.pushBucket === "future" || row.pushBucket === "invalid");
  state.filteredRows = state.classifiedRows.filter((row) => isRowIncluded(row, currentStart, currentEnd));

  renderAll();
}

function classifyRow(row, currentStart, currentEnd) {
  const pushCategory = classifyPushCategory(row.pushName);
  const resolvedManualDate = resolvePushNameDate(row.pushName, currentStart, currentEnd);
  const pushBucket = classifyPushBucket(pushCategory, resolvedManualDate, currentStart, currentEnd);

  return {
    ...row,
    pushCategory,
    resolvedManualDate,
    pushBucket,
  };
}

function classifyPushCategory(pushName) {
  let name = String(pushName || "").trim().toLowerCase();

  // 自动 Push 名称列表
  const automationPushNames = [
    "pushwelcom01",
    "cartship",
    "cart30m",
    "cart2h",
    "cart24h",
    "quickship",
    "view3",
    "checkout",
    "cart15off"
  ];

  // 判断是否为自动 Push
  if (automationPushNames.includes(name)) {
    return "automation";
  }

  // 修复日期错误的手动 Push
  if (/^push\d{4}0\d{1,2}/.test(name)) {
    name = name.replace(/^push(\d{2})0(\d{2})/, "push$1$2");
  }

  // 如果包含 "push"（除去 `pushwelcom01`）则为手动 Push
  if (/push/.test(name) && name !== "pushwelcom01") {
    return "manual";
  }

  // 默认返回自动 Push
  return "automation";
}

function classifyPushBucket(pushCategory, resolvedManualDate, currentStart, currentEnd) {
  if (pushCategory === "automation") return "automation";

  if (!resolvedManualDate) return "invalid";

  if (resolvedManualDate >= currentStart && resolvedManualDate <= currentEnd) {
    return "current";
  }

  if (resolvedManualDate < currentStart) {
    return "past";
  }

  return "future";
}
