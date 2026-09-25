const storageKey = "wxyy-4-luogujing-grid";
const instruments = [
  { name: "大锣", token: "仓", freq: 180 },
  { name: "鼓", token: "冬", freq: 120 },
  { name: "钹", token: "才", freq: 360 },
  { name: "小锣", token: "台", freq: 520 }
];
const steps = 16;
const state = JSON.parse(localStorage.getItem(storageKey) || "null") || {
  pieceName: "出场锣鼓-慢起",
  bpm: 96,
  loop: "",
  notes: [],
  pattern: instruments.map((instrument) => Array.from({ length: steps }, (_, index) => index % 4 === 0 ? instrument.token : "")),
  saved: []
};

let timer = null;
let playhead = 0;
let audioContext = null;

const grid = document.querySelector("#grid");
const savedList = document.querySelector("#savedList");
const structure = document.querySelector("#structure");
const notesList = document.querySelector("#notesList");
const pieceName = document.querySelector("#pieceName");
const bpmInput = document.querySelector("#bpmInput");
const loopSelect = document.querySelector("#loopSelect");
const noteInput = document.querySelector("#noteInput");
const summaryInput = document.querySelector("#summaryInput");
const expandedPlans = new Set();

function save() {
  localStorage.setItem(storageKey, JSON.stringify(state));
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

function formatTime(iso) {
  const date = new Date(iso);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function snapshotState() {
  return {
    bpm: state.bpm,
    loop: state.loop,
    notes: [...state.notes],
    pattern: state.pattern.map((row) => [...row])
  };
}

function nextVersionNumber(plan) {
  return plan.versions.reduce((max, version) => Math.max(max, version.version), 0) + 1;
}

function migrateLegacyPlan(plan) {
  plan.versions = [{
    id: crypto.randomUUID(),
    version: 1,
    createdAt: plan.createdAt || new Date().toISOString(),
    summary: "旧方案导入",
    bpm: plan.bpm,
    loop: plan.loop,
    notes: [...(plan.notes || [])],
    pattern: (plan.pattern || []).map((row) => [...row])
  }];
  plan.current = 1;
  delete plan.bpm;
  delete plan.loop;
  delete plan.notes;
  delete plan.pattern;
  delete plan.createdAt;
}

function applyVersion(plan, version) {
  state.pieceName = plan.name;
  state.bpm = version.bpm;
  state.loop = version.loop;
  state.notes = [...version.notes];
  state.pattern = version.pattern.map((row) => [...row]);
  save();
  render();
}

function loadPlan(plan) {
  if (!plan.versions) migrateLegacyPlan(plan);
  const version = plan.versions.find((entry) => entry.version === plan.current) || plan.versions[plan.versions.length - 1];
  applyVersion(plan, version);
}

function loadVersion(plan, versionNumber) {
  const version = plan.versions.find((entry) => entry.version === versionNumber);
  if (!version) return;
  if (version.version === plan.current) {
    applyVersion(plan, version);
    return;
  }
  const restored = {
    id: crypto.randomUUID(),
    version: nextVersionNumber(plan),
    createdAt: new Date().toISOString(),
    summary: `恢复自 v${version.version}`,
    bpm: version.bpm,
    loop: version.loop,
    notes: [...version.notes],
    pattern: version.pattern.map((row) => [...row])
  };
  plan.versions.push(restored);
  plan.current = restored.version;
  applyVersion(plan, restored);
}

function cleanupPlan(plan) {
  plan.versions = plan.versions.filter((version) => version.version >= plan.current);
  save();
  renderSidebars();
}

function renderSaved() {
  if (!state.saved.length) {
    savedList.innerHTML = "<p>还没有保存方案。</p>";
    return;
  }
  const locked = Boolean(timer);
  const html = state.saved.map((item) => {
    if (!item.versions) {
      return `
        <button class="saved-item" type="button" data-load="${item.id}" ${locked ? "disabled" : ""}>
          <strong>${item.name}</strong><br><span>${item.bpm}BPM · ${item.notes.length}条批注</span>
        </button>
      `;
    }
    const expanded = expandedPlans.has(item.id);
    const versions = [...item.versions].sort((a, b) => b.version - a.version);
    const hasEarlier = item.versions.some((version) => version.version < item.current);
    return `
      <article class="saved-item">
        <div class="saved-head">
          <button class="saved-load" type="button" data-load="${item.id}" ${locked ? "disabled" : ""}>
            <strong>${item.name}</strong><br>
            <span>当前 v${item.current} · 共${item.versions.length}个版本</span>
          </button>
          <button class="saved-toggle" type="button" data-toggle="${item.id}" aria-expanded="${expanded}">${expanded ? "收起" : "版本"}</button>
        </div>
        ${expanded ? `
          <div class="version-list">
            ${versions.map((version) => `
              <div class="version-row ${version.version === item.current ? "current" : ""}">
                <div class="version-meta">
                  <strong>v${version.version}</strong>${version.version === item.current ? '<span class="current-tag">当前</span>' : ""}<time>${formatTime(version.createdAt)}</time>
                  <p>${version.summary}</p>
                </div>
                <button type="button" data-load-version data-plan="${item.id}" data-version="${version.version}" ${locked ? "disabled" : ""}>载入</button>
              </div>
            `).join("")}
            ${hasEarlier ? '<button class="cleanup" type="button" data-cleanup="' + item.id + '">清理更早记录</button>' : ""}
          </div>
        ` : ""}
      </article>
    `;
  }).join("");
  savedList.innerHTML = locked ? html + '<p class="lock-hint">播放中，停止后才能切换版本。</p>' : html;
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
    <article class="note"><p>${note}</p></article>
  `).join("") : "<p>暂无批注。</p>";

  renderSaved();
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
  renderSidebars();
});

document.querySelector("#stopBtn").addEventListener("click", () => {
  clearInterval(timer);
  timer = null;
  document.querySelectorAll(".cell.playing").forEach((cell) => cell.classList.remove("playing"));
  renderSidebars();
});

document.querySelector("#saveBtn").addEventListener("click", () => {
  const name = state.pieceName || "未命名片段";
  const summary = summaryInput.value.trim() || "未填写小结";
  let plan = state.saved.find((entry) => entry.name === name);
  if (plan && !plan.versions) migrateLegacyPlan(plan);
  if (!plan) {
    plan = { id: crypto.randomUUID(), name, versions: [], current: 0 };
    state.saved.unshift(plan);
  }
  const version = {
    id: crypto.randomUUID(),
    version: nextVersionNumber(plan),
    createdAt: new Date().toISOString(),
    summary,
    ...snapshotState()
  };
  plan.versions.push(version);
  plan.current = version.version;
  summaryInput.value = "";
  save();
  renderSidebars();
});

savedList.addEventListener("click", (event) => {
  const toggle = event.target.closest("[data-toggle]");
  if (toggle) {
    const id = toggle.dataset.toggle;
    if (expandedPlans.has(id)) expandedPlans.delete(id);
    else expandedPlans.add(id);
    renderSidebars();
    return;
  }
  const cleanup = event.target.closest("[data-cleanup]");
  if (cleanup) {
    const plan = state.saved.find((entry) => entry.id === cleanup.dataset.cleanup);
    if (plan && window.confirm("确定清理当前版本之前的所有记录吗？")) cleanupPlan(plan);
    return;
  }
  if (timer) return;
  const versionButton = event.target.closest("[data-load-version]");
  if (versionButton) {
    const plan = state.saved.find((entry) => entry.id === versionButton.dataset.plan);
    if (plan) loadVersion(plan, Number(versionButton.dataset.version));
    return;
  }
  const load = event.target.closest("[data-load]");
  if (!load) return;
  const plan = state.saved.find((entry) => entry.id === load.dataset.load);
  if (plan) loadPlan(plan);
});

render();
