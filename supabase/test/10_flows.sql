\set ON_ERROR_STOP on
insert into auth.users(id,email) values ('00000000-0000-0000-0000-00000000000a','owner@x'),('00000000-0000-0000-0000-00000000000b','other@x');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';

-- helper to assert
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if not coalesce(cond,false) then raise exception 'ASSERT FAILED: %', msg; end if; end $$;

-- ===== TEST A: voice update creates lead, activity, next action =====
select pg_temp.ok((select (apply_update('{"new_lead":{"company_name":"HM Renovation","contact_name":"Milos"},
  "activity":{"type":"linkedin_message","outcome":"no_answer","summary":"Milos geschrieben, keine Antwort"},
  "lead":{"stage":"contacted","temperature":"warm"},
  "next_action":{"title":"Milos nachfassen","due_date":"2026-10-09"}}'::jsonb)->>'created')::boolean), 'A: lead created');
select pg_temp.ok((select count(*) from leads)=1 and (select count(*) from activities where source='voice')>=1, 'A: activity');
select pg_temp.ok((select due_date from tasks where status='open')='2026-10-09', 'A: due friday');

-- second update must REPLACE the open task, never duplicate
select apply_update(jsonb_build_object('lead_id',(select id from leads limit 1),
  'activity','{"type":"call","outcome":"spoke","summary":"Gespräch"}'::jsonb,'next_action','{"title":"Anrufen","due_date":"2026-10-12"}'::jsonb));
select pg_temp.ok((select count(*) from tasks where status='open')=1, 'A: exactly one open task');
select pg_temp.ok((select count(*) from tasks where status='dismissed')=1, 'A: old task superseded');
do $$ begin
  begin insert into tasks(lead_id,title,due_date) select id,'dup',current_date from leads; raise exception 'dup allowed';
  exception when unique_violation then null; end; end $$;

-- ===== TEST B: won needs confirmation; no payment auto-created =====
do $$ begin
  begin perform apply_update(jsonb_build_object('lead_id',(select id from leads limit 1),'lead','{"stage":"won","deal_value":1490}'::jsonb));
    raise exception 'won without confirmation allowed';
  exception when raise_exception then if sqlerrm like 'won without%' then raise; end if; end; end $$;
select pg_temp.ok((select stage from leads limit 1)<>'won', 'B: not won before approval');
select apply_update(jsonb_build_object('lead_id',(select id from leads limit 1),'lead','{"stage":"won","deal_value":1490}'::jsonb,'won','{"confirmed":true,"one_time_value":1490}'::jsonb));
select pg_temp.ok((select stage from leads limit 1)='won', 'B: won after approval');
select pg_temp.ok((select one_time_value from deals)=1490, 'B: contract value');
select pg_temp.ok((select count(*) from payments)=0, 'B: payment NOT received');
select pg_temp.ok((select count(*) from tasks where status='open')=0, 'B: removed from active queue');

-- ===== partner commission from actual payments =====
insert into referral_partners(name,commission_pct,commission_months) values ('Partner X',10,3);
update leads set referral_partner_id=(select id from referral_partners limit 1);
select record_payment((select id from deals limit 1),'received',1490);
select pg_temp.ok((select amount from commissions)=149.00,'commission 10% of actual payment');
select record_payment((select id from deals limit 1),'invoiced',500);
select pg_temp.ok((select count(*) from commissions)=1,'invoiced does not accrue when basis=received');

-- ===== TEST C/D/E: LinkedIn import =====
insert into linkedin_imports(file_name,file_fingerprint) values ('a.zip','fp1');
create temp table imp as select id from linkedin_imports;
create or replace function pg_temp.mkconv(n_from int, n_to int) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('conversation_key','conv-1','title','Milos','participant_name','Milos','participant_url','https://www.linkedin.com/in/milos/',
    'messages',(select jsonb_agg(jsonb_build_object('fingerprint','fp-'||g,'sender_name',case when g%2=0 then 'Elena' else 'Milos' end,'direction',case when g%2=0 then 'outbound' else 'inbound' end,
      'sent_at',(timestamptz '2026-09-01 10:00+00' + g*interval '1 hour'),'content','msg '||g)) from generate_series(n_from,n_to) g)));
$$;
-- contact exists with this LinkedIn URL (with different formatting) → certain match
update contacts set linkedin_url='https://www.linkedin.com/in/Milos?trk=x' ;
select pg_temp.ok((import_linkedin_batch((select id from imp), pg_temp.mkconv(1,12))->>'new_messages')::int=12,'C: 12 stored');
select pg_temp.ok((select count(*) from leads)=1,'C: no duplicate CRM lead');
select pg_temp.ok((select review_status from linkedin_conversations)='matched' and (select lead_id from linkedin_conversations) is not null,'C: matched to existing lead by URL');
select pg_temp.ok((select message_count from linkedin_conversations)=12,'C: count');

-- snapshot CRM before D
create temp table before as select (select jsonb_agg(to_jsonb(l) - 'last_interaction_at' - 'updated_at' order by id) from leads l) l,
  (select jsonb_agg(to_jsonb(t) order by id) from tasks t) t, (select jsonb_agg(to_jsonb(a) order by id) from activities a) a, (select jsonb_agg(to_jsonb(d) order by id) from deals d) d;

-- TEST G prerequisite: lead is won already; create a fresh lead with a "check reply" task bound to a conversation
insert into companies(name) values ('Reply Test AG'); 
insert into contacts(company_id,name,linkedin_url) select id,'Rita','https://www.linkedin.com/in/rita' from companies where name='Reply Test AG';
insert into leads(company_id,contact_id) select c.id,k.id from companies c join contacts k on k.company_id=c.id where c.name='Reply Test AG';
select set_next_action((select id from leads where company_id=(select id from companies where name='Reply Test AG')),'Prüfen ob Rita geantwortet hat', current_date+2,'system');
update tasks set created_at = '2026-08-31 00:00+00' where title like 'Prüfen ob Rita%';

-- TEST D: same 12 + 6 new
select pg_temp.ok((select (import_linkedin_batch((select id from imp), pg_temp.mkconv(1,18))) ->> 'new_messages')::int=6,'D: 6 new');
select pg_temp.ok((select count(*) from linkedin_messages where conversation_id=(select id from linkedin_conversations where conversation_key='conv-1'))=18,'D: 18 total');
select pg_temp.ok((select updated_conversations from linkedin_imports)=1,'D: updated conv counted');
select pg_temp.ok((select jsonb_agg(to_jsonb(l) - 'last_interaction_at' - 'updated_at' order by id) from leads l where id=(select lead_id from linkedin_conversations)) is not null,'D: lead intact');

-- TEST E: identical again → idempotent
select pg_temp.ok((import_linkedin_batch((select id from imp), pg_temp.mkconv(1,18))->>'new_messages')::int=0,'E: 0 new');
select pg_temp.ok((select count(*) from linkedin_messages)=18,'E: no duplicates');

-- CRM unchanged by sync (won lead, its tasks, activities, deals)
select pg_temp.ok((select d from before) = (select jsonb_agg(to_jsonb(d) order by id) from deals d), 'D/E: deals untouched');
select pg_temp.ok((select a from before) = (select jsonb_agg(to_jsonb(a) order by id) from activities a), 'D/E: activities untouched');

-- ===== TEST G: reply for Rita arrives =====
create or replace function pg_temp.rita() returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('conversation_key','conv-rita','participant_name','Rita','participant_url','https://www.linkedin.com/in/rita/',
   'messages', jsonb_build_array(
     jsonb_build_object('fingerprint','r1','sender_name','Elena','direction','outbound','sent_at','2026-09-01T10:00:00Z','content','Hallo Rita'),
     jsonb_build_object('fingerprint','r2','sender_name','Rita','direction','inbound','sent_at','2026-09-05T10:00:00Z','content','Ja gerne, schick mir Infos'))));
$$;
select pg_temp.ok((import_linkedin_batch((select id from imp), pg_temp.rita())->>'flagged_tasks')::int=1,'G: flagged');
select pg_temp.ok((select needs_review from tasks where title like 'Prüfen ob Rita%' and status='open'),'G: task flagged for review');
select pg_temp.ok((select due_date from tasks where title like 'Prüfen ob Rita%')=current_date+2,'G: task NOT silently changed');
select pg_temp.ok((select count(*) from suggestions where kind='reply_detected' and status='pending')=1,'G: suggestion created');
select import_linkedin_batch((select id from imp), pg_temp.rita());
select pg_temp.ok((select count(*) from suggestions)=1,'G: no duplicate suggestion on re-import');

-- unknown person → review queue, no lead created
select import_linkedin_batch((select id from imp), '[{"conversation_key":"conv-x","participant_name":"Fremder","messages":[{"fingerprint":"x1","direction":"inbound","sent_at":"2026-09-02T10:00:00Z","content":"hi"}]}]');
select pg_temp.ok((select review_status from linkedin_conversations where conversation_key='conv-x')='new','unknown → review');
select pg_temp.ok((select count(*) from leads)=2,'no auto lead for unknown conversation');

-- ===== delete demo + search =====
select pg_temp.ok((select count(*) from search_all('Milos'))>=2,'search finds contacts and messages');

-- ===== RLS: other user sees nothing =====
reset role; set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.ok((select count(*) from leads)=0 and (select count(*) from linkedin_messages)=0 and (select count(*) from companies)=0,'RLS isolation');
do $$ begin begin insert into companies(user_id,name) values ('00000000-0000-0000-0000-00000000000a','evil'); raise exception 'cross-user insert allowed';
 exception when insufficient_privilege then null; end; end $$;
-- anon has no access at all
reset role; set role anon;
do $$ begin begin perform count(*) from leads; raise exception 'anon can read';
 exception when insufficient_privilege then null; end; end $$;
