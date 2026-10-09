# Lista zakupów

Rodzinna lista zakupów w stylu kuchennego notesu. Frontend to zwykłe pliki w `public/`,
dane i logowanie są w Supabase.

## Jak to działa
- Administrator tworzy rodziny w panelu i dostaje dla każdej 5-znakowy klucz dostępu.
- Członek rodziny zakłada konto z kluczem, imieniem i kolorem; administrator je akceptuje.
- Każda rodzina widzi tylko własną listę, a przy każdej pozycji widać, kto ją dodał.

## Uruchomienie lokalnie
```
node server.js
```
Strona: http://localhost:3000 (serwer tylko podaje pliki, wymaga samego Node.js).

## Baza danych (Supabase)
W SQL Editor uruchom po kolei `supabase/00-cleanup.sql` (tylko przy migracji ze starej wersji)
i `supabase/schema.sql` (wpisz w nim e-mail administratora). W Authentication włącz rejestrację
i wyłącz „Confirm email”.

Adres projektu i klucz publiczny (publishable) są w `public/config.js`. Klucza `service_role`
nigdy nie wpisujemy do repozytorium.
