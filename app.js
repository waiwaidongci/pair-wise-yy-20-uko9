const storageKey = "wxyy-4-luogujing-grid";
const instruments = [
  { name: "大锣", token: "仓", freq: 180 },
  { name: "鼓", token: "冬", freq: 120 },
  { name: "钹", token: "才", freq: 360 },
  { name: "小锣", token: "台", freq: 520 }
];
const steps = 16;

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function defaultPattern() {
  return instruments.map((instrument) => Array.from({ length: steps }, (_, index) => index % 4 === 0 ? instrument.token : ""));
}

function clonePattern(pattern) {
  return pattern.map((row) => [...row]);
}

// 旧数据行数或列数可能不齐，统一补齐为 乐器数×steps 的空口令网格。
function normalizePattern(pattern) {
  return instruments.map((_, rowIndex) =>
    Array.from({ length: steps }, (_, step) => pattern?.[rowIndex]?.[step] || ""));
}

// 旧版方案没有版本记录：第一次打开时包装成 v1，并视为当前版本。
function migrateScheme(item) {
  if (Array.isArray(item.versions)) return item;
  const updatedAt = item.updatedAt || item.createdAt || new Date().toISOString();
  const version = {
    id: uid(),
    version: 1,
    updatedAt,
    summary: item.summary || "初始版本",
    bpm: item.bpm,
    loop: item.loop ?? "",
    notes: [...(item.notes || [])],
    pattern: normalizePattern(item.pattern)
  };
  return {
    id: item.id,
    name: item.name,
    createdAt: item.createdAt || updatedAt,
    currentVersionId: version.id,
    versions: [version]
  };
}

const state = JSON.parse(localStorage.getItem(storageKey) || "null") || {
  pieceName: "出场锣鼓-慢起",
  bpm: 96,
  loop: "",
  notes: [],
  pattern: defaultPattern(),
  saved: [],
  activeSchemeId: null
};
state.saved = (state.saved || []).map(migrateScheme);
state.activeSchemeId = state.activeSchemeId ?? null;
state.pattern = normalizePattern(state.pattern);

let timer = null;
let playhead = 0;
let audioContext = null;
const expandedSchemeIds = new Set();

const grid = document.querySelector("#grid");
const savedList = document.querySelector("#savedList");
const structure = document.querySelector("#structure");
const notesList = document.querySelector("#notesList");
const pieceName = document.querySelector("#pieceName");
const bpmInput = document.querySelector("#bpmInput");
const loopSelect = document.querySelector("#loopSelect");
const noteInput = document.querySelector("#noteInput");
const lockTip = document.querySelector("#lockTip");
const dialog = document.querySelector("#dialog");
const dialogForm = document.querySelector("#dialogForm");
const dialogTitle = document.querySelector("#dialogTitle");
const dialogInput = document.querySelector("#dialogInput");
const dialogCancel = document.querySelector("#dialogCancel");
const toast = document.querySelector("#toast");

function save() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function showToast(text) {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 2400);
}

function syncFields() {
  pieceName.value = state.pieceName;
  bpmInput.value = state.bpm;
  loopSelect.value = state.loop;
}

function beatLabel(index) {
  const measure = Math.floor(index / 4) + 1;
  const beat = (index % 4) + 1;
  return `${measure}-${beat}`;
}

function renderGrid() {
  const header = ['<div class="label-cell">乐器</div>'];
  for (let i = 0; i < steps; i += 1) {
    header.push(`<div class="beat-cell">${beatLabel(i)}</div>`);
  }

  const rows = instruments.flatMap((instrument, rowIndex) => {
    const row = [`<div class="label-cell">${instrument.name}</div>`];
    for (let step = 0; step < steps; step += 1) {
      const value = state.pattern[rowIndex][step];
      row.push(`<button class="cell ${value ? "filled" : ""}" type="button" data-row="${rowIndex}" data-step="${step}">${value}</button>`);
    }
    return row;
  });

  grid.innerHTML = [...header, ...rows].join("");
}

function currentVersion(scheme) {
  return scheme.versions.find((version) => version.id === scheme.currentVersionId) || scheme.versions[scheme.versions.length - 1];
}

function renderVersion(scheme, version) {
  const isCurrent = version.id === scheme.currentVersionId;
  const meta = `v${version.version} · ${formatTime(version.updatedAt)}`;
  const summary = version.summary ? `<span class="version-summary">${escapeHtml(version.summary)}</span>` : "";
  const actions = isCurrent
    ? `<button type="button" class="btn-ghost" data-load-current="${scheme.id}">载入</button><span class="current-badge">当前版本</span>`
    : `<button type="button" class="btn-ghost" data-restore="${scheme.id}/${version.id}">另存为当前</button><button type="button" class="btn-danger" data-del-version="${scheme.id}/${version.id}" title="删除该历史版本">删除</button>`;
  return `
    <li class="version-row ${isCurrent ? "is-current" : ""}">
      <div class="version-meta"><strong>${meta}</strong>${summary}</div>
      <div class="version-actions">${actions}</div>
    </li>`;
}

function renderScheme(scheme) {
  const current = currentVersion(scheme);
  const expanded = expandedSchemeIds.has(scheme.id);
  const isActive = scheme.id === state.activeSchemeId;
  const versionCount = scheme.versions.length;
  const versionsHtml = expanded
    ? `<ul class="version-list">${[...scheme.versions].reverse().map((version) => renderVersion(scheme, version)).join("")}</ul>
       ${versionCount > 1 ? `<button type="button" class="btn-ghost prune" data-prune="${scheme.id}">清理更早记录（仅保留当前版本）</button>` : ""}`
    : "";
  return `
    <article class="scheme ${isActive ? "is-active" : ""}">
      <div class="scheme-head">
        <button type="button" class="scheme-toggle" data-toggle="${scheme.id}" aria-expanded="${expanded}">${expanded ? "▾" : "▸"}</button>
        <button type="button" class="scheme-load" data-load-current="${scheme.id}" title="载入当前版本">
          <strong>${escapeHtml(scheme.name)}</strong>
          <span>当前 v${current.version} · ${formatTime(current.updatedAt)} · 共${versionCount}版</span>
        </button>
        ${isActive ? '<span class="current-badge">当前版本</span>' : ""}
      </div>
      ${versionsHtml}
    </article>`;
}

function renderSidebars() {
  const filledByMeasure = [0, 1, 2, 3].map((measure) => {
    const start = measure * 4;
    const count = state.pattern.flatMap((row) => row.slice(start, start + 4)).filter(Boolean).length;
    return { measure: measure + 1, count };
  });
  structure.innerHTML = filledByMeasure.map((item) => `
    <div class="structure-row"><span>第${item.measure}小节</span><strong>${item.count}个口令</strong></div>
  `).join("");

  notesList.innerHTML = state.notes.length ? state.notes.map((note) => `
    <article class="note"><p>${escapeHtml(note)}</p></article>
  `).join("") : "<p>暂无批注。</p>";

  savedList.innerHTML = state.saved.length
    ? state.saved.map(renderScheme).join("")
    : "<p>还没有保存方案。</p>";

  setHistoryLocked(Boolean(timer));
}

function render() {
  syncFields();
  renderGrid();
  renderSidebars();
}

function playSound(instrument) {
  audioContext ||= new AudioContext();
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc.frequency.value = instrument.freq;
  osc.type = instrument.name === "鼓" ? "sine" : "square";
  gain.gain.setValueAtTime(0.08, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.08);
  osc.connect(gain).connect(audioContext.destination);
  osc.start();
  osc.stop(audioContext.currentTime + 0.09);
}

function highlight(step) {
  document.querySelectorAll(".cell.playing").forEach((cell) => cell.classList.remove("playing"));
  document.querySelectorAll(`[data-step="${step}"]`).forEach((cell) => cell.classList.add("playing"));
}

function currentRange() {
  if (state.loop === "") return [0, steps - 1];
  const start = Number(state.loop) * 4;
  return [start, start + 3];
}

function tick() {
  const [start, end] = currentRange();
  if (playhead < start || playhead > end) playhead = start;
  highlight(playhead);
  instruments.forEach((instrument, rowIndex) => {
    if (state.pattern[rowIndex][playhead]) playSound(instrument);
  });
  playhead = playhead >= end ? start : playhead + 1;
}

// 播放期间锁定历史版本切换，停止后恢复。
function setHistoryLocked(locked) {
  document.querySelectorAll("[data-load-current], [data-restore], [data-del-version], [data-prune]").forEach((el) => {
    el.disabled = locked;
  });
  lockTip.hidden = !locked;
}

function snapshotVersion(versionNumber) {
  return {
    id: uid(),
    version: versionNumber,
    updatedAt: new Date().toISOString(),
    summary: "",
    bpm: state.bpm,
    loop: state.loop,
    notes: [...state.notes],
    pattern: clonePattern(state.pattern)
  };
}

function applyVersion(scheme, version) {
  state.pieceName = scheme.name;
  state.bpm = version.bpm;
  state.loop = version.loop ?? "";
  state.notes = [...version.notes];
  state.pattern = clonePattern(version.pattern);
  state.activeSchemeId = scheme.id;
  playhead = currentRange()[0];
}

function findScheme(id) {
  return state.saved.find((scheme) => scheme.id === id);
}

let dialogSubmit = null;

function openDialog({ title, placeholder, confirmText, onSubmit }) {
  dialogTitle.textContent = title;
  dialogInput.value = "";
  dialogInput.placeholder = placeholder || "如：第2小节小锣晚半拍";
  document.querySelector("#dialogConfirm").textContent = confirmText || "保存版本";
  dialogSubmit = onSubmit;
  dialog.hidden = false;
  dialogInput.focus();
}

function closeDialog() {
  dialog.hidden = true;
  dialogSubmit = null;
}

dialogForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const summary = dialogInput.value.trim();
  if (!summary || !dialogSubmit) return;
  const onSubmit = dialogSubmit;
  closeDialog();
  onSubmit(summary);
});

dialogCancel.addEventListener("click", closeDialog);
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) closeDialog();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !dialog.hidden) closeDialog();
});

// 保存：归入当前方案成为新版本；不属于任何方案时新建方案。
function commitSave(summary) {
  const scheme = findScheme(state.activeSchemeId);
  if (scheme) {
    const version = snapshotVersion(scheme.versions.length + 1);
    version.summary = summary;
    scheme.name = state.pieceName || "未命名片段";
    scheme.versions.push(version);
    scheme.currentVersionId = version.id;
    showToast(`已保存为「${scheme.name}」v${version.version}`);
  } else {
    const version = snapshotVersion(1);
    version.summary = summary;
    const newScheme = {
      id: uid(),
      name: state.pieceName || "未命名片段",
      createdAt: version.updatedAt,
      currentVersionId: version.id,
      versions: [version]
    };
    state.saved.unshift(newScheme);
    state.activeSchemeId = newScheme.id;
    expandedSchemeIds.add(newScheme.id);
    showToast(`已保存新方案「${newScheme.name}」v1`);
  }
  save();
  renderSidebars();
}

// 载入历史版本：以该版本内容另存为新的当前版本，旧内容保留。
function commitRestore(scheme, version, summary) {
  const copy = {
    id: uid(),
    version: scheme.versions.length + 1,
    updatedAt: new Date().toISOString(),
    summary,
    bpm: version.bpm,
    loop: version.loop ?? "",
    notes: [...version.notes],
    pattern: clonePattern(version.pattern)
  };
  scheme.versions.push(copy);
  scheme.currentVersionId = copy.id;
  applyVersion(scheme, copy);
  save();
  render();
  showToast(`已基于 v${version.version} 另存为 v${copy.version}`);
}

function deleteVersion(scheme, versionId) {
  const version = scheme.versions.find((entry) => entry.id === versionId);
  if (!version || version.id === scheme.currentVersionId) return;
  if (!window.confirm(`删除「${scheme.name}」的 v${version.version}？该历史版本将无法恢复。`)) return;
  scheme.versions = scheme.versions.filter((entry) => entry.id !== versionId);
  save();
  renderSidebars();
}

function pruneVersions(scheme) {
  if (scheme.versions.length <= 1) return;
  if (!window.confirm(`清理「${scheme.name}」更早的版本记录，仅保留当前版本？`)) return;
  scheme.versions = scheme.versions.filter((entry) => entry.id === scheme.currentVersionId);
  save();
  renderSidebars();
}

grid.addEventListener("click", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell) return;
  const row = Number(cell.dataset.row);
  const step = Number(cell.dataset.step);
  state.pattern[row][step] = state.pattern[row][step] ? "" : instruments[row].token;
  save();
  render();
});

pieceName.addEventListener("input", () => {
  state.pieceName = pieceName.value;
  save();
});

bpmInput.addEventListener("input", () => {
  state.bpm = Number(bpmInput.value || 96);
  save();
  if (timer) {
    clearInterval(timer);
    timer = setInterval(tick, 60000 / state.bpm);
  }
});

loopSelect.addEventListener("change", () => {
  state.loop = loopSelect.value;
  playhead = currentRange()[0];
  save();
});

noteInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || !noteInput.value.trim()) return;
  state.notes.unshift(noteInput.value.trim());
  noteInput.value = "";
  save();
  renderSidebars();
});

document.querySelector("#playBtn").addEventListener("click", () => {
  if (timer) clearInterval(timer);
  playhead = currentRange()[0];
  tick();
  timer = setInterval(tick, 60000 / state.bpm);
  setHistoryLocked(true);
});

document.querySelector("#stopBtn").addEventListener("click", () => {
  clearInterval(timer);
  timer = null;
  document.querySelectorAll(".cell.playing").forEach((cell) => cell.classList.remove("playing"));
  setHistoryLocked(false);
});

document.querySelector("#saveBtn").addEventListener("click", () => {
  const scheme = findScheme(state.activeSchemeId);
  openDialog({
    title: scheme ? `保存到「${scheme.name}」` : "保存为新方案",
    confirmText: "保存版本",
    onSubmit: commitSave
  });
});

savedList.addEventListener("click", (event) => {
  const target = event.target.closest("[data-toggle], [data-load-current], [data-restore], [data-del-version], [data-prune]");
  if (!target) return;
  if (timer && !target.dataset.toggle) {
    showToast("播放中，停止后再切换历史版本。");
    return;
  }

  if (target.dataset.toggle) {
    const id = target.dataset.toggle;
    expandedSchemeIds.has(id) ? expandedSchemeIds.delete(id) : expandedSchemeIds.add(id);
    renderSidebars();
    return;
  }

  if (target.dataset.loadCurrent) {
    const scheme = findScheme(target.dataset.loadCurrent);
    if (!scheme) return;
    applyVersion(scheme, currentVersion(scheme));
    save();
    render();
    showToast(`已载入「${scheme.name}」当前版本`);
    return;
  }

  if (target.dataset.restore) {
    const [schemeId, versionId] = target.dataset.restore.split("/");
    const scheme = findScheme(schemeId);
    const version = scheme?.versions.find((entry) => entry.id === versionId);
    if (!scheme || !version) return;
    openDialog({
      title: `基于「${scheme.name}」v${version.version} 另存为当前版本`,
      placeholder: "如：恢复第2小节的慢起处理",
      confirmText: "另存为当前版本",
      onSubmit: (summary) => commitRestore(scheme, version, summary)
    });
    return;
  }

  if (target.dataset.delVersion) {
    const [schemeId, versionId] = target.dataset.delVersion.split("/");
    const scheme = findScheme(schemeId);
    if (scheme) deleteVersion(scheme, versionId);
    return;
  }

  if (target.dataset.prune) {
    const scheme = findScheme(target.dataset.prune);
    if (scheme) pruneVersions(scheme);
  }
});

save();
render();
