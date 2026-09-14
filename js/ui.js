/* BidSpot — The Bidding House for Website Traffic */
/* Dynamic UI Rendering, Text Navigation System & Stock Market Session Timer */

import { state } from './state.js';
import { confettiEngine } from './confetti.js';
import { renderLogo } from './get-logo.js';
import { submitListing, trackClick } from './supabase-client.js';
import { isSupabaseConfigured } from './config.js';
import { escapeHtml, MIN_BID_INR } from './listing-mapper.js';

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
    this.selectedPaymentMethod = 'upi';
    this.pendingConfirmData = null;
  }

  init() {
    this.bindEvents();
    this.render();
    this.startTradingSessionTimer();
    this.initCategoryAutoScroll();
    state.subscribe(() => this.render());
  }

  // Slowly drifts the category chip row back and forth so every category (17 of
  // them, only ~9 fit at once) surfaces on its own without the visitor having to
  // discover it's horizontally scrollable. Pauses on hover/touch/focus so it never
  // fights an actual click, and stays still entirely once everything already fits
  // (maxScroll <= 0, e.g. on a wide desktop viewport).
  initCategoryAutoScroll() {
    // "All" is pinned outside this — only the rest of the categories roll.
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

    // Hero Bid Form
    const heroForm = document.getElementById('hero-claim-form');
    if (heroForm) {
      heroForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const urlInput = document.getElementById('claim-url-input');
        const catSelect = document.getElementById('claim-category-select');
        const url = urlInput ? urlInput.value.trim() : '';
        const cat = (catSelect && catSelect.value) || 'Productivity';
        
        const projectedRank = state.getProjectedRank(this.selectedBidAmountUSD);
        this.openConfirmRankModal(String(projectedRank), this.selectedBidAmountUSD, 'BidSpot Rank #' + projectedRank + ' Spot', cat, url);
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
          const { url, category, minUSD, listingId, title } = this.pendingConfirmData;
          // Only prefill the title when this came from an existing card's outbid
          // button (listingId set) — the hero form's placeholder title ("BidSpot
          // Rank #1 Spot") must never leak into the field for a fresh submission.
          this.openBidModalWithData(url, category, minUSD, listingId ? title : null);
        } else {
          this.openBidModalWithData('', 'Productivity', state.getMinBidForRank1(), null);
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

    // Payment Method Selector
    document.querySelectorAll('.payment-card').forEach(card => {
      card.addEventListener('click', () => {
        document.querySelectorAll('.payment-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        this.selectedPaymentMethod = card.dataset.method;
        this.togglePaymentMethodBoxes();
        this.renderModalPriceBreakup();
      });
    });

    // Copy VPA Button
    const copyUpiBtn = document.getElementById('copy-upi-btn');
    if (copyUpiBtn) {
      copyUpiBtn.addEventListener('click', () => {
        navigator.clipboard.writeText('bidspot@upi').then(() => {
          copyUpiBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin-right:4px;"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span>Copied!</span>
          `;
          setTimeout(() => {
            copyUpiBtn.innerHTML = `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin-right:4px;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              <span>Copy VPA</span>
            `;
          }, 2000);
          this.showToast("UPI ID (bidspot@upi) copied to clipboard!", "copy");
        }).catch(() => {
          this.showToast("UPI ID: bidspot@upi", "info");
        });
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

  togglePaymentMethodBoxes() {
    const upiBox = document.getElementById('upi-qr-box');
    const rzpBox = document.getElementById('razorpay-box');

    if (upiBox) upiBox.style.display = this.selectedPaymentMethod === 'upi' ? 'flex' : 'none';
    if (rzpBox) rzpBox.style.display = this.selectedPaymentMethod === 'razorpay' ? 'block' : 'none';
  }

  startTradingSessionTimer() {
    setInterval(() => {
      const marketTimer = state.getStockMarketTimer();
      const sidebarTimer = document.getElementById('sidebar-closing-timer');
      const sidebarLabel = document.getElementById('sidebar-timer-label');
      
      if (sidebarTimer) {
        sidebarTimer.textContent = marketTimer.displayString;
      }
      if (sidebarLabel) {
        sidebarLabel.textContent = marketTimer.label;
      }
    }, 1000);
  }

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
        <div class="trader-price">${state.formatAmount(item.amountUSD)}</div>
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
    pillText.innerHTML = `<strong>${stats.activeOnlineFormatted} Active Bidders</strong> · ${stats.displayRevenueFormatted} Volume · Analytics`;
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

  renderCategoryChips() {
    document.querySelectorAll('.category-chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.category === state.categoryFilter);
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

  // Updates Hero headline price AND dynamic target rank position (#1, #2, #5)!
  updateHeroPriceDisplay() {
    if (!this.bidAmountManuallySet) {
      this.selectedBidAmountUSD = state.getMinBidForRank1();
    }
    const projectedRank = state.getProjectedRank(this.selectedBidAmountUSD);
    
    const heroPriceEl = document.getElementById('hero-price-display');
    if (heroPriceEl) {
      heroPriceEl.textContent = state.formatAmount(this.selectedBidAmountUSD);
    }

    const headlineLabel = document.getElementById('hero-headline-label');
    if (headlineLabel) {
      headlineLabel.innerHTML = `Claim Spot <span class="hero-rank-num">#${projectedRank}</span> Floor:`;
    }
  }

  renderLeaderboard() {
    const container = document.getElementById('leaderboard-list');
    if (!container) return;

    let filteredItems = state.items;
    if (state.categoryFilter !== 'All') {
      filteredItems = filteredItems.filter(item => item.category === state.categoryFilter);
    }

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

    container.innerHTML = filteredItems.map(item => `
      <div class="leaderboard-card rank-${item.rank}" data-url="${item.url}" data-id="${item.id}">
        <button class="hover-claim-pill" data-outbid-id="${item.id}" data-min-usd="${item.amountUSD + 5}">
          <svg class="gavel-icon-svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m14 13 5 5"></path><path d="m3 21 3-3"></path><path d="m9 15 2 2"></path><path d="m11 9 5 5"></path><path d="m13 3 6 6-6 6-6-6 6-6Z"></path></svg>
          <span>Place Bid: ${state.formatAmount(item.amountUSD + 5)}</span>
        </button>
        <div class="card-rank">#${item.rank}</div>
        
        <div class="card-logo" style="background: ${item.logoBg};">
          ${item.logoText}
        </div>

        <div class="card-details">
          <div class="card-title-row">
            <h3 class="card-title">${item.title}</h3>
            ${item.verified ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" title="Verified Spot"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>` : ''}
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
              ${item.clicks.toLocaleString()} clicks
            </span>
            <a href="./product.html?id=${item.id}" class="meta-details-btn" style="text-decoration: underline;" onclick="event.stopPropagation();">
              see details
            </a>
          </div>
        </div>

        <div class="card-price-section">
          <span class="card-price-label">FLOOR BID</span>
          <span class="card-price">${state.formatAmount(item.amountUSD)}</span>
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
        const category = card ? card.querySelector('.category-tag')?.textContent.trim() : 'Productivity';
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

    const projectedRank = state.getProjectedRank(subtotalUSD);

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

    const upiAmountText = document.getElementById('upi-qr-amount-text');
    if (upiAmountText) {
      upiAmountText.textContent = `Amount: ${state.formatINRExact(totalINR)}`;
    }

    const upiQrImg = document.getElementById('upi-qr-img');
    if (upiQrImg) {
      const upiData = `upi://pay?pa=bidspot@upi&pn=BidSpotIndia&am=${totalINR.toFixed(2)}&cu=INR&tn=BidSpot%20Rank%20%23${projectedRank}`;
      upiQrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(upiData)}`;
    }

    const submitBtn = document.getElementById('submit-bid-btn');
    if (submitBtn) {
      const iconSVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m14 13 5 5"></path><path d="m3 21 3-3"></path><path d="m9 15 2 2"></path><path d="m11 9 5 5"></path><path d="m13 3 6 6-6 6-6-6 6-6Z"></path></svg>`;
      if (this.selectedPaymentMethod === 'upi') {
        submitBtn.innerHTML = `${iconSVG} <span>Confirm &amp; Place Bid (${state.formatINRExact(totalINR)}) via UPI</span>`;
      } else {
        submitBtn.innerHTML = `${iconSVG} <span>Confirm &amp; Place Bid (${state.formatINRExact(totalINR)}) via Razorpay</span>`;
      }
      submitBtn.disabled = isBelowMinBid;
      submitBtn.style.opacity = isBelowMinBid ? '0.5' : '';
    }
  }

  // `prefillTitle` is only passed when this came from clicking "Outbid" on an
  // *existing* card — it's a suggested starting point (that listing's real name),
  // not a claim on that listing. Submitting always creates a brand-new listing;
  // outbidding someone doesn't add to their total, it means beating it with yours.
  openBidModalWithData(url = '', category = 'Productivity', presetAmountUSD = null, prefillTitle = null) {
    const urlInput = document.getElementById('bid-url-input');
    const catSelect = document.getElementById('bid-category-select');
    const amountInput = document.getElementById('bid-amount-input');
    const titleInput = document.getElementById('bid-title-input');

    if (urlInput) urlInput.value = url;
    if (titleInput) titleInput.value = prefillTitle || '';
    if (catSelect) catSelect.value = category || 'Productivity';
    
    const targetUSD = presetAmountUSD || this.selectedBidAmountUSD || state.getMinBidForRank1();
    this.selectedBidAmountUSD = targetUSD;
    if (amountInput) {
      amountInput.value = state.currency === 'INR' ? state.convertUSDToINR(targetUSD) : Math.round(targetUSD);
    }

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

    if (!title || !title.value.trim() || !url || !url.value.trim()) {
      this.showToast("Add a title and URL before continuing.", "warning");
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

    const title = titleInput ? titleInput.value.trim() : '';
    let url = urlInput ? urlInput.value.trim() : '';
    const tagline = taglineInput ? taglineInput.value.trim() : '';
    const category = (catSelect && catSelect.value) || 'Productivity';
    const bidderName = nameInput ? nameInput.value.trim() : '';
    const bidderEmail = emailInput ? emailInput.value.trim() : '';

    const inputVal = Number(amountInput ? amountInput.value : 0);
    const amountUSD = state.currency === 'INR' ? (inputVal / state.USD_TO_INR) : inputVal;
    const amountRupees = state.currency === 'INR' ? inputVal : Math.round(inputVal * state.USD_TO_INR);

    if (!title || !url || amountUSD <= 0) {
      this.showToast("Please fill in all required fields.", "warning");
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
    if (!window.Razorpay) {
      this.showToast("Payment gateway didn't load — check your connection and try again.", "warning");
      return;
    }
    if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;

    this.setBidSubmitLoading(true);
    try {
      // Every bid creates a brand-new 'pending' listing — "outbidding" an existing
      // card just pre-fills its name/category as an editable starting point (see
      // openBidModalWithData), it does not add to that listing's own total. The new
      // row only actually goes live once payment clears, in the handler below.
      const categoryRow = (state.categoriesFromDb || []).find((c) => c.name === category);
      const { data: newListing, error: submitErr } = await submitListing({
        name: title,
        url,
        tagline,
        categoryId: categoryRow ? categoryRow.id : null,
        ownerEmail: bidderEmail,
      });
      if (submitErr) throw new Error(submitErr.message || "Could not create your listing.");
      const listingId = newListing.id;

      const orderRes = await fetch('/api/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, bidderName, bidderEmail, amountRupees, currency: 'INR' }),
      });
      const order = await parseJsonResponse(orderRes);
      if (!orderRes.ok) throw new Error(order.error || "Could not start checkout.");

      const rzp = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name: 'BidSpot.in',
        description: `Rank bid — ${title}`,
        prefill: { name: bidderName, email: bidderEmail },
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
            this.showToast(`Payment confirmed! ${escapeHtml(title)} is now live on the leaderboard.`, "success");
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
          <span class="card-price">${state.formatAmount(item.amountUSD)}</span>
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
        <span style="font-family: var(--font-serif); font-weight: 800; color: var(--accent-primary); font-size: 0.95rem;">${state.formatAmount(item.amountUSD)}</span>
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


