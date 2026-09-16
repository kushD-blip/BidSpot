/* js/admin.js — Admin dashboard runtime.
 *
 * Deliberately no external chart library. The three charts (line, horizontal
 * bar, donut) are rendered as inline SVG, controlled by the same code that
 * loads the data. That means:
 *   - No CDN failure mode. Chart.js off cdnjs was the main flake path before.
 *   - No script tag racing our module. Charts paint the frame the data arrives.
 *   - No hidden global. Everything's imported.
 *   - Same theme tokens as the rest of the site (see .chart-* rules in
 *     css/admin.css) — palette changes stay consistent automatically.
 *
 * Auth flow (single path, deterministic):
 *   1. Show the loading spinner.
 *   2. GET /api/admin/auth — server returns { authenticated: bool }.
 *   3a. true  → hide loading + gate, show shell, fetch stats.
 *   3b. false → hide loading, show gate. On submit, POST /api/admin/auth;
 *               on 200, transition to shell. On 401, show error under the input.
 *
 * Everything else — refresh, presence subscription — only fires from the ONE
 * `enterShell()` function so double-init bugs (like the previous "cannot add
 * callbacks after subscribe()" from calling twice) are structurally impossible.
 */

import { subscribeToPresence } from './supabase-client.js';

/* ---------- tiny DOM helpers ---------- */
const $ = (id) => document.getElementById(id);
const show = (el) => { if (el) el.hidden = false; };
const hide = (el) => { if (el) el.hidden = true; };

/* ---------- boot ---------- */

(async function boot() {
  // If ADMIN_PASSWORD isn't configured server-side, the auth endpoint returns
  // 503. That's a "gate visible, error shown" state — don't hide the gate.
  try {
    const r = await fetch('/api/admin/auth', { credentials: 'same-origin' });
    hide($('admin-loading'));
    if (r.ok) {
      const body = await r.json().catch(() => ({}));
      if (body.authenticated) return enterShell();
    }
  } catch {
    hide($('admin-loading'));
    // network offline — fall through to the gate; the user can try again
  }
  showGate();
})();

/* ---------- gate ---------- */

function showGate() {
  const gate = $('admin-gate');
  show(gate);
  const form = $('admin-gate-form');
  form.addEventListener('submit', onGateSubmit);
  // Focus the input once the gate is visible so keyboard users can type
  // immediately without an extra tab.
  requestAnimationFrame(() => $('admin-password').focus());
}

async function onGateSubmit(e) {
  e.preventDefault();
  const err = $('admin-gate-error');
  const submit = $('admin-gate-submit');
  const passwordInput = $('admin-password');

  hide(err);
  submit.disabled = true;
  submit.textContent = 'Checking…';

  try {
    const res = await fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: passwordInput.value }),
      credentials: 'same-origin',
    });

    if (res.ok) {
      // Auth cookie set. Tear down the gate cleanly before entering the shell.
      const gate = $('admin-gate');
      const form = $('admin-gate-form');
      form.removeEventListener('submit', onGateSubmit);
      hide(gate);
      return enterShell();
    }

    let msg = 'Wrong password.';
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch { /* not JSON — fall through with the default */ }
    err.textContent = msg;
    show(err);
    passwordInput.select();
  } catch (netErr) {
    console.error('[admin] auth request failed:', netErr);
    err.textContent = 'Could not reach the server. Check your connection and try again.';
    show(err);
  } finally {
    submit.disabled = false;
    submit.textContent = 'Unlock';
  }
}

/* ---------- shell ---------- */

let shellEntered = false;

function enterShell() {
  if (shellEntered) return;
  shellEntered = true;
  show($('admin-shell'));
  bindShellControls();
  subscribePresence();
  refreshStats();
}

function bindShellControls() {
  $('admin-refresh')?.addEventListener('click', refreshStats);
  $('admin-logout')?.addEventListener('click', logout);
  // "R" (uppercase or lower) triggers a refresh unless the user is typing in an
  // input somewhere. Cheap keybind; no library needed.
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'r') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const active = document.activeElement;
    if (active && ['INPUT', 'TEXTAREA'].includes(active.tagName)) return;
    e.preventDefault();
    refreshStats();
  });
}

async function logout() {
  try {
    await fetch('/api/admin/auth', { method: 'DELETE', credentials: 'same-origin' });
  } catch { /* even if the request fails, reload so the client state resets */ }
  location.reload();
}

/* ---------- presence ---------- */

function subscribePresence() {
  // subscribeToPresence never rejects; on a Supabase failure it just returns a
  // no-op unsubscribe. So a broken realtime channel here leaves the tile at
  // its initial "1" — same behaviour as an empty page with only the operator.
  subscribeToPresence((count) => {
    const n = Math.max(1, Number(count) || 0);
    $('tile-viewing').textContent = int(n);
  });
}

/* ---------- data ---------- */

async function refreshStats() {
  const updated = $('admin-updated');
  updated.textContent = 'Loading…';

  try {
    const res = await fetch('/api/admin/stats', { credentials: 'same-origin' });
    if (res.status === 401) {
      // Session expired mid-session. Reload to fall back to the gate.
      location.reload();
      return;
    }
    if (!res.ok) throw new Error(`stats ${res.status}`);
    const data = await res.json();
    applyStats(data);
    updated.textContent = 'Updated ' + new Date(data.generatedAt).toLocaleTimeString();
  } catch (err) {
    console.error('[admin] refresh failed:', err);
    updated.textContent = 'Refresh failed';
  }
}

function applyStats(stats) {
  const totals = stats.totals || {};
  $('tile-bids').textContent = int(totals.paid_count);
  $('tile-bids-sub').textContent = totals.paid_count
    ? `${int(totals.paid_count)} paid, ledger source`
    : 'No bids yet';
  $('tile-volume').textContent = inr(totals.volume_paise);
  $('tile-listings').textContent = int(totals.listings_count);

  const pending = Number(stats.pendingCount) || 0;
  const listingsSub = $('tile-listings-sub');
  if (pending > 0) {
    listingsSub.textContent = `${int(pending)} pending payment`;
    listingsSub.classList.add('is-pending');
  } else {
    listingsSub.textContent = 'Nothing pending';
    listingsSub.classList.remove('is-pending');
  }

  renderRecent(stats.recentBids || []);
  renderBidsLine($('chart-bids'), stats.bidsByDay || []);
  renderStatusDonut($('chart-status'), stats.listingsByStatus || []);
  renderCategoryBars($('chart-categories'), stats.topCategories || []);
}

/* ---------- recent bids list ---------- */

function renderRecent(rows) {
  const box = $('admin-recent');
  if (!rows.length) {
    box.innerHTML = `<div class="recent-empty">No paid bids yet.</div>`;
    return;
  }
  box.innerHTML = rows.map((r) => `
    <div class="recent-row">
      <div class="recent-name" title="${esc(r.listings?.name || 'Deleted listing')}">${esc(r.listings?.name || 'Deleted listing')}</div>
      <div class="recent-amount">${inr(r.amount)}</div>
      <div class="recent-time">${timeAgo(r.created_at)}</div>
    </div>
  `).join('');
}

/* ---------- charts (inline SVG, no external lib) ---------- */

/** Paid bids per day — a smooth line with a soft fill under it. Empty state
 *  when there's no history. */
function renderBidsLine(container, rows) {
  if (!rows.length) return emptyChart(container, 'No bids yet in this range.');

  const W = 620;
  const H = 220;
  const PAD_L = 34;
  const PAD_R = 12;
  const PAD_T = 12;
  const PAD_B = 26;

  const counts = rows.map((r) => Number(r.paid_count) || 0);
  const maxY = Math.max(1, ...counts); // never divide by zero when there are 0 bids anywhere
  const stepX = (W - PAD_L - PAD_R) / Math.max(1, rows.length - 1);
  const scaleY = (v) => H - PAD_B - (v / maxY) * (H - PAD_T - PAD_B);

  // Point positions.
  const pts = counts.map((v, i) => ({ x: PAD_L + i * stepX, y: scaleY(v) }));
  const path = pts.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`)).join(' ');
  const area = `${path} L${pts[pts.length - 1].x},${H - PAD_B} L${pts[0].x},${H - PAD_B} Z`;

  // Gridlines at 25/50/75/100% of maxY.
  const gridLines = [0.25, 0.5, 0.75, 1].map((frac) => {
    const y = scaleY(maxY * frac);
    return `<line class="chart-grid" x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}"></line>
            <text class="chart-tick" x="${PAD_L - 4}" y="${y + 3}" text-anchor="end">${Math.round(maxY * frac)}</text>`;
  }).join('');

  // X-axis: show ~6 tick labels evenly across the range, not one per day.
  const tickStep = Math.max(1, Math.floor(rows.length / 6));
  const xTicks = rows.map((r, i) => {
    if (i % tickStep !== 0 && i !== rows.length - 1) return '';
    const label = shortDate(r.day);
    return `<text class="chart-tick" x="${PAD_L + i * stepX}" y="${H - 8}" text-anchor="middle">${esc(label)}</text>`;
  }).join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Paid bids per day, last 30 days">
      <line class="chart-axis" x1="${PAD_L}" y1="${H - PAD_B}" x2="${W - PAD_R}" y2="${H - PAD_B}"></line>
      ${gridLines}
      <path class="chart-line-area" d="${area}"></path>
      <path class="chart-line" d="${path}"></path>
      ${xTicks}
    </svg>
  `;
}

/** Listings by status — a proper donut with a hole in the middle showing the
 *  total. Draws each slice as an SVG arc. If everything is 0 we draw a single
 *  neutral ring so it's still visually a donut, not a broken chart. */
function renderStatusDonut(container, rows) {
  const order = [
    { key: 'approved', label: 'Approved', cls: 'chart-donut-approved' },
    { key: 'pending',  label: 'Pending',  cls: 'chart-donut-pending'  },
    { key: 'rejected', label: 'Rejected', cls: 'chart-donut-rejected' },
    { key: 'removed',  label: 'Removed',  cls: 'chart-donut-removed'  },
  ];
  const byKey = Object.fromEntries(rows.map((r) => [r.status, Number(r.count) || 0]));
  const slices = order.map((s) => ({ ...s, value: byKey[s.key] || 0 }));
  const total = slices.reduce((sum, s) => sum + s.value, 0);

  const size = 220;
  const cx = size / 2;
  const cy = size / 2 - 6;
  const rOuter = 88;
  const rInner = 56;

  let paths = '';
  if (total === 0) {
    // Empty state: flat neutral ring so the panel is never "chart-shaped blank".
    paths = donutRing(cx, cy, rOuter, rInner, 'chart-donut-empty');
  } else {
    let acc = 0;
    for (const s of slices) {
      if (s.value <= 0) continue;
      const startAngle = (acc / total) * Math.PI * 2;
      const endAngle = ((acc + s.value) / total) * Math.PI * 2;
      paths += donutArc(cx, cy, rOuter, rInner, startAngle, endAngle, s.cls);
      acc += s.value;
    }
  }

  const legend = slices.map((s) => `
    <span><span class="swatch" style="background: var(--tmp-${s.key}, currentColor);"></span>${s.label} · ${int(s.value)}</span>
  `).join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${size} ${size + 40}" role="img" aria-label="Listings by status">
      ${paths}
      <text class="chart-donut-center-num" x="${cx}" y="${cy + 4}" text-anchor="middle">${int(total)}</text>
      <text class="chart-donut-center-lbl" x="${cx}" y="${cy + 22}" text-anchor="middle">Total</text>
    </svg>
    <div class="chart-legend">${legendSwatch(slices)}</div>
  `;
}

/** Legend renderer that uses inline background colors matching the donut
 *  slice classes. Cleaner than trying to read colors back from CSS. */
function legendSwatch(slices) {
  const map = {
    approved: '#8B1E2E',
    pending:  '#d97706',
    rejected: '#6b7280',
    removed:  '#4b5563',
  };
  return slices.map((s) => `
    <span><span class="swatch" style="background:${map[s.key]}"></span>${s.label} · ${int(s.value)}</span>
  `).join('');
}

/** Horizontal bar chart of top categories by volume. Bars grow from the left,
 *  with the category name at the start of the bar row and the ₹ value at the
 *  right. Compact enough to fit the top-10 in ~260px of vertical space. */
function renderCategoryBars(container, rows) {
  if (!rows.length) return emptyChart(container, 'No volume yet.');

  const W = 620;
  const rowHeight = 28;
  const PAD_L = 4;
  const PAD_R = 4;
  const BAR_LEFT = 190;
  const BAR_RIGHT_MARGIN = 90;
  const barMax = W - BAR_LEFT - BAR_RIGHT_MARGIN;

  const maxVol = Math.max(1, ...rows.map((r) => Number(r.volume_paise) || 0));
  const H = rows.length * rowHeight + 6;

  const bars = rows.map((r, i) => {
    const y = i * rowHeight + 4;
    const vol = Number(r.volume_paise) || 0;
    const barW = Math.max(1, (vol / maxVol) * barMax);
    const label = esc(r.category_name || 'Uncategorized');
    return `
      <text class="chart-bar-label" x="${PAD_L + 6}" y="${y + 15}">${truncate(label, 28)}</text>
      <rect class="chart-bar" x="${BAR_LEFT}" y="${y + 4}" width="${barW}" height="${rowHeight - 12}" rx="4"></rect>
      <text class="chart-value-label" x="${BAR_LEFT + barW + 6}" y="${y + 15}">${shortInr(vol)}</text>
    `;
  }).join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMinYMin meet" role="img" aria-label="Volume by category, top 10">
      ${bars}
    </svg>
  `;
}

/* ---------- SVG chart primitives ---------- */

function donutArc(cx, cy, rOuter, rInner, start, end, cls) {
  const large = end - start > Math.PI ? 1 : 0;
  const sx1 = cx + rOuter * Math.cos(start);
  const sy1 = cy + rOuter * Math.sin(start);
  const sx2 = cx + rOuter * Math.cos(end);
  const sy2 = cy + rOuter * Math.sin(end);
  const ix1 = cx + rInner * Math.cos(end);
  const iy1 = cy + rInner * Math.sin(end);
  const ix2 = cx + rInner * Math.cos(start);
  const iy2 = cy + rInner * Math.sin(start);
  const d = `M${sx1},${sy1} A${rOuter},${rOuter} 0 ${large} 1 ${sx2},${sy2}` +
            ` L${ix1},${iy1} A${rInner},${rInner} 0 ${large} 0 ${ix2},${iy2} Z`;
  return `<path class="${cls}" d="${d}"></path>`;
}

function donutRing(cx, cy, rOuter, rInner, cls) {
  // A donut with no data — full ring, used only in the empty state.
  const d = `M${cx - rOuter},${cy} a${rOuter},${rOuter} 0 1 0 ${rOuter * 2},0 a${rOuter},${rOuter} 0 1 0 -${rOuter * 2},0
             M${cx - rInner},${cy} a${rInner},${rInner} 0 1 1 ${rInner * 2},0 a${rInner},${rInner} 0 1 1 -${rInner * 2},0`;
  return `<path class="${cls}" d="${d}" fill-rule="evenodd"></path>`;
}

function emptyChart(container, message) {
  container.innerHTML = `<div class="admin-chart-empty">${esc(message)}</div>`;
}

/* ---------- formatting helpers ---------- */

function int(n) { return Number(n || 0).toLocaleString('en-IN'); }

function inr(paise) {
  return '₹' + Math.round((Number(paise) || 0) / 100).toLocaleString('en-IN');
}

/** Compact rupee: ₹1.2 Cr / ₹1.2 L / ₹1.2k / ₹123. Used in the category bar
 *  labels where a full "₹12,45,67,890" wouldn't fit. */
function shortInr(paise) {
  const rupees = Math.round((Number(paise) || 0) / 100);
  if (rupees >= 1e7) return '₹' + (rupees / 1e7).toFixed(1) + ' Cr';
  if (rupees >= 1e5) return '₹' + (rupees / 1e5).toFixed(1) + ' L';
  if (rupees >= 1e3) return '₹' + (rupees / 1e3).toFixed(1) + 'k';
  return '₹' + rupees;
}

function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function timeAgo(iso) {
  if (!iso) return '—';
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function truncate(str, n) {
  const s = String(str);
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
