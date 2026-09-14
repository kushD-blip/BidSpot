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

insert into public.categories (slug, name, icon, sort_order) values
  ('productivity', 'Productivity', '⚡', 1),
  ('ecommerce', 'Ecommerce', '🛒', 2),
  ('fintech', 'Fintech', '💳', 3),
  ('developer', 'Developer', '</>', 4),
  ('ai-tools', 'AI Tools', '🤖', 5),
  ('saas', 'SaaS', '💼', 6),
  ('crypto', 'Crypto', '◎', 7),
  ('marketing', 'Marketing', '📣', 8),
  ('seo', 'SEO & Visibility', '🔍', 9),
  ('design', 'Design & Creative', '🎨', 10),
  ('business', 'Business & Finance', '⚖️', 11),
  ('security', 'Security & Privacy', '🛡️', 12),
  ('health', 'Health & Wellness', '❤️', 13),
  ('social', 'Social & Creator Tools', '📱', 14),
  ('hiring', 'Hiring & Careers', '📋', 15),
  ('education', 'Education & Learning', '🎓', 16),
  ('agencies', 'Agencies & Services', '🤝', 17)
on conflict (slug) do nothing;

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

create index if not exists idx_listings_category on public.listings(category_id);
create index if not exists idx_listings_alltime on public.listings(total_bid_alltime desc);
create index if not exists idx_listings_today on public.listings(total_bid_today desc);

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
