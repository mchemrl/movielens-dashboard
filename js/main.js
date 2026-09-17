// ============================================================
// Config
// ============================================================
// STANDALONE BUILD: no backend, no network calls anywhere in this file.
// api() below routes to localApi() (see js/local-data-api.js), which
// computes the same response shapes from the embedded DATA dataset
// (see js/mock-data.js).

const css = getComputedStyle(document.documentElement);
const C = (name) => css.getPropertyValue(name).trim();
const THEME = {
  yellow: C("--color-yellow"),
  green: C("--color-green"),
  blue: C("--color-blue"),
  purple: C("--color-purple"),
  ink: C("--color-ink"),
  inkMuted: C("--color-ink-muted"),
  inkFaint: C("--color-ink-faint"),
  border: C("--color-border"),
  panel: C("--color-panel"),
  accentInk: C("--color-accent-ink"),
};

Chart.defaults.color = THEME.inkMuted;
Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
Chart.defaults.borderColor = THEME.border;

let YEAR_FROM = null, YEAR_TO = null, MIN_RATINGS = 50;

async function api(path, params = {}) {
  return localApi(path, params);
}

function fmt(n) { return Number(n).toLocaleString(); }

function showError(el, err) {
  el.innerHTML = `<p class="error-msg">Couldn't load (${err.message}).</p>`;
}

function hexToRgb(input) {
  if (input.startsWith("rgb")) {
    const m = input.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) return { r: +m[1], g: +m[2], b: +m[3] };
  }
  let hex = input.replace("#", "");
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  const num = parseInt(hex, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}
function mix(hexA, hexB, t) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  return `rgb(${Math.round(a.r + (b.r - a.r) * t)},${Math.round(a.g + (b.g - a.g) * t)},${Math.round(a.b + (b.b - a.b) * t)})`;
}
// General-purpose sequential color for chart series (returns a plain CSS
// string) — same scale family as the heatmap, just without the luminance
// text-contrast logic that only heatmap table cells need.
function scaleColor(t) {
  t = Math.max(0, Math.min(1, t));
  return mix(THEME.yellow, THEME.purple, t);
}

// Sequential scale for heatmaps: low relevance stays near-white, high
// relevance moves toward the purple accent. Capped well short of full
// saturation so cells never get dark enough to need light text except at
// the very top of the range.
function heatmapColor(t) {
  if (!Number.isFinite(t)) return { bg: "rgb(240,240,240)", text: THEME.ink };
  t = Math.max(0, Math.min(1, t));
  const { r, g, b } = hexToRgb(mix("#FFFFFF", THEME.purple, t * 0.65));
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return { bg: `rgb(${r} ${g} ${b})`, text: luminance < 0.55 ? "#FFFFFF" : THEME.ink };
}

// ============================================================
// Left nav — built from sections, tracks scroll position
// ============================================================
function initNav() {
  const sections = [document.getElementById("hero"), ...document.querySelectorAll(".section")];
  const nav = document.getElementById("section-nav");

  sections.forEach((sec, i) => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = `#${sec.id}`;
    a.dataset.target = sec.id;
    a.innerHTML = `<span class="idx">${String(i).padStart(2, "0")}</span><span>${sec.dataset.label || sec.id}</span>`;
    li.appendChild(a);
    nav.appendChild(li);
  });

  const links = [...nav.querySelectorAll("a")];
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const idx = sections.indexOf(entry.target);
          links.forEach((l) => l.classList.remove("active"));
          if (links[idx]) links[idx].classList.add("active");
        }
      });
    },
    { rootMargin: "-10% 0px -70% 0px" }
  );
  sections.forEach((s) => observer.observe(s));
}

// ============================================================
// Global controls
// ============================================================
async function initControls() {
  const status = document.getElementById("control-status");
  try {
    const meta = await api("/api/meta");
    const from = document.getElementById("year-from");
    const to = document.getElementById("year-to");
    from.min = to.min = meta.year_min;
    from.max = to.max = meta.year_max;
    from.value = meta.year_min;
    to.value = meta.year_max;
    YEAR_FROM = meta.year_min;
    YEAR_TO = meta.year_max;
    status.textContent = `${fmt(meta.total_movies)} movies · ${fmt(meta.total_users)} users`;

    const applyYearFilter = () => {
      YEAR_FROM = Number(from.value);
      YEAR_TO = Number(to.value);
      refreshYearSensitiveCharts();
    };
    from.addEventListener("change", applyYearFilter);
    to.addEventListener("change", applyYearFilter);

    const minRatings = document.getElementById("min-ratings");
    const minRatingsVal = document.getElementById("min-ratings-value");
    minRatings.value = MIN_RATINGS;
    minRatingsVal.textContent = MIN_RATINGS;
    minRatings.addEventListener("input", () => {
      MIN_RATINGS = Number(minRatings.value);
      minRatingsVal.textContent = MIN_RATINGS;
    });
    minRatings.addEventListener("change", () => {
      renderAgreement();
      renderDivisive();
    });

    renderGenreChips(meta.genres);
  } catch (e) {
    status.textContent = "mock data failed to load";
    console.error(e);
  }
}

function refreshYearSensitiveCharts() {
  renderHero();
  renderDistribution();
  renderVolume();
  renderAgreement();
  renderDivisive();
  renderGenres();
  renderConclusion();
}

// ============================================================
// Hero
// ============================================================
async function renderHero() {
  const el = document.getElementById("hero-stats");
  try {
    const s = await api("/api/summary", { year_from: YEAR_FROM, year_to: YEAR_TO });
    el.innerHTML = `
      <div class="stat"><span class="num">${fmt(s.total_ratings)}</span><span class="label">ratings</span></div>
      <div class="stat"><span class="num">${fmt(s.total_movies_rated)}</span><span class="label">movies rated</span></div>
      <div class="stat"><span class="num">${fmt(s.total_users)}</span><span class="label">users</span></div>
      <div class="stat"><span class="num">${s.avg_rating ?? "—"}</span><span class="label">average rating</span></div>
    `;
  } catch (e) {
    showError(el, e);
  }
}

// ============================================================
// 1. Rating distribution — histogram
// ============================================================
let distChart;
async function renderDistribution() {
  const panel = document.querySelector("#sec-distribution .chart-panel");
  try {
    const d = await api("/api/rating-distribution", { year_from: YEAR_FROM, year_to: YEAR_TO });
    const ctx = document.getElementById("chart-distribution");
    if (distChart) distChart.destroy();
    const total = d.counts.reduce((a, b) => a + b, 0);
    document.getElementById("dist-total").textContent = `n = ${fmt(total)}`;

    distChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: d.bins.map((b) => b.toString()),
        datasets: [{
          label: "Ratings",
          data: d.counts,
          backgroundColor: d.bins.map((b) => scaleColor((b - 0.5) / 4.5)),
          borderRadius: 1,
        }],
      },
      options: {
        responsive: true,
        scales: {
          x: { title: { display: true, text: "Star rating" }, grid: { display: false } },
          y: { title: { display: true, text: "Number of ratings" }, grid: { color: THEME.border } },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (c) => `${fmt(c.raw)} ratings (${(c.raw / total * 100).toFixed(1)}%)`,
            },
          },
        },
      },
    });

    const peakIdx = d.counts.indexOf(Math.max(...d.counts));
    const weightedMean = d.bins.reduce((sum, b, i) => sum + b * d.counts[i], 0) / total;
    document.getElementById("dist-caption").innerHTML =
      `Most common rating: <span class="num">${d.bins[peakIdx]} stars</span> · Mean: <span class="num">${weightedMean.toFixed(2)}</span> — noticeably above the midpoint (2.75).`;
  } catch (e) {
    showError(panel, e);
  }
}

// ============================================================
// 2. Yearly volume — line
// ============================================================
let volumeChart;
async function renderVolume() {
  const panel = document.querySelector("#sec-volume .chart-panel");
  try {
    const d = await api("/api/yearly-volume", { year_from: YEAR_FROM, year_to: YEAR_TO });
    const ctx = document.getElementById("chart-volume");
    if (volumeChart) volumeChart.destroy();
    volumeChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: d.years,
        datasets: [{
          label: "Ratings",
          data: d.counts,
          borderColor: THEME.blue,
          backgroundColor: THEME.blue + "22",
          fill: true,
          tension: 0.25,
          pointRadius: 2,
          pointBackgroundColor: THEME.blue,
        }],
      },
      options: {
        responsive: true,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { title: { display: true, text: "Year" }, grid: { display: false } },
          y: { title: { display: true, text: "Ratings submitted" }, grid: { color: THEME.border } },
        },
        plugins: { legend: { display: false } },
      },
    });

    const peak = d.years[d.counts.indexOf(Math.max(...d.counts))];
    document.getElementById("volume-caption").innerHTML = `Peak year: <span class="num">${peak}</span>`;
  } catch (e) {
    showError(panel, e);
  }
}

// ============================================================
// 3. Agreement — scatter
// ============================================================
let agreementChart;
async function renderAgreement() {
  const panel = document.querySelector("#sec-agreement .chart-panel");
  try {
    const d = await api("/api/agreement", {
      year_from: YEAR_FROM, year_to: YEAR_TO, min_ratings: MIN_RATINGS, limit: 800,
    });
    const ctx = document.getElementById("chart-agreement");
    document.getElementById("agreement-count").textContent = `${fmt(d.points.length)} movies shown`;
    if (agreementChart) agreementChart.destroy();
    agreementChart = new Chart(ctx, {
      type: "scatter",
      data: {
        datasets: [{
          label: "Movies",
          data: d.points.map((p) => ({ x: p.rating_count, y: p.avg_rating, title: p.title })),
          backgroundColor: THEME.purple + "99",
          borderColor: THEME.accentInk,
          borderWidth: 0.5,
          pointRadius: 3,
          pointHoverRadius: 5,
        }],
      },
      options: {
        responsive: true,
        scales: {
          x: {
            type: "logarithmic",
            title: { display: true, text: "Rating count (log scale)" },
            grid: { color: THEME.border },
          },
          y: {
            title: { display: true, text: "Average rating" },
            min: 0, max: 5,
            grid: { color: THEME.border },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (c) => {
                const p = c.raw;
                return `${p.title} — ${p.y.toFixed(2)}★ (${fmt(p.x)} ratings)`;
              },
            },
          },
        },
      },
    });
  } catch (e) {
    showError(panel, e);
  }
}

// ============================================================
// 4. Divisive movies — ranked table
// ============================================================
async function renderDivisive() {
  const table = document.getElementById("divisive-table");
  try {
    const d = await api("/api/divisive", {
      year_from: YEAR_FROM, year_to: YEAR_TO, min_ratings: Math.max(MIN_RATINGS * 2, 100), limit: 12,
    });
    let html = "<thead><tr><th>Title</th><th>Avg. rating</th><th>Spread (std dev)</th><th># Ratings</th></tr></thead><tbody>";
    d.rows.forEach((r) => {
      html += `<tr><td>${r.title}</td><td class="num">${r.avg_rating.toFixed(2)}</td><td class="num">${r.rating_std.toFixed(2)}</td><td class="num">${fmt(r.rating_count)}</td></tr>`;
    });
    html += "</tbody>";
    table.innerHTML = html;
  } catch (e) {
    showError(table.parentElement, e);
  }
}

// ============================================================
// 5. Genres — horizontal bar
// ============================================================
let genresChart;
async function renderGenres() {
  const panel = document.querySelector("#sec-genres .chart-panel");
  try {
    const d = await api("/api/genres", { year_from: YEAR_FROM, year_to: YEAR_TO });
    const ctx = document.getElementById("chart-genres");
    if (genresChart) genresChart.destroy();
    const maxCount = Math.max(...d.rows.map((r) => r.count));
    // sort by weighted rating so the chart also reads as a ranking, not just a volume list
    const rows = [...d.rows].sort((a, b) => b.weighted_rating - a.weighted_rating);
    genresChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: rows.map((r) => r.genre),
        datasets: [{
          label: "Weighted rating",
          data: rows.map((r) => r.weighted_rating),
          backgroundColor: rows.map((r) => mix(THEME.yellow, THEME.blue, r.count / maxCount)),
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { min: 0, max: 5, title: { display: true, text: "Weighted rating (adjusted for sample size)" }, grid: { color: THEME.border } },
          y: { grid: { display: false }, ticks: { autoSkip: false } },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (c) => {
                const r = rows[c.dataIndex];
                return [`Weighted: ${r.weighted_rating.toFixed(2)}★`, `Raw average: ${r.avg_rating.toFixed(2)}★`, `${fmt(r.count)} ratings`];
              },
            },
          },
        },
      },
    });
  } catch (e) {
    showError(panel, e);
  }
}

// ============================================================
// 6. Genome — movie search + top traits
// ============================================================
let genomeChart;
let searchDebounce;
function initGenomeSearch() {
  const input = document.getElementById("genome-search");
  const dropdown = document.getElementById("search-results");

  input.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    const q = input.value.trim();
    if (q.length < 2) { dropdown.innerHTML = ""; return; }
    searchDebounce = setTimeout(async () => {
      try {
        const d = await api("/api/movies/search", { q, limit: 8 });
        dropdown.innerHTML = `<div class="search-dropdown">${d.results
          .map((m) => `<div class="item" data-id="${m.movieId}" data-title="${m.title.replace(/"/g, "&quot;")}">
              <div class="title">${m.title}</div>
              <div class="meta">${(m.genres || []).join(", ")} · ${fmt(m.rating_count)} ratings</div>
            </div>`)
          .join("")}</div>`;
      } catch (e) {
        console.error(e);
      }
    }, 250);
  });

  dropdown.addEventListener("click", (e) => {
    const item = e.target.closest(".item");
    if (!item) return;
    dropdown.innerHTML = "";
    input.value = item.dataset.title;
    renderGenomeMovie(Number(item.dataset.id));
  });
}

async function renderGenomeMovie(movieId) {
  const panel = document.querySelector("#sec-genome .chart-panel");
  try {
    const d = await api("/api/genome/movie", { movieId, top_n: 15 });
    document.getElementById("genome-selected").textContent = d.title || "";
    const ctx = document.getElementById("chart-genome");
    if (genomeChart) genomeChart.destroy();
    genomeChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: d.tags.map((t) => t.tag),
        datasets: [{
          label: "Relevance",
          data: d.tags.map((t) => t.relevance),
          backgroundColor: THEME.green,
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { min: 0, max: 1, title: { display: true, text: "Genome relevance" }, grid: { color: THEME.border } },
          y: { grid: { display: false }, ticks: { autoSkip: false } },
        },
        plugins: { legend: { display: false } },
      },
    });
  } catch (e) {
    showError(panel, e);
  }
}

// ============================================================
// 7. Taste fingerprint — genre x tag heatmap table
// ============================================================
let selectedFingerprintGenres = [];
function renderGenreChips(allGenres) {
  const wrap = document.getElementById("fingerprint-genre-chips");
  const defaults = allGenres.slice(0, 6);
  selectedFingerprintGenres = [...defaults];
  wrap.innerHTML = allGenres
    .map((g) => `<button class="chip ${defaults.includes(g) ? "active" : ""}" data-genre="${g}">${g}</button>`)
    .join("");
  wrap.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    const g = chip.dataset.genre;
    if (selectedFingerprintGenres.includes(g)) {
      selectedFingerprintGenres = selectedFingerprintGenres.filter((x) => x !== g);
      chip.classList.remove("active");
    } else {
      selectedFingerprintGenres.push(g);
      chip.classList.add("active");
    }
    renderFingerprint();
  });
  renderFingerprint();
}

async function renderFingerprint() {
  const table = document.getElementById("fingerprint-table");
  if (selectedFingerprintGenres.length === 0) {
    table.innerHTML = "<caption style='color:var(--color-ink-faint);font-size:0.8rem;'>Select at least one genre above.</caption>";
    return;
  }
  try {
    const d = await api("/api/genome/genre-fingerprint", {
      genres: selectedFingerprintGenres.join(","),
      top_tags: 10,
    });
    let maxVal = 0;
    d.matrix.forEach((row) => row.forEach((v) => { if (v !== null && v > maxVal) maxVal = v; }));

    let html = "<thead><tr><th></th>" + d.tags.map((t) => `<th>${t}</th>`).join("") + "</tr></thead><tbody>";
    d.genres.forEach((genre, gi) => {
      html += `<tr><th>${genre}</th>`;
      d.tags.forEach((tag, ti) => {
        const v = d.matrix[gi][ti];
        if (v === null || v === undefined) {
          html += `<td class="heatmap-cell">—</td>`;
          return;
        }
        const t = maxVal > 0 ? v / maxVal : 0;
        const { bg, text } = heatmapColor(t);
        html += `<td class="heatmap-cell" style="background:${bg};color:${text}">${v.toFixed(2)}</td>`;
      });
      html += "</tr>";
    });
    html += "</tbody>";
    table.innerHTML = html;
  } catch (e) {
    showError(table.parentElement, e);
  }
}

// ============================================================
// Conclusion
// ============================================================
async function renderConclusion() {
  const wrap = document.getElementById("scorecard");
  try {
    const [summary, divisive, genres] = await Promise.all([
      api("/api/summary", { year_from: YEAR_FROM, year_to: YEAR_TO }),
      api("/api/divisive", { year_from: YEAR_FROM, year_to: YEAR_TO, min_ratings: 200, limit: 1 }),
      api("/api/genres", { year_from: YEAR_FROM, year_to: YEAR_TO }),
    ]);
    const topGenre = [...genres.rows].sort((a, b) => b.avg_rating - a.avg_rating)[0];
    const mostDivisive = divisive.rows[0];
    const cells = [
      { num: fmt(summary.total_ratings), label: "ratings analyzed" },
      { num: summary.avg_rating ?? "—", label: "average rating (vs. 2.75 midpoint)" },
      { num: topGenre ? topGenre.genre : "—", label: "highest-rated genre on average" },
      { num: mostDivisive ? mostDivisive.title : "—", label: "most divisive title (highest spread)" },
    ];
    wrap.innerHTML = cells.map((c) => `<div class="cell"><div class="num">${c.num}</div><div class="label">${c.label}</div></div>`).join("");
  } catch (e) {
    showError(wrap, e);
  }
}

// ============================================================
// Boot
// ============================================================
async function loadDefaultGenomeMovie() {
  try {
    const d = await api("/api/agreement", { limit: 1, min_ratings: 1 });
    if (d.points.length) {
      document.getElementById("genome-search").value = d.points[0].title;
      renderGenomeMovie(d.points[0].movieId);
    }
  } catch (e) {
    console.error("default genome movie failed", e);
  }
}

(async function init() {
  initNav();
  initGenomeSearch();
  await initControls();
  renderHero();
  renderDistribution();
  renderVolume();
  renderAgreement();
  renderDivisive();
  renderGenres();
  renderConclusion();
  loadDefaultGenomeMovie();
})();
