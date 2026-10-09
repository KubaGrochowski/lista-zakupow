-- Schemat bazy: rodziny, konta zakładane przez administratora, lista zakupów.
-- Wklej całość w Supabase → SQL Editor → Run. Można uruchamiać ponownie — nie kasuje rodzin, kont ani list.
--
-- Model:
--   app_admins  — kto jest administratorem aplikacji
--   families    — rodziny (tworzy administrator)
--   members     — konta w rodzinach: login, imię, kolor (tworzy administrator, razem z kontem logowania)
--   items       — pozycje listy, każda należy do jednej rodziny
-- Rodzina widzi tylko swoją listę. Administrator widzi rodziny i konta, ale NIE listy zakupów.
--
-- Logowanie bez e-maila: login "kuba.grochowscy" to pod spodem konto "kuba.grochowscy@lista.local".
-- Konta zakłada funkcja create_member() bezpośrednio w auth.users — strona nie potrzebuje klucza service_role.

create extension if not exists pgcrypto with schema extensions;

-- ---------- sprzątanie po wersji z kluczami dostępu ----------

drop function if exists public.request_join(text, text, text);
drop function if exists public.regenerate_join_code(uuid);
drop function if exists public.new_join_code();
drop table if exists public.join_failures;

-- ---------- tabele ----------

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create table if not exists public.families (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 60),
  created_at timestamptz not null default now()
);
alter table public.families drop column if exists join_code;

create table if not exists public.members (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  family_id  uuid not null references public.families (id) on delete cascade,
  login      text,
  name       text not null check (char_length(name) between 1 and 30),
  color      text not null check (color ~ '^#[0-9a-f]{6}$'),
  created_at timestamptz not null default now()
);
alter table public.members add column if not exists login text;

-- osoby, które zdążyły się zarejestrować starym sposobem: zostają, ale bez prośby — usuń je w panelu, jeśli zbędne
drop policy if exists "members: odczyt" on public.members;   -- polityka zależy od kolumny status
alter table public.members drop column if exists status;

create unique index if not exists members_family_color on public.members (family_id, color);
create unique index if not exists members_login on public.members (login);

-- ---------- funkcje pomocnicze ----------

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid())
$$;

create or replace function public.my_family() returns uuid
language sql stable security definer set search_path = public as $$
  select family_id from public.members where user_id = auth.uid()
$$;

-- "Grochowscy" / "Łucja" → "grochowscy" / "lucja"
create or replace function public.slugify(t text) returns text
language sql immutable as $$
  select regexp_replace(
    translate(lower(coalesce(t, '')), 'ąćęłńóśźżäöüé', 'acelnoszzaoue'),
    '[^a-z0-9]', '', 'g')
$$;

-- losowe hasło: 10 znaków bez mylących (0/O, 1/l/I)
create or replace function public.random_password() returns text
language plpgsql as $$
declare
  alphabet constant text := 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- 55 znaków
  bytes bytea := extensions.gen_random_bytes(10);
  pw text := '';
  i int;
begin
  for i in 0..9 loop
    pw := pw || substr(alphabet, 1 + (get_byte(bytes, i) % 55), 1);
  end loop;
  return pw;
end $$;

-- ---------- tabela pozycji ----------

create table if not exists public.items (
  id        uuid primary key default gen_random_uuid(),
  family_id uuid not null default public.my_family() references public.families (id) on delete cascade,
  name      text not null check (char_length(name) between 1 and 120),
  qty       text not null default '' check (char_length(qty) <= 30),
  note      text not null default '' check (char_length(note) <= 200),
  category  text not null default 'inne',
  added_by  uuid not null default auth.uid(),
  added_at  timestamptz not null default now(),
  done_by   uuid,
  done_at   timestamptz
);

create index if not exists items_family_idx on public.items (family_id, added_at);

create or replace function public.items_lock() returns trigger
language plpgsql as $$
begin
  new.added_by  := old.added_by;
  new.added_at  := old.added_at;
  new.family_id := old.family_id;
  return new;
end $$;

drop trigger if exists items_lock on public.items;
create trigger items_lock before update on public.items
  for each row execute function public.items_lock();

-- ---------- funkcje administratora ----------

create or replace function public.create_family(p_name text) returns public.families
language plpgsql security definer set search_path = public as $$
declare f public.families;
begin
  if not is_admin() then raise exception 'Tylko administrator.'; end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 60 then raise exception 'Wpisz nazwę rodziny.'; end if;
  insert into families (name) values (trim(p_name)) returning * into f;
  return f;
end $$;

-- Nowe konto w rodzinie. Zwraca { ok, login, password } — hasło widać tylko teraz, w bazie jest zaszyfrowane.
create or replace function public.create_member(p_family uuid, p_name text, p_color text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  fam   public.families;
  n     text := trim(coalesce(p_name, ''));
  c     text := lower(coalesce(p_color, ''));
  base  text;
  lg    text;
  k     int := 1;
  uid   uuid := gen_random_uuid();
  pw    text := public.random_password();
  v_email text;   -- nie "email": tak nazywa się kolumna w auth.users
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'not_admin'); end if;
  select * into fam from families where id = p_family;
  if fam.id is null then return jsonb_build_object('ok', false, 'error', 'no_family'); end if;
  if char_length(n) not between 1 and 30 then return jsonb_build_object('ok', false, 'error', 'name'); end if;
  if c !~ '^#[0-9a-f]{6}$' then return jsonb_build_object('ok', false, 'error', 'color'); end if;
  if exists (select 1 from members where family_id = fam.id and color = c) then
    return jsonb_build_object('ok', false, 'error', 'color_taken');
  end if;

  base := nullif(slugify(n), '');
  if base is null then base := 'osoba'; end if;
  base := base || '.' || coalesce(nullif(slugify(fam.name), ''), 'rodzina');
  lg := base;
  while exists (select 1 from auth.users u where u.email = lg || '@lista.local') loop
    k := k + 1;
    lg := base || k;
  end loop;
  v_email := lg || '@lista.local';

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', v_email,
    crypt(pw, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('name', n), now(), now(),
    '', '', '', ''
  );

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text,
          jsonb_build_object('sub', uid::text, 'email', v_email, 'email_verified', true),
          'email', now(), now(), now());

  insert into members (user_id, family_id, login, name, color) values (uid, fam.id, lg, n, c);
  return jsonb_build_object('ok', true, 'login', lg, 'password', pw);
end $$;

-- Nowe hasło dla członka rodziny (stare przestaje działać).
create or replace function public.reset_member_password(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  pw text := public.random_password();
  lg text;
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'not_admin'); end if;
  select login into lg from members where user_id = p_user;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_member'); end if;
  update auth.users set encrypted_password = crypt(pw, gen_salt('bf')), updated_at = now() where id = p_user;
  return jsonb_build_object('ok', true, 'login', lg, 'password', pw);
end $$;

-- Usunięcie konta członka (razem z logowaniem). Administratora nie da się tak usunąć.
create or replace function public.delete_member(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Tylko administrator.'; end if;
  if exists (select 1 from app_admins where user_id = p_user) then raise exception 'Nie można usunąć administratora.'; end if;
  delete from auth.users where id = p_user and exists (select 1 from members where user_id = p_user);
end $$;

-- Usunięcie rodziny razem z kontami jej członków i całą listą.
create or replace function public.delete_family(p_family uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Tylko administrator.'; end if;
  delete from auth.users u
   where u.id in (select user_id from members where family_id = p_family)
     and not exists (select 1 from app_admins a where a.user_id = u.id);
  delete from families where id = p_family;
end $$;

revoke execute on function public.create_family(text)                from public, anon;
revoke execute on function public.create_member(uuid, text, text)    from public, anon;
revoke execute on function public.reset_member_password(uuid)        from public, anon;
revoke execute on function public.delete_member(uuid)                from public, anon;
revoke execute on function public.delete_family(uuid)                from public, anon;
revoke execute on function public.random_password()                  from public, anon, authenticated;
grant  execute on function public.create_family(text)                to authenticated;
grant  execute on function public.create_member(uuid, text, text)    to authenticated;
grant  execute on function public.reset_member_password(uuid)        to authenticated;
grant  execute on function public.delete_member(uuid)                to authenticated;
grant  execute on function public.delete_family(uuid)                to authenticated;

-- ---------- uprawnienia (RLS) ----------

alter table public.app_admins enable row level security;
alter table public.families   enable row level security;
alter table public.members    enable row level security;
alter table public.items      enable row level security;

drop policy if exists "admins: własny wiersz" on public.app_admins;
create policy "admins: własny wiersz" on public.app_admins
  for select to authenticated using (user_id = auth.uid());

-- families: admin widzi wszystkie, członek swoją. Zmiany tylko przez funkcje admina.
drop policy if exists "families: odczyt" on public.families;
create policy "families: odczyt" on public.families
  for select to authenticated using (is_admin() or id = my_family());
drop policy if exists "families: usuwa admin" on public.families;

-- members: widzę siebie i swoją rodzinę, admin wszystkich. Zmiany tylko przez funkcje admina.
create policy "members: odczyt" on public.members
  for select to authenticated
  using (user_id = auth.uid() or is_admin() or family_id = my_family());
drop policy if exists "members: akceptuje admin" on public.members;
drop policy if exists "members: usuwa admin lub sam zainteresowany" on public.members;

-- items: tylko członkowie danej rodziny
drop policy if exists "items: odczyt" on public.items;
create policy "items: odczyt" on public.items
  for select to authenticated using (family_id = my_family());

drop policy if exists "items: dodawanie" on public.items;
create policy "items: dodawanie" on public.items
  for insert to authenticated
  with check (family_id = my_family() and added_by = auth.uid());

drop policy if exists "items: zmiana" on public.items;
create policy "items: zmiana" on public.items
  for update to authenticated
  using (family_id = my_family())
  with check (family_id = my_family() and (done_by is null or done_by = auth.uid()));

drop policy if exists "items: usuwanie" on public.items;
create policy "items: usuwanie" on public.items
  for delete to authenticated using (family_id = my_family());

-- ---------- zmiany na żywo ----------

alter table public.items   replica identity full;
alter table public.members replica identity full;

do $$ begin
  alter publication supabase_realtime add table public.items;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.members;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.families;
exception when duplicate_object then null;
end $$;

-- ---------- administrator ----------
-- Przy nowej instalacji: załóż swoje konto w Authentication → Users (Auto Confirm User)
-- i uruchom poniższe z własnym adresem w miejscu przykładowego:
--
--   insert into public.app_admins (user_id)
--   select id from auth.users where lower(email) = lower('twoj-adres@przyklad.pl')
--   on conflict do nothing;
