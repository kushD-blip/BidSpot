/* js/product.js — product.html: a single listing's detail page, read by ?id= from
   the URL. Laid out as a real page rather than one centered box: breadcrumb, hero,
   rank stat cards, a plain-language explanation of the ranking, and the rest of the
   listing's category underneath.

   Every number here is read from the database — ranks, counts and clicks are all
   derived from real listings, nothing is padded or invented. The actual bid/outbid
   action always happens on index.html (single source of truth for payments); this
   page just links there with ?outbid=<id>. */

import { fetchListingById, fetchApprovedListings, trackClick } from './supabase-client.js';
import { mapSupabaseListing, unescapeHtml, formatClicks } from './listing-mapper.js';
import { isSupabaseConfigured } from './config.js';
import { renderLogo } from './get-logo.js';

function formatINR(n) {
  return '₹' + Math.round(n || 0).toLocaleString('en-IN');
}

const VERIFIED_ICON = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><title>Verified</title><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;

const FOUNDING_BADGE = `<span class="founding-badge" title="Founding Bidder — one of the first listings ever to claim a spot on BidSpot."><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>Founding</span>`;

function miniRankRow(item, rank) {
  return `
    <a class="peer-rank-row" href="./product.html?id=${encodeURIComponent(item.id)}">
      <span class="peer-rank-num">#${rank}</span>
      <span class="peer-rank-logo" data-domain="${item.domain}" data-text="${item.logoText}" data-bg="${item.logoBg}" style="background:${item.logoBg};">${item.logoText}</span>
      <span class="peer-rank-title">${item.title}</span>
      <span class="peer-rank-price">${formatINR(item.amountINR)}</span>
    </a>
  `;
}

function errorBlock(heading, body) {
  return `<div class="empty-state-block"><h3>${heading}</h3><p>${body}</p></div>`;
}

async function render() {
  const container = document.getElementById('product-detail');
  if (!container) return;

  const id = new URLSearchParams(location.search).get('id');

  if (!isSupabaseConfigured) {
    container.innerHTML = errorBlock('Not connected yet', 'Listing pages need Supabase configured in js/config.js.');
    return;
  }

  if (!id) {
    container.innerHTML = errorBlock('No listing specified', '<a href="./index.html">Back to the leaderboard</a>');
    return;
  }

  const [row, allRows] = await Promise.all([fetchListingById(id), fetchApprovedListings({ limit: 1000 })]);

  if (!row) {
    container.innerHTML = errorBlock(
      'Listing not found',
      'It may have been removed, or the link is incorrect.<br><a href="./index.html">Back to the leaderboard</a>'
    );
    return;
  }

  const item = mapSupabaseListing(row);
  const all = allRows.map((r) => mapSupabaseListing(r));

  // fetchApprovedListings already returns rows ordered by total_bid_alltime desc,
  // so position in these arrays IS the rank — overall, and within the category.
  const overallRank = all.findIndex((i) => i.id === item.id) + 1;
  const inCategory = all.filter((i) => i.category === item.category);
  const categoryRank = inCategory.findIndex((i) => i.id === item.id) + 1;
  const peers = inCategory.filter((i) => i.id !== item.id).slice(0, 4);

  // What it would cost to take this listing's spot — the same proportional rule the
  // home page's bid stepper uses (1% above the current total, floored at ₹10).
  const toOutbidINR = item.amountINR + Math.max(10, Math.round(item.amountINR * 0.01));

  // document.title isn't HTML-parsed, so it needs the unescaped original.
  const plainTitle = unescapeHtml(item.title);
  document.title = `${plainTitle} — BidSpot.in`;

  const categoryHref = `./index.html?category=${encodeURIComponent(item.category)}`;

  container.innerHTML = `
    <nav class="product-breadcrumb" aria-label="Breadcrumb">
      <a href="./index.html">Leaderboard</a>
      <span class="meta-sep" aria-hidden="true">·</span>
      <a href="${categoryHref}">${item.category}</a>
    </nav>

    <div class="product-hero-card">
      <div class="product-hero-logo" id="product-logo" style="background:${item.logoBg};">${item.logoText}</div>
      <div class="product-hero-main">
        <h1 class="product-hero-title">
          ${item.title}
          ${item.verified ? VERIFIED_ICON : ''}
          ${item.foundingBidder ? FOUNDING_BADGE : ''}
        </h1>
        <div class="product-hero-meta">
          <a href="${categoryHref}" class="category-tag">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path></svg>
            ${item.category}
          </a>
          <span class="meta-sep" aria-hidden="true">·</span>
          <a href="${item.url}" target="_blank" rel="noopener" class="meta-link js-outbound">${item.domain}</a>
          <span class="meta-sep" aria-hidden="true">·</span>
          <span>${item.timestamp}</span>
          <span class="meta-sep" aria-hidden="true">·</span>
          <span>${formatClicks(item.clicks)}</span>
        </div>
        <p class="product-hero-tagline">${item.tagline || 'No description provided.'}</p>
        <div class="product-hero-actions">
          <a href="${item.url}" target="_blank" rel="noopener" class="btn-primary js-outbound">
            <span>Visit</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </a>
          <button type="button" class="btn-secondary" id="copy-link-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
            <span>Copy link</span>
          </button>
        </div>
      </div>
    </div>

    <div class="product-rank-cards">
      <div class="product-rank-card">
        <div class="product-rank-label">Category rank</div>
        <div class="product-rank-value">#${categoryRank}</div>
        <div class="product-rank-sub">of ${inCategory.length} in ${item.category}</div>
        <a href="${categoryHref}" class="see-all-link">See category ranking</a>
      </div>
      <div class="product-rank-card">
        <div class="product-rank-label">Overall</div>
        <div class="product-rank-value">#${overallRank}</div>
        <div class="product-rank-sub">of ${all.length} on the board</div>
        <a href="./index.html" class="see-all-link">See overall ranking</a>
      </div>
    </div>

    <section class="product-about">
      <h2>About this ranking</h2>
      <p class="product-about-lede">
        The listing was last claimed ${item.timestamp.toLowerCase()}.
        ${item.clicks.toLocaleString('en-IN')} visitor${item.clicks === 1 ? ' has' : 's have'} opened ${item.domain}.
      </p>

      <h3>What rank does ${item.title} hold on BidSpot?</h3>
      <p>
        ${item.title} has bid ${formatINR(item.amountINR)} on BidSpot to rank
        #${categoryRank} of ${inCategory.length} in ${item.category}, and
        #${overallRank} of ${all.length} overall.
      </p>

      <h3>Has ${item.title} bid today?</h3>
      <p>
        ${item.amountTodayINR > 0
          ? `Yes — ${formatINR(item.amountTodayINR)} of that total was bid in the current 24-hour cycle, so it's on <a href="./today.html">today's board</a>.`
          : `No — ${item.title} hasn't added to its total in the current 24-hour cycle, so it isn't on <a href="./today.html">today's board</a>.`}
      </p>

      <h3>How do I outrank ${item.title}?</h3>
      <p>
        Anyone can take this spot by bidding ${formatINR(toOutbidINR)} or more on the
        ${item.category} board. Rankings are ordered purely by total bid amount — see the
        <a href="./rules.html">House Rules</a> for how that's calculated.
      </p>

      <a href="./index.html?outbid=${encodeURIComponent(item.id)}" class="btn-primary product-claim-btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 13 5 5"></path><path d="m3 21 3-3"></path><path d="m9 15 2 2"></path><path d="m11 9 5 5"></path><path d="m13 3 6 6-6 6-6-6 6-6Z"></path></svg>
        <span>Claim this rank for ${formatINR(toOutbidINR)}</span>
      </a>
    </section>

    ${peers.length > 0 ? `
      <section class="product-peers">
        <div class="section-heading-row">
          <h2>Also in ${item.category}</h2>
          <a href="${categoryHref}" class="see-all-link">See all →</a>
        </div>
        <div class="peer-rank-list">
          ${peers.map((peer) => miniRankRow(peer, inCategory.findIndex((i) => i.id === peer.id) + 1)).join('')}
        </div>
      </section>
    ` : ''}
  `;

  const logoEl = document.getElementById('product-logo');
  if (logoEl) renderLogo(logoEl, item.domain, { text: item.logoText, bg: item.logoBg });

  container.querySelectorAll('.peer-rank-logo').forEach((el) => {
    renderLogo(el, el.dataset.domain, { text: el.dataset.text, bg: el.dataset.bg });
  });

  // Both the domain link and the Visit button leave for the listing's own site —
  // count either as a click, the same as the leaderboard card does.
  container.querySelectorAll('.js-outbound').forEach((el) => {
    el.addEventListener('click', () => trackClick(item.id));
  });

  const copyBtn = document.getElementById('copy-link-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        const label = copyBtn.querySelector('span');
        if (label) {
          label.textContent = 'Copied';
          setTimeout(() => { label.textContent = 'Copy link'; }, 1800);
        }
      } catch {
        // Clipboard access can be denied (insecure context, permissions) — say so
        // rather than silently doing nothing and looking broken.
        const label = copyBtn.querySelector('span');
        if (label) {
          label.textContent = 'Copy failed';
          setTimeout(() => { label.textContent = 'Copy link'; }, 1800);
        }
      }
    });
  }
}

render();
