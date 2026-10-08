-- VAULT SALES OS – core schema. Single-user app; every row is owned by auth.uid() and protected by RLS.
create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

-- ───────── helpers ─────────
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ───────── settings ─────────
create table public.settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  self_name text,                       -- own LinkedIn display name (to tell sent from received)
  self_linkedin_url text,
  followup_defaults jsonb not null default '{"no_answer":2,"message_sent":2,"proposal_sent":2,"meeting_completed":1,"decision_pending":1,"interested":2}',
  priority_weights jsonb not null default '{"hot":25,"warm":15,"decision_pending":20,"proposal":20,"meeting_completed":15,"positive_reply":10,"overdue":10,"due_today":10,"high_value":5,"unanswered":-15,"not_interested":-40,"high_value_threshold":3000}',
  goals jsonb not null default '{"customers_per_month":10,"daily_outreach":50,"monthly_calls":2000,"monthly_revenue":10000}',
  weighted_probability jsonb not null default '{"new":0.05,"contacted":0.1,"replied":0.15,"qualified":0.3,"call_booked":0.4,"call_completed":0.5,"proposal":0.6,"decision_pending":0.75}',
  retain_audio boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ───────── CRM core ─────────
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  industry text, website text, location text, linkedin_url text, instagram text, notes text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  position text, phone text, email text, linkedin_url text, instagram text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  kind text not null default 'one_time' check (kind in ('one_time','recurring','custom')),
  price_chf numeric(12,2) not null default 0,       -- one-time price or monthly price
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.referral_partners (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null, company text,
  commission_pct numeric(5,2) not null default 0 check (commission_pct between 0 and 100),
  commission_months int,                            -- null = no recurring commission; n = first n monthly payments
  commission_basis text not null default 'received' check (commission_basis in ('received','invoiced')),
  notes text,
  created_at timestamptz not null default now()
);
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,   -- primary contact
  source text,
  temperature text not null default 'cold' check (temperature in ('hot','warm','cold')),
  stage text not null default 'new' check (stage in ('new','contacted','replied','qualified','call_booked','call_completed','proposal','decision_pending','won','lost')),
  offer_id uuid references public.offers(id) on delete set null,
  deal_value numeric(12,2),
  expected_mrr numeric(12,2),
  referral_partner_id uuid references public.referral_partners(id) on delete set null,
  notes text,
  pain_points text[] not null default '{}',
  buying_signals text[] not null default '{}',
  objections text[] not null default '{}',
  decision_makers text,
  timing text,
  expected_close date,
  last_interaction_at timestamptz,
  unanswered_attempts int not null default 0,
  priority_override int,                            -- manual override of the computed score
  not_interested boolean not null default false,
  proposal_sent boolean not null default false,
  lost_reason text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (company_id is not null or contact_id is not null)
);
create table public.deals (          -- a confirmed win. Contract value ≠ invoiced ≠ received.
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  offer_id uuid references public.offers(id) on delete set null,
  one_time_value numeric(12,2) not null default 0,
  monthly_value numeric(12,2) not null default 0,
  contract_months int,
  won_at date not null default (now() at time zone 'Europe/Zurich')::date,
  notes text,
  created_at timestamptz not null default now()
);
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  kind text not null check (kind in ('invoiced','received')),
  amount numeric(12,2) not null check (amount > 0),
  on_date date not null default (now() at time zone 'Europe/Zurich')::date,
  note text,
  created_at timestamptz not null default now()
);
create table public.commissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  partner_id uuid not null references public.referral_partners(id) on delete cascade,
  payment_id uuid not null references public.payments(id) on delete cascade,
  amount numeric(12,2) not null,
  paid boolean not null default false,
  paid_on date,
  created_at timestamptz not null default now(),
  unique (payment_id)
);

-- ───────── activities & tasks ─────────
create table public.voice_updates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  transcript text not null,
  proposal jsonb,
  applied jsonb,
  status text not null default 'pending' check (status in ('pending','applied','discarded','failed')),
  audio_path text,
  created_at timestamptz not null default now()
);
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  type text not null check (type in ('call','call_attempt','email','linkedin_message','linkedin_reply','meeting','proposal','note','follow_up','stage_change','won','lost','other')),
  outcome text,
  summary text,
  occurred_at timestamptz not null default now(),
  source text not null default 'manual' check (source in ('manual','voice','linkedin','system')),
  voice_update_id uuid references public.voice_updates(id) on delete set null,
  is_new_prospect_touch boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  title text not null,
  kind text not null default 'follow_up',
  due_date date not null,
  status text not null default 'open' check (status in ('open','done','dismissed')),
  needs_review boolean not null default false,
  review_reason text,
  outcome text,
  created_by text not null default 'user' check (created_by in ('user','voice','system','linkedin')),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
-- at most ONE open primary next action per lead → no duplicate follow-ups by construction
create unique index tasks_one_open_per_lead on public.tasks(lead_id) where status = 'open';
create index tasks_due on public.tasks(user_id, due_date) where status = 'open';
create index activities_lead_time on public.activities(lead_id, occurred_at desc);
create index leads_user_stage on public.leads(user_id, stage);

-- ───────── LinkedIn ─────────
create table public.linkedin_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  file_name text not null,
  file_fingerprint text not null,                  -- SHA-256 of the uploaded archive
  status text not null default 'running' check (status in ('running','completed','failed')),
  conversations_processed int not null default 0,
  messages_total int not null default 0,
  new_messages int not null default 0,
  existing_messages int not null default 0,
  updated_conversations int not null default 0,
  new_conversations int not null default 0,
  potential_leads int not null default 0,
  errors jsonb not null default '[]',
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create table public.linkedin_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  conversation_key text not null,                  -- LinkedIn conversation id or participant hash
  title text,
  participant_name text,
  participant_url text,
  lead_id uuid references public.leads(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  review_status text not null default 'new' check (review_status in ('new','matched','possible_match','ignored')),
  possible_company text,
  message_count int not null default 0,
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  summary text,
  summary_message_count int not null default 0,
  first_imported_at timestamptz not null default now(),
  unique (user_id, conversation_key)
);
create table public.linkedin_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.linkedin_conversations(id) on delete cascade,
  import_id uuid references public.linkedin_imports(id) on delete set null,
  fingerprint text not null,
  sender_name text, sender_url text,
  direction text not null check (direction in ('inbound','outbound')),
  sent_at timestamptz not null,
  subject text,
  content text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, fingerprint)
);
create index linkedin_messages_conv on public.linkedin_messages(conversation_id, sent_at);
create index linkedin_messages_trgm on public.linkedin_messages using gin (content gin_trgm_ops);

-- Pending proposals that need the owner's approval (never applied silently)
create table public.suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  conversation_id uuid references public.linkedin_conversations(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  kind text not null check (kind in ('new_opportunity','reply_detected','stage_change','next_action')),
  title text not null,
  detail text,
  payload jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending','approved','dismissed')),
  created_at timestamptz not null default now()
);
create unique index suggestions_dedupe on public.suggestions(user_id, kind, conversation_id) where status = 'pending' and conversation_id is not null;

create table public.audit_logs (
  id bigserial primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  action text not null,
  entity text, entity_id text,
  detail jsonb,
  created_at timestamptz not null default now()
);

-- search indexes
create index companies_trgm on public.companies using gin (name gin_trgm_ops);
create index contacts_trgm on public.contacts using gin (name gin_trgm_ops);
create index activities_trgm on public.activities using gin (summary gin_trgm_ops);
create index voice_trgm on public.voice_updates using gin (transcript gin_trgm_ops);
create index leads_notes_trgm on public.leads using gin (notes gin_trgm_ops);

-- updated_at triggers
do $$ declare t text; begin
  foreach t in array array['companies','contacts','leads','settings'] loop
    execute format('create trigger %I_upd before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- ───────── Row level security: owner only ─────────
do $$ declare t text; begin
  foreach t in array array['settings','companies','contacts','offers','referral_partners','leads','deals','payments','commissions',
    'voice_updates','activities','tasks','linkedin_imports','linkedin_conversations','linkedin_messages','suggestions','audit_logs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t||'_owner', t);
  end loop;
end $$;
revoke all on all tables in schema public from anon;
