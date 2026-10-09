// Panel administratora: rodziny i konta ich członków.
(() => {
  const { $, db, esc, colorVars, PALETTE, setupLogin, ask, toast } = window.Common;

  const APP_URL = new URL('../', location.href).href;   // link do listy, który wysyłamy rodzinom
  let uid = null;
  let channel = null;

  const ERRORS = {
    color_taken: 'Ten kolor jest już zajęty w tej rodzinie.',
    name: 'Wpisz imię (do 30 znaków).',
    color: 'Wybierz kolor.',
    no_family: 'Tej rodziny już nie ma.',
    not_admin: 'To konto nie jest administratorem.',
  };

  // ---------- logowanie ----------

  const login = setupLogin('admin-email');

  function showAuth(message) {
    $('#admin').hidden = true;
    $('#auth').hidden = false;
    login.reset(message);
  }

  $('#logout').onclick = () => db.auth.signOut();

  async function start() {
    const { data: admin, error } = await db.from('app_admins').select('user_id').maybeSingle();
    if (error) return toast('Brak połączenia z bazą.');
    if (!admin) {
      await db.auth.signOut();
      return showAuth('To konto nie jest administratorem.');
    }
    $('#auth').hidden = true;
    $('#admin').hidden = false;
    await load();
    connect();
  }

  // ---------- dane ----------

  async function load() {
    const [f, m] = await Promise.all([
      db.from('families').select('*').order('created_at'),
      db.from('members').select('*').order('created_at'),
    ]);
    if (f.error || m.error) return toast('Nie udało się wczytać rodzin.');
    render(f.data, m.data);
  }

  function connect() {
    if (channel) return;
    let t;
    const reload = () => { clearTimeout(t); t = setTimeout(load, 200); };
    channel = db.channel('admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'families' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'members' }, reload)
      .subscribe();
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && uid && !$('#admin').hidden) load();
  });

  // ---------- rysowanie ----------

  function render(families, members) {
    $('#families-empty').hidden = families.length > 0;
    $('#families').innerHTML = families.map(f => {
      const people = members.filter(x => x.family_id === f.id);
      const taken = new Set(people.map(x => x.color));
      return `
        <article class="family" data-family="${f.id}" data-name="${esc(f.name)}">
          <header class="family-head">
            <h2>${esc(f.name)}</h2>
            <button class="icon-btn" type="button" data-act="delete-family" aria-label="Usuń rodzinę ${esc(f.name)}" title="Usuń rodzinę">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
          </header>

          <h3 class="sub">Konta <b>${people.length}</b></h3>
          ${people.length ? `<ul class="people">${people.map(x => `
            <li class="person">
              <span class="who" style="${colorVars(x.color)}">${esc((x.name[0] || '?').toUpperCase())}</span>
              <span class="person-name">${esc(x.name)}<small class="person-login">${esc(x.login || '—')}</small></span>
              <span class="person-actions">
                <button class="link" type="button" data-act="reset" data-user="${x.user_id}" data-person="${esc(x.name)}">Nowe hasło</button>
                <button class="link" type="button" data-act="remove" data-user="${x.user_id}" data-person="${esc(x.name)}">Usuń</button>
              </span>
            </li>`).join('')}</ul>` : '<p class="none">Nie ma jeszcze żadnego konta.</p>'}

          <form class="add-person" data-act-form="add" autocomplete="off">
            <h3 class="sub">Nowe konto</h3>
            <input name="name" maxlength="30" placeholder="Imię, np. Kuba" required aria-label="Imię">
            <div class="swatches small" role="radiogroup" aria-label="Kolor">
              ${PALETTE.map(([hex, label]) => `
                <label class="swatch${taken.has(hex) ? ' taken' : ''}" style="${colorVars(hex)}" title="${label}${taken.has(hex) ? ' (zajęty)' : ''}">
                  <input type="radio" name="color" value="${hex}" aria-label="${label}" ${taken.has(hex) ? 'disabled' : ''}>
                  <span></span>
                </label>`).join('')}
            </div>
            <button class="btn" type="submit">Utwórz konto</button>
          </form>
        </article>`;
    }).join('');
  }

  // ---------- dane logowania do wysłania ----------

  function showCreds(name, creds) {
    $('#creds-who').textContent = name;
    $('#creds-url').textContent = APP_URL;
    $('#creds-login').textContent = creds.login;
    $('#creds-pass').textContent = creds.password;
    $('#creds-copy').onclick = async () => {
      const text = `Lista zakupów: ${APP_URL}\nLogin: ${creds.login}\nHasło: ${creds.password}`;
      try { await navigator.clipboard.writeText(text); toast('Skopiowano — wklej w wiadomości.'); }
      catch { toast('Nie udało się skopiować — przepisz ręcznie.'); }
    };
    $('#creds').showModal();
  }

  // ---------- akcje ----------

  $('#families').addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const card = btn.closest('[data-family]');
    const familyId = card.dataset.family;
    const familyName = card.dataset.name;
    const person = btn.dataset.person;

    if (btn.dataset.act === 'reset') {
      ask(`Wygenerować nowe hasło dla ${person}? Stare przestanie działać.`, '', 'Tak, nowe hasło', async () => {
        const { data, error } = await db.rpc('reset_member_password', { p_user: btn.dataset.user });
        if (error || !data || !data.ok) return toast('Nie udało się zmienić hasła.');
        showCreds(person, data);
      });
    } else if (btn.dataset.act === 'remove') {
      ask(`Usunąć konto z rodziny „${familyName}”? Ta osoba nie zaloguje się już na listę.`, `${person}?`, 'Tak, usuń', async () => {
        const { error } = await db.rpc('delete_member', { p_user: btn.dataset.user });
        if (error) return toast('Nie udało się usunąć konta.');
        load();
      });
    } else if (btn.dataset.act === 'delete-family') {
      ask('Usunąć rodzinę razem ze wszystkimi kontami i całą jej listą zakupów?', `„${familyName}”`, 'Tak, usuń rodzinę', async () => {
        const { error } = await db.rpc('delete_family', { p_family: familyId });
        if (error) return toast('Nie udało się usunąć rodziny.');
        load();
      });
    }
  });

  $('#families').addEventListener('submit', async e => {
    const form = e.target.closest('[data-act-form="add"]');
    if (!form) return;
    e.preventDefault();
    const familyId = form.closest('[data-family]').dataset.family;
    const name = form.elements.name.value.trim();
    const color = (form.querySelector('input[name="color"]:checked') || {}).value;
    if (!name) return toast('Wpisz imię.');
    if (!color) return toast('Wybierz kolor.');
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    const { data, error } = await db.rpc('create_member', { p_family: familyId, p_name: name, p_color: color });
    btn.disabled = false;
    if (error || !data || !data.ok) return toast(ERRORS[data && data.error] || 'Nie udało się utworzyć konta.');
    showCreds(name, data);
    load();
  });

  $('#family-form').onsubmit = async e => {
    e.preventDefault();
    const name = $('#family-name').value.trim();
    if (!name) return;
    const { error } = await db.rpc('create_family', { p_name: name });
    if (error) return toast('Nie udało się utworzyć rodziny.');
    $('#family-name').value = '';
    load();
  };

  // ---------- sesja ----------

  db.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session) {
      uid = null;
      if (channel) { db.removeChannel(channel); channel = null; }
      if ($('#auth').hidden) showAuth();
      return;
    }
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
      if (uid === session.user.id) return;
      uid = session.user.id;
      setTimeout(start, 0);
    }
  });
})();
