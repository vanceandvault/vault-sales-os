-- All functions are SECURITY INVOKER (default): they run with the caller's RLS, never with elevated rights.

create or replace function public.stage_rank(s text) returns int language sql immutable as $$
  select array_position(array['new','contacted','replied','qualified','call_booked','call_completed','proposal','decision_pending','won','lost'], s)
$$;

-- Set THE next action for a lead. Replaces (never duplicates) an existing open action.
create or replace function public.set_next_action(p_lead uuid, p_title text, p_due date, p_by text default 'user')
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  if p_title is null or length(trim(p_title)) = 0 then raise exception 'Titel der Aktion fehlt'; end if;
  update public.tasks set status = 'dismissed', outcome = coalesce(outcome,'superseded'), completed_at = now()
   where lead_id = p_lead and status = 'open';
  insert into public.tasks(lead_id, title, due_date, created_by) values (p_lead, trim(p_title), p_due, p_by) returning id into v_id;
  return v_id;
end $$;

create or replace function public.mark_won(p_lead uuid, p_one_time numeric, p_monthly numeric default 0, p_months int default null)
returns uuid language plpgsql as $$
declare v_deal uuid; v_offer uuid;
begin
  select offer_id into v_offer from public.leads where id = p_lead;
  if not found then raise exception 'Lead nicht gefunden'; end if;
  select id into v_deal from public.deals where lead_id = p_lead limit 1;
  if v_deal is null then
    insert into public.deals(lead_id, offer_id, one_time_value, monthly_value, contract_months)
      values (p_lead, v_offer, coalesce(p_one_time,0), coalesce(p_monthly,0), p_months) returning id into v_deal;
  else
    update public.deals set one_time_value = coalesce(p_one_time,one_time_value), monthly_value = coalesce(p_monthly,monthly_value),
      contract_months = coalesce(p_months, contract_months) where id = v_deal;
  end if;
  update public.leads set stage = 'won', deal_value = coalesce(p_one_time, deal_value), expected_mrr = coalesce(nullif(p_monthly,0), expected_mrr),
    temperature = 'hot', last_interaction_at = now() where id = p_lead;
  update public.tasks set status = 'dismissed', outcome = 'won', completed_at = now() where lead_id = p_lead and status = 'open';
  insert into public.activities(lead_id, type, summary, source) values (p_lead, 'won', 'Als gewonnen markiert (bestätigt)', 'system');
  insert into public.audit_logs(action, entity, entity_id, detail) values ('deal.won','lead',p_lead::text, jsonb_build_object('one_time',p_one_time,'monthly',p_monthly));
  return v_deal;
end $$;

create or replace function public.mark_lost(p_lead uuid, p_reason text default null)
returns void language plpgsql as $$
begin
  update public.leads set stage = 'lost', lost_reason = p_reason, last_interaction_at = now() where id = p_lead;
  if not found then raise exception 'Lead nicht gefunden'; end if;
  update public.tasks set status = 'dismissed', outcome = 'lost', completed_at = now() where lead_id = p_lead and status = 'open';
  insert into public.activities(lead_id, type, summary, source) values (p_lead, 'lost', coalesce('Verloren: '||p_reason,'Als verloren markiert'), 'system');
  insert into public.audit_logs(action, entity, entity_id, detail) values ('deal.lost','lead',p_lead::text, jsonb_build_object('reason',p_reason));
end $$;

-- Record a payment and accrue partner commission from the ACTUAL payment (never assumed).
create or replace function public.record_payment(p_deal uuid, p_kind text, p_amount numeric, p_date date default null, p_note text default null)
returns uuid language plpgsql as $$
declare v_pay uuid; v_partner public.referral_partners; v_n int;
begin
  insert into public.payments(deal_id, kind, amount, on_date, note)
    values (p_deal, p_kind, p_amount, coalesce(p_date, (now() at time zone 'Europe/Zurich')::date), p_note) returning id into v_pay;
  select rp.* into v_partner from public.deals d join public.leads l on l.id = d.lead_id
    join public.referral_partners rp on rp.id = l.referral_partner_id where d.id = p_deal;
  if found and v_partner.commission_pct > 0 and p_kind = v_partner.commission_basis then
    -- first payment of a deal is always eligible (one-time part); further ones only within commission_months
    select count(*) into v_n from public.payments where deal_id = p_deal and kind = p_kind and id <> v_pay;
    if v_n = 0 or (v_partner.commission_months is not null and v_n < v_partner.commission_months) then
      insert into public.commissions(partner_id, payment_id, amount) values (v_partner.id, v_pay, round(p_amount * v_partner.commission_pct / 100, 2));
    end if;
  end if;
  return v_pay;
end $$;

-- Complete the open action with an outcome ("Was ist passiert?") and optionally schedule the next one.
create or replace function public.complete_task(p_task uuid, p_outcome text, p_note text default null, p_next_title text default null, p_next_due date default null)
returns uuid language plpgsql as $$
declare t public.tasks; l public.leads; v_type text; v_new uuid; v_stage text; v_days int; v_defaults jsonb;
begin
  select * into t from public.tasks where id = p_task and status = 'open';
  if not found then raise exception 'Aktion nicht gefunden oder bereits erledigt'; end if;
  select * into l from public.leads where id = t.lead_id;
  update public.tasks set status = 'done', outcome = p_outcome, completed_at = now(), needs_review = false where id = p_task;

  v_type := case p_outcome when 'no_answer' then 'call_attempt' when 'spoke' then 'call' when 'message_sent' then 'linkedin_message'
    when 'meeting_booked' then 'meeting' when 'proposal_sent' then 'proposal' else 'follow_up' end;
  insert into public.activities(lead_id, type, outcome, summary, source) values (l.id, v_type, p_outcome, coalesce(p_note, t.title), 'manual');

  v_stage := l.stage;
  if p_outcome = 'no_answer' then update public.leads set unanswered_attempts = unanswered_attempts + 1, last_interaction_at = now() where id = l.id;
  else update public.leads set unanswered_attempts = 0, last_interaction_at = now() where id = l.id; end if;

  if p_outcome = 'message_sent' and l.stage = 'new' then v_stage := 'contacted';
  elsif p_outcome = 'spoke' and stage_rank(l.stage) < stage_rank('replied') then v_stage := 'replied';
  elsif p_outcome = 'interested' then v_stage := case when stage_rank(l.stage) < stage_rank('qualified') then 'qualified' else l.stage end;
    update public.leads set temperature = case when temperature = 'cold' then 'warm' else temperature end where id = l.id;
  elsif p_outcome = 'meeting_booked' then v_stage := 'call_booked';
  elsif p_outcome = 'proposal_sent' then v_stage := 'proposal'; update public.leads set proposal_sent = true where id = l.id;
  elsif p_outcome = 'decision_pending' then v_stage := 'decision_pending';
  end if;
  if v_stage <> l.stage and p_outcome not in ('won','lost') then
    update public.leads set stage = v_stage where id = l.id;
    insert into public.activities(lead_id, type, summary, source) values (l.id, 'stage_change', l.stage||' → '||v_stage, 'system');
  end if;

  if p_outcome in ('won','lost') then return null; end if;   -- Won/Lost require explicit confirmation via mark_won / mark_lost

  if p_next_title is not null then
    return public.set_next_action(l.id, p_next_title, coalesce(p_next_due, current_date + 2), 'user');
  end if;
  -- default follow-up from editable settings
  select followup_defaults into v_defaults from public.settings where user_id = auth.uid();
  v_days := coalesce((v_defaults ->> p_outcome)::int, case p_outcome when 'other' then null else 2 end);
  if v_days is not null then
    return public.set_next_action(l.id, case p_outcome
      when 'no_answer' then 'Erneut anrufen' when 'message_sent' then 'Antwort prüfen / nachfassen'
      when 'proposal_sent' then 'Angebot nachfassen' when 'decision_pending' then 'Entscheid nachfassen'
      when 'meeting_booked' then 'Termin vorbereiten' else 'Nächsten Schritt klären' end,
      (now() at time zone 'Europe/Zurich')::date + v_days, 'system');
  end if;
  return null;
end $$;

-- Apply a CONFIRMED voice proposal atomically. The AI never writes; this function does, after the user approved.
create or replace function public.apply_update(p jsonb) returns jsonb language plpgsql as $$
declare
  v_lead uuid := nullif(p->>'lead_id','')::uuid; v_company uuid; v_contact uuid; v_vu uuid := nullif(p->>'voice_update_id','')::uuid;
  v_stage text := nullif(p->'lead'->>'stage',''); v_act jsonb := p->'activity'; v_next jsonb := p->'next_action'; v_task uuid;
  v_won jsonb := p->'won'; v_created boolean := false; v_outcome text := v_act->>'outcome';
begin
  if v_lead is null then
    if coalesce(nullif(p->'new_lead'->>'company_name',''), nullif(p->'new_lead'->>'contact_name','')) is null then
      raise exception 'Weder Lead noch neue Firma/Kontakt angegeben';
    end if;
    if nullif(p->'new_lead'->>'company_name','') is not null then
      insert into public.companies(name, industry) values (p->'new_lead'->>'company_name', nullif(p->'new_lead'->>'industry','')) returning id into v_company;
    end if;
    if nullif(p->'new_lead'->>'contact_name','') is not null then
      insert into public.contacts(company_id, name, position) values (v_company, p->'new_lead'->>'contact_name', nullif(p->'new_lead'->>'position','')) returning id into v_contact;
    end if;
    insert into public.leads(company_id, contact_id, source) values (v_company, v_contact, coalesce(nullif(p->'new_lead'->>'source',''),'voice')) returning id into v_lead;
    v_created := true;
  end if;

  if v_stage = 'won' and coalesce((v_won->>'confirmed')::boolean,false) is not true then
    raise exception 'Gewonnen erfordert ausdrückliche Bestätigung';
  end if;

  update public.leads set
    temperature = coalesce(nullif(p->'lead'->>'temperature',''), temperature),
    offer_id = coalesce(nullif(p->'lead'->>'offer_id','')::uuid, offer_id),
    deal_value = coalesce(nullif(p->'lead'->>'deal_value','')::numeric, deal_value),
    expected_mrr = coalesce(nullif(p->'lead'->>'expected_mrr','')::numeric, expected_mrr),
    decision_makers = coalesce(nullif(p->'lead'->>'decision_makers',''), decision_makers),
    timing = coalesce(nullif(p->'lead'->>'timing',''), timing),
    pain_points = (select coalesce(array_agg(distinct x), '{}') from unnest(pain_points || coalesce(array(select jsonb_array_elements_text(p->'lead'->'pain_points')),'{}')) x),
    objections = (select coalesce(array_agg(distinct x), '{}') from unnest(objections || coalesce(array(select jsonb_array_elements_text(p->'lead'->'objections')),'{}')) x),
    buying_signals = (select coalesce(array_agg(distinct x), '{}') from unnest(buying_signals || coalesce(array(select jsonb_array_elements_text(p->'lead'->'buying_signals')),'{}')) x),
    not_interested = coalesce((p->'lead'->>'not_interested')::boolean, not_interested),
    unanswered_attempts = case when v_outcome = 'no_answer' then unanswered_attempts + 1 when v_outcome in ('spoke','interested','replied') then 0 else unanswered_attempts end,
    last_interaction_at = now()
  where id = v_lead;

  if v_stage is not null and v_stage not in ('won','lost') then
    update public.leads set stage = v_stage where id = v_lead and stage is distinct from v_stage;
    if found then insert into public.activities(lead_id, type, summary, source, voice_update_id) values (v_lead,'stage_change','Stufe → '||v_stage,'voice',v_vu); end if;
  end if;

  if v_act is not null and nullif(v_act->>'type','') is not null then
    insert into public.activities(lead_id, type, outcome, summary, source, voice_update_id, is_new_prospect_touch)
    values (v_lead, v_act->>'type', nullif(v_act->>'outcome',''), nullif(v_act->>'summary',''), 'voice', v_vu, v_created);
  end if;

  if v_stage = 'won' then
    perform public.mark_won(v_lead, coalesce(nullif(v_won->>'one_time_value','')::numeric, (select deal_value from public.leads where id = v_lead)),
      coalesce(nullif(v_won->>'monthly_value','')::numeric, 0), nullif(v_won->>'contract_months','')::int);
  elsif v_stage = 'lost' then
    perform public.mark_lost(v_lead, nullif(p->'lead'->>'lost_reason',''));
  elsif v_next is not null and nullif(v_next->>'title','') is not null and nullif(v_next->>'due_date','') is not null then
    v_task := public.set_next_action(v_lead, v_next->>'title', (v_next->>'due_date')::date, 'voice');
  end if;

  if v_vu is not null then
    update public.voice_updates set status = 'applied', lead_id = v_lead, applied = p where id = v_vu;
  end if;
  insert into public.audit_logs(action, entity, entity_id, detail) values ('voice.apply','lead',v_lead::text, jsonb_build_object('created',v_created,'voice_update_id',v_vu));
  return jsonb_build_object('lead_id', v_lead, 'task_id', v_task, 'created', v_created);
end $$;

-- LinkedIn synchronisation of ONE batch (whole conversations). Idempotent; touches only linkedin_* data,
-- plus review flags (tasks.needs_review) and pending suggestions. It never edits notes, stages, values, tasks' dates etc.
create or replace function public.import_linkedin_batch(p_import uuid, p_convs jsonb) returns jsonb language plpgsql as $$
declare
  c jsonb; v_conv public.linkedin_conversations; v_exist boolean; v_started timestamptz;
  v_new int; v_total int; v_tot_new int := 0; v_tot_existing int := 0; v_convs_new int := 0; v_convs_upd int := 0; v_leads int := 0;
  v_contact public.contacts; v_matches int; v_url text; v_msgs int;
  v_last_in timestamptz; v_new_in timestamptz; v_flagged int := 0; v_task public.tasks;
begin
  select started_at into v_started from public.linkedin_imports where id = p_import;
  if not found then raise exception 'Import nicht gefunden'; end if;

  for c in select * from jsonb_array_elements(p_convs) loop
    select * into v_conv from public.linkedin_conversations where user_id = auth.uid() and conversation_key = c->>'conversation_key';
    v_exist := found;
    if not v_exist then
      insert into public.linkedin_conversations(conversation_key, title, participant_name, participant_url)
        values (c->>'conversation_key', c->>'title', c->>'participant_name', nullif(c->>'participant_url','')) returning * into v_conv;
      v_convs_new := v_convs_new + 1;
      -- matching: profile URL first (certain), exact unique name second (only a *possible* match; never a guess of company)
      v_url := lower(regexp_replace(regexp_replace(coalesce(v_conv.participant_url,''), '[?#].*$', ''), '/+$', ''));
      select * into v_contact from public.contacts
        where v_url <> '' and lower(regexp_replace(regexp_replace(coalesce(linkedin_url,''), '[?#].*$', ''), '/+$', '')) = v_url limit 1;
      if found then
        update public.linkedin_conversations set contact_id = v_contact.id, review_status = 'matched',
          lead_id = (select id from public.leads where contact_id = v_contact.id order by (stage in ('won','lost')), created_at desc limit 1)
          where id = v_conv.id returning * into v_conv;
      else
        select count(*) into v_matches from public.contacts where lower(trim(name)) = lower(trim(coalesce(v_conv.participant_name,''))) and coalesce(v_conv.participant_name,'') <> '';
        if v_matches = 1 then
          select * into v_contact from public.contacts where lower(trim(name)) = lower(trim(v_conv.participant_name));
          update public.linkedin_conversations set contact_id = v_contact.id, review_status = 'possible_match',
            possible_company = (select name from public.companies where id = v_contact.company_id),
            lead_id = (select id from public.leads where contact_id = v_contact.id order by (stage in ('won','lost')), created_at desc limit 1)
            where id = v_conv.id returning * into v_conv;
        end if;
        v_leads := v_leads + 1;     -- unmatched or only possibly matched: goes to the review queue, never auto-created as a lead
      end if;
    end if;

    -- insert messages; conflicting fingerprints are existing messages
    with ins as (
      insert into public.linkedin_messages(conversation_id, import_id, fingerprint, sender_name, sender_url, direction, sent_at, subject, content)
      select v_conv.id, p_import, m->>'fingerprint', m->>'sender_name', nullif(m->>'sender_url',''), m->>'direction', (m->>'sent_at')::timestamptz, nullif(m->>'subject',''), coalesce(m->>'content','')
      from jsonb_array_elements(c->'messages') m
      on conflict (user_id, fingerprint) do nothing
      returning direction, sent_at
    ) select count(*), max(sent_at) filter (where direction = 'inbound') into v_new, v_new_in from ins;
    v_total := jsonb_array_length(c->'messages');
    v_tot_new := v_tot_new + v_new; v_tot_existing := v_tot_existing + (v_total - v_new);

    if v_new > 0 then
      update public.linkedin_conversations lc set
        message_count = (select count(*) from public.linkedin_messages where conversation_id = lc.id),
        last_message_at = (select max(sent_at) from public.linkedin_messages where conversation_id = lc.id),
        last_inbound_at = (select max(sent_at) from public.linkedin_messages where conversation_id = lc.id and direction = 'inbound'),
        last_outbound_at = (select max(sent_at) from public.linkedin_messages where conversation_id = lc.id and direction = 'outbound'),
        title = coalesce(lc.title, c->>'title'), participant_url = coalesce(lc.participant_url, nullif(c->>'participant_url',''))
        where lc.id = v_conv.id returning * into v_conv;
      if v_exist then v_convs_upd := v_convs_upd + 1; end if;

      if v_conv.lead_id is not null then
        update public.leads set last_interaction_at = greatest(coalesce(last_interaction_at, v_conv.last_message_at), v_conv.last_message_at) where id = v_conv.lead_id;
        -- TEST G: a reply arrived while a "wait for reply" action is open → flag for review, never silently change
        if v_new_in is not null then
          select * into v_task from public.tasks where lead_id = v_conv.lead_id and status = 'open' and created_at < v_new_in
            and title ~* '(antwort|geantwortet|reply|replied|rückmeldung|prüfen|check)';
          if found then
            update public.tasks set needs_review = true, review_reason = 'Neue LinkedIn-Antwort vom ' || to_char(v_new_in at time zone 'Europe/Zurich','DD.MM.YYYY HH24:MI') || ' – Aktion evtl. veraltet' where id = v_task.id;
            insert into public.suggestions(lead_id, conversation_id, task_id, kind, title, detail)
              values (v_conv.lead_id, v_conv.id, v_task.id, 'reply_detected', 'Antwort erhalten: "' || v_task.title || '" prüfen',
                      'Neue eingehende Nachricht in LinkedIn. Aktion anpassen oder erledigen?')
              on conflict (user_id, kind, conversation_id) where status = 'pending' and conversation_id is not null do nothing;
            v_flagged := v_flagged + 1;
          end if;
        end if;
      end if;
    end if;
  end loop;

  update public.linkedin_imports set conversations_processed = conversations_processed + jsonb_array_length(p_convs),
    messages_total = messages_total + v_tot_new + v_tot_existing, new_messages = new_messages + v_tot_new,
    existing_messages = existing_messages + v_tot_existing, new_conversations = new_conversations + v_convs_new,
    updated_conversations = updated_conversations + v_convs_upd, potential_leads = potential_leads + v_leads
    where id = p_import;
  return jsonb_build_object('new_messages', v_tot_new, 'existing_messages', v_tot_existing, 'new_conversations', v_convs_new,
    'updated_conversations', v_convs_upd, 'potential_leads', v_leads, 'flagged_tasks', v_flagged);
end $$;

-- Global search over companies, contacts, notes, activities, imported messages and transcripts
create or replace function public.search_all(q text) returns table(kind text, id uuid, lead_id uuid, title text, snippet text)
language sql stable as $$
  with p as (select '%' || replace(replace(trim(q),'%','\%'),'_','\_') || '%' as pat)
  select 'company', c.id, (select l.id from public.leads l where l.company_id = c.id order by l.created_at desc limit 1), c.name, coalesce(c.industry,'') from public.companies c, p where c.name ilike p.pat or c.notes ilike p.pat or c.website ilike p.pat
  union all
  select 'contact', k.id, (select l.id from public.leads l where l.contact_id = k.id order by l.created_at desc limit 1), k.name, concat_ws(' · ', k.phone, k.email) from public.contacts k, p where k.name ilike p.pat or k.phone ilike p.pat or k.email ilike p.pat
  union all
  select 'notiz', l.id, l.id, coalesce((select name from public.companies where id = l.company_id),'Lead'), left(l.notes, 140) from public.leads l, p where l.notes ilike p.pat
  union all
  select 'aktivität', a.id, a.lead_id, a.type, left(a.summary, 140) from public.activities a, p where a.summary ilike p.pat
  union all
  select 'linkedin', m.id, lc.lead_id, coalesce(lc.participant_name, lc.title, 'LinkedIn'), left(m.content, 140) from public.linkedin_messages m join public.linkedin_conversations lc on lc.id = m.conversation_id, p where m.content ilike p.pat
  union all
  select 'transkript', v.id, v.lead_id, 'Sprachnotiz', left(v.transcript, 140) from public.voice_updates v, p where v.transcript ilike p.pat
  limit 60
$$;

-- Delete all demo records (companies cascade to contacts/leads/tasks/activities/deals)
create or replace function public.delete_demo_data() returns int language plpgsql as $$
declare n int;
begin
  delete from public.companies where is_demo; get diagnostics n = row_count;
  delete from public.leads where is_demo;
  delete from public.contacts where is_demo;
  insert into public.audit_logs(action, detail) values ('demo.delete', jsonb_build_object('companies', n));
  return n;
end $$;
