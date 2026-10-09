// Wspólne dla listy i panelu administratora: połączenie z Supabase, logowanie, okienka, kolory.
window.Common = (() => {
  const $ = sel => document.querySelector(sel);
  // osobne sesje dla listy i panelu — admin może mieć w tej samej przeglądarce otwarte oba
  const isAdminPage = /\/admin\/?/.test(location.pathname);
  const db = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY, {
    auth: { storageKey: isAdminPage ? 'lista-admin-auth' : 'lista-auth' },
  });

  // Konta rodzin logują się loginem ("kuba.grochowscy"), pod spodem to adres w domenie technicznej.
  // Administrator loguje się normalnym e-mailem.
  const LOGIN_DOMAIN = 'lista.local';
  const toEmail = login => {
    const v = login.trim().toLowerCase();
    return v.includes('@') ? v : `${v}@${LOGIN_DOMAIN}`;
  };

  function read(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function write(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // jasne kolory (biały, żółty) dostają ciemny napis, ciemne — biały
  function inkFor(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255];
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#2b2622' : '#fff';
  }
  const colorVars = c => `--c:${c};--c-ink:${inkFor(c)}`;

  const PALETTE = [
    ['#86b36f', 'zielony'], ['#3a6db3', 'niebieski'], ['#f1c84b', 'żółty'], ['#ffffff', 'biały'],
    ['#d9604c', 'czerwony'], ['#e8893a', 'pomarańczowy'], ['#8a63b8', 'fioletowy'], ['#e58fb0', 'różowy'],
    ['#3fa7a0', 'turkusowy'], ['#8a5a3c', 'brązowy'],
  ];

  function authMessage(error) {
    const m = (error && error.message) || '';
    if (/invalid login/i.test(m)) return 'Zły login albo hasło.';
    if (/rate limit|too many|security purposes/i.test(m)) return 'Za dużo prób. Spróbuj za kilka minut.';
    return 'Nie udało się zalogować. Spróbuj za chwilę.';
  }

  // formularz #login-form z polami #login-user, #login-pass
  function setupLogin(rememberKey) {
    $('#login-form').onsubmit = async e => {
      e.preventDefault();
      const btn = $('#login-btn');
      btn.disabled = true;
      $('#login-error').textContent = '';
      const user = $('#login-user').value;
      const { error } = await db.auth.signInWithPassword({ email: toEmail(user), password: $('#login-pass').value });
      btn.disabled = false;
      if (error) { $('#login-error').textContent = authMessage(error); return; }
      write(rememberKey, user.trim());
      // resztę robi onAuthStateChange na danej stronie
    };
    return {
      reset(message = '') {
        $('#login-pass').value = '';
        $('#login-user').value = read(rememberKey) || '';
        $('#login-error').textContent = message;
        (read(rememberKey) ? $('#login-pass') : $('#login-user')).focus();
      },
    };
  }

  // pytanie "czy na pewno" — jedno okienko #confirm dla wszystkiego
  function ask(text, name, yesLabel, onYes) {
    const dlg = $('#confirm');
    $('#confirm-text').textContent = text;
    $('#confirm-name').textContent = name;
    $('#confirm-yes').textContent = yesLabel;
    dlg.returnValue = '';
    dlg.onclose = () => { if (dlg.returnValue === 'yes') onYes(); };
    dlg.showModal();
  }
  // klik w tło zamyka każde okienko (= Nie)
  document.addEventListener('click', e => {
    if (e.target.tagName === 'DIALOG') e.target.close();
  });

  let toastTimer;
  function toast(text) {
    const t = $('#toast');
    t.innerHTML = `<span>${esc(text)}</span>`;
    t.classList.add('show');
    clearTimeout(toastTimer);
    // dłuższe komunikaty (np. błędy z bazy) zostają dłużej, żeby dało się je przeczytać
    toastTimer = setTimeout(() => t.classList.remove('show'), text.length > 60 ? 12000 : 4000);
  }

  return { $, db, toEmail, read, write, esc, colorVars, PALETTE, setupLogin, ask, toast };
})();
