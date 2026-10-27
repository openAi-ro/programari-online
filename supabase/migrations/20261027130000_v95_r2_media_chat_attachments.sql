-- v95: Cloudflare R2 media + chat attachments (additive).
-- The media Worker (programari-media.rafaeldanescu.workers.dev) authorizes
-- uploads and private chat reads by calling these functions with the
-- caller's own Supabase JWT, so the Worker holds no Supabase secret.

-- Who may write public media under <bucket>/<folder>/...: same rules as the
-- old Supabase storage policies (avatars: own user id; the rest: own business).
create or replace function public.media_can_write(p_bucket text, p_folder text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null or p_folder is null then false
    when p_bucket = 'profile-avatars' then p_folder = auth.uid()::text
    when p_bucket in ('business-logos', 'business-media', 'business-videos', 'staff-photos') then
      exists (
        select 1 from public.business_profiles b
        where b.id::text = p_folder and b.owner_user_id = auth.uid()
      )
    else false
  end;
$$;

revoke all on function public.media_can_write(text, text) from public, anon;
grant execute on function public.media_can_write(text, text) to authenticated;

-- Conversation membership (client or salon owner), same rule as chat RLS.
create or replace function public.chat_can_access(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.chat_conversations c
    where c.id = p_conversation
      and (
        c.client_user_id = auth.uid()
        or c.business_id in (select b.id from public.business_profiles b where b.owner_user_id = auth.uid())
      )
  );
$$;

revoke all on function public.chat_can_access(uuid) from public, anon;
grant execute on function public.chat_can_access(uuid) to authenticated;

-- Attachment on a chat message: the R2 key lives in the private bucket under
-- <conversation_id>/..., so a row can only point at its own conversation.
alter table public.chat_messages
  add column if not exists attachment_key text,
  add column if not exists attachment_kind text,
  add column if not exists attachment_mime text,
  add column if not exists attachment_bytes integer;

alter table public.chat_messages drop constraint if exists chat_messages_attachment_check;
alter table public.chat_messages add constraint chat_messages_attachment_check check (
  (attachment_key is null and attachment_kind is null and attachment_mime is null and attachment_bytes is null)
  or (
    attachment_key like conversation_id::text || '/%'
    and attachment_key !~ '\.\.'
    and attachment_kind in ('image', 'video')
    and attachment_mime is not null
    and attachment_bytes between 1 and 52428800
  )
);

create or replace function public.insert_chat_attachment(
  p_conversation uuid,
  p_key text,
  p_kind text,
  p_mime text,
  p_bytes integer,
  p_caption text default ''
)
returns public.chat_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg public.chat_messages;
  v_caption text := coalesce(trim(p_caption), '');
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.chat_can_access(p_conversation) then
    raise exception 'not_participant';
  end if;
  if length(v_caption) > 4000 then
    raise exception 'message_too_long';
  end if;

  insert into public.chat_messages (
    conversation_id, sender_user_id, body,
    attachment_key, attachment_kind, attachment_mime, attachment_bytes
  )
  values (p_conversation, auth.uid(), v_caption, p_key, p_kind, p_mime, p_bytes)
  returning * into v_msg;

  return v_msg;
end;
$$;

revoke all on function public.insert_chat_attachment(uuid, text, text, text, integer, text) from public, anon;
grant execute on function public.insert_chat_attachment(uuid, text, text, text, integer, text) to authenticated;
