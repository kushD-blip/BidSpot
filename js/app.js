/* Main Application Entry Point */
import { state } from './state.js';
import { ui } from './ui.js';
import { isSupabaseConfigured } from './config.js';
import { subscribeToListingChanges } from './supabase-client.js';

async function startApp() {
  // Apply saved theme state
  document.documentElement.setAttribute('data-theme', state.theme);

  // Initialize UI Engine (binds event listeners & initial render)
  ui.init();

  const params = new URLSearchParams(location.search);
  const categoryParam = params.get('category');
  if (categoryParam) state.setCategory(categoryParam);

  if (isSupabaseConfigured) {
    await state.loadFromSupabase();

    // Deep link from another page's "Outbid" button (?outbid=<listingId>) —
    // auto-opens the same confirm modal as clicking that card's bid pill directly.
    // Strip it from the URL right after so reloading (or re-visiting via back/
    // forward) doesn't keep reopening the modal on every page load.
    const outbidId = params.get('outbid');
    if (outbidId) {
      params.delete('outbid');
      const newSearch = params.toString();
      history.replaceState(null, '', location.pathname + (newSearch ? `?${newSearch}` : '') + location.hash);

      const item = state.items.find((i) => i.id === outbidId);
      if (item) {
        ui.openConfirmRankModal(String(item.rank), item.amountUSD + 5, item.title, item.category, item.url, item.id);
      } else {
        ui.showToast("That listing couldn't be found — it may have been removed.", "warning");
      }
    }

    // Re-fetch whenever any listing changes (new bid, new approval) so other
    // visitors' activity shows up live without a page refresh.
    subscribeToListingChanges(() => state.loadFromSupabase());
  }

  console.log("🚀 BidSpot.in — Minimalist Viral Live Bidding Leaderboard initialized successfully.");
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}
