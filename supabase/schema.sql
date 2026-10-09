-- KROK 2 z 2 — schemat bazy: rodziny, klucze dostępu, akceptacja członków, lista zakupów.
-- Uruchom po 00-cleanup.sql. Można uruchamiać ponownie — niczego nie kasuje.
--
-- Model:
--   app_admins  — kto jest administratorem aplikacji (Ty)
--   families    — rodziny z 5-znakowym kluczem dostępu (tworzysz w panelu admina)
--   members     — osoby w rodzinach: imię, kolor, status 'pending' (czeka) / 'approved' (zaakceptowany)
--   items       — pozycje listy, każda należy do jednej rodziny
-- Rodzina widzi tylko swoją listę. Administrator widzi rodziny i prośby o dołączenie, ale NIE listy zakupów.

-- ---------- tabele ----------

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create table if not exists public.families (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 60),
  join_code  text not null unique check (join_code ~ '^[A-Z0-9]{5}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  family_id  uuid not null references public.families (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 30),
  color      text not null check (color ~ '^#[0-9a-f]{6}$'),
  status     text not null default 'pending' check (status in ('pending', 'approved')),
  created_at timestamptz not null default now()
);

-- w jednej rodzinie każdy ma inny kolor
create unique index if not exists members_family_color on public.members (family_id, color);

-- licznik błędnych kluczy (ochrona przed zgadywaniem)
create table if not exists public.join_failures (
  user_id uuid not null,
  at      timestamptz not null default now()
);
alter table public.join_failures enable row level security;  -- bez polityk: nikt z zewnątrz nie ma wstępu

-- ---------- funkcje pomocnicze ----------

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid())
$$;

-- rodzina zalogowanej osoby, ale tylko jeśli została zaakceptowana
create or replace function public.my_family() returns uuid
language sql stable security definer set search_path = public as $$
  select family_id from public.members where user_id = auth.uid() and status = 'approved'
$$;

-- losowy klucz: 5 znaków z alfabetu bez mylących (0/O, 1/I)
create or replace function public.new_join_code() returns text
language plpgsql set search_path = public as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';  -- 32 znaki
  bytes bytea;
  code text;
  i int;
begin
  loop
    bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    code := '';
    for i in 0..4 loop
      code := code || substr(alphabet, 1 + (get_byte(bytes, i) % 32), 1);
    end loop;
    exit when not exists (select 1 from public.families where join_code = code);
  end loop;
  return code;
end $$;

-- ---------- tabela pozycji (potrzebuje my_family() w domyślnej wartości) ----------

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

-- autora, datę dodania i rodzinę zmienić się nie da
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

-- ---------- funkcje wywoływane z aplikacji ----------

-- Dołączanie: klucz + imię + kolor. Konto trafia do kolejki ze statusem 'pending'.
-- Zwraca { ok: true } albo { ok: false, error: '<kod>' } — kody tłumaczy aplikacja.
create or replace function public.request_join(p_code text, p_name text, p_color text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  fid uuid;
  n text := trim(coalesce(p_name, ''));
  c text := lower(coalesce(p_color, ''));
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'no_session'); end if;
  if exists (select 1 from members where user_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'error', 'already');
  end if;
  if char_length(n) not between 1 and 30 then return jsonb_build_object('ok', false, 'error', 'name'); end if;
  if c !~ '^#[0-9a-f]{6}$' then return jsonb_build_object('ok', false, 'error', 'color'); end if;

  if (select count(*) from join_failures where user_id = auth.uid() and at > now() - interval '1 hour') >= 8 then
    return jsonb_build_object('ok', false, 'error', 'too_many');
  end if;

  select id into fid from families where join_code = upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  if fid is null then
    insert into join_failures (user_id) values (auth.uid());
    return jsonb_build_object('ok', false, 'error', 'bad_code');
  end if;

  if exists (select 1 from members where family_id = fid and color = c) then
    return jsonb_build_object('ok', false, 'error', 'color_taken');
  end if;

  insert into members (user_id, family_id, name, color) values (auth.uid(), fid, n, c);
  return jsonb_build_object('ok', true);
end $$;

-- Tylko administrator: nowa rodzina z wylosowanym kluczem.
create or replace function public.create_family(p_name text) returns public.families
language plpgsql security definer set search_path = public as $$
declare f public.families;
begin
  if not is_admin() then raise exception 'Tylko administrator.'; end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 60 then raise exception 'Wpisz nazwę rodziny.'; end if;
  insert into families (name, join_code) values (trim(p_name), new_join_code()) returning * into f;
  return f;
end $$;

-- Tylko administrator: nowy klucz dla rodziny (stary przestaje działać; obecni członkowie zostają).
create or replace function public.regenerate_join_code(p_family uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not is_admin() then raise exception 'Tylko administrator.'; end if;
  update families set join_code = new_join_code() where id = p_family returning join_code into c;
  return c;
end $$;

revoke execute on function public.request_join(text, text, text)  from public, anon;
revoke execute on function public.create_family(text)             from public, anon;
revoke execute on function public.regenerate_join_code(uuid)      from public, anon;
grant  execute on function public.request_join(text, text, text)  to authenticated;
grant  execute on function public.create_family(text)             to authenticated;
grant  execute on function public.regenerate_join_code(uuid)      to authenticated;

-- ---------- uprawnienia (RLS) ----------

alter table public.app_admins enable row level security;
alter table public.families   enable row level security;
alter table public.members    enable row level security;
alter table public.items      enable row level security;

-- app_admins: każdy widzi tylko czy sam jest adminem
drop policy if exists "admins: własny wiersz" on public.app_admins;
create policy "admins: własny wiersz" on public.app_admins
  for select to authenticated using (user_id = auth.uid());

-- families: admin widzi wszystkie i może usuwać; członek widzi swoją (nazwa w nagłówku)
drop policy if exists "families: odczyt" on public.families;
create policy "families: odczyt" on public.families
  for select to authenticated using (is_admin() or id = my_family());

drop policy if exists "families: usuwa admin" on public.families;
create policy "families: usuwa admin" on public.families
  for delete to authenticated using (is_admin());

-- members: widzę siebie, admin widzi wszystkich, zaakceptowani widzą się nawzajem w swojej rodzinie.
-- Dodawać wiersze można tylko przez request_join(); akceptuje (update) tylko admin.
drop policy if exists "members: odczyt" on public.members;
create policy "members: odczyt" on public.members
  for select to authenticated
  using (user_id = auth.uid() or is_admin() or (status = 'approved' and family_id = my_family()));

drop policy if exists "members: akceptuje admin" on public.members;
create policy "members: akceptuje admin" on public.members
  for update to authenticated using (is_admin()) with check (is_admin());

drop policy if exists "members: usuwa admin lub sam zainteresowany" on public.members;
create policy "members: usuwa admin lub sam zainteresowany" on public.members
  for delete to authenticated using (is_admin() or user_id = auth.uid());

-- items: tylko zaakceptowani członkowie danej rodziny
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

-- ---------- administrator ----------
-- Załóż konto admina w Authentication → Users → Add user (Auto Confirm User),
-- wpisz tu jego e-mail i uruchom skrypt (lub tylko ten fragment).

do $$
declare
  admin_email constant text := 'TWOJ-EMAIL@example.com';   -- <-- ZMIEŃ
  uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(admin_email);
  if uid is null then
    raise notice 'Nie znaleziono konta % — załóż je w Authentication → Users i uruchom ten fragment ponownie.', admin_email;
  else
    insert into public.app_admins (user_id) values (uid) on conflict do nothing;
    raise notice 'Administrator ustawiony: %', admin_email;
  end if;
end $$;
