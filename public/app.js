(() => {
  const $ = sel => document.querySelector(sel);
  const { CATEGORIES, guessCategory } = window.Categories;
  const db = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY);

  // kolory do wyboru przy dołączaniu (w jednej rodzinie każdy ma inny)
  const PALETTE = [
    ['#86b36f', 'zielony'], ['#3a6db3', 'niebieski'], ['#f1c84b', 'żółty'], ['#ffffff', 'biały'],
    ['#d9604c', 'czerwony'], ['#e8893a', 'pomarańczowy'], ['#8a63b8', 'fioletowy'], ['#e58fb0', 'różowy'],
    ['#3fa7a0', 'turkusowy'], ['#8a5a3c', 'brązowy'],
  ];

  const state = {
    uid: null,
    isAdmin: false,
    member: null,        // mój wiersz z members (albo null)
    family: null,        // rodzina, jeśli jestem zaakceptowany
    users: [],           // zaakceptowani członkowie mojej rodziny: { id, name, color }
    categories: CATEGORIES.map(({ id, label }) => ({ id, label })).concat({ id: 'inne', label: 'Inne' }),
    items: [],
    fresh: new Set(),
    view: null,
    wantAdmin: false,    // admin, który jest też członkiem, przełączył się na panel
    wantJoin: false,     // admin, który chce dołączyć do rodziny
    notice: '',
    registering: false,  // trwa rejestracja — nie przełączaj ekranów w połowie
  };

  function read(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function write(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }

  const userById = id => state.users.find(u => u.id === id) || { name: '?', color: '#888888' };

  const fromRow = r => ({
    id: r.id, name: r.name, qty: r.qty, note: r.note, category: r.category,
    addedBy: r.added_by, addedAt: Date.parse(r.added_at),
    doneBy: r.done_by, doneAt: r.done_at ? Date.parse(r.done_at) : null,
  });

  // jasne kolory (biały, żółty) dostają ciemny napis, ciemne — biały
  function inkFor(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255];
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#2b2622' : '#fff';
  }
  const colorVars = c => `--c:${c};--c-ink:${inkFor(c)}`;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const VIEWS = ['auth', 'join', 'waiting', 'admin', 'app'];
  function show(view) {
    state.view = view;
    for (const v of VIEWS) $('#' + v).hidden = v !== view;
    window.scrollTo(0, 0);
  }

  // ---------- komunikaty o błędach ----------

  function authMessage(error) {
    const m = (error && error.message) || '';
    if (/invalid login/i.test(m)) return 'Zły e-mail albo hasło.';
    if (/already registered|already been registered/i.test(m)) return 'Ten e-mail ma już konto. Przejdź do „Mam konto”.';
    if (/at least 6|password should/i.test(m)) return 'Hasło musi mieć co najmniej 6 znaków.';
    if (/invalid.*email|email.*invalid|valid email/i.test(m)) return 'Ten adres e-mail wygląda nieprawidłowo.';
    if (/not confirmed/i.test(m)) return 'Najpierw potwierdź e-mail (link w wiadomości od nas).';
    if (/rate limit|too many|security purposes/i.test(m)) return 'Za dużo prób. Spróbuj za kilka minut.';
    if (/signups? not allowed|signup.*disabled/i.test(m)) return 'Zakładanie kont jest wyłączone w ustawieniach projektu.';
    return 'Coś poszło nie tak. Spróbuj za chwilę.';
  }

  const JOIN_ERRORS = {
    bad_code: 'Nie ma takiego klucza. Sprawdź, czy przepisany jest dokładnie.',
    color_taken: 'Ten kolor jest już zajęty w tej rodzinie — wybierz inny.',
    name: 'Wpisz imię (do 30 znaków).',
    color: 'Wybierz kolor.',
    too_many: 'Za dużo błędnych kluczy. Spróbuj za godzinę.',
    already: 'To konto ma już zgłoszoną prośbę.',
    no_session: 'Sesja wygasła — zaloguj się ponownie.',
  };

  // ---------- wybór koloru ----------

  function colorPicker(root, name) {
    root.innerHTML = PALETTE.map(([hex, label]) => `
      <label class="swatch" style="${colorVars(hex)}" title="${label}">
        <input type="radio" name="${name}" value="${hex}" aria-label="${label}">
        <span></span>
      </label>`).join('');
    return () => (root.querySelector('input:checked') || {}).value || '';
  }
  const regColor = colorPicker($('#reg-colors'), 'reg-color');
  const joinColor = colorPicker($('#join-colors'), 'join-color');

  const cleanCode = v => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  for (const id of ['#reg-code', '#join-code']) {
    $(id).addEventListener('input', e => { e.target.value = cleanCode(e.target.value); });
  }

  // ---------- ekran logowania / nowego konta ----------

  function showAuth() {
    show('auth');
    selectTab('register');   // domyślnie "Nowe konto"; "Mam konto" jest w zakładce obok
    $('#login-pass').value = '';
    $('#login-email').value = read('email') || '';
  }

  function selectTab(which) {
    const login = which === 'login';
    $('#tab-login').setAttribute('aria-selected', String(login));
    $('#tab-register').setAttribute('aria-selected', String(!login));
    $('#login-form').hidden = !login;
    $('#register-form').hidden = login;
    (login ? (read('email') ? $('#login-pass') : $('#login-email')) : $('#reg-code')).focus();
  }
  $('#tab-login').onclick = () => selectTab('login');
  $('#tab-register').onclick = () => selectTab('register');

  $('#login-form').onsubmit = async e => {
    e.preventDefault();
    const btn = $('#login-btn');
    btn.disabled = true;
    $('#login-error').textContent = '';
    const email = $('#login-email').value.trim();
    const { error } = await db.auth.signInWithPassword({ email, password: $('#login-pass').value });
    btn.disabled = false;
    if (error) { $('#login-error').textContent = authMessage(error); return; }
    write('email', email);
    // resztę robi onAuthStateChange
  };

  $('#register-form').onsubmit = async e => {
    e.preventDefault();
    const err = $('#reg-error');
    err.textContent = '';
    const code = cleanCode($('#reg-code').value);
    const name = $('#reg-name').value.trim();
    const color = regColor();
    if (code.length !== 5) return void (err.textContent = 'Klucz ma 5 znaków (litery i cyfry).');
    if (!name) return void (err.textContent = 'Wpisz swoje imię.');
    if (!color) return void (err.textContent = 'Wybierz kolor.');

    const btn = $('#reg-btn');
    btn.disabled = true;
    state.registering = true;
    try {
      const email = $('#reg-email').value.trim();
      const { data, error } = await db.auth.signUp({ email, password: $('#reg-pass').value });
      if (error) return void (err.textContent = authMessage(error));
      if (!data.session) {
        // projekt wymaga potwierdzenia e-maila — konto jest, ale sesji jeszcze nie ma
        err.textContent = 'Konto założone. Potwierdź e-mail (link w wiadomości), zaloguj się i podaj klucz jeszcze raz.';
        return;
      }
      write('email', email);
      const { data: res, error: rpcError } = await db.rpc('request_join', { p_code: code, p_name: name, p_color: color });
      if (rpcError || !res || !res.ok) {
        // konto istnieje i jest zalogowane — pokażemy ekran dołączania z powodem
        state.notice = JOIN_ERRORS[res && res.error] || 'Nie udało się wysłać prośby.';
      }
    } finally {
      btn.disabled = false;
      state.registering = false;
      if (state.uid) route();
    }
  };

  // ---------- ekran dołączania ----------

  function showJoin() {
    show('join');
    $('#join-error').textContent = state.notice;
    state.notice = '';
    $('#join-back').hidden = !state.isAdmin;
    $('#join-code').focus();
  }

  $('#join-form').onsubmit = async e => {
    e.preventDefault();
    const err = $('#join-error');
    err.textContent = '';
    const code = cleanCode($('#join-code').value);
    const name = $('#join-name').value.trim();
    const color = joinColor();
    if (code.length !== 5) return void (err.textContent = 'Klucz ma 5 znaków (litery i cyfry).');
    if (!name) return void (err.textContent = 'Wpisz swoje imię.');
    if (!color) return void (err.textContent = 'Wybierz kolor.');
    const btn = $('#join-btn');
    btn.disabled = true;
    const { data: res, error } = await db.rpc('request_join', { p_code: code, p_name: name, p_color: color });
    btn.disabled = false;
    if (error || !res || !res.ok) { err.textContent = JOIN_ERRORS[res && res.error] || 'Nie udało się wysłać prośby.'; return; }
    state.wantJoin = false;
    route();
  };

  $('#join-back').onclick = () => { state.wantJoin = false; route(); };

  // ---------- ekran oczekiwania ----------

  async function showWaiting() {
    const { data: fam } = await db.from('families').select('name').eq('id', state.member.family_id).maybeSingle();
    // zwykły członek nie widzi jeszcze rodziny (polityka) — nazwa pojawi się po akceptacji
    $('#wait-name').textContent = state.member.name;
    $('#wait-family').textContent = (fam && fam.name) || '';
    $('#wait-family-wrap').hidden = !(fam && fam.name);
    $('#wait-dot').textContent = (state.member.name[0] || '?').toUpperCase();
    $('#wait-dot').style.cssText = colorVars(state.member.color);
    show('waiting');
  }

  $('#wait-cancel').onclick = () => ask('Czy na pewno chcesz anulować prośbę?', '', 'Tak, anuluj', async () => {
    await db.from('members').delete().eq('user_id', state.uid);
    route();
  });

  // ---------- routing: który ekran pokazać ----------

  let routing = null;
  let routeAgain = false;

  function route() {
    if (state.registering) return Promise.resolve();
    if (routing) { routeAgain = true; return routing; }
    routing = (async () => {
      do {
        routeAgain = false;
        await routeOnce().catch(() => toast('Brak połączenia z bazą.'));
      } while (routeAgain);
    })().finally(() => { routing = null; });
    return routing;
  }

  async function routeOnce() {
    if (!state.uid) return;
    const [a, m] = await Promise.all([
      db.from('app_admins').select('user_id').maybeSingle(),
      db.from('members').select('*').eq('user_id', state.uid).maybeSingle(),
    ]);
    if (a.error || m.error) throw a.error || m.error;

    const prev = state.member;
    state.isAdmin = Boolean(a.data);
    state.member = m.data;
    const approved = Boolean(m.data) && m.data.status === 'approved';

    if (prev && prev.status === 'pending' && !m.data) {
      state.notice = 'Administrator odrzucił Twoją prośbę. Sprawdź klucz albo napisz do niego.';
    }

    if (approved && !(state.isAdmin && state.wantAdmin)) return showList();
    if (state.isAdmin && !(state.wantJoin && !m.data)) return showAdmin();
    if (m.data) return showWaiting();
    return showJoin();
  }

  // ---------- na żywo ----------

  let channel = null;
  let routeTimer = null;

  function connect() {
    if (channel) return;
    channel = db.channel('live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, payload => {
        if (state.view !== 'app') return;
        if (payload.eventType === 'DELETE') {
          state.items = state.items.filter(x => x.id !== payload.old.id);
        } else {
          const item = fromRow(payload.new);
          const i = state.items.findIndex(x => x.id === item.id);
          if (i === -1) { state.items.push(item); state.fresh.add(item.id); }
          else state.items[i] = item;
        }
        render();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'members' }, () => {
        // ktoś dołączył / został zaakceptowany / usunięty — przelicz, co mam pokazać
        clearTimeout(routeTimer);
        routeTimer = setTimeout(() => { route(); if (state.view === 'admin') loadAdmin(); }, 250);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'families' }, () => {
        if (state.view === 'admin') loadAdmin();
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED' && state.view === 'app') loadItems().catch(() => {});
      });
  }

  function disconnect() {
    if (channel) { db.removeChannel(channel); channel = null; }
  }

  // po powrocie do aplikacji (telefon, karta) dociągamy aktualny stan
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !state.uid) return;
    route();
    if (state.view === 'admin') loadAdmin();
  });

  // ---------- lista ----------

  async function loadUsers() {
    const { data, error } = await db.from('members').select('*')
      .eq('family_id', state.member.family_id).eq('status', 'approved');
    if (error) throw error;
    state.users = data.map(r => ({ id: r.user_id, name: r.name, color: r.color }));
  }

  async function loadItems() {
    const { data, error } = await db.from('items').select('*').order('added_at');
    if (error) throw error;
    state.items = data.map(fromRow);
    render();
  }

  async function showList() {
    const wasList = state.view === 'app';
    state.wantAdmin = false;
    await loadUsers();

    if (!wasList) {
      const { data: fam } = await db.from('families').select('name').eq('id', state.member.family_id).maybeSingle();
      state.family = fam;
      $('#family-label').textContent = fam ? `Rodzina ${fam.name}` : 'Lista zakupów';
      document.title = fam ? `Lista zakupów · ${fam.name}` : 'Lista zakupów';
      show('app');
      await loadItems().catch(() => toast('Nie udało się wczytać listy.'));
    }

    const me = userById(state.uid);
    $('#me-name').textContent = me.name;
    $('#me-dot').textContent = (me.name[0] || '?').toUpperCase();
    $('#me-dot').style.cssText = colorVars(me.color);
    $('#to-admin').hidden = !state.isAdmin;
    render();
  }

  function render() {
    const todo = state.items.filter(i => !i.doneAt);
    const done = state.items.filter(i => i.doneAt).sort((a, b) => b.doneAt - a.doneAt);

    const list = $('#list');
    list.innerHTML = '';
    for (const cat of state.categories) {
      const group = todo.filter(i => i.category === cat.id).sort((a, b) => a.addedAt - b.addedAt);
      if (!group.length) continue;
      const h = document.createElement('h2');
      h.className = 'group-title';
      h.textContent = cat.label;
      const ul = document.createElement('ul');
      ul.className = 'rows';
      group.forEach(i => ul.append(row(i)));
      list.append(h, ul);
    }

    const left = todo.length;
    $('#title').textContent = left ? `Do kupienia: ${left}` : 'Do kupienia';
    $('#empty').hidden = left > 0;

    $('#basket').hidden = done.length === 0;
    $('#basket-count').textContent = done.length;
    const dl = $('#done-list');
    dl.innerHTML = '';
    done.forEach(i => dl.append(row(i)));
    state.fresh.clear();
  }

  function row(item) {
    const author = userById(item.addedBy);
    const li = document.createElement('li');
    li.className = 'row' + (item.doneAt ? ' done' : '') + (state.fresh.has(item.id) ? ' enter' : '');

    const meta = item.doneAt
      ? `w koszyku · ${esc(userById(item.doneBy).name)}, ${when(item.doneAt)}`
      : esc(item.note || '');

    li.innerHTML = `
      <input type="checkbox" class="tick" ${item.doneAt ? 'checked' : ''} aria-label="Kupione: ${esc(item.name)}">
      <div class="what">
        <span class="who" style="${colorVars(author.color)}" title="${esc(author.name)}" aria-label="Dodał(a): ${esc(author.name)}">${esc((author.name[0] || '?').toUpperCase())}</span>
        <span class="name" title="Kliknij, żeby poprawić">${esc(item.name)}</span>
        ${item.qty ? `<span class="qty">${esc(item.qty)}</span>` : ''}
        ${meta ? `<span class="meta">${meta}</span>` : ''}
      </div>
      <div class="side">
        <button class="icon-btn del-btn" type="button" aria-label="Usuń ${esc(item.name)}">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>`;

    li.querySelector('.tick').onchange = e => toggle(item, e.target.checked);
    li.querySelector('.del-btn').onclick = () => remove(item);
    li.querySelector('.name').onclick = e => startEdit(item, e.currentTarget);
    return li;
  }

  function when(ts) {
    const d = new Date(ts);
    const now = new Date();
    const time = d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    const days = Math.round((startOfDay(now) - startOfDay(d)) / 864e5);
    if (days === 0) return `dziś ${time}`;
    if (days === 1) return `wczoraj ${time}`;
    if (days < 7) return d.toLocaleDateString('pl-PL', { weekday: 'long' }) + ' ' + time;
    return d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
  }
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  // ---------- akcje na liście ----------

  async function toggle(item, done) {
    Object.assign(item, done ? { doneAt: Date.now(), doneBy: state.uid } : { doneAt: null, doneBy: null });
    render();
    const { error } = await db.from('items')
      .update({ done_by: done ? state.uid : null, done_at: done ? new Date().toISOString() : null })
      .eq('id', item.id);
    if (error) { toast('Nie udało się zapisać.'); loadItems().catch(() => {}); }
  }

  // pytanie "czy na pewno" — jedno okienko dla wszystkich usuwań
  function ask(text, name, yesLabel, onYes) {
    const dlg = $('#confirm');
    $('#confirm-text').textContent = text;
    $('#confirm-name').textContent = name;
    $('#confirm-yes').textContent = yesLabel;
    dlg.returnValue = '';
    dlg.onclose = () => { if (dlg.returnValue === 'yes') onYes(); };
    dlg.showModal();
  }
  $('#confirm').onclick = e => { if (e.target.id === 'confirm') e.target.close(); }; // klik w tło = Nie

  function remove(item) {
    ask('Czy na pewno chcesz usunąć', `„${item.name}”?`, 'Tak, usuń', async () => {
      state.items = state.items.filter(x => x.id !== item.id);
      render();
      const { error } = await db.from('items').delete().eq('id', item.id);
      if (error) { toast('Nie udało się usunąć.'); loadItems().catch(() => {}); }
    });
  }

  function startEdit(item, el) {
    const input = document.createElement('input');
    input.className = 'edit-input';
    input.value = item.name;
    input.maxLength = 120;
    el.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const finish = async save => {
      if (finished) return;
      finished = true;
      const name = input.value.trim();
      if (save && name && name !== item.name) {
        item.name = name;
        const { error } = await db.from('items').update({ name }).eq('id', item.id);
        if (error) { toast('Nie udało się zapisać.'); loadItems().catch(() => {}); }
      }
      render();
    };
    input.onkeydown = e => {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    };
    input.onblur = () => finish(true);
  }

  $('#clear-done').onclick = e => {
    e.preventDefault(); // przycisk leży w <summary>, nie zwijamy koszyka
    const n = state.items.filter(i => i.doneAt).length;
    ask('Czy na pewno chcesz wyczyścić', n === 1 ? 'kupioną pozycję?' : `kupione pozycje (${n})?`, 'Tak, wyczyść', async () => {
      const { error } = await db.from('items').delete().not('done_at', 'is', null);
      if (error) toast('Nie udało się wyczyścić.');
    });
  };

  $('#add-form').onsubmit = async e => {
    e.preventDefault();
    const name = $('#add-name').value.trim();
    if (!name) return;
    const qty = $('#add-qty').value.trim();
    $('#add-name').value = '';
    $('#add-qty').value = '';
    $('#add-name').focus();
    const { data, error } = await db.from('items')
      .insert({ name, qty, category: guessCategory(name) })
      .select()
      .single();
    if (error) {
      $('#add-name').value = name;
      $('#add-qty').value = qty;
      return toast('Nie udało się dodać. Sprawdź połączenie.');
    }
    const item = fromRow(data);
    if (!state.items.some(x => x.id === item.id)) { state.items.push(item); state.fresh.add(item.id); render(); }
  };

  // ---------- panel administratora ----------

  async function showAdmin() {
    state.wantAdmin = true;
    $('#admin-to-list').hidden = !(state.member && state.member.status === 'approved');
    $('#admin-foot').hidden = Boolean(state.member);
    document.title = 'Panel administratora';
    show('admin');
    await loadAdmin();
  }

  async function loadAdmin() {
    const [f, m] = await Promise.all([
      db.from('families').select('*').order('created_at'),
      db.from('members').select('*').order('created_at'),
    ]);
    if (f.error || m.error) return toast('Nie udało się wczytać rodzin.');
    renderAdmin(f.data, m.data);
  }

  function renderAdmin(families, members) {
    $('#families-empty').hidden = families.length > 0;
    $('#families').innerHTML = families.map(f => {
      const mine = members.filter(x => x.family_id === f.id);
      const pending = mine.filter(x => x.status === 'pending');
      const approved = mine.filter(x => x.status === 'approved');
      const person = x => `
        <li class="person">
          <span class="who" style="${colorVars(x.color)}">${esc((x.name[0] || '?').toUpperCase())}</span>
          <span class="person-name">${esc(x.name)}${x.user_id === state.uid ? ' <small>(Ty)</small>' : ''}</span>`;
      return `
        <article class="family" data-family="${f.id}">
          <header class="family-head">
            <h2>${esc(f.name)}</h2>
            <button class="icon-btn" type="button" data-act="delete-family" aria-label="Usuń rodzinę ${esc(f.name)}" title="Usuń rodzinę">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
          </header>
          <div class="keybox">
            <div>
              <span class="label">Klucz dostępu</span>
              <strong class="key">${esc(f.join_code)}</strong>
            </div>
            <div class="key-actions">
              <button class="btn-ghost" type="button" data-act="copy" data-code="${esc(f.join_code)}">Skopiuj</button>
              <button class="link" type="button" data-act="regen">Nowy klucz</button>
            </div>
          </div>
          ${pending.length ? `
            <h3 class="sub">Czekają na akceptację <b>${pending.length}</b></h3>
            <ul class="people">${pending.map(x => person(x) + `
              <span class="person-actions">
                <button class="btn small" type="button" data-act="approve" data-user="${x.user_id}">Akceptuj</button>
                <button class="btn-ghost small" type="button" data-act="reject" data-user="${x.user_id}" data-name="${esc(x.name)}">Odrzuć</button>
              </span></li>`).join('')}</ul>` : ''}
          <h3 class="sub">Członkowie <b>${approved.length}</b></h3>
          ${approved.length ? `<ul class="people">${approved.map(x => person(x) + `
              <span class="person-actions">
                <button class="link" type="button" data-act="remove" data-user="${x.user_id}" data-name="${esc(x.name)}">Usuń</button>
              </span></li>`).join('')}</ul>` : '<p class="none">Nikt jeszcze nie dołączył.</p>'}
        </article>`;
    }).join('');
  }

  $('#families').addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const card = btn.closest('[data-family]');
    const familyId = card.dataset.family;
    const familyName = card.querySelector('h2').textContent;
    const act = btn.dataset.act;
    const fail = msg => toast(msg);

    if (act === 'copy') {
      try { await navigator.clipboard.writeText(btn.dataset.code); toast('Klucz skopiowany.'); }
      catch { toast(`Klucz: ${btn.dataset.code}`); }
    } else if (act === 'approve') {
      const { error } = await db.from('members').update({ status: 'approved' }).eq('user_id', btn.dataset.user);
      if (error) return fail('Nie udało się zaakceptować.');
      toast('Zaakceptowano.');
      loadAdmin();
    } else if (act === 'reject' || act === 'remove') {
      const text = act === 'reject' ? 'Czy na pewno chcesz odrzucić prośbę osoby' : `Czy na pewno chcesz usunąć z rodziny „${familyName}” osobę`;
      ask(text, `${btn.dataset.name}?`, act === 'reject' ? 'Tak, odrzuć' : 'Tak, usuń', async () => {
        const { error } = await db.from('members').delete().eq('user_id', btn.dataset.user);
        if (error) return fail('Nie udało się usunąć.');
        loadAdmin();
      });
    } else if (act === 'regen') {
      ask('Nowy klucz zastąpi obecny. Stary przestanie działać, ale obecni członkowie zostają. Wygenerować?', '', 'Tak, nowy klucz', async () => {
        const { error } = await db.rpc('regenerate_join_code', { p_family: familyId });
        if (error) return fail('Nie udało się wygenerować klucza.');
        loadAdmin();
      });
    } else if (act === 'delete-family') {
      ask('Usunąć rodzinę wraz z członkami i całą ich listą zakupów?', `„${familyName}”`, 'Tak, usuń rodzinę', async () => {
        const { error } = await db.from('families').delete().eq('id', familyId);
        if (error) return fail('Nie udało się usunąć rodziny.');
        loadAdmin();
      });
    }
  });

  $('#family-form').onsubmit = async e => {
    e.preventDefault();
    const name = $('#family-name').value.trim();
    if (!name) return;
    const { error } = await db.rpc('create_family', { p_name: name });
    if (error) return toast('Nie udało się utworzyć rodziny.');
    $('#family-name').value = '';
    loadAdmin();
  };

  $('#admin-to-list').onclick = () => { state.wantAdmin = false; route(); };
  $('#to-admin').onclick = () => { state.wantAdmin = true; route(); };
  $('#admin-join').onclick = () => { state.wantJoin = true; route(); };

  // ---------- wylogowanie ----------

  async function logout() {
    await db.auth.signOut();
  }
  $('#me').onclick = logout;
  for (const b of document.querySelectorAll('[data-logout]')) b.onclick = logout;

  function resetSession() {
    disconnect();
    Object.assign(state, {
      uid: null, isAdmin: false, member: null, family: null, users: [], items: [],
      wantAdmin: false, wantJoin: false,
    });
    document.title = 'Lista zakupów';
  }

  // ---------- toast ----------

  let toastTimer;
  function toast(text) {
    const t = $('#toast');
    t.innerHTML = `<span>${esc(text)}</span>`;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
  }

  // ---------- start ----------

  db.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session) {
      resetSession();
      return showAuth();
    }
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
      if (state.uid === session.user.id) return; // odświeżenie tokenu, nic do roboty
      state.uid = session.user.id;
      // odroczenie: w callbacku nie wolno od razu wołać innych metod supabase
      setTimeout(() => { connect(); route(); }, 0);
    }
  });
})();
