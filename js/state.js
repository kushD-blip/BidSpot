/* BidSpot — The Bidding House for Website Traffic */
/* State Management, System Auto Theme Detection & Dataset */

import { isSupabaseConfigured } from './config.js';
import { fetchApprovedListings, fetchCategories } from './supabase-client.js';
import { USD_TO_INR, MIN_BID_INR, mapSupabaseListing } from './listing-mapper.js';

export { USD_TO_INR, MIN_BID_INR };

/** Mirror of the `categories` table in schema.sql, used only when Supabase isn't
    configured (local dev without credentials) so the chips and dropdowns still
    render something. The database is the source of truth — the live site never
    reads this. Keep the two in sync if you add a category; the names here must
    match schema.sql exactly, because listings are matched to categories by name. */
export const FALLBACK_CATEGORIES = [
  { slug: 'ai-tools', name: 'AI Agents & Infrastructure', icon: '🤖' },
  { slug: 'seo', name: 'SEO & AI Visibility', icon: '🔍' },
  { slug: 'marketing', name: 'Marketing & Advertising', icon: '📣' },
  { slug: 'analytics', name: 'Analytics', icon: '📊' },
  { slug: 'crypto', name: 'Crypto, Web3 & Investing', icon: '◎' },
  { slug: 'developer', name: 'Developer Tools', icon: '⌨️' },
  { slug: 'business', name: 'Business, Finance & Legal', icon: '⚖️' },
  { slug: 'security', name: 'Security, Privacy & Compliance', icon: '🛡️' },
  { slug: 'health', name: 'Health, Fitness & Wellness', icon: '❤️' },
  { slug: 'social', name: 'Social Media & Creator Tools', icon: '📱' },
  { slug: 'leaderboards', name: 'Leaderboards & Attention Markets', icon: '🏆' },
  { slug: 'hiring', name: 'Hiring, Jobs & Careers', icon: '📋' },
  { slug: 'education', name: 'Education & Learning', icon: '🎓' },
  { slug: 'agencies', name: 'Agencies, Studios & Services', icon: '🤝' },
  { slug: 'ecommerce', name: 'Ecommerce & Retail', icon: '🛒' },
  { slug: 'domains', name: 'Domains & Web Assets', icon: '🌐' },
  { slug: 'games', name: 'Games & Entertainment', icon: '🎮' },
  { slug: 'people', name: 'People & Profiles', icon: '👤' },
  { slug: 'productivity', name: 'Productivity & Personal Tools', icon: '⚡' },
  { slug: 'design', name: 'Design & Creative', icon: '🎨' },
  { slug: 'writing', name: 'Writing & Content', icon: '✍️' },
  { slug: 'directories', name: 'Directories, Launch & Discovery', icon: '🚀' },
  { slug: 'ai-media', name: 'AI Media Generation', icon: '🎬' },
  { slug: 'audio', name: 'Audio, Voice & Podcasting', icon: '🎙️' },
  { slug: 'sales', name: 'Sales & Lead Generation', icon: '📈' },
  { slug: 'travel', name: 'Travel, Local & Lifestyle', icon: '✈️' },
  { slug: 'real-estate', name: 'Real Estate & Property', icon: '🏠' },
  { slug: 'media-news', name: 'Media & News', icon: '📰' },
  { slug: 'other', name: 'Other', icon: '🏷️' },
];

export const INITIAL_LEADERBOARD = [
  {
    id: "item-1",
    rank: 1,
    title: "Postman · API Platform for Developers",
    tagline: "Build, test, and iterate your APIs faster with 30M+ developers worldwide. Born in Bengaluru.",
    category: "Developer Tools",
    url: "https://postman.com",
    domain: "postman.com",
    logoText: "PM",
    logoBg: "linear-gradient(135deg, #ff6c37, #ff4500)",
    clicks: 58420,
    amountUSD: 17006,
    amountINR: 1445510,
    timestamp: "2 hours ago",
    verified: true,
    country: "India",
    is_demo: true
  },
  {
    id: "item-2",
    rank: 2,
    title: "Zerodha · Stock Broker & Trading",
    tagline: "Investing in stocks, derivatives, mutual funds, and more. Zero brokerage on equity delivery.",
    category: "Crypto, Web3 & Investing",
    url: "https://zerodha.com",
    domain: "zerodha.com",
    logoText: "ZD",
    logoBg: "linear-gradient(135deg, #387ed1, #1e40af)",
    clicks: 49850,
    amountUSD: 14500,
    amountINR: 1232500,
    timestamp: "5 hours ago",
    verified: true,
    country: "India",
    is_demo: true
  },
  {
    id: "item-3",
    rank: 3,
    title: "VibeCoding AI · AI Code Assistant",
    tagline: "Next-gen AI agentic suite that writes, tests, and deploys full-stack web applications effortlessly.",
    category: "AI Agents & Infrastructure",
    url: "https://vibecoding.ai",
    domain: "vibecoding.ai",
    logoText: "VC",
    logoBg: "linear-gradient(135deg, #8b5cf6, #06b6d4)",
    clicks: 41750,
    amountUSD: 12200,
    amountINR: 1037000,
    timestamp: "3 hours ago",
    verified: true,
    country: "Global",
    is_demo: true
  },
  {
    id: "item-4",
    rank: 4,
    title: "Notion · AI Workspace",
    tagline: "Connected workspace where better, faster work happens with integrated AI doc generation.",
    category: "Productivity & Personal Tools",
    url: "https://notion.so",
    domain: "notion.so",
    logoText: "NT",
    logoBg: "linear-gradient(135deg, #111827, #374151)",
    clicks: 44120,
    amountUSD: 11200,
    amountINR: 952000,
    timestamp: "1 day ago",
    verified: true,
    country: "Global",
    is_demo: true
  },
  {
    id: "item-5",
    rank: 5,
    title: "Shopify India · Ecommerce Platform",
    tagline: "Powering millions of businesses worldwide to sell online, on social media, and in-person.",
    category: "Ecommerce & Retail",
    url: "https://shopify.in",
    domain: "shopify.in",
    logoText: "SH",
    logoBg: "linear-gradient(135deg, #059669, #10b981)",
    clicks: 38900,
    amountUSD: 9800,
    amountINR: 833000,
    timestamp: "6 hours ago",
    verified: true,
    country: "India",
    is_demo: true
  },
  {
    id: "item-6",
    rank: 6,
    title: "Razorpay · Payments Infrastructure",
    tagline: "Full-stack financial services platform powering 8M+ businesses across India for seamless payments.",
    category: "Business, Finance & Legal",
    url: "https://razorpay.com",
    domain: "razorpay.com",
    logoText: "RZ",
    logoBg: "linear-gradient(135deg, #2563eb, #1d4ed8)",
    clicks: 34200,
    amountUSD: 9273,
    amountINR: 788200,
    timestamp: "8 hours ago",
    verified: true,
    country: "India",
    is_demo: true
  },
  {
    id: "item-7",
    rank: 7,
    title: "Freshworks · CRM & Support Suite",
    tagline: "Customer service and IT service management software that is affordable and quick to deploy.",
    category: "Sales & Lead Generation",
    url: "https://freshworks.com",
    domain: "freshworks.com",
    logoText: "FW",
    logoBg: "linear-gradient(135deg, #d97706, #f59e0b)",
    clicks: 29800,
    amountUSD: 7588,
    amountINR: 645000,
    timestamp: "12 hours ago",
    verified: true,
    country: "India",
    is_demo: true
  },
  {
    id: "item-8",
    rank: 8,
    title: "Zoho · Business Software Suite",
    tagline: "Run your entire business with 55+ integrated cloud apps. Trusted by 100M+ users globally.",
    category: "Business, Finance & Legal",
    url: "https://zoho.com",
    domain: "zoho.com",
    logoText: "ZH",
    logoBg: "linear-gradient(135deg, #e11d48, #be123c)",
    clicks: 26450,
    amountUSD: 6947,
    amountINR: 590500,
    timestamp: "1 day ago",
    verified: true,
    country: "India",
    is_demo: true
  },
  {
    id: "item-9",
    rank: 9,
    title: "CRED · Credit Card Rewards App",
    tagline: "Pay credit card bills, win rewards, and access premium financial privileges in India.",
    category: "Business, Finance & Legal",
    url: "https://cred.club",
    domain: "cred.club",
    logoText: "CR",
    logoBg: "linear-gradient(135deg, #1f2937, #4b5563)",
    clicks: 22100,
    amountUSD: 5588,
    amountINR: 475000,
    timestamp: "2 days ago",
    verified: true,
    country: "India",
    is_demo: true
  },
  {
    id: "item-10",
    rank: 10,
    title: "Swiggy Instamart · Quick Commerce",
    tagline: "Groceries and daily essentials delivered to your doorstep in 10 minutes across India.",
    category: "Ecommerce & Retail",
    url: "https://swiggy.com",
    domain: "swiggy.com",
    logoText: "SW",
    logoBg: "linear-gradient(135deg, #ea580c, #c2410c)",
    clicks: 18350,
    amountUSD: 3765,
    amountINR: 320000,
    timestamp: "4 hours ago",
    verified: true,
    country: "India",
    is_demo: true
  },
  {
    id: "item-11",
    rank: 11,
    title: "Groww · Investment Platform",
    tagline: "Direct mutual funds, stocks, IPOs, and gold investment platform for retail investors.",
    category: "Crypto, Web3 & Investing",
    url: "https://groww.in",
    domain: "groww.in",
    logoText: "GW",
    logoBg: "linear-gradient(135deg, #0d9488, #115e59)",
    clicks: 15900,
    amountUSD: 3388,
    amountINR: 288000,
    timestamp: "9 hours ago",
    verified: true,
    country: "India",
    is_demo: true
  },
  {
    id: "item-12",
    rank: 12,
    title: "PhonePe Business · Merchant Tools",
    tagline: "Accept digital payments via UPI QR codes, soundboxes, and merchant POS devices seamlessly.",
    category: "Business, Finance & Legal",
    url: "https://phonepe.com",
    domain: "phonepe.com",
    logoText: "PP",
    logoBg: "linear-gradient(135deg, #6b21a8, #581c87)",
    clicks: 12840,
    amountUSD: 2529,
    amountINR: 215000,
    timestamp: "1 day ago",
    verified: true,
    country: "India",
    is_demo: true
  },
  {
    id: "item-13",
    rank: 13,
    title: "Canva India · Design Tool",
    tagline: "Create social media graphics, presentations, posters, videos, and visual content easily.",
    category: "Design & Creative",
    url: "https://canva.com",
    domain: "canva.com",
    logoText: "CN",
    logoBg: "linear-gradient(135deg, #0284c7, #0369a1)",
    clicks: 9620,
    amountUSD: 1706,
    amountINR: 145000,
    timestamp: "5 hours ago",
    verified: true,
    country: "Global",
    is_demo: true
  },
  {
    id: "item-14",
    rank: 14,
    title: "Meesho · Social Commerce",
    tagline: "India's favorite online shopping destination for fashion, home, and lifestyle products.",
    category: "Ecommerce & Retail",
    url: "https://meesho.com",
    domain: "meesho.com",
    logoText: "MS",
    logoBg: "linear-gradient(135deg, #db2777, #9d174d)",
    clicks: 7410,
    amountUSD: 1123,
    amountINR: 95430,
    timestamp: "7 hours ago",
    verified: true,
    country: "India",
    is_demo: true
  },
  {
    id: "item-15",
    rank: 15,
    title: "Dukaan · DIY Online Store Builder",
    tagline: "Set up an online e-commerce store in 30 seconds with custom domain and payment integration.",
    category: "Ecommerce & Retail",
    url: "https://mydukaan.io",
    domain: "mydukaan.io",
    logoText: "DK",
    logoBg: "linear-gradient(135deg, #d97706, #b45309)",
    clicks: 5230,
    amountUSD: 806,
    amountINR: 68500,
    timestamp: "3 hours ago",
    verified: true,
    country: "India",
    is_demo: true
  }
];

class StateManager {
  constructor() {
    this.appName = "BidSpot";
    this.USD_TO_INR = USD_TO_INR; // instance alias — ui.js reads state.USD_TO_INR directly
    this.currency = localStorage.getItem('bidspot_currency') || 'INR'; // 'INR' or 'USD'
    
    // Light is the default regardless of system preference — only an explicit
    // choice via the theme toggle (saved below) switches it to dark.
    this.theme = localStorage.getItem('bidspot_theme') || 'light';
    
    this.categoryFilter = 'All';
    this.timeFilter = 'all-time';
    
    this.categoriesFromDb = [];

    // Concurrent viewer count, kept in sync by subscribeToPresence() in app.js.
    // Starts 0 (no channel joined yet); getLiveStats() reports 1 until the channel
    // reports back so the visitor sees themselves rather than an empty "0".
    this.presenceCount = 0;

    if (isSupabaseConfigured) {
      // Live site: no fabricated numbers. Starts empty and honest — loadFromSupabase()
      // (called from app.js) fills this in from the real database moments later.
      this.stats = { totalVisitors: 0, totalRevenueUSD: 0, totalProducts: 0, baseActiveOnline: 0 };
      this.activityFeed = [];
      this.items = [];
    } else {
      // No backend configured (local dev without credentials) — fall back to the
      // demo dataset so the UI is still explorable.
      this.stats = {
        totalVisitors: 1545599,
        totalRevenueUSD: 259313,
        totalProducts: 2881,
        baseActiveOnline: 30
      };

      this.activityFeed = [
        {
          id: 'act-1',
          message: "Postman (Bengaluru) claimed Rank #1 spot for ₹14,45,510",
          timestamp: new Date().toISOString()
        },
        {
          id: 'act-2',
          message: "Zerodha (Mumbai) claimed Rank #2 spot for ₹12,32,500",
          timestamp: new Date().toISOString()
        },
        {
          id: 'act-3',
          message: "VibeCoding AI placed ₹10,37,000 floor bid",
          timestamp: new Date().toISOString()
        }
      ];

      // Schema versioning reset to force load 15 seed listings across browsers
      const SCHEMA_VERSION = 'v5';
      const savedVer = localStorage.getItem('bidspot_schema_version');
      let savedItems = null;

      if (savedVer === SCHEMA_VERSION) {
        try {
          const saved = localStorage.getItem('bidspot_leaderboard_data');
          if (saved) savedItems = JSON.parse(saved);
        } catch (e) {
          savedItems = null;
        }
      }

      if (Array.isArray(savedItems) && savedItems.length >= 15) {
        this.items = savedItems;
      } else {
        this.items = JSON.parse(JSON.stringify(INITIAL_LEADERBOARD));
        localStorage.setItem('bidspot_schema_version', SCHEMA_VERSION);
        localStorage.setItem('bidspot_leaderboard_data', JSON.stringify(this.items));
      }
    }

    this.listeners = [];
    this.sortAndRank();

    // Apply initial theme attribute
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', this.theme);
    }
  }

  subscribe(listener) {
    this.listeners.push(listener);
  }

  notify() {
    this.listeners.forEach(fn => fn(this));
    localStorage.setItem('bidspot_leaderboard_data', JSON.stringify(this.items));
    localStorage.setItem('bidspot_currency', this.currency);
    localStorage.setItem('bidspot_theme', this.theme);
    localStorage.setItem('bidspot_sound', this.soundEnabled);
  }

  /** Fetches real listings + categories from Supabase and replaces the leaderboard.
      Called once on startup (app.js) and again after a bid clears payment, and can
      also be called from the realtime subscription for live updates. No-op if
      Supabase isn't configured. */
  async loadFromSupabase() {
    if (!isSupabaseConfigured) return;
    const [listings, categories] = await Promise.all([fetchApprovedListings(), fetchCategories()]);
    this.categoriesFromDb = categories;
    this.items = listings.map((row) => mapSupabaseListing(row));
    this.sortAndRank();
    this.notify();
  }

  setCurrency(curr) {
    this.currency = curr;
    this.notify();
  }

  setTheme(th) {
    this.theme = th;
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', th);
    }
    this.notify();
  }

  toggleSound() {
    this.soundEnabled = !this.soundEnabled;
    this.notify();
  }

  setCategory(cat) {
    this.categoryFilter = cat;
    this.notify();
  }

  setTimeFilter(tf) {
    this.timeFilter = tf;
    this.notify();
  }

  /** INR is the currency bids are actually taken in, so it's the canonical amount
      for ordering and comparison. amountUSD is a rounded display convenience
      (Math.round(inr / 85)) and ranking by it silently collapsed distinct bids into
      ties — ₹2,100 and ₹2,125 both round to $25, so which one ranked first was
      arbitrary. Anything that decides a position uses this, not amountUSD. */
  static amountInRupees(item) {
    return item.amountINR ?? Math.round(Number(item.amountUSD || 0) * USD_TO_INR);
  }

  sortAndRank() {
    this.items.sort((a, b) => StateManager.amountInRupees(b) - StateManager.amountInRupees(a));
    this.items.forEach((item, idx) => {
      item.rank = idx + 1;
    });
  }

  /** Formats a listing's bid for display. In INR it prints the real stored rupee
      amount rather than round-tripping through the rounded USD figure, which made
      a ₹2,100 listing read as "₹2,125" on the card — and then made the hero's
      "beat it for ₹2,121" look like nonsense next to it. */
  formatListingAmount(item) {
    if (this.currency === 'INR') return this.formatINR(StateManager.amountInRupees(item));
    return this.formatUSD(item.amountUSD);
  }

  convertUSDToINR(amountUSD) {
    return Math.round(Number(amountUSD || 0) * USD_TO_INR);
  }

  // Deliberately NOT rounded — this feeds into amountUSD which then gets converted
  // straight back to INR to pre-fill the bid amount field (openBidModalWithData).
  // Rounding here was the actual bug behind "suggests ₹85 instead of ₹100": ₹100 ->
  // round(100/85)=$1 -> round(1*85)=₹85, silently pre-filling a bid below the real
  // minimum. Keeping full precision until display time makes the round-trip exact.
  convertINRToUSD(amountINR) {
    return Number(amountINR || 0) / USD_TO_INR;
  }

  // There is deliberately no bidding-session timer here any more. Bidding used to
  // be gated to a 9:00 AM - 3:00 PM "stock market session", which held bidders to
  // someone else's clock for no real reason — the board is open 24/7 and a paid
  // bid re-ranks immediately.

  formatAmount(amountUSD, overrideCurrency = null) {
    const curr = overrideCurrency || this.currency;
    const num = Number(amountUSD || 0);
    if (curr === 'INR') {
      const inr = Math.round(num * USD_TO_INR);
      return '₹' + inr.toLocaleString('en-IN');
    }
    return '$' + Math.round(num).toLocaleString('en-US');
  }

  formatINR(amountINR) {
    return '₹' + Math.round(Number(amountINR || 0)).toLocaleString('en-IN');
  }

  formatUSD(amountUSD) {
    return '$' + Math.round(Number(amountUSD || 0)).toLocaleString('en-US');
  }

  formatUSDExact(amountUSD) {
    return '$' + Number(amountUSD || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  formatINRExact(amountINR) {
    return '₹' + Number(amountINR || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /** Every listing in one category, in the same descending-bid order as the board.
      `'All'` (or omitted) means the whole board. `this.items` is already sorted by
      sortAndRank(), so filtering preserves the ordering — index+1 is that listing's
      rank *within the category*, which is what the board shows while a category
      chip is active. */
  /** The single source every category control renders from — the chip bar, both
      category dropdowns, and the demo dataset's own sanity. Real rows from Supabase
      when they've loaded, the static mirror otherwise, so nothing hardcodes its own
      copy of the list and drifts out of sync with the database. */
  getCategories() {
    return this.categoriesFromDb.length > 0 ? this.categoriesFromDb : FALLBACK_CATEGORIES;
  }

  getItemsInCategory(category = 'All') {
    if (!category || category === 'All') return this.items;
    return this.items.filter((item) => item.category === category);
  }

  /** Where a bid of `amountUSD` would land — within `category` when one is selected,
      otherwise across the whole board. Selecting "Fintech" and being told you'd be
      "#7" (your position among *all* listings) was meaningless when the board next
      to it only showed 3 Fintech listings ranked #1-#3. */
  getProjectedRank(amountUSD, category = 'All') {
    // Compared in rupees for the same reason sortAndRank() orders by them: at the
    // ₹100-₹5,000 amounts real bids actually land at, the rounded USD figure is far
    // too coarse to rank with. Beating a ₹2,100 listing by ₹21 used to be reported
    // as rank #2, because both amounts rounded to the same $25.
    const amountINR = this.convertUSDToINR(amountUSD);
    let rank = 1;
    for (const item of this.getItemsInCategory(category)) {
      if (amountINR < StateManager.amountInRupees(item)) {
        rank++;
      } else {
        break;
      }
    }
    return rank;
  }

  /** Normalizes a typed URL or @handle down to the bare host, so "Postman.com/",
      "https://www.postman.com/docs" and "postman.com" all resolve to the same
      listing. Mirrors the domain extraction in listing-mapper.js. */
  static normalizeDomain(input) {
    return String(input || '')
      .trim()
      .toLowerCase()
      .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
      .split(/[/?#]/)[0]
      .replace(/\.$/, '');
  }

  /** The listing already holding a spot for this URL, if any. House Rules allow one
      listing per website, so bidding on a site that's already on the board is a
      top-up of that listing's total — not a second listing competing with itself. */
  findListingByUrl(input) {
    const domain = StateManager.normalizeDomain(input);
    if (!domain) return null;
    return this.items.find((item) => StateManager.normalizeDomain(item.domain) === domain) || null;
  }

  getHighestBidUSD() {
    return this.items.length > 0 ? this.items[0].amountUSD : this.convertINRToUSD(MIN_BID_INR);
  }

  // Real floor is ₹100 (matches api/create-order.js). On an empty board that IS
  // the minimum — there was a bug here where an empty board suggested ~$105
  // (₹8,925), a leftover demo-dataset constant that had nothing to do with the
  // actual ₹100 rule. Once there's a bid to beat, the increment is proportional
  // (1% of the current top bid, floored at ₹10) instead of a flat, meaningless "+5".
  // Scoped to `category` when one is selected: topping an empty/quiet category costs
  // ₹100, not whatever the #1 listing on the entire board happens to be sitting at.
  getMinBidForRank1(category = 'All') {
    const scoped = this.getItemsInCategory(category);
    if (scoped.length === 0) return this.convertINRToUSD(MIN_BID_INR);
    const topINR = StateManager.amountInRupees(scoped[0]);
    const incrementINR = Math.max(10, Math.round(topINR * 0.01));
    return this.convertINRToUSD(topINR + incrementINR);
  }

  /** Called by app.js whenever the Realtime presence channel reports a new head
      count. Nudges the UI so the header pill re-renders with the current number. */
  setPresenceCount(count) {
    const n = Math.max(0, Number(count) || 0);
    if (n === this.presenceCount) return;
    this.presenceCount = n;
    this.notify();
  }

  getLiveStats() {
    // Real presence, not simulated. this.presenceCount is set by
    // subscribeToPresence() in app.js from Supabase Realtime — every open tab
    // (including this one) joins a shared channel and the count is unique keys
    // in that channel's state. Until the channel has connected we deliberately
    // show 1 so the visitor sees themselves rather than a hollow "0"; the demo
    // dataset (no backend configured) keeps the small randomised local number.
    let activeOnline;
    if (isSupabaseConfigured) {
      activeOnline = this.presenceCount > 0 ? this.presenceCount : 1;
    } else {
      const randomOffset = Math.floor(Math.random() * 21) - 5;
      activeOnline = Math.max(15, this.stats.baseActiveOnline + randomOffset);
    }

    // Totalled in rupees, then converted — summing the rounded per-listing USD
    // figures and converting back inflated the headline "volume" by up to ₹42 per
    // listing (a single ₹2,100 listing reported ₹2,125 of volume).
    const itemsTotalINR = this.items.reduce((sum, item) => sum + StateManager.amountInRupees(item), 0);
    const totalRevenueINR = Math.max(Math.round(this.stats.totalRevenueUSD * USD_TO_INR), itemsTotalINR);
    const totalRevenueUSD = Math.round(totalRevenueINR / USD_TO_INR);

    const totalProducts = isSupabaseConfigured
      ? this.items.length
      : Math.max(this.stats.totalProducts, 2881 + (this.items.length - INITIAL_LEADERBOARD.length));

    return {
      totalVisitors: this.stats.totalVisitors,
      totalVisitorsFormatted: this.stats.totalVisitors.toLocaleString('en-US'),
      totalRevenueUSD: totalRevenueUSD,
      totalRevenueUSDFormatted: '$' + totalRevenueUSD.toLocaleString('en-US'),
      totalRevenueINR: totalRevenueINR,
      totalRevenueINRFormatted: '₹' + totalRevenueINR.toLocaleString('en-IN'),
      displayRevenueFormatted: this.currency === 'INR'
        ? this.formatINR(totalRevenueINR)
        : this.formatUSD(totalRevenueUSD),
      totalProducts: totalProducts,
      totalProductsFormatted: totalProducts.toLocaleString('en-US'),
      activeOnline: activeOnline,
      activeOnlineFormatted: activeOnline.toLocaleString('en-US')
    };
  }

  logActivity(message) {
    const logItem = {
      id: 'act-' + Date.now(),
      message,
      timestamp: new Date().toISOString()
    };
    this.activityFeed.unshift(logItem);
    if (this.activityFeed.length > 20) {
      this.activityFeed.pop();
    }
    return logItem;
  }

  getActivityLogs() {
    return [...this.activityFeed];
  }

  addBid({ title, tagline, category, url, amountUSD }) {
    const domain = url.replace(/^(?:https?:\/\/)?(?:www\.)?/i, "").split('/')[0];
    const logoText = title.substring(0, 2).toUpperCase();
    const colors = [
      'linear-gradient(135deg, #8B1E2E, #B23A4A)',
      'linear-gradient(135deg, #1A1A1A, #5C564E)',
      'linear-gradient(135deg, #5C564E, #8C8478)',
      'linear-gradient(135deg, #721825, #8B1E2E)'
    ];
    const logoBg = colors[Math.floor(Math.random() * colors.length)];

    const numericAmount = Number(amountUSD);

    const newItem = {
      id: 'item-' + Date.now(),
      title,
      tagline: tagline || `Discover ${title} on BidSpot.`,
      // "Other" rather than Productivity: if a category somehow didn't come through,
      // parking the listing in an unrelated real category is worse than saying so.
      category: category || "Other",
      url: url.startsWith('http') ? url : 'https://' + url,
      domain,
      logoText,
      logoBg,
      clicks: 1,
      amountUSD: numericAmount,
      amountINR: Math.round(numericAmount * USD_TO_INR),
      timestamp: "Just now",
      verified: true,
      country: "India"
    };

    this.items.push(newItem);
    this.sortAndRank();

    this.stats.totalRevenueUSD += numericAmount;
    this.stats.totalProducts += 1;

    this.logActivity(`${title} placed a ${this.formatAmount(numericAmount)} floor bid`);

    this.notify();

    return newItem;
  }
}

export const state = new StateManager();
