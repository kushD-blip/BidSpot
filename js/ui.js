/* BidSpot — The Bidding House for Website Traffic */
/* Dynamic UI Rendering & Text Navigation System */

import { state } from './state.js';
import { confettiEngine } from './confetti.js';
import { renderLogo } from './get-logo.js';
import { submitListing, trackClick, fetchActivityFeed, subscribeToActivityFeed } from './supabase-client.js';
import { isSupabaseConfigured } from './config.js';
import { escapeHtml, unescapeHtml, formatClicks, MIN_BID_INR } from './listing-mapper.js';
import { COUNTRIES, OTHER_COUNTRY, findCountry, toE164 } from './country-codes.js';

/** One row of the activity ticker, rendered from an `activity_feed` row. Amount
    is in paise (per schema.sql). Kept above the class so the helper is easy to
    find rather than buried inside a member. */
function activityItemHtml(row) {
  const inr = "₹" + Math.round(((row.amount || 0) / 100)).toLocaleString("en-IN");
  const name = escapeHtml(row.listing_name || "Someone");
  const when = shortTimeAgo(row.created_at);
  return `
    <span class="activity-item">
      <strong>${name}</strong>
      <span>bid</span>
      <span class="activity-amount">${inr}</span>
      <span class="activity-dot">·</span>
      <span class="activity-time">${when}</span>
    </span>
  `;
}

/** Ticker-friendly relative time — deliberately shorter than listing-mapper's
    timeAgo(). "2m ago" not "2 minutes ago" — the ticker has limited width. */
function shortTimeAgo(iso) {
  if (!iso) return "just now";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Parses a fetch Response as JSON, but fails with a readable message instead of a
    raw "Unexpected token '<'..." SyntaxError if the server actually returned an
    HTML error page (e.g. a misrouted/unreachable API endpoint) instead of JSON. */
async function parseJsonResponse(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Server returned an unexpected response (status ${res.status}). Please try again shortly.`);
  }
}

class UIManager {
  constructor() {
    this.selectedBidAmountUSD = state.getMinBidForRank1();
    // getMinBidForRank1() is computed here before Supabase's real listings have
    // loaded (state.items is still empty), so it starts as the flat ₹100 floor.
    // Track whether the visitor has actually touched the +/- stepper themselves —
    // until they do, updateHeroPriceDisplay() keeps this pinned to "cost to beat
    // the current #1", so it doesn't stay frozen at ₹100 once real bids exist.
    this.bidAmountManuallySet = false;
    // Single payment route through Razorpay Checkout — bidders pick card, UPI or
    // netbanking inside Razorpay's own popup. We deliberately don't collect card
    // details on our own screen (that would put us in PCI SAQ D scope), and the
    // in-house UPI QR was removed because a static VPA can't tie a payment to a
    // specific bid and the raw QR flow was giving people cold feet on a real bid.
    this.pendingConfirmData = null;
    // Which category the current selectedBidAmountUSD was priced against, so
    // updateHeroPriceDisplay() can re-anchor the suggestion when it changes.
    this.lastPricedCategory = state.categoryFilter;
  }

  /** What it costs to take a given listing's spot: one increment above its total,
      using the same proportional rule as the hero stepper (1%, floored at ₹10)
      rather than the flat "+$5" (≈₹425) this used to hardcode — which was more
      than four times the entire ₹100 minimum bid on a quiet board. */
  outbidAmountUSD(item) {
    const currentINR = item.amountINR ?? state.convertUSDToINR(item.amountUSD);
    const incrementINR = Math.max(10, Math.round(currentINR * 0.01));
    return state.convertINRToUSD(currentINR + incrementINR);
  }

  init() {
    this.bindEvents();
    this.render();
    this.renderCountryCodePickers();
    this.initCategoryAutoScroll();
    this.initActivityTicker();
    this.initHowItWorksScroll();
    state.subscribe(() => this.render());
  }

  /** Fades the "How it works" strip out when the visitor scrolls down and back
      in when they scroll up. Uses opacity + transform (both compositor-only)
      rather than height so nothing reflows; a rAF gate keeps the scroll handler
      cheap; a small threshold ignores wheel/touch jitter so it doesn't flicker
      on a single tick of movement. */
  initHowItWorksScroll() {
    const section = document.querySelector('.how-it-works');
    if (!section) return;

    let lastY = window.scrollY;
    let ticking = false;
    const JITTER_PX = 6;

    const update = () => {
      const y = window.scrollY;
      const dy = y - lastY;
      if (Math.abs(dy) >= JITTER_PX) {
        // Going down (dy > 0) hides; going up (dy < 0) reveals. toggle(force)
        // sets state deterministically so a fast scroll can't leave it stuck.
        section.classList.toggle('scrolled-past', dy > 0);
        lastY = y;
      }
      ticking = false;
    };

    window.addEventListener('scroll', () => {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    }, { passive: true });
  }

  /** Fills both country pickers on the checkout form from the shared list in
      country-codes.js. Runs once at startup — the list is static, and re-rendering
      on every state change would blow away whatever the visitor had picked. */
  renderCountryCodePickers() {
    const phoneCC = document.getElementById('contact-phone-cc');
    if (phoneCC && phoneCC.options.length === 0) {
      // Trigger stays narrow: flag + dial code only ("🇮🇳 +91"). Full country name
      // still appears in the dropdown while it's open, and screen readers hear it
      // via aria-label on the trigger.
      phoneCC.innerHTML = COUNTRIES.map((c) =>
        `<option value="${c.iso}" data-dial="${c.dial}" title="${escapeHtml(c.name)}">${c.flag} ${c.dial}</option>`
      ).join('');
      phoneCC.value = 'IN';
    }

    const country = document.getElementById('contact-country');
    if (country && country.options.length === 0) {
      country.innerHTML = COUNTRIES.map((c) =>
        `<option value="${c.iso}">${c.name}</option>`
      ).join('') + `<option value="${OTHER_COUNTRY.iso}">${OTHER_COUNTRY.name}</option>`;
      country.value = 'IN';
    }

    // Convenience: picking a country in the address dropdown updates the phone
    // dial code to match, unless the visitor has already touched it themselves.
    // A US-based bidder addressing a US billing address probably wants +1 by
    // default, but a bidder in India with an out-of-country phone (or vice
    // versa) shouldn't have their phone silently rewritten.
    if (country && phoneCC && !country.dataset.bound) {
      country.dataset.bound = 'true';
      country.addEventListener('change', () => {
        if (phoneCC.dataset.touched === 'true') return;
        const match = findCountry(country.value);
        if (match) phoneCC.value = match.iso;
      });
      phoneCC.addEventListener('change', () => { phoneCC.dataset.touched = 'true'; });
    }
  }

  // Slowly drifts the category chip row back and forth so every category (29 of
  // them, only a handful fit at once) surfaces on its own without the visitor having
  // to discover it's horizontally scrollable. Pauses on hover/touch/focus so it never
  // fights an actual click, and stays still entirely once everything already fits
  // (maxScroll <= 0, e.g. on a very wide viewport).
  initCategoryAutoScroll() {
    // "All" and "Explore" are pinned outside this — only the categories roll.
    const bar = document.getElementById('category-scroll');
    if (!bar) return;

    let direction = 1;
    let paused = false;
    let resumeTimer = null;

    const pause = () => {
      paused = true;
      clearTimeout(resumeTimer);
    };
    const scheduleResume = () => {
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => { paused = false; }, 2000);
    };

    bar.addEventListener('mouseenter', pause);
    bar.addEventListener('mouseleave', scheduleResume);
    bar.addEventListener('touchstart', pause, { passive: true });
    bar.addEventListener('touchend', scheduleResume);
    bar.addEventListener('focusin', pause);
    bar.addEventListener('focusout', scheduleResume);
    // No dedicated 'wheel' handler: the cursor can't be over the bar to wheel-scroll
    // it without mouseenter having already paused it, and a wheel-triggered resume
    // timer used to fire mid-hover — auto-scroll would resume under the user's
    // cursor a couple seconds after their last scroll tick even though they'd
    // never left the bar.

    const step = () => {
      if (!paused) {
        const maxScroll = bar.scrollWidth - bar.clientWidth;
        if (maxScroll > 0) {
          bar.scrollLeft += direction * 0.5;
          if (bar.scrollLeft >= maxScroll) direction = -1;
          else if (bar.scrollLeft <= 0) direction = 1;
        }
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  bindEvents() {
    // Theme Toggle (Icon + Text: Sun / Moon)
    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        const nextTheme = state.theme === 'dark' ? 'light' : 'dark';
        state.setTheme(nextTheme);
      });
    }

    // Currency Toggle (INR / USD)
    const inrBtn = document.getElementById('curr-inr');
    const usdBtn = document.getElementById('curr-usd');
    if (inrBtn && usdBtn) {
      inrBtn.addEventListener('click', () => {
        state.setCurrency('INR');
      });
      usdBtn.addEventListener('click', () => {
        state.setCurrency('USD');
      });
    }

    // Category Chips
    ['category-bar', 'category-chips'].forEach(id => {
      const container = document.getElementById(id);
      if (container) {
        container.addEventListener('click', (e) => {
          const chip = e.target.closest('.category-chip, .chip');
          // The "Explore" chip is a real link to categories.html, not a filter —
          // it has no data-category, so let its own navigation happen instead of
          // setting the filter to undefined.
          if (chip && chip.dataset.category) {
            state.setCategory(chip.dataset.category);
          }
        });
      }
    });

    // Featured Category Showcase Cards inside Sidebar & Explorer Modal
    document.querySelectorAll('.sidebar-category-card, .btn-explore-category-small, .modal-cat-box').forEach(card => {
      card.addEventListener('click', (e) => {
        const target = e.target.closest('[data-category]');
        if (target) {
          const cat = target.dataset.category;
          if (cat) {
            state.setCategory(cat);
            this.closeAllModals();
            const listEl = document.getElementById('leaderboard-list');
            if (listEl) listEl.scrollIntoView({ behavior: 'smooth' });
          }
        }
      });
    });

    // Time Toggle Pill
    const timePill = document.getElementById('time-toggle-pill');
    if (timePill) {
      timePill.addEventListener('click', (e) => {
        const btn = e.target.closest('.time-option');
        if (btn) {
          const timeVal = btn.dataset.time;
          state.setTimeFilter(timeVal);
        }
      });
    }

    // Hero category picker — the same selection as the chip bar above it, so
    // choosing here re-ranks the board and re-prices the headline identically.
    const heroCatSelect = document.getElementById('claim-category-select');
    if (heroCatSelect) {
      heroCatSelect.addEventListener('change', () => {
        if (heroCatSelect.value) state.setCategory(heroCatSelect.value);
      });
    }

    // Hero Bid Form
    const heroForm = document.getElementById('hero-claim-form');
    if (heroForm) {
      heroForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const urlInput = document.getElementById('claim-url-input');
        const catSelect = document.getElementById('claim-category-select');
        const url = urlInput ? urlInput.value.trim() : '';
        const cat = catSelect && catSelect.value;

        // The select is `required`, so the browser blocks submit before this in
        // normal use — this covers the case where it's somehow bypassed, rather
        // than silently filing the listing under Productivity as it used to.
        if (!cat) {
          this.showToast("Pick a category for your listing first.", "warning");
          catSelect?.focus();
          return;
        }

        const projectedRank = state.getProjectedRank(this.selectedBidAmountUSD, cat);
        this.openConfirmRankModal(String(projectedRank), this.selectedBidAmountUSD, `BidSpot Rank #${projectedRank} Spot`, cat, url);
      });
    }

    // Hero Price Adjust Buttons (+ / -) -> Dynamically updates rank position!
    const decBtn = document.getElementById('hero-dec-btn');
    const incBtn = document.getElementById('hero-inc-btn');
    if (decBtn && incBtn) {
      // Dynamic, proportional step (1% of the current amount, floored at ₹10) instead
      // of a flat ±50 that made no sense once real bids start at ₹100, not thousands.
      // Never lets the amount drop below the real ₹100 minimum.
      decBtn.addEventListener('click', () => {
        this.bidAmountManuallySet = true;
        const currentINR = state.convertUSDToINR(this.selectedBidAmountUSD);
        const step = Math.max(10, Math.round(currentINR * 0.01));
        this.selectedBidAmountUSD = state.convertINRToUSD(Math.max(MIN_BID_INR, currentINR - step));
        this.updateHeroPriceDisplay();
      });
      incBtn.addEventListener('click', () => {
        this.bidAmountManuallySet = true;
        const currentINR = state.convertUSDToINR(this.selectedBidAmountUSD);
        const step = Math.max(10, Math.round(currentINR * 0.01));
        this.selectedBidAmountUSD = state.convertINRToUSD(currentINR + step);
        this.updateHeroPriceDisplay();
      });
    }

    // Search Toggle
    const searchToggleBtn = document.getElementById('search-toggle-btn');
    const searchDropdown = document.getElementById('header-search-dropdown');
    const closeSearchBtn = document.getElementById('close-search-btn');
    const searchInput = document.getElementById('header-search-input');

    if (searchToggleBtn && searchDropdown) {
      searchToggleBtn.addEventListener('click', () => {
        const isHidden = searchDropdown.style.display === 'none';
        searchDropdown.style.display = isHidden ? 'flex' : 'none';
        if (isHidden && searchInput) searchInput.focus();
      });
    }

    if (closeSearchBtn && searchDropdown) {
      closeSearchBtn.addEventListener('click', () => {
        searchDropdown.style.display = 'none';
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        this.filterBySearchQuery(query);
      });
    }

    // Modal Triggers (Document-level delegation)
    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-modal-target]');
      if (trigger) {
        e.preventDefault();
        const targetId = trigger.dataset.modalTarget;
        this.openModal(targetId);
      }
    });

    // Close Modals
    document.querySelectorAll('.close-modal-btn, .modal-overlay').forEach(btn => {
      btn.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay') || e.target.classList.contains('close-modal-btn')) {
          this.closeAllModals();
        }
      });
    });

    // Step 1 -> Step 2 Modal Transition
    const continueCheckoutBtn = document.getElementById('continue-to-checkout-btn');
    if (continueCheckoutBtn) {
      continueCheckoutBtn.addEventListener('click', () => {
        const termsCheck = document.getElementById('terms-checkbox-confirm');
        if (termsCheck && !termsCheck.checked) {
          this.showToast("Please agree to the House Terms to proceed.", "warning");
          return;
        }
        this.closeModal('modal-confirm-rank');

        if (this.pendingConfirmData) {
          const { url, category, minUSD, listingId } = this.pendingConfirmData;
          // Outbidding someone else's card (listingId set) means listing YOUR site
          // to beat theirs, so the form starts empty apart from the amount to beat
          // and their category. Their URL/title are deliberately not prefilled:
          // now that a bid on an already-listed URL tops that listing up, carrying
          // their URL into this form would have quietly turned "outbid them" into
          // "pay to push them further ahead". The hero form (no listingId) keeps
          // whatever the visitor actually typed.
          this.openBidModalWithData(listingId ? '' : url, category, minUSD, null);
        } else {
          this.openBidModalWithData('', state.categoryFilter, state.getMinBidForRank1(state.categoryFilter), null);
        }
      });
    }

    // Checkout modal's own internal Step 1 (listing + price) -> Step 2 (bidder info)
    const checkoutNextBtn = document.getElementById('checkout-next-btn');
    if (checkoutNextBtn) {
      checkoutNextBtn.addEventListener('click', () => this.goToCheckoutStep2());
    }
    const checkoutBackBtn = document.getElementById('checkout-back-btn');
    if (checkoutBackBtn) {
      checkoutBackBtn.addEventListener('click', () => this.showCheckoutStep(1));
    }

    // Step 2 Form Amount Listener
    const amountInput = document.getElementById('bid-amount-input');
    if (amountInput) {
      amountInput.addEventListener('input', () => {
        this.renderModalPriceBreakup();
      });
    }

    // Typed URL decides whether this bid creates a listing or tops up an existing
    // one, which also changes the projected rank — so re-check on every edit.
    const bidUrlInput = document.getElementById('bid-url-input');
    if (bidUrlInput) {
      bidUrlInput.addEventListener('input', () => {
        this.syncTopUpState();
        this.renderModalPriceBreakup();
      });
    }

    // Category drives the projected rank too (rank is per-category).
    const bidCatSelect = document.getElementById('bid-category-select');
    if (bidCatSelect) {
      bidCatSelect.addEventListener('change', () => this.renderModalPriceBreakup());
    }

    // Quick Preset Chips
    const presetsContainer = document.getElementById('bid-presets-container');
    if (presetsContainer) {
      presetsContainer.addEventListener('click', (e) => {
        const chip = e.target.closest('.preset-chip');
        if (!chip || !amountInput) return;

        const addUSD = Number(chip.dataset.addUsd || 0);
        const addINR = Number(chip.dataset.addInr || 0);

        if (state.currency === 'INR') {
          const currentINR = Number(amountInput.value || 0);
          amountInput.value = currentINR + (addINR || Math.round(addUSD * state.USD_TO_INR));
        } else {
          const currentUSD = Number(amountInput.value || 0);
          amountInput.value = currentUSD + (addUSD || Math.round(addINR / state.USD_TO_INR));
        }

        this.renderModalPriceBreakup();
      });
    }

    // Step 2 Bid Form Submission
    const submitBidForm = document.getElementById('submit-bid-form');
    if (submitBidForm) {
      submitBidForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleBidSubmission();
      });
    }
  }

  // togglePaymentMethodBoxes() and its UPI/Razorpay box switching are gone; a single
  // Razorpay Checkout is the only route and there is nothing to toggle any more.

  render() {
    // Each section renders independently — one throwing (e.g. on an unexpected
    // data shape from Supabase) used to abort every section after it in this
    // list silently, which is exactly how a single bad render call could freeze
    // the hero price *and* blank the leaderboard at once with no visible error.
    const sections = [
      ['renderHeaderStats', () => this.renderHeaderStats()],
      ['renderCategoryChips', () => this.renderCategoryChips()],
      ['renderTimeTogglePill', () => this.renderTimeTogglePill()],
      ['renderCurrencyToggle', () => this.renderCurrencyToggle()],
      ['updateHeroPriceDisplay', () => this.updateHeroPriceDisplay()],
      ['renderLeaderboard', () => this.renderLeaderboard()],
      ['renderTopTradersToday', () => this.renderTopTradersToday()],
      ['renderActivityFeed', () => this.renderActivityFeed()],
      ['syncThemeText', () => this.syncThemeText()],
      ['renderAnalyticsData', () => this.renderAnalyticsData()],
    ];
    for (const [name, fn] of sections) {
      try {
        fn();
      } catch (err) {
        console.error(`render(): ${name} failed`, err);
      }
    }
  }

  renderTopTradersToday() {
    const container = document.getElementById('top-traders-list');
    if (!container) return;

    const top5 = state.items.slice(0, 5);
    container.innerHTML = top5.map(item => `
      <div class="top-trader-card rank-${item.rank}" data-url="${item.url}" data-id="${item.id}" title="Click to visit ${item.domain}">
        <div class="trader-rank-num">#${item.rank}</div>
        <div class="trader-logo" style="background: ${item.logoBg};">
          ${item.logoText}
        </div>
        <div class="trader-info">
          <div class="trader-title">${item.title}</div>
        </div>
        <div class="trader-price">${state.formatListingAmount(item)}</div>
      </div>
    `).join('');

    container.querySelectorAll('.top-trader-card').forEach((card, idx) => {
      card.addEventListener('click', () => {
        const url = card.dataset.url;
        if (card.dataset.id) trackClick(card.dataset.id);
        if (url) window.open(url, '_blank');
      });
      const logoEl = card.querySelector('.trader-logo');
      const item = top5[idx];
      if (logoEl && item) {
        renderLogo(logoEl, item.domain, { text: item.logoText, bg: item.logoBg });
      }
    });
  }

  syncThemeText() {
    const isDark = state.theme === 'dark';
    const themeTextSpan = document.getElementById('theme-text-span');
    const themeIconSvg = document.getElementById('theme-icon-svg');

    if (themeTextSpan) {
      themeTextSpan.textContent = isDark ? 'Light' : 'Dark';
    }

    if (themeIconSvg) {
      if (isDark) {
        // Sun SVG Icon when in Dark mode (to switch to Light)
        themeIconSvg.innerHTML = `<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>`;
      } else {
        // Moon SVG Icon when in Light mode (to switch to Dark)
        themeIconSvg.innerHTML = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>`;
      }
    }
  }

  renderHeaderStats() {
    const pillText = document.getElementById('header-stats-text');
    if (!pillText) return;
    const stats = state.getLiveStats();
    // "Viewing now" not "Active Bidders": presence is who's on the site, not who
    // has bid. "Viewing now" reads right at any count (1 viewing now, 5 viewing
    // now) where "1 viewers" or "1 bidders" would not. displayRevenueFormatted
    // is the real cumulative bid volume, straight from the ledger.
    pillText.innerHTML = `<strong>${stats.activeOnlineFormatted} viewing now</strong> · ${stats.displayRevenueFormatted} Volume · Analytics`;
  }

  renderAnalyticsData() {
    const stats = state.getLiveStats();
    const onlineEl = document.getElementById('analytics-online-val');
    const revEl = document.getElementById('analytics-revenue-val');
    const visEl = document.getElementById('analytics-visitors-val');
    const prodEl = document.getElementById('analytics-products-val');

    if (onlineEl) onlineEl.textContent = stats.activeOnlineFormatted;
    if (revEl) revEl.textContent = stats.displayRevenueFormatted;
    if (visEl) visEl.textContent = stats.totalVisitorsFormatted;
    if (prodEl) prodEl.textContent = stats.totalProductsFormatted;
  }

  /** Builds the rolling chip row and both category dropdowns from state.getCategories()
      — the database, not a hardcoded copy. Rebuilds only when the category list itself
      actually changes, because replacing the row's innerHTML on every render() would
      reset the auto-scroll position (and the visitor's own scroll) several times a
      second. The fixed "All" and "Explore" chips live in index.html and aren't touched:
      neither is a category. */
  renderCategoryChips() {
    const categories = state.getCategories();
    const signature = categories.map((c) => c.name).join('|');

    if (signature !== this.renderedCategorySignature) {
      this.renderedCategorySignature = signature;

      const scroll = document.getElementById('category-scroll');
      if (scroll) {
        scroll.innerHTML = categories
          .map((cat) => `
            <button class="category-chip" data-category="${escapeHtml(cat.name)}">
              <span class="chip-icon-emoji">${escapeHtml(cat.icon || '🏷️')}</span>
              <span>${escapeHtml(cat.name)}</span>
            </button>
          `)
          .join('');
      }

      this.renderCategoryOptions(categories);
    }

    document.querySelectorAll('.category-chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.category === state.categoryFilter);
    });
  }

  /** Fills the hero and checkout category pickers. Each keeps its own current value
      across a rebuild — the list can refresh underneath a half-filled checkout form
      and must not silently clear the category the bidder already chose. */
  renderCategoryOptions(categories) {
    ['claim-category-select', 'bid-category-select'].forEach((id) => {
      const select = document.getElementById(id);
      if (!select) return;
      const previous = select.value;
      select.innerHTML = `<option value="" disabled${previous ? '' : ' selected'}>Select Category</option>`
        + categories
            .map((cat) => `<option value="${escapeHtml(cat.name)}">${escapeHtml(cat.name)}</option>`)
            .join('');
      if (previous) select.value = previous;
    });
  }

  renderTimeTogglePill() {
    document.querySelectorAll('.time-option').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.time === state.timeFilter);
    });
  }

  renderCurrencyToggle() {
    const inrBtn = document.getElementById('curr-inr');
    const usdBtn = document.getElementById('curr-usd');
    if (inrBtn) inrBtn.classList.toggle('active', state.currency === 'INR');
    if (usdBtn) usdBtn.classList.toggle('active', state.currency === 'USD');
  }

  // Updates the hero headline price AND the target rank — both scoped to whichever
  // category is currently selected, so the headline names the same board the
  // leaderboard below it is showing ("Claim Spot #2 in Fintech").
  updateHeroPriceDisplay() {
    const category = state.categoryFilter;

    // Switching category changes which listings you'd actually be competing with,
    // so a price the visitor hadn't hand-picked should re-anchor to the new
    // category's floor instead of staying pinned to the previous one's.
    if (this.lastPricedCategory !== category) {
      this.lastPricedCategory = category;
      this.bidAmountManuallySet = false;
    }

    if (!this.bidAmountManuallySet) {
      this.selectedBidAmountUSD = state.getMinBidForRank1(category);
    }
    const projectedRank = state.getProjectedRank(this.selectedBidAmountUSD, category);

    const heroPriceEl = document.getElementById('hero-price-display');
    if (heroPriceEl) {
      heroPriceEl.textContent = state.formatAmount(this.selectedBidAmountUSD);
    }

    const headlineLabel = document.getElementById('hero-headline-label');
    if (headlineLabel) {
      const inCategory = category && category !== 'All'
        ? ` in <span class="hero-category-name">${escapeHtml(category)}</span>`
        : '';
      headlineLabel.innerHTML = `Claim Spot <span class="hero-rank-num">#${projectedRank}</span>${inCategory} Floor:`;
    }

    // One notion of "which category am I bidding into": the chips and this select
    // are two controls over the same state.categoryFilter, so keep them in step.
    const catSelect = document.getElementById('claim-category-select');
    if (catSelect) {
      catSelect.value = category && category !== 'All' ? category : '';
    }
  }

  renderLeaderboard() {
    const container = document.getElementById('leaderboard-list');
    if (!container) return;

    const isCategoryView = state.categoryFilter !== 'All';
    const filteredItems = state.getItemsInCategory(state.categoryFilter);

    // While a category is selected the board is that category's own ranking, so
    // the cards count 1, 2, 3… within it. Showing each listing's global rank here
    // (#7, #12, #31) made a 3-listing category look like a broken, gap-riddled
    // list. item.rank is still the board-wide rank and is what the "All" view uses.
    const rankOf = (item, idx) => (isCategoryView ? idx + 1 : item.rank);

    if (filteredItems.length === 0) {
      const isWholeBoardEmpty = state.items.length === 0;
      container.innerHTML = isWholeBoardEmpty ? `
        <div style="text-align: center; padding: 56px 24px; color: var(--text-secondary);">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:12px;"><path d="m14 13 5 5"></path><path d="m3 21 3-3"></path><path d="m9 15 2 2"></path><path d="m11 9 5 5"></path><path d="m13 3 6 6-6 6-6-6 6-6Z"></path></svg>
          <h3 style="font-family: var(--font-serif); font-size: 1.3rem; color: var(--text-primary); margin-bottom: 6px;">No one's claimed a spot yet</h3>
          <p style="font-size: 0.92rem; max-width: 360px; margin: 0 auto 18px;">This board is brand new — be the very first listing and claim Rank #1 for as little as ₹100.</p>
          <button type="button" class="btn-primary" id="empty-state-claim-btn" style="margin: 0 auto;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m14 13 5 5"></path><path d="m3 21 3-3"></path><path d="m9 15 2 2"></path><path d="m11 9 5 5"></path><path d="m13 3 6 6-6 6-6-6 6-6Z"></path></svg>
            <span>Claim Rank #1</span>
          </button>
        </div>
      ` : `
        <div style="text-align: center; padding: 40px; color: var(--text-secondary);">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:8px; opacity:0.5;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <h3 style="font-family: var(--font-serif);">No spots found</h3>
          <p style="font-size: 0.88rem;">Be the first bidder in this category!</p>
        </div>
      `;

      const claimBtn = document.getElementById('empty-state-claim-btn');
      if (claimBtn) {
        claimBtn.addEventListener('click', () => {
          const heroInput = document.getElementById('claim-url-input');
          document.querySelector('.hero-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          heroInput?.focus();
        });
      }
      return;
    }

    container.innerHTML = filteredItems.map((item, idx) => `
      <div class="leaderboard-card rank-${rankOf(item, idx)}" data-url="${item.url}" data-id="${item.id}">
        <button class="hover-claim-pill" data-outbid-id="${item.id}" data-min-usd="${this.outbidAmountUSD(item)}">
          <svg class="gavel-icon-svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m14 13 5 5"></path><path d="m3 21 3-3"></path><path d="m9 15 2 2"></path><path d="m11 9 5 5"></path><path d="m13 3 6 6-6 6-6-6 6-6Z"></path></svg>
          <span>Place Bid: ${state.formatAmount(this.outbidAmountUSD(item))}</span>
        </button>
        <div class="card-rank">#${rankOf(item, idx)}</div>

        <div class="card-logo" style="background: ${item.logoBg};">
          ${item.logoText}
        </div>

        <div class="card-details">
          <div class="card-title-row">
            <h3 class="card-title">${item.title}</h3>
            ${item.verified ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" title="Verified Spot"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>` : ''}
            ${item.foundingBidder ? `<span class="founding-badge" title="Founding Bidder — one of the first listings ever to claim a spot on BidSpot."><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>Founding</span>` : ''}
          </div>
          <p class="card-tagline">${item.tagline}</p>
          <div class="card-meta">
            <a href="./index.html?category=${encodeURIComponent(item.category)}" class="category-tag" onclick="event.stopPropagation();">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path></svg>
              ${item.category}
            </a>
            <span class="meta-item">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 16 14"></polyline></svg>
              ${item.timestamp}
            </span>
            <a href="${item.url}" target="_blank" class="meta-link" onclick="event.stopPropagation();">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
              ${item.domain}
            </a>
            <span class="meta-item">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
              ${formatClicks(item.clicks)}
            </span>
            <a href="./product.html?id=${item.id}" class="meta-details-btn" style="text-decoration: underline;" onclick="event.stopPropagation();">
              see details
            </a>
          </div>
        </div>

        <div class="card-price-section">
          <span class="card-price-label">FLOOR BID</span>
          <span class="card-price">${state.formatListingAmount(item)}</span>
        </div>
      </div>
    `).join('');

    // Entire card click opens company URL
    container.querySelectorAll('.leaderboard-card').forEach((card, idx) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.hover-claim-pill') || e.target.closest('.meta-details-btn') || e.target.closest('.meta-link') || e.target.closest('.category-tag')) return;
        const targetUrl = card.dataset.url;
        if (card.dataset.id) trackClick(card.dataset.id);
        if (targetUrl) window.open(targetUrl, '_blank');
      });
      const logoEl = card.querySelector('.card-logo');
      const item = filteredItems[idx];
      if (logoEl && item) {
        renderLogo(logoEl, item.domain, { text: item.logoText, bg: item.logoBg });
      }
    });

    // The domain link inside the card navigates directly (not via the card's own
    // click handler above, which explicitly skips it) — count it here instead.
    container.querySelectorAll('.meta-link').forEach((link, idx) => {
      const item = filteredItems[idx];
      if (item) link.addEventListener('click', () => trackClick(item.id));
    });

    // Hover "Place Bid" pill — direct outbid CTA (see details is now a real link to product.html)
    container.querySelectorAll('.hover-claim-pill').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const minUsd = Number(btn.dataset.minUsd);
        const card = btn.closest('.leaderboard-card');
        const rankText = card ? card.querySelector('.card-rank')?.textContent.replace('#', '') : '1';
        const title = card ? card.querySelector('.card-title')?.textContent : '';
        const category = card ? card.querySelector('.category-tag')?.textContent.trim() : '';
        const url = card ? card.dataset.url : '';
        const listingId = btn.dataset.outbidId || null;
        this.openConfirmRankModal(rankText, minUsd, title, category, url, listingId);
      });
    });
  }

  openConfirmRankModal(rankText, minUSD, title, category, url, listingId = null) {
    this.pendingConfirmData = { rankText, minUSD, title, category, url, listingId };

    const confirmRankBadge = document.getElementById('confirm-rank-badge');
    const confirmPriceDisplay = document.getElementById('confirm-price-display');
    const confirmTargetSub = document.getElementById('confirm-target-sub');

    if (confirmRankBadge) confirmRankBadge.textContent = `#${rankText}`;
    if (confirmPriceDisplay) confirmPriceDisplay.textContent = state.formatAmount(minUSD);
    if (confirmTargetSub) confirmTargetSub.textContent = `${category} Category`;

    this.openModal('modal-confirm-rank');
  }

  /** Re-checks the typed URL against the board and puts the checkout into either
      "new listing" or "top up the existing listing" mode. Called whenever the URL
      field changes. The existing listing's own category wins in top-up mode — a
      listing can't be in two categories, and its bids all pool into one total. */
  syncTopUpState() {
    const urlInput = document.getElementById('bid-url-input');
    const notice = document.getElementById('topup-notice');
    const titleEl = document.getElementById('topup-notice-title');
    const subEl = document.getElementById('topup-notice-sub');
    const titleInput = document.getElementById('bid-title-input');
    const catSelect = document.getElementById('bid-category-select');

    const match = state.findListingByUrl(urlInput ? urlInput.value : '');
    this.topUpListing = match;

    if (!notice) return;

    if (!match) {
      notice.hidden = true;
      if (titleInput) titleInput.readOnly = false;
      if (catSelect) catSelect.disabled = false;
      return;
    }

    // Title/category belong to the listing being topped up, so they're shown but
    // not editable here — changing them would silently rewrite someone's live
    // listing as a side effect of bidding on it.
    if (titleInput) {
      // An <input value> isn't HTML-parsed, so it needs the original text — the
      // mapper stores these fields escaped for innerHTML consumers.
      titleInput.value = unescapeHtml(match.title);
      titleInput.readOnly = true;
    }
    if (catSelect) {
      catSelect.value = match.category;
      catSelect.disabled = true;
    }

    const categoryRank = state.getItemsInCategory(match.category).indexOf(match) + 1;
    if (titleEl) titleEl.textContent = `${unescapeHtml(match.domain)} already holds a spot on the board.`;
    if (subEl) {
      subEl.textContent = `It's #${categoryRank} in ${match.category} with ${state.formatListingAmount(match)} bid so far. `
        + `This bid is added to that total instead of creating a second listing.`;
    }
    notice.hidden = false;
  }

  /** The category this checkout is bidding into: the existing listing's own when
      topping up, otherwise whatever the form has selected. */
  currentBidCategory() {
    if (this.topUpListing) return this.topUpListing.category;
    const catSelect = document.getElementById('bid-category-select');
    return (catSelect && catSelect.value) || state.categoryFilter;
  }

  renderModalPriceBreakup() {
    const amountInput = document.getElementById('bid-amount-input');
    const rawVal = Number(amountInput && amountInput.value ? amountInput.value : 0);

    let subtotalUSD = 0;
    let subtotalINR = 0;

    if (state.currency === 'INR') {
      subtotalINR = rawVal || state.convertUSDToINR(this.selectedBidAmountUSD);
      subtotalUSD = subtotalINR / state.USD_TO_INR;
    } else {
      subtotalUSD = rawVal || this.selectedBidAmountUSD;
      subtotalINR = subtotalUSD * state.USD_TO_INR;
    }

    // No GST is charged — this business has no GSTIN, and an unregistered seller
    // is not permitted to collect GST (CGST Act, s.32). The total payable is just
    // the bid itself; it used to add a display-only 18% that was never actually
    // charged by create-order.js, which was its own bug (promised total != real charge).
    const totalUSD = subtotalUSD;
    const totalINR = subtotalINR;

    // Ranked within the category being bid into, matching the board the visitor
    // is looking at. When topping up an existing listing the rank is driven by
    // its *resulting* total (what's already been bid + this bid), not by this
    // bid alone — a ₹200 top-up on a ₹50,000 listing doesn't drop it to last.
    const bidCategory = this.currentBidCategory();
    const effectiveUSD = this.topUpListing
      ? this.topUpListing.amountUSD + subtotalUSD
      : subtotalUSD;
    const projectedRank = state.getProjectedRank(effectiveUSD, bidCategory);

    // The floor bid on the home page can't go below ₹100 (see MIN_BID_INR), but this
    // field is a free-typed number input — enforce and surface the same floor here,
    // live, instead of only rejecting it after the user has already seen a full
    // checkout summary (handleBidSubmission checks this again at submit time).
    const isBelowMinBid = subtotalINR > 0 && subtotalINR < MIN_BID_INR;
    const amountErrorEl = document.getElementById('bid-amount-error');
    if (amountInput) amountInput.classList.toggle('input-error', isBelowMinBid);
    if (amountErrorEl) {
      amountErrorEl.textContent = isBelowMinBid ? `Minimum bid is ${state.formatINRExact(MIN_BID_INR)}.` : '';
      amountErrorEl.style.display = isBelowMinBid ? 'block' : 'none';
    }

    const titleInput = document.getElementById('bid-title-input');
    const currentTitle = titleInput && titleInput.value.trim() ? titleInput.value.trim() : `BidSpot Rank #${projectedRank} Spot`;

    const itemNameEl = document.getElementById('checkout-item-name');
    const itemBadgeEl = document.getElementById('checkout-item-rank-badge');
    const itemDisplayEl = document.getElementById('breakup-item-display');

    if (itemNameEl) itemNameEl.textContent = currentTitle;
    if (itemBadgeEl) itemBadgeEl.textContent = `#${projectedRank}`;
    if (itemDisplayEl) itemDisplayEl.textContent = currentTitle;

    const presetsContainer = document.getElementById('bid-presets-container');
    if (presetsContainer) {
      if (state.currency === 'INR') {
        presetsContainer.innerHTML = `
          <button type="button" class="preset-chip" data-add-inr="1000">+ ₹1,000</button>
          <button type="button" class="preset-chip" data-add-inr="5000">+ ₹5,000</button>
          <button type="button" class="preset-chip" data-add-inr="10000">+ ₹10,000</button>
          <button type="button" class="preset-chip" data-add-inr="50000">+ ₹50,000</button>
        `;
      } else {
        presetsContainer.innerHTML = `
          <button type="button" class="preset-chip" data-add-usd="50">+ $50</button>
          <button type="button" class="preset-chip" data-add-usd="100">+ $100</button>
          <button type="button" class="preset-chip" data-add-usd="500">+ $500</button>
          <button type="button" class="preset-chip" data-add-usd="1000">+ $1,000</button>
        `;
      }
    }

    const amountLabel = document.getElementById('bid-amount-label');
    if (amountLabel) {
      amountLabel.textContent = state.currency === 'INR' ? `Base Bid Amount (₹ INR) *` : `Base Bid Amount ($ USD) *`;
    }

    const equivBadge = document.getElementById('bid-equivalent-badge');
    if (equivBadge) {
      equivBadge.textContent = state.currency === 'INR' ? `≈ ${state.formatUSDExact(subtotalUSD)} (estimate, billed in INR)` : `≈ ${state.formatINRExact(subtotalINR)}`;
    }

    const subtotalUsdEl = document.getElementById('breakup-subtotal-usd');
    const subtotalInrEl = document.getElementById('breakup-subtotal-inr');
    const totalUsdEl = document.getElementById('breakup-total-usd');
    const totalInrEl = document.getElementById('breakup-total-inr');
    const rankBadgeEl = document.getElementById('breakup-projected-rank');

    if (subtotalUsdEl) subtotalUsdEl.textContent = `≈ ${state.formatUSDExact(subtotalUSD)} (estimate)`;
    if (subtotalInrEl) subtotalInrEl.textContent = state.formatINRExact(subtotalINR);
    if (totalUsdEl) totalUsdEl.textContent = `≈ ${state.formatUSDExact(totalUSD)} USD`;
    if (totalInrEl) totalInrEl.textContent = `${state.formatINRExact(totalINR)} INR`;

    if (rankBadgeEl) {
      rankBadgeEl.textContent = `#${projectedRank}`;
    }

    // The in-house UPI QR and its price sync are gone (see the note in
    // constructor()); Razorpay's popup handles UPI and everything else.

    const submitBtn = document.getElementById('submit-bid-btn');
    if (submitBtn) {
      const iconSVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m14 13 5 5"></path><path d="m3 21 3-3"></path><path d="m9 15 2 2"></path><path d="m11 9 5 5"></path><path d="m13 3 6 6-6 6-6-6 6-6Z"></path></svg>`;
      submitBtn.innerHTML = `${iconSVG} <span>Pay ${state.formatINRExact(totalINR)} securely</span>`;
      submitBtn.disabled = isBelowMinBid;
      submitBtn.style.opacity = isBelowMinBid ? '0.5' : '';
    }
  }

  // `prefillTitle` is only passed when this came from clicking "Outbid" on an
  // *existing* card — it's a suggested starting point (that listing's real name),
  // not a claim on that listing. Outbidding someone else's listing creates your
  // own new listing that beats it; the one case that does NOT create a new row is
  // bidding on a URL that's already on the board, which tops that listing up
  // instead (see syncTopUpState — House Rules allow one listing per website).
  openBidModalWithData(url = '', category = '', presetAmountUSD = null, prefillTitle = null) {
    const urlInput = document.getElementById('bid-url-input');
    const catSelect = document.getElementById('bid-category-select');
    const amountInput = document.getElementById('bid-amount-input');
    const titleInput = document.getElementById('bid-title-input');

    if (urlInput) urlInput.value = url;
    if (titleInput) titleInput.value = prefillTitle || '';
    // "All" is a board filter, not a category a listing can belong to — leave the
    // picker unset in that case so the bidder chooses, rather than silently
    // defaulting their listing into Productivity.
    if (catSelect) catSelect.value = !category || category === 'All' ? '' : category;

    const targetUSD = presetAmountUSD || this.selectedBidAmountUSD || state.getMinBidForRank1(category);
    this.selectedBidAmountUSD = targetUSD;
    if (amountInput) {
      amountInput.value = state.currency === 'INR' ? state.convertUSDToINR(targetUSD) : Math.round(targetUSD);
    }

    // Must run before renderModalPriceBreakup(): it decides the mode the breakup
    // is priced and ranked in, and may override the title/category set above.
    this.syncTopUpState();
    this.renderModalPriceBreakup();
    this.showCheckoutStep(1);
    this.openModal('modal-bid');
  }

  // Step 1: listing details + price. Step 2: bidder info + payment. Kept as two
  // plain divs toggled by display rather than separate modals — handleBidSubmission
  // already reads every field by id regardless of which step it's currently in.
  showCheckoutStep(step) {
    const step1 = document.getElementById('checkout-step-1');
    const step2 = document.getElementById('checkout-step-2');
    const badge = document.getElementById('checkout-step-badge');
    const title = document.getElementById('checkout-step-title');
    if (step1) step1.style.display = step === 1 ? 'flex' : 'none';
    if (step2) step2.style.display = step === 2 ? 'flex' : 'none';
    if (badge) badge.textContent = `Step ${step} of 2`;
    if (title) title.textContent = step === 1 ? 'Your Listing' : 'Your Details & Payment';
  }

  goToCheckoutStep2() {
    const title = document.getElementById('bid-title-input');
    const url = document.getElementById('bid-url-input');
    const amountInput = document.getElementById('bid-amount-input');

    const catSelect = document.getElementById('bid-category-select');

    if (!title || !title.value.trim() || !url || !url.value.trim()) {
      this.showToast("Add a title and URL before continuing.", "warning");
      return;
    }
    // Caught here rather than defaulted at submit time — a listing filed under a
    // category nobody chose is a wrong listing, not a reasonable fallback. (In
    // top-up mode the picker is disabled but carries the existing listing's
    // category, so this passes.)
    if (!this.topUpListing && (!catSelect || !catSelect.value)) {
      this.showToast("Pick a category for your listing before continuing.", "warning");
      catSelect?.focus();
      return;
    }
    if (amountInput && amountInput.classList.contains('input-error')) {
      this.showToast(`Minimum bid is ₹${MIN_BID_INR}.`, "warning");
      return;
    }
    this.showCheckoutStep(2);
  }

  async handleBidSubmission() {
    const titleInput = document.getElementById('bid-title-input');
    const urlInput = document.getElementById('bid-url-input');
    const taglineInput = document.getElementById('bid-tagline-input');
    const catSelect = document.getElementById('bid-category-select');
    const amountInput = document.getElementById('bid-amount-input');
    const nameInput = document.getElementById('contact-name');
    const emailInput = document.getElementById('contact-email');
    const phoneInput = document.getElementById('contact-phone');
    const phoneCCSelect = document.getElementById('contact-phone-cc');
    const countrySelect = document.getElementById('contact-country');

    const title = titleInput ? titleInput.value.trim() : '';
    let url = urlInput ? urlInput.value.trim() : '';
    const tagline = taglineInput ? taglineInput.value.trim() : '';
    // A disabled <select> still reports its value, so top-up mode correctly
    // carries the existing listing's category through here.
    const category = this.currentBidCategory();
    const bidderName = nameInput ? nameInput.value.trim() : '';
    const bidderEmail = emailInput ? emailInput.value.trim() : '';

    // Assemble a single E.164 phone string from picker + input so what we store,
    // send to Razorpay, and quote back to the bidder is one canonical value.
    const phoneCC = phoneCCSelect ? findCountry(phoneCCSelect.value) : null;
    const bidderPhone = toE164(phoneCC?.dial, phoneInput ? phoneInput.value : '');
    const bidderCountry = countrySelect ? countrySelect.value : '';

    const inputVal = Number(amountInput ? amountInput.value : 0);
    const amountUSD = state.currency === 'INR' ? (inputVal / state.USD_TO_INR) : inputVal;
    const amountRupees = state.currency === 'INR' ? inputVal : Math.round(inputVal * state.USD_TO_INR);

    if (!title || !url || amountUSD <= 0) {
      this.showToast("Please fill in all required fields.", "warning");
      return;
    }
    // "All" is the board filter leaking through as a fallback, not a real category.
    if (!category || category === 'All') {
      this.showToast("Pick a category for your listing.", "warning");
      this.showCheckoutStep(1);
      document.getElementById('bid-category-select')?.focus();
      return;
    }
    if (amountRupees < MIN_BID_INR) {
      this.showToast(`Minimum bid is ₹${MIN_BID_INR}.`, "warning");
      return;
    }

    if (!isSupabaseConfigured) {
      // No backend configured — local-only demo behavior.
      const newItem = state.addBid({ title, tagline, category, url, amountUSD });
      if (newItem.rank === 1) {
        confettiEngine.launch();
        this.showToast(`CONGRATULATIONS! You claimed Rank #1 spot with ${state.formatAmount(amountUSD)}!`, "success");
      } else {
        this.showToast(`Bid placed! Your listing is positioned at Rank #${newItem.rank}.`, "info");
      }
      this.closeModal('modal-bid');
      return;
    }

    if (!bidderName || !bidderEmail) {
      this.showToast("Please add your name and email for the receipt.", "warning");
      return;
    }
    // The picker guarantees the +CC part; the local number just needs digits.
    // Rejected here so an obvious typo (empty or three-digit "number") never
    // ships as junk metadata into the payment record.
    const localDigits = (phoneInput?.value || '').replace(/\D+/g, '');
    if (!bidderPhone || localDigits.length < 5) {
      this.showToast("Please add a valid phone number.", "warning");
      phoneInput?.focus();
      return;
    }
    if (!window.Razorpay) {
      this.showToast("Payment gateway didn't load — check your connection and try again.", "warning");
      return;
    }
    if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;

    this.setBidSubmitLoading(true);
    try {
      // Re-resolve against the live board rather than trusting the flag set while
      // typing — another visitor's listing for this domain could have gone live in
      // between (realtime keeps state.items current), and two listings for one site
      // is exactly what House Rules forbid.
      const existing = state.findListingByUrl(url);
      this.topUpListing = existing;

      let listingId;
      if (existing) {
        // Re-bidding a site that's already on the board: the bid is added to that
        // listing's running total by increment_listing_totals in verify-payment.js,
        // exactly as any of its earlier bids were. No new row, no duplicate.
        listingId = existing.id;
      } else {
        // A brand-new site: create its 'pending' listing. It only actually goes
        // live once payment clears, in verify-payment.js. "Outbidding" someone
        // else's card lands here too — it beats their listing with your own new
        // one, it does not add to theirs.
        const categoryRow = (state.categoriesFromDb || []).find((c) => c.name === category);
        const { data: newListing, error: submitErr } = await submitListing({
          name: title,
          url,
          tagline,
          categoryId: categoryRow ? categoryRow.id : null,
          ownerEmail: bidderEmail,
        });
        if (submitErr) throw new Error(submitErr.message || "Could not create your listing.");
        listingId = newListing.id;
      }

      const orderRes = await fetch('/api/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId, bidderName, bidderEmail, bidderPhone, bidderCountry,
          amountRupees, currency: 'INR',
        }),
      });
      const order = await parseJsonResponse(orderRes);
      if (!orderRes.ok) throw new Error(order.error || "Could not start checkout.");

      const rzp = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name: 'BidSpot.in',
        description: existing ? `Rank top-up — ${existing.title}` : `Rank bid — ${title}`,
        prefill: {
          name: bidderName,
          email: bidderEmail,
          // Razorpay expects the E.164 form here — the picker + toE164() already
          // produce that, so the checkout popup opens with the number ready.
          contact: bidderPhone,
        },
        theme: { color: '#8B1E2E' },
        handler: async (response) => {
          try {
            const verifyRes = await fetch('/api/verify-payment', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(response),
            });
            const verifyData = await parseJsonResponse(verifyRes);
            if (!verifyRes.ok || !verifyData.ok) throw new Error(verifyData.error || "Payment could not be verified.");

            confettiEngine.launch();
            this.showToast(
              existing
                ? `Payment confirmed! ${existing.title}'s bid total just went up.` // already escaped by the mapper
                : `Payment confirmed! ${escapeHtml(title)} is now live on the leaderboard.`,
              "success"
            );
            this.closeModal('modal-bid');
            await state.loadFromSupabase();
          } catch (err) {
            this.showToast(err.message || "Payment verification failed — contact support with your payment ID.", "warning");
          } finally {
            this.setBidSubmitLoading(false);
          }
        },
        modal: {
          ondismiss: () => this.setBidSubmitLoading(false),
        },
      });

      rzp.on('payment.failed', (resp) => {
        this.showToast(resp?.error?.description || "Payment failed. Please try again.", "warning");
        this.setBidSubmitLoading(false);
      });

      rzp.open();
    } catch (err) {
      console.error("handleBidSubmission error:", err);
      this.showToast(err.message || "Something went wrong. Please try again.", "warning");
      this.setBidSubmitLoading(false);
    }
  }

  setBidSubmitLoading(isLoading) {
    const submitBtn = document.getElementById('submit-bid-btn');
    if (!submitBtn) return;
    submitBtn.disabled = isLoading;
    submitBtn.style.opacity = isLoading ? '0.6' : '';
    submitBtn.style.pointerEvents = isLoading ? 'none' : '';
  }

  renderActivityFeed() {
    const feed = document.getElementById('activity-feed');
    if (!feed) return;
    const logs = state.getActivityLogs().slice(0, 5);
    feed.innerHTML = logs.map(log => `
      <div class="activity-item">
        <span>${log.message}</span>
      </div>
    `).join('');
  }

  /** Live activity ticker on the home page: reads from public.activity_feed
      (populated by verify-payment.js on every paid bid) and re-renders on
      realtime inserts. The whole strip is hidden when the feed is empty
      rather than an empty rail masquerading as activity. */
  async initActivityTicker() {
    const strip = document.getElementById('activity-ticker');
    const track = document.getElementById('activity-ticker-track');
    if (!strip || !track) return;

    const load = async () => {
      const rows = await fetchActivityFeed({ limit: 20 });
      if (!rows || rows.length === 0) {
        strip.hidden = true;
        return;
      }
      strip.hidden = false;

      // Duplicate the item list so the CSS marquee animation loops seamlessly
      // (transform: translateX(-50%) at the end lines up copy 2's start with
      // copy 1's start). Kept in a single wrapper for a single animation.
      const items = rows.map(activityItemHtml).join('');
      track.innerHTML = `<div class="activity-ticker-flow">${items}${items}</div>`;
    };

    await load();
    // Realtime: refetch on every insert into activity_feed. Cheap because the
    // fetch itself is a 20-row query with a covering index on created_at.
    subscribeToActivityFeed(load);
  }

  filterBySearchQuery(query) {
    if (!query) {
      this.renderLeaderboard();
      return;
    }
    const container = document.getElementById('leaderboard-list');
    if (!container) return;

    const matched = state.items.filter(item => 
      item.title.toLowerCase().includes(query) || 
      item.tagline.toLowerCase().includes(query) ||
      item.category.toLowerCase().includes(query) ||
      item.domain.toLowerCase().includes(query)
    );

    if (matched.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--text-secondary);">
          <h3 style="font-family: var(--font-serif);">No spots matching "${query}"</h3>
        </div>
      `;
      return;
    }

    container.innerHTML = matched.map(item => `
      <div class="leaderboard-card rank-${item.rank}" data-url="${item.url}">
        <div class="card-rank">#${item.rank}</div>
        <div class="card-details">
          <h3 class="card-title">${item.title}</h3>
          <p class="card-tagline">${item.tagline}</p>
        </div>
        <div class="card-price-section">
          <span class="card-price">${state.formatListingAmount(item)}</span>
        </div>
      </div>
    `).join('');
  }

  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('active');

    if (modalId === 'modal-daily') {
      this.renderDailySpotlight();
    }
  }

  renderDailySpotlight() {
    const container = document.getElementById('daily-spotlight-list');
    if (!container) return;

    const topSpots = state.items.slice(0, 5);
    container.innerHTML = topSpots.map(item => `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: var(--bg-secondary); border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-family: var(--font-serif); font-weight: 800; color: var(--accent-primary); font-size: 1.05rem;">#${item.rank}</span>
          <div>
            <div style="font-family: var(--font-serif); font-weight: 700; color: var(--text-primary); font-size: 0.92rem;">${item.title}</div>
            <div style="font-size: 0.76rem; color: var(--text-muted);">${item.category} · ${item.domain}</div>
          </div>
        </div>
        <span style="font-family: var(--font-serif); font-weight: 800; color: var(--accent-primary); font-size: 0.95rem;">${state.formatListingAmount(item)}</span>
      </div>
    `).join('');
  }

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
  }

  closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    let iconSVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;

    if (type === 'success') {
      iconSVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
    } else if (type === 'warning') {
      iconSVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 1-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 1 1.73-3z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
    } else if (type === 'copy') {
      iconSVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `${iconSVG} <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }
}

export const ui = new UIManager();


