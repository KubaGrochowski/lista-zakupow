// Lista zakupów rodziny. Panel administratora jest osobno: admin/
(() => {
  const { $, db, esc, colorVars, setupLogin, ask, toast } = window.Common;
  const { CATEGORIES, guessCategory } = window.Categories;

  const state = {
    uid: null,
    member: null,        // mój wiersz z members
    users: [],           // członkowie mojej rodziny: { id, name, color }
    categories: CATEGORIES.map(({ id, label }) => ({ id, label })).concat({ id: 'inne', label: 'Inne' }),
    items: [],
    fresh: new Set(),
  };

  const userById = id => state.users.find(u => u.id === id) || { name: '?', color: '#888888' };

  const fromRow = r => ({
    id: r.id, name: r.name, qty: r.qty, note: r.note, category: r.category,
    addedBy: r.added_by, addedAt: Date.parse(r.added_at),
    doneBy: r.done_by, doneAt: r.done_at ? Date.parse(r.done_at) : null,
  });

  // ---------- logowanie ----------

  const login = setupLogin('login');

  function showAuth(message) {
    $('#app').hidden = true;
    $('#auth').hidden = false;
    login.reset(message);
  }

  $('#me').onclick = () => db.auth.signOut();

  // ---------- start ----------

  async function start() {
    const { data: me, error } = await db.from('members').select('*').eq('user_id', state.uid).maybeSingle();
    if (error) return toast('Brak połączenia z bazą.');
    if (!me) {
      // np. konto administratora, które nie należy do żadnej rodziny
      const { data: admin } = await db.from('app_admins').select('user_id').maybeSingle();
      await db.auth.signOut();
      return showAuth(admin
        ? 'To konto administratora — panel jest pod adresem …/admin/'
        : 'To konto nie należy do żadnej rodziny.');
    }
    state.member = me;

    const { data: fam } = await db.from('families').select('name').eq('id', me.family_id).maybeSingle();
    $('#family-label').textContent = fam ? `Rodzina ${fam.name}` : 'Lista zakupów';
    document.title = fam ? `Lista zakupów · ${fam.name}` : 'Lista zakupów';

    await loadUsers();
    $('#auth').hidden = true;
    $('#app').hidden = false;
    const u = userById(state.uid);
    $('#me-name').textContent = u.name;
    $('#me-dot').textContent = (u.name[0] || '?').toUpperCase();
    $('#me-dot').style.cssText = colorVars(u.color);

    await loadItems().catch(() => toast('Nie udało się wczytać listy.'));
    connect();
  }

  async function loadUsers() {
    const { data, error } = await db.from('members').select('*').eq('family_id', state.member.family_id);
    if (error) throw error;
    state.users = data.map(r => ({ id: r.user_id, name: r.name, color: r.color }));
  }

  async function loadItems() {
    const { data, error } = await db.from('items').select('*').order('added_at');
    if (error) throw error;
    state.items = data.map(fromRow);
    render();
  }

  // ---------- na żywo ----------

  let channel = null;

  function connect() {
    if (channel) return;
    channel = db.channel('list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, payload => {
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
      // nowa osoba w rodzinie albo zmiana imienia/koloru
      .on('postgres_changes', { event: '*', schema: 'public', table: 'members' }, () => {
        loadUsers().then(render).catch(() => {});
      })
      // po powrocie sieci dociągamy pełną listę
      .subscribe(status => { if (status === 'SUBSCRIBED') loadItems().catch(() => {}); });
  }

  function disconnect() {
    if (channel) { db.removeChannel(channel); channel = null; }
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.member) loadItems().catch(() => {});
  });

  // ---------- rysowanie ----------

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

  // ---------- akcje ----------

  async function toggle(item, done) {
    Object.assign(item, done ? { doneAt: Date.now(), doneBy: state.uid } : { doneAt: null, doneBy: null });
    render();
    const { error } = await db.from('items')
      .update({ done_by: done ? state.uid : null, done_at: done ? new Date().toISOString() : null })
      .eq('id', item.id);
    if (error) { toast('Nie udało się zapisać.'); loadItems().catch(() => {}); }
  }

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

  // ---------- sesja ----------

  db.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session) {
      disconnect();
      Object.assign(state, { uid: null, member: null, users: [], items: [] });
      document.title = 'Lista zakupów';
      if ($('#auth').hidden) showAuth();
      return;
    }
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
      if (state.uid === session.user.id) return; // odświeżenie tokenu
      state.uid = session.user.id;
      // odroczenie: w callbacku nie wolno od razu wołać innych metod supabase
      setTimeout(start, 0);
    }
  });
})();
