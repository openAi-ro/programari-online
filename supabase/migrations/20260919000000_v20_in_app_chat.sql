-- v20: chat în-app (client ↔ business). Conversațiile se creează automat la
-- prima programare (trigger pe appointments) sau la deschiderea chat-ului
-- (RPC ensure_chat_conversation, idempotent). Mesajele merg prin RPC-ul
-- insert_chat_message; actualizările sunt transmise prin publicarea
-- realtime `supabase_realtime`.

create table public.chat_conversations (
  id uuid not null default gen_random_uuid() primary key,
  business_id uuid not null references public.business_profiles(id) on delete cascade,
  client_user_id uuid not null references public.profiles(id) on delete cascade,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, client_user_id)
);

create table public.chat_messages (
  id uuid not null default gen_random_uuid() primary key,
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) <= 4000),
  created_at timestamptz not null default now()
);

create index chat_messages_conversation_idx on public.chat_messages (conversation_id, created_at);

alter table public.chat_conversations enable row level security;
create policy chat_conversations_select_participant on public.chat_conversations for select using (
  auth.uid() = client_user_id
  or business_id in (select id from public.business_profiles b where b.owner_user_id = auth.uid())
);

alter table public.chat_messages enable row level security;
create policy chat_messages_select_participant on public.chat_messages for select using (
  exists (
    select 1 from public.chat_conversations c
    where c.id = conversation_id
      and (
        c.client_user_id = auth.uid()
        or c.business_id in (select id from public.business_profiles b where b.owner_user_id = auth.uid())
      )
  )
);
create policy chat_messages_insert_participant on public.chat_messages for insert with check (
  exists (
    select 1 from public.chat_conversations c
    where c.id = conversation_id
      and (
        c.client_user_id = auth.uid()
        or c.business_id in (select id from public.business_profiles b where b.owner_user_id = auth.uid())
      )
  )
  and sender_user_id = auth.uid()
);

-- Conversația e creată automat la prima programare a unui client.
create or replace function public.chat_conversation_from_appointment() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.chat_conversations (business_id, client_user_id)
  values (NEW.business_id, NEW.client_user_id)
  on conflict (business_id, client_user_id) do nothing;
  return NEW;
end;
$$;

create trigger appointments_create_chat_conversation
  after insert on public.appointments
  for each row
  execute procedure public.chat_conversation_from_appointment();

-- Actualizează last_message_at pe conversația mesajului (pentru ordonare
-- și afișare în listă).
create or replace function public.chat_message_set_last_message_at() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_conversations
    set last_message_at = NEW.created_at
  where id = NEW.conversation_id;
  return NEW;
end;
$$;

create trigger chat_messages_set_last_message_at
  after insert on public.chat_messages
  for each row
  execute procedure public.chat_message_set_last_message_at();

-- Creează (idempotent) conversația între utilizatorul autentificat și business-ul
-- dat ca parametru. Utilizatorul poate fi client sau proprietar business; conversația
-- e (business_id, client_user_id = caller), adică proprietarul e „client" al
-- conversației pe baza owner-ului business-ului.
create or replace function public.ensure_chat_conversation(
  p_business_id uuid
) returns public.chat_conversations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_biz public.business_profiles;
  v_conv public.chat_conversations;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_biz from public.business_profiles where id = p_business_id;
  if not found then
    raise exception 'business_not_found';
  end if;

  insert into public.chat_conversations (business_id, client_user_id)
  values (p_business_id, v_user)
  on conflict (business_id, client_user_id) do nothing;

  select * into v_conv from public.chat_conversations
    where business_id = p_business_id and client_user_id = v_user;
  if not found then
    raise exception 'conversation_not_created';
  end if;

  return v_conv;
end;
$$;

revoke all on function public.ensure_chat_conversation(uuid) from public;
grant execute on function public.ensure_chat_conversation(uuid) to authenticated;

-- Trimite un mesaj în conversația în care participantul (caller) e parte.
create or replace function public.insert_chat_message(
  p_conversation uuid,
  p_body text
) returns public.chat_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_conv public.chat_conversations;
  v_msg public.chat_messages;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  if p_body is null or trim(p_body) = '' then
    raise exception 'empty_message';
  end if;

  if length(p_body) > 4000 then
    raise exception 'message_too_long';
  end if;

  select * into v_conv from public.chat_conversations where id = p_conversation;
  if not found then
    raise exception 'conversation_not_found';
  end if;

  if not (
    v_conv.client_user_id = v_user
    or v_conv.business_id in (select id from public.business_profiles b where b.owner_user_id = v_user)
  ) then
    raise exception 'not_participant';
  end if;

  insert into public.chat_messages (conversation_id, sender_user_id, body)
  values (p_conversation, v_user, p_body)
  returning * into v_msg;

  return v_msg;
end;
$$;

revoke all on function public.insert_chat_message(uuid, text) from public;
grant execute on function public.insert_chat_message(uuid, text) to authenticated;

-- Adaugă tabelele la publicarea realtime (Supabase Realtime / Database
-- Webhooks le folosesc pentru live update și push la alte dispozitive).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_conversations'
  ) then
    execute 'alter publication supabase_realtime add table public.chat_conversations';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_messages'
  ) then
    execute 'alter publication supabase_realtime add table public.chat_messages';
  end if;
exception
  when undefined_object then
    null;
end;
$$;

notify pgrst, 'reload schema';
