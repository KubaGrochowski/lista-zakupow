-- KROK 1 z 2 — uruchom RAZ, przed schema.sql.
-- Kasuje starą wersję (tabele items i profiles z przykładowymi pozycjami)
-- oraz 4 przykładowe konta: kuba@, dawid@, ania@, julka@.
--
-- Jeśli chcesz zostawić jedno z tych kont jako swoje konto administratora,
-- wpisz jego adres poniżej — to jedno konto nie zostanie skasowane.
-- Jeśli założysz osobne konto administratora (polecam), zostaw jak jest.

do $$
declare
  keep_email text := '';   -- np. 'kuba@grochowscy.pl' albo puste
begin
  drop table if exists public.items cascade;
  drop table if exists public.profiles cascade;
  drop function if exists public.items_lock_author() cascade;

  delete from auth.users
  where split_part(lower(email), '@', 1) in ('kuba', 'dawid', 'ania', 'julka')
    and lower(email) <> lower(keep_email);
end $$;

-- podgląd: te konta, które zostały w projekcie
select email, created_at from auth.users order by created_at;
