-- BidSpot.in — Core Schema (Supabase / Postgres)
-- NO LOGIN REQUIRED — bidders identify themselves only via email/name at bid time,
-- used for receipts and fraud follow-up, not for an account system.
-- Run this in Supabase SQL Editor.
--
-- Written to be safely re-runnable end to end: Supabase's SQL Editor commits each
-- statement individually rather than wrapping the whole paste in one transaction, so
-- if any single statement fails partway through, everything before it has already
-- committed. Re-running the same non-idempotent script then fails immediately on
-- "relation already exists" for the first CREATE TABLE — which is exactly what
-- happened here — leaving you stuck with tables that exist but were never seeded.
-- Every statement below uses IF NOT EXISTS / IF EXISTS / ON CONFLICT so you can just
-- run the whole file again if anything ever fails partway through.

create extension if not exists "uuid-ossp";

-- 1. Categories
create table if not exists public.categories (
  id serial primary key,
  slug text unique not null,
  name text not null,
  icon text,
  sort_order int default 0
);

-- The category list. `on conflict (slug) do update` rather than `do nothing` so this
-- one statement both seeds a fresh database AND renames/reorders an existing one.
-- Renames are applied by SLUG, never by name: listings reference categories by
-- category_id, so a renamed row carries all its existing listings with it — e.g.
-- everything filed under the old 'Agencies & Services' is now under
-- 'Agencies, Studios & Services' with no data migration and no orphaned listings.
--
-- Names are the public label AND the value the frontend matches on, so anything
-- rendering a category (chips, dropdowns, category cards) reads this table rather
-- than hardcoding a copy — a hardcoded chip list that had drifted out of sync with
-- these rows is what previously made 9 of the categories unreachable from the home
-- page filter bar.
insert into public.categories (slug, name, icon, sort_order) values
  ('ai-tools',     'AI Agents & Infrastructure',        '🤖', 1),
  ('seo',          'SEO & AI Visibility',               '🔍', 2),
  ('marketing',    'Marketing & Advertising',           '📣', 3),
  ('analytics',    'Analytics',                         '📊', 4),
  ('crypto',       'Crypto, Web3 & Investing',          '◎', 5),
  ('developer',    'Developer Tools',                   '⌨️', 6),
  ('business',     'Business, Finance & Legal',         '⚖️', 7),
  ('security',     'Security, Privacy & Compliance',    '🛡️', 8),
  ('health',       'Health, Fitness & Wellness',        '❤️', 9),
  ('social',       'Social Media & Creator Tools',      '📱', 10),
  ('leaderboards', 'Leaderboards & Attention Markets',  '🏆', 11),
  ('hiring',       'Hiring, Jobs & Careers',            '📋', 12),
  ('education',    'Education & Learning',              '🎓', 13),
  ('agencies',     'Agencies, Studios & Services',      '🤝', 14),
  ('ecommerce',    'Ecommerce & Retail',                '🛒', 15),
  ('domains',      'Domains & Web Assets',              '🌐', 16),
  ('games',        'Games & Entertainment',             '🎮', 17),
  ('people',       'People & Profiles',                 '👤', 18),
  ('productivity', 'Productivity & Personal Tools',     '⚡', 19),
  ('design',       'Design & Creative',                 '🎨', 20),
  ('writing',      'Writing & Content',                 '✍️', 21),
  ('directories',  'Directories, Launch & Discovery',   '🚀', 22),
  ('ai-media',     'AI Media Generation',               '🎬', 23),
  ('audio',        'Audio, Voice & Podcasting',         '🎙️', 24),
  ('sales',        'Sales & Lead Generation',           '📈', 25),
  ('travel',       'Travel, Local & Lifestyle',         '✈️', 26),
  ('real-estate',  'Real Estate & Property',            '🏠', 27),
  ('media-news',   'Media & News',                      '📰', 28),
  ('other',        'Other',                             '🏷️', 29)
on conflict (slug) do update
  set name = excluded.name,
      icon = excluded.icon,
      sort_order = excluded.sort_order;

-- (The retirement of the two categories this list drops happens after the listings
--  table is created below — it has to check whether anything still references them.)

-- Newer Supabase projects enable RLS by default on every new table, including this
-- one — with zero policies, that means the anon key sees nothing at all even though
-- the 8 rows above are really in the table. Categories are pure public metadata, so
-- this is a straightforward "anyone can read" policy, no restrictions needed.
alter table public.categories enable row level security;

drop policy if exists "public read categories" on public.categories;
create policy "public read categories" on public.categories
  for select using (true);

-- 2. Listings (a product/handle competing for rank)
-- No owner_id/auth link. Instead: a claim_token lets whoever submitted the listing
-- edit it later via a private link (emailed to them), without needing to log in.
create table if not exists public.listings (
  id uuid primary key default uuid_generate_v4(),
  claim_token uuid default uuid_generate_v4(),   -- private edit link: bidspot.in/edit/{claim_token}
  owner_email text,                               -- for receipts + fraud contact, not an account
  name text not null,
  url text not null,
  tagline text,
  logo_url text,
  category_id int references public.categories(id),
  verified boolean default false,
  status text default 'pending' check (status in ('pending','approved','rejected','removed')),
  total_bid_alltime bigint default 0,
  total_bid_today bigint default 0,
  clicks bigint default 0,
  created_at timestamptz default now()
);

-- Founding Bidder: awarded automatically to the first N listings that ever clear a
-- payment (see approve_listing_and_award_founding below). Deliberately a separate
-- column from `verified` rather than reusing it — House Rules defines `verified` as
-- "established, recognizable brands", which is a different claim entirely, and
-- overloading one flag with both meanings would make each badge unreadable.
-- Stated as its own ALTER so re-running this file on an existing database adds the
-- column (the CREATE TABLE above is `if not exists` and would skip it otherwise).
alter table public.listings add column if not exists founding_bidder boolean default false;

create index if not exists idx_listings_category on public.listings(category_id);
-- The `created_at asc` second column matches the tie-breaker in
-- fetchApprovedListings (older listing wins ties). Without it, Postgres would still
-- return correct results but with an extra sort step for the secondary key.
create index if not exists idx_listings_alltime on public.listings(total_bid_alltime desc, created_at asc);
create index if not exists idx_listings_today on public.listings(total_bid_today desc, created_at asc);

-- 'fintech' and 'saas' have no equivalent in the category list above (that ground is
-- covered by 'Business, Finance & Legal' / 'Crypto, Web3 & Investing' and by the more
-- specific categories). Removed ONLY when nothing is filed under them — if a listing
-- still references either, the row stays and that listing keeps working, rather than
-- this script silently breaking a live listing's category. Placed here, after the
-- listings table exists, because it has to check exactly that.
delete from public.categories c
where c.slug in ('fintech', 'saas')
  and not exists (select 1 from public.listings l where l.category_id = c.id);

-- 3. Bids (every paid bid, immutable ledger)
create table if not exists public.bids (
  id uuid primary key default uuid_generate_v4(),
  listing_id uuid references public.listings(id) on delete cascade,
  bidder_name text,
  bidder_email text,                              -- for receipt only
  amount bigint not null,                         -- paise
  currency text default 'INR',
  razorpay_order_id text unique not null,
  razorpay_payment_id text unique,
  razorpay_signature text,
  status text default 'created' check (status in ('created','paid','failed','refunded')),
  created_at timestamptz default now(),
  verified_at timestamptz
);

create index if not exists idx_bids_listing on public.bids(listing_id);
create index if not exists idx_bids_status on public.bids(status);

-- Bidder contact metadata captured at checkout. Nullable because the earliest
-- bids on the site were placed before this column existed; new bids from
-- create-order.js always set them. `bidder_phone` is E.164 (+CC + digits, 8-16
-- chars); bidder_country is an ISO alpha-2 or '' (for "Other"). Stated as their
-- own ALTERs so re-running this file on an existing database adds the columns
-- (the CREATE TABLE above is `if not exists` and would skip them otherwise).
alter table public.bids add column if not exists bidder_phone text;
alter table public.bids add column if not exists bidder_country text;

-- 4. Weekly winners (populated by cron every Monday 00:00 IST)
create table if not exists public.weekly_winners (
  id uuid primary key default uuid_generate_v4(),
  week_start date not null,
  week_end date not null,
  listing_id uuid references public.listings(id),
  category_id int references public.categories(id),
  total_bid_that_week bigint,
  created_at timestamptz default now()
);

-- 5. Activity feed (denormalized, fast reads for the live ticker)
create table if not exists public.activity_feed (
  id uuid primary key default uuid_generate_v4(),
  listing_id uuid references public.listings(id) on delete cascade,
  listing_name text not null,
  amount bigint not null,
  city text,
  created_at timestamptz default now()
);

create index if not exists idx_activity_created on public.activity_feed(created_at desc);

-- Row Level Security
alter table public.listings enable row level security;
alter table public.bids enable row level security;

-- Public can read approved listings only
drop policy if exists "public read approved listings" on public.listings;
create policy "public read approved listings" on public.listings
  for select using (status = 'approved');

-- Public can submit a new listing (goes to 'pending', admin approves manually)
drop policy if exists "anyone can submit a listing" on public.listings;
create policy "anyone can submit a listing" on public.listings
  for insert with check (status = 'pending');

-- Nobody can read/write bids directly from the browser — only your server
-- (using the service_role key, which bypasses RLS entirely) touches this table.
-- No public policies on `bids` = default deny for the anon key. This is intentional.

-- Companion function used by verify-payment.js to atomically bump totals
create or replace function increment_listing_totals(p_listing_id uuid, p_amount bigint)
returns void as $$
begin
  update listings
  set total_bid_alltime = total_bid_alltime + p_amount,
      total_bid_today   = total_bid_today + p_amount
  where id = p_listing_id;
end;
$$ language plpgsql;

-- This one runs with the *caller's* rights (no `security definer`), so RLS already
-- stops the anon key from moving anyone's bid totals — it has no UPDATE policy on
-- listings, and the update simply matches zero rows. Revoked from the browser roles
-- anyway: it's the money path, and it should not be reachable at all from a page.
revoke all on function increment_listing_totals(uuid, bigint) from public;
revoke all on function increment_listing_totals(uuid, bigint) from anon, authenticated;
grant execute on function increment_listing_totals(uuid, bigint) to service_role;

-- Lets the anon key (browser, no UPDATE grant on listings under RLS) bump a
-- listing's click counter without exposing any other write. security definer
-- runs it as the function owner instead of the caller, bypassing RLS for just
-- this one atomic increment; search_path is pinned so it can't be hijacked by
-- a same-named function on a schema earlier in a caller-controlled path.
create or replace function increment_listing_clicks(p_listing_id uuid)
returns void as $$
begin
  update listings
  set clicks = clicks + 1
  where id = p_listing_id
    and status = 'approved';
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function increment_listing_clicks(uuid) to anon, authenticated;

-- Takes a listing live on its first cleared payment and, in the same atomic step,
-- decides whether it earns the Founding Bidder badge (one of the first p_limit
-- listings to ever go live). Called only by api/verify-payment.js with the service
-- role key — never exposed to the browser, so no grant to anon here.
--
-- Doing the count and the update as two separate statements from Node would let two
-- payments clearing at the same moment both read "19 approved" and both be awarded
-- badge number 20. The advisory lock serializes exactly this function for the
-- transaction's duration, so the count every caller reads already includes any
-- listing a concurrent caller just approved.
--
-- Returns (approved, founding): `approved` is false when the listing was already
-- live (a repeat bid / top-up, or a duplicate webhook + client callback), which is
-- also what stops a listing that's already on the board from being re-badged.
create or replace function approve_listing_and_award_founding(p_listing_id uuid, p_limit int)
returns table(approved boolean, founding boolean) as $$
declare
  v_status text;
  v_approved_count int;
  v_founding boolean := false;
begin
  perform pg_advisory_xact_lock(hashtext('bidspot_founding_bidder'));

  select status into v_status from listings where id = p_listing_id;

  -- Unknown listing, or one that's already approved/rejected/removed: nothing to do.
  if v_status is distinct from 'pending' then
    return query select false, false;
    return;
  end if;

  select count(*) into v_approved_count from listings where status = 'approved';
  v_founding := v_approved_count < p_limit;

  update listings
  set status = 'approved',
      founding_bidder = v_founding
  where id = p_listing_id;

  return query select true, v_founding;
end;
$$ language plpgsql security definer set search_path = public;

-- CRITICAL: Postgres grants EXECUTE on a new function to PUBLIC by default, and
-- this one is SECURITY DEFINER — so without these revokes the anon key could call
-- it directly from a browser and flip its own unpaid 'pending' listing to
-- 'approved', publishing a listing without ever paying for it. Only the server's
-- service role, which alone has already verified the Razorpay signature, may run it.
revoke all on function approve_listing_and_award_founding(uuid, int) from public;
revoke all on function approve_listing_and_award_founding(uuid, int) from anon, authenticated;
grant execute on function approve_listing_and_award_founding(uuid, int) to service_role;

-- ============================================================
-- Admin dashboard aggregates
-- ------------------------------------------------------------
-- Called only by /api/admin/stats.js under the service role, so no browser grant
-- is needed. Wrapped as functions rather than left as inline SQL in the API file
-- so any operator with SQL access can validate the numbers directly, and so
-- swapping the definition here immediately reshapes what the dashboard shows.
-- ============================================================

create or replace function admin_totals()
returns table(paid_count bigint, volume_paise bigint, listings_count bigint) as $$
  select
    (select count(*)::bigint from bids where status = 'paid') as paid_count,
    (select coalesce(sum(amount), 0)::bigint from bids where status = 'paid') as volume_paise,
    (select count(*)::bigint from listings where status = 'approved') as listings_count;
$$ language sql stable;

create or replace function admin_bids_by_day(p_days int)
returns table(day date, paid_count bigint, volume_paise bigint) as $$
  -- generate_series gives us a row for every day in the window even if no bids
  -- landed that day, so the line chart draws a flat 0 rather than skipping days.
  with days as (
    select generate_series(
      (current_date - (p_days - 1))::date,
      current_date,
      interval '1 day'
    )::date as day
  )
  select
    d.day,
    coalesce(count(b.id), 0)::bigint as paid_count,
    coalesce(sum(b.amount), 0)::bigint as volume_paise
  from days d
  left join bids b
    on b.status = 'paid'
   and (b.verified_at at time zone 'utc')::date = d.day
  group by d.day
  order by d.day asc;
$$ language sql stable;

create or replace function admin_volume_by_category(p_limit int)
returns table(category_id int, category_name text, volume_paise bigint) as $$
  select
    l.category_id,
    coalesce(c.name, 'Uncategorized') as category_name,
    coalesce(sum(b.amount), 0)::bigint as volume_paise
  from bids b
  join listings l on l.id = b.listing_id
  left join categories c on c.id = l.category_id
  where b.status = 'paid'
  group by l.category_id, c.name
  order by volume_paise desc
  limit p_limit;
$$ language sql stable;

create or replace function admin_listings_by_status()
returns table(status text, count bigint) as $$
  select status, count(*)::bigint as count
  from listings
  group by status
  order by status;
$$ language sql stable;

-- Lock the admin aggregates down to the service role only. They read every bid
-- and every listing including non-approved rows, so the anon key must not be
-- able to call them from a browser even though the underlying tables have RLS.
revoke all on function admin_totals() from public;
revoke all on function admin_bids_by_day(int) from public;
revoke all on function admin_volume_by_category(int) from public;
revoke all on function admin_listings_by_status() from public;
revoke all on function admin_totals() from anon, authenticated;
revoke all on function admin_bids_by_day(int) from anon, authenticated;
revoke all on function admin_volume_by_category(int) from anon, authenticated;
revoke all on function admin_listings_by_status() from anon, authenticated;
grant execute on function admin_totals() to service_role;
grant execute on function admin_bids_by_day(int) to service_role;
grant execute on function admin_volume_by_category(int) to service_role;
grant execute on function admin_listings_by_status() to service_role;

-- Companion function used by api/cron/weekly-snapshot.js. Sums paid bids per listing
-- within [p_week_start, p_week_end), ordered so the top bid per category comes first —
-- there's no running weekly counter on `listings`, so this reads the immutable ledger.
create or replace function get_weekly_top_per_category(p_week_start date, p_week_end date)
returns table(listing_id uuid, category_id int, total_bid_that_week bigint) as $$
  select b.listing_id, l.category_id, sum(b.amount) as total_bid_that_week
  from bids b
  join listings l on l.id = b.listing_id
  where b.status = 'paid'
    and b.created_at >= p_week_start
    and b.created_at < p_week_end
  group by b.listing_id, l.category_id
  order by l.category_id, total_bid_that_week desc;
$$ language sql stable;
