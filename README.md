# Lista zakupów

Rodzinna lista zakupów w stylu kuchennego notesu. Frontend to zwykłe pliki w `public/`,
dane i logowanie są w Supabase.

- **Lista dla rodzin:** https://kubagrochowski.github.io/lista-zakupow/
- **Panel administratora:** https://kubagrochowski.github.io/lista-zakupow/admin/

## Jak to działa
- Administrator tworzy w panelu rodziny, a w nich konta: imię + kolor.
- Login (np. `kuba.grochowscy`) i hasło generują się same; hasło widać raz, do wysłania.
  Zapomniane hasło → „Nowe hasło” w panelu.
- Każda rodzina widzi tylko własną listę, a przy każdej pozycji widać, kto ją dodał.
- Administrator nie widzi list zakupów, tylko rodziny i konta.

## Uruchomienie lokalnie
```
node server.js
```
Lista: http://localhost:3000, panel: http://localhost:3000/admin/ (serwer tylko podaje pliki).

## Baza danych (Supabase)
W SQL Editor uruchom `supabase/schema.sql` (można wielokrotnie). Przy nowej instalacji dopisz
siebie do `app_admins` — instrukcja na końcu pliku. W Authentication wyłącz zakładanie kont
(„Allow new users to sign up”) — konta tworzy tylko administrator.

Adres projektu i klucz publiczny (publishable) są w `public/config.js`. Klucza `service_role`
nigdy nie wpisujemy do repozytorium.

## Publikacja (GitHub Pages)
Przy każdym wypchnięciu do `main` workflow `.github/workflows/pages.yml` publikuje folder `public/`.
