import * as pdfjsLib from './vendor/pdfjs/pdf.min.mjs';
import { normalizeItem, reflow, readingMinutes, titleFromFilename, extractMarks } from './leitor-core.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
const CMAP_URL = new URL('./vendor/pdfjs/cmaps/', import.meta.url).href;

const $ = (id) => document.getElementById(id);
const els = {
  library: $('library'), reader: $('reader'), bookList: $('bookList'), empty: $('emptyState'),
  fileInput: $('fileInput'), installTip: $('installTip'), libSettingsBtn: $('libSettingsBtn'),
  pager: $('pager'), flow: $('flow'), topBar: $('topBar'), bookTitle: $('bookTitle'),
  backBtn: $('backBtn'), tocBtn: $('tocBtn'), fontBtn: $('fontBtn'),
  range: $('progressRange'), pageInfo: $('pageInfo'), percentInfo: $('percentInfo'), mini: $('miniProgress'),
  backdrop: $('sheetBackdrop'), settings: $('settingsSheet'), fontSizeOut: $('fontSizeOut'), originalBtn: $('originalBtn'),
  toc: $('tocSheet'), tocList: $('tocList'),
  original: $('originalView'), originalTitle: $('originalTitle'), originalScroll: $('originalScroll'),
  originalClose: $('originalClose'), originalPrev: $('originalPrev'), originalNext: $('originalNext'),
  busy: $('busy'), busyText: $('busyText'), busyFill: $('busyFill'), toast: $('toast'),
  pwdModal: $('pwdModal'), pwdForm: $('pwdForm'), pwdInput: $('pwdInput'), pwdMsg: $('pwdMsg'), pwdCancel: $('pwdCancel'),
};

/* ------------------------------------------------------------------ */
/* Armazenamento                                                       */
/* ------------------------------------------------------------------ */

const DB_NAME = 'leitor';
let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const name of ['books', 'content', 'files']) {
          if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    const req = fn(s);
    t.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const idb = {
  get: (store, id) => tx(store, 'readonly', (s) => s.get(id)),
  all: (store) => tx(store, 'readonly', (s) => s.getAll()),
  put: (store, value) => tx(store, 'readwrite', (s) => s.put(value)),
  del: (store, id) => tx(store, 'readwrite', (s) => s.delete(id)),
};

const prefs = {
  read(key, fallback) {
    try { const v = localStorage.getItem('leitor:' + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  write(key, value) {
    try { localStorage.setItem('leitor:' + key, JSON.stringify(value)); } catch { /* sem armazenamento */ }
  },
};

/* ------------------------------------------------------------------ */
/* Preferências de leitura                                             */
/* ------------------------------------------------------------------ */

const DEFAULTS = { size: 19, font: 'serif', theme: 'sepia', spacing: 'normal', margin: 'normal', align: 'left', mode: 'paged' };
const settings = { ...DEFAULTS, ...prefs.read('settings', {}) };
const FONTS = {
  serif: 'ui-serif, "New York", Georgia, "Times New Roman", serif',
  sans: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, system-ui, sans-serif',
};
const SPACING = { compact: 1.4, normal: 1.6, airy: 1.85 };
const MARGIN = { narrow: 14, normal: 24, wide: 38 };
const THEME_COLOR = { light: '#ffffff', sepia: '#f4ecd8', dark: '#1e1e20', black: '#000000' };

function applySettings() {
  const root = document.documentElement.style;
  root.setProperty('--read-size', settings.size + 'px');
  root.setProperty('--read-font', FONTS[settings.font] || FONTS.serif);
  root.setProperty('--read-lh', SPACING[settings.spacing] || 1.6);
  root.setProperty('--read-margin', (MARGIN[settings.margin] ?? 24) + 'px');
  root.setProperty('--read-align', settings.align);
  document.body.dataset.theme = settings.theme;
  document.body.classList.toggle('paged', settings.mode === 'paged');
  document.body.classList.toggle('scroll', settings.mode === 'scroll');
  document.querySelector('meta[name="theme-color"]').setAttribute('content', THEME_COLOR[settings.theme] || '#f4ecd8');
  els.fontSizeOut.textContent = settings.size;
  for (const group of els.settings.querySelectorAll('.choice')) {
    const key = group.dataset.setting;
    for (const b of group.querySelectorAll('button')) b.classList.toggle('on', b.dataset.value === settings[key]);
  }
  prefs.write('settings', settings);
}

/* ------------------------------------------------------------------ */
/* Utilidades de interface                                             */
/* ------------------------------------------------------------------ */

let toastTimer = 0;
function toast(msg, ms = 2600) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, ms);
}
function busy(text, fraction) {
  if (text === null) { els.busy.hidden = true; return; }
  els.busy.hidden = false;
  els.busyText.textContent = text;
  els.busyFill.style.width = Math.round((fraction || 0) * 100) + '%';
}
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const COVER_COLORS = ['#8c4a2f', '#2f5d8c', '#3d7a4f', '#7a3d6b', '#8c7a2f', '#2f7a7a', '#5a4a8c', '#8c2f45'];
function coverColor(text) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return COVER_COLORS[h % COVER_COLORS.length];
}
function debounce(fn, ms) {
  let t = 0;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  return d;
}

/* ------------------------------------------------------------------ */
/* PDF protegido por senha                                             */
/* ------------------------------------------------------------------ */

function askPassword(wrong) {
  return new Promise((resolve) => {
    const busyWasOpen = !els.busy.hidden;
    els.busy.hidden = true;
    els.pwdMsg.textContent = wrong ? 'Senha incorreta. Tente de novo.' : 'Este PDF é protegido. Digite a senha para abrir.';
    els.pwdMsg.classList.toggle('err', !!wrong);
    els.pwdInput.value = '';
    els.pwdModal.hidden = false;
    setTimeout(() => els.pwdInput.focus(), 50);
    const done = (value) => {
      els.pwdModal.hidden = true;
      els.pwdForm.onsubmit = null;
      els.pwdCancel.onclick = null;
      if (busyWasOpen && value !== null) els.busy.hidden = false;
      resolve(value);
    };
    els.pwdForm.onsubmit = (e) => { e.preventDefault(); done(els.pwdInput.value); };
    els.pwdCancel.onclick = () => done(null);
  });
}

/** Abre o PDF, pedindo a senha quando necessário. */
async function openPdf(buffer, knownPassword) {
  let password = knownPassword || undefined;
  for (;;) {
    try {
      const pdf = await pdfjsLib.getDocument({
        data: new Uint8Array(buffer.slice(0)), password, cMapUrl: CMAP_URL, cMapPacked: true,
      }).promise;
      return { pdf, password };
    } catch (err) {
      if (err?.name !== 'PasswordException') throw err;
      const wrong = err.code === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD;
      const typed = await askPassword(wrong);
      if (typed === null) { const e = new Error('cancelado'); e.name = 'Cancelled'; throw e; }
      password = typed;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Biblioteca                                                          */
/* ------------------------------------------------------------------ */

async function renderLibrary() {
  const books = (await idb.all('books')).sort((a, b) => (b.openedAt || b.addedAt) - (a.openedAt || a.addedAt));
  els.bookList.innerHTML = '';
  els.empty.hidden = books.length > 0;
  for (const book of books) {
    const li = document.createElement('li');
    li.className = 'book';
    const pct = Math.round((book.percent || 0) * 100);
    const status = book.percent > 0.995 ? 'Concluído' : pct > 0 ? `${pct}% lido` : `Novo · ~${book.minutes} min`;
    li.innerHTML = `
      <button class="book-open" type="button">
        <span class="cover"></span>
        <span class="book-meta">
          <p class="book-title"></p>
          <p class="book-info"></p>
          <div class="book-bar"><span style="width:${pct}%"></span></div>
        </span>
      </button>
      <button class="icon-btn book-del" type="button" aria-label="Remover">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>
      </button>`;
    const cover = li.querySelector('.cover');
    cover.textContent = (book.title.match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase();
    cover.style.background = book.color;
    li.querySelector('.book-title').textContent = book.title;
    li.querySelector('.book-info').textContent = `${book.pageCount} pág. no PDF · ${status}`;
    li.querySelector('.book-open').addEventListener('click', () => openBook(book.id));
    li.querySelector('.book-del').addEventListener('click', async () => {
      if (!confirm(`Remover “${book.title}” da biblioteca?`)) return;
      await Promise.all([idb.del('books', book.id), idb.del('content', book.id), idb.del('files', book.id)]);
      renderLibrary();
    });
    els.bookList.appendChild(li);
  }
}

async function importFile(file) {
  if (!file) return;
  if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) { toast('Escolha um arquivo PDF.'); return; }
  busy('Abrindo o PDF…', 0);
  let pdf = null;
  try {
    const buffer = await file.arrayBuffer();
    // o pdf.js transfere o buffer para o worker; guardamos uma cópia para salvar
    const opened = await openPdf(buffer);
    pdf = opened.pdf;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      busy(`Reorganizando página ${i} de ${pdf.numPages}…`, i / pdf.numPages);
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      // formas pequenas desenhadas (marcadores de lista que não são texto)
      let marks = [];
      try { marks = extractMarks(await page.getOperatorList(), pdfjsLib.OPS); } catch { /* segue sem */ }
      pages.push({ items: content.items.filter((it) => 'str' in it).map(normalizeItem), width: vp.width, height: vp.height, marks });
      page.cleanup();
    }
    const blocks = reflow(pages);
    for (const b of blocks) {
      if (b.type === 'image') b.ratio = +(pages[b.page - 1].height / pages[b.page - 1].width).toFixed(4);
    }
    let title = titleFromFilename(file.name);
    try {
      const meta = await pdf.getMetadata();
      const t = meta?.info?.Title?.trim();
      if (t && t.length > 2 && !/^(untitled|sem título|microsoft word|documento\d*)/i.test(t) && !/\.(docx?|pdf|indd)$/i.test(t)) title = t;
    } catch { /* sem metadados */ }

    const id = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random().toString(16).slice(2);
    const now = Date.now();
    const book = {
      id, title, pageCount: pdf.numPages, minutes: readingMinutes(blocks), color: coverColor(title),
      addedAt: now, openedAt: now, anchor: 0, percent: 0,
    };
    // a senha fica só neste aparelho, para reabrir o arquivo (imagens e página original)
    if (opened.password) book.password = opened.password;
    await idb.put('files', { id, data: buffer });
    await idb.put('content', { id, blocks });
    await idb.put('books', book);
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    busy(null);
    const textBlocks = blocks.filter((b) => b.type !== 'image').length;
    if (textBlocks === 0) toast('Este PDF é escaneado (só imagens): as páginas aparecem como imagem.', 4200);
    await openBook(id);
  } catch (err) {
    console.error(err);
    busy(null);
    if (err?.name !== 'Cancelled') toast('Não consegui ler este PDF.');
  } finally {
    if (pdf) pdf.destroy();
  }
}

/* ------------------------------------------------------------------ */
/* Leitor                                                              */
/* ------------------------------------------------------------------ */

const state = {
  book: null, blocks: [], blockEls: [], endEl: null,
  page: 0, pages: 1, step: 1, anchor: 0, pdf: null, pdfPromise: null, observer: null, imgUrls: [],
};

async function openBook(id) {
  const [book, content] = await Promise.all([idb.get('books', id), idb.get('content', id)]);
  if (!book || !content) { toast('Livro não encontrado.'); return; }
  closeBook(false);
  state.book = book;
  state.blocks = content.blocks;
  state.anchor = Math.min(book.anchor || 0, content.blocks.length - 1);
  book.openedAt = Date.now();
  idb.put('books', book);

  els.bookTitle.textContent = book.title;
  renderBlocks();
  els.library.hidden = true;
  els.reader.hidden = false;
  els.reader.classList.remove('ui');
  if (history.state?.view !== 'reader') history.pushState({ view: 'reader', id }, '', '#ler');
  await relayout();
}

function closeBook(goLibrary = true) {
  if (state.book) saveProgress.flush();
  state.observer?.disconnect();
  state.imgUrls.forEach((u) => URL.revokeObjectURL(u));
  state.imgUrls = [];
  state.pdf?.destroy();
  Object.assign(state, { book: null, blocks: [], blockEls: [], endEl: null, pdf: null, pdfPromise: null, observer: null });
  els.flow.innerHTML = '';
  hideSheets();
  if (goLibrary) {
    els.reader.hidden = true;
    els.library.hidden = false;
    renderLibrary();
  }
}

function renderBlocks() {
  const frag = document.createDocumentFragment();
  state.blockEls = state.blocks.map((b, i) => {
    let el;
    if (b.type === 'image') {
      el = document.createElement('figure');
      el.className = 'page-img';
      const ph = document.createElement('div');
      ph.className = 'ph';
      ph.style.aspectRatio = `1 / ${b.ratio || 1.33}`;
      const cap = document.createElement('figcaption');
      cap.textContent = `Página ${b.page}`;
      el.append(ph, cap);
    } else if (b.type === 'li') {
      el = document.createElement('p');
      el.className = 'li' + (b.marker.length > 2 ? ' wide' : '');
      const mk = document.createElement('span');
      mk.className = 'mk';
      mk.textContent = b.marker;
      el.append(mk, document.createTextNode(b.text));
    } else if (b.type === 'table') {
      el = renderTable(b);
    } else {
      el = document.createElement(b.type);
      el.textContent = b.text;
    }
    el.dataset.i = i;
    frag.appendChild(el);
    return el;
  });
  const end = document.createElement('p');
  end.className = 'end';
  end.textContent = `— Fim —`;
  frag.appendChild(end);
  state.endEl = end;
  els.flow.appendChild(frag);

  state.observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { state.observer.unobserve(e.target); renderPageImage(e.target); }
    }
  }, { root: els.pager, rootMargin: '150% 150% 150% 150%' });
  state.blockEls.forEach((el, i) => { if (state.blocks[i].type === 'image') state.observer.observe(el); });
}

const NUMERIC = /^[\s\d.,%()+\-−–R$€US]*\d[\s\d.,%()+\-−–]*$/;
function renderTable(b) {
  const wrap = document.createElement('div');
  wrap.className = 'tbl';
  const table = document.createElement('table');
  const [head, ...body] = b.rows.length > 1 ? b.rows : [null, ...b.rows];
  if (head) {
    const thead = table.createTHead().insertRow();
    for (const h of head) { const th = document.createElement('th'); th.textContent = h; thead.appendChild(th); }
  }
  const tbody = table.createTBody();
  for (const row of body) {
    const tr = tbody.insertRow();
    row.forEach((v, k) => {
      const td = tr.insertCell();
      td.textContent = v;
      td.dataset.label = head?.[k] || '';
      if (!v) td.classList.add('empty');
      if (k > 0 && NUMERIC.test(v)) td.classList.add('num');
    });
  }
  const cap = document.createElement('button');
  cap.type = 'button';
  cap.className = 'tbl-src';
  cap.textContent = `Tabela · ver original (p. ${b.page})`;
  cap.addEventListener('click', (e) => { e.stopPropagation(); showOriginal(b.page); });
  cap.addEventListener('pointerup', (e) => e.stopPropagation());
  wrap.append(table, cap);
  wrap.dataset.cols = b.rows[0].length;
  return wrap;
}

/** Tabelas que não cabem na largura viram "cartões" (uma linha da tabela por cartão). */
function fitTables() {
  for (const wrap of els.flow.querySelectorAll('.tbl')) {
    wrap.classList.remove('cards');
    const table = wrap.querySelector('table');
    const avail = wrap.clientWidth;
    const tooNarrow = avail / Number(wrap.dataset.cols) < 68;
    if (tooNarrow || table.scrollWidth > avail + 1) wrap.classList.add('cards');
  }
}

function loadPdf() {
  if (!state.pdfPromise) {
    const id = state.book.id;
    state.pdfPromise = idb.get('files', id).then((file) => {
      if (!file) throw new Error('arquivo ausente');
      return openPdf(file.data, state.book?.password);
    }).then(({ pdf, password }) => {
      if (state.book && password && password !== state.book.password) {
        state.book.password = password;
        idb.put('books', { ...state.book });
      }
      if (state.book?.id !== id) { pdf.destroy(); throw new Error('livro fechado'); }
      state.pdf = pdf;
      return pdf;
    });
    state.pdfPromise.catch(() => { state.pdfPromise = null; });
  }
  return state.pdfPromise;
}

async function renderPdfPage(pageNo, cssWidth) {
  const pdf = await loadPdf();
  const page = await pdf.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const scale = Math.min((cssWidth * dpr) / base.width, 4096 / Math.max(base.width, base.height));
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  page.cleanup();
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.88));
  canvas.width = canvas.height = 0; // libera memória no iOS
  const url = URL.createObjectURL(blob);
  state.imgUrls.push(url);
  return url;
}

async function renderPageImage(fig) {
  const block = state.blocks[+fig.dataset.i];
  const bookId = state.book?.id;
  try {
    const url = await renderPdfPage(block.page, els.flow.clientWidth);
    if (state.book?.id !== bookId) return;
    const img = new Image();
    img.alt = `Página ${block.page} do PDF original`;
    img.src = url;
    img.style.aspectRatio = `1 / ${block.ratio || 1.33}`;
    await img.decode().catch(() => {});
    fig.querySelector('.ph')?.replaceWith(img);
    if (settings.mode === 'paged') relayout();
  } catch (err) {
    console.warn('falha ao renderizar página', err);
  }
}

/* ---- paginação ---- */

function colOf(el) {
  const r = el.getClientRects()[0] || el.getBoundingClientRect();
  const base = els.flow.getBoundingClientRect().left;
  return Math.floor((r.left - base + 2) / state.step);
}

async function relayout() {
  if (!state.book) return;
  const anchor = state.anchor;
  fitTables();
  if (settings.mode === 'paged') {
    const flow = els.flow;
    const pagerW = els.pager.clientWidth;
    const w = flow.clientWidth;
    const gap = pagerW - w;
    flow.style.columnWidth = w + 'px';
    flow.style.columnGap = gap + 'px';
    state.step = pagerW;
    await nextFrame();
    state.pages = Math.max(1, colOf(state.endEl) + 1);
    const el = state.blockEls[anchor];
    goToPage(el ? colOf(el) : 0, false, true);
  } else {
    els.flow.style.columnWidth = '';
    els.flow.style.columnGap = '';
    els.flow.style.transform = '';
    await nextFrame();
    const el = state.blockEls[anchor];
    els.pager.scrollTop = el ? el.offsetTop - 8 : 0;
    updateProgress();
  }
}

function goToPage(p, animate = true, keepAnchor = false) {
  state.page = Math.max(0, Math.min(state.pages - 1, p));
  els.flow.classList.toggle('animate', animate);
  els.flow.style.transform = `translateX(${-state.page * state.step}px)`;
  // ao refazer o layout mantemos o bloco de referência, para a posição não "andar"
  if (!keepAnchor) state.anchor = anchorForPage(state.page);
  updateProgress();
  saveProgress();
}

/** Último bloco que começa nesta página ou antes dela (o que está no topo da página). */
function anchorForPage(p) {
  const list = state.blockEls;
  let lo = 0; let hi = list.length - 1; let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (colOf(list[mid]) <= p) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

function anchorForScroll() {
  const top = els.pager.scrollTop + 4;
  const list = state.blockEls;
  let lo = 0; let hi = list.length - 1; let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const el = list[mid];
    if (el.offsetTop + el.offsetHeight > top) { ans = mid; hi = mid - 1; } else lo = mid + 1;
  }
  return ans;
}

function currentPercent() {
  if (settings.mode === 'paged') return state.pages <= 1 ? 1 : state.page / (state.pages - 1);
  const max = Math.max(1, state.endEl.offsetTop + state.endEl.offsetHeight - els.pager.clientHeight);
  return Math.max(0, Math.min(1, els.pager.scrollTop / max));
}

function minutesLeft(pct) {
  return Math.max(0, Math.round(state.book.minutes * (1 - pct)));
}

function updateProgress() {
  if (!state.book) return;
  const pct = currentPercent();
  const pctText = Math.round(pct * 100) + '%';
  const left = minutesLeft(pct);
  const leftText = left < 1 ? 'fim próximo' : left < 60 ? `${left} min restantes` : `${Math.floor(left / 60)} h ${left % 60} min restantes`;
  const pdfPage = state.blocks[state.anchor]?.page || 1;
  if (settings.mode === 'paged') {
    els.pageInfo.textContent = `Página ${state.page + 1} de ${state.pages}`;
    els.mini.textContent = `${state.page + 1} de ${state.pages} · ${pctText}`;
  } else {
    els.pageInfo.textContent = `Pág. ${pdfPage} do PDF`;
    els.mini.textContent = pctText;
  }
  els.percentInfo.textContent = `${pctText} · ${leftText}`;
  if (!rangeDragging) els.range.value = Math.round(pct * 1000);
  state.book.percent = pct;
}

const saveProgress = debounce(() => {
  if (!state.book) return;
  state.book.anchor = state.anchor;
  state.book.openedAt = Date.now();
  idb.put('books', { ...state.book });
}, 500);

function goToBlock(i) {
  state.anchor = i;
  relayout();
}

/* ---- barras ---- */

let uiScrollTop = 0;
function toggleUI(force) {
  const show = force ?? !els.reader.classList.contains('ui');
  els.reader.classList.toggle('ui', show);
  uiScrollTop = els.pager.scrollTop;
}

/* ---- gestos (modo páginas) ---- */

let touch = null;
els.pager.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  touch = { x: e.clientX, y: e.clientY, t: Date.now(), dragging: false, id: e.pointerId };
});
els.pager.addEventListener('pointermove', (e) => {
  if (!touch || settings.mode !== 'paged' || e.pointerId !== touch.id) return;
  const dx = e.clientX - touch.x; const dy = e.clientY - touch.y;
  if (!touch.dragging && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2 && !hasSelection()) touch.dragging = true;
  if (touch.dragging) {
    els.flow.classList.remove('animate');
    els.flow.style.transform = `translateX(${-state.page * state.step + dx}px)`;
  }
});
els.pager.addEventListener('pointercancel', () => {
  if (touch?.dragging) goToPage(state.page);
  touch = null;
});
els.pager.addEventListener('pointerup', (e) => {
  if (!touch || e.pointerId !== touch.id) return;
  const dx = e.clientX - touch.x; const dy = e.clientY - touch.y; const dt = Date.now() - touch.t;
  const wasDrag = touch.dragging;
  touch = null;
  if (settings.mode === 'paged' && wasDrag) {
    const threshold = Math.min(80, state.step * 0.18);
    if (dx < -threshold || (dx < -20 && dt < 250)) goToPage(state.page + 1);
    else if (dx > threshold || (dx > 20 && dt < 250)) goToPage(state.page - 1);
    else goToPage(state.page);
    return;
  }
  const isTap = Math.abs(dx) < 10 && Math.abs(dy) < 10 && dt < 450;
  if (!isTap || hasSelection()) return;
  if (els.reader.classList.contains('ui')) { toggleUI(false); return; }
  if (settings.mode === 'scroll') { toggleUI(true); return; }
  const rel = (e.clientX - els.pager.getBoundingClientRect().left) / els.pager.clientWidth;
  if (rel < 0.3) goToPage(state.page - 1);
  else if (rel > 0.7) goToPage(state.page + 1);
  else toggleUI(true);
});
function hasSelection() {
  const s = window.getSelection?.();
  return s && !s.isCollapsed && String(s).trim() !== '';
}

els.pager.addEventListener('scroll', () => {
  if (settings.mode !== 'scroll' || !state.book) return;
  state.anchor = anchorForScroll();
  // esconde as barras só quando o leitor rola de verdade
  if (els.reader.classList.contains('ui') && Math.abs(els.pager.scrollTop - uiScrollTop) > 60) toggleUI(false);
  updateProgress();
  saveProgress();
}, { passive: true });

document.addEventListener('keydown', (e) => {
  if (els.reader.hidden || !els.settings.hidden || !els.toc.hidden || !els.original.hidden) return;
  if (settings.mode !== 'paged') return;
  if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); goToPage(state.page + 1); }
  if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); goToPage(state.page - 1); }
});

let rangeDragging = false;
els.range.addEventListener('input', () => {
  rangeDragging = true;
  const v = els.range.value / 1000;
  if (settings.mode === 'paged') goToPage(Math.round(v * (state.pages - 1)), false);
  else {
    const max = Math.max(1, state.endEl.offsetTop + state.endEl.offsetHeight - els.pager.clientHeight);
    els.pager.scrollTop = v * max;
  }
});
els.range.addEventListener('change', () => { rangeDragging = false; updateProgress(); });

/* ---- painéis ---- */

function hideSheets() {
  els.settings.hidden = true;
  els.toc.hidden = true;
  els.backdrop.hidden = true;
}
function showSheet(sheet) {
  hideSheets();
  sheet.hidden = false;
  els.backdrop.hidden = false;
}
els.backdrop.addEventListener('click', hideSheets);
els.fontBtn.addEventListener('click', () => showSheet(els.settings));
els.libSettingsBtn.addEventListener('click', () => showSheet(els.settings));
els.tocBtn.addEventListener('click', () => { buildToc(); showSheet(els.toc); });
els.backBtn.addEventListener('click', () => {
  if (history.state?.view === 'reader') history.back();
  else closeBook();
});
window.addEventListener('popstate', () => { if (!els.reader.hidden) closeBook(); });

els.settings.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.act === 'font-') settings.size = Math.max(13, settings.size - 1);
  else if (btn.dataset.act === 'font+') settings.size = Math.min(34, settings.size + 1);
  else if (btn.parentElement.dataset.setting) settings[btn.parentElement.dataset.setting] = btn.dataset.value;
  else return;
  applySettings();
  relayout();
});

function buildToc() {
  els.tocList.innerHTML = '';
  const add = (label, i, cls, page) => {
    const li = document.createElement('li');
    if (cls) li.className = cls;
    const b = document.createElement('button');
    b.type = 'button';
    const t = document.createElement('span'); t.textContent = label;
    const pg = document.createElement('span'); pg.className = 'pg'; pg.textContent = `p. ${page}`;
    b.append(t, pg);
    b.addEventListener('click', () => { hideSheets(); toggleUI(false); goToBlock(i); });
    li.appendChild(b);
    els.tocList.appendChild(li);
  };
  const heads = state.blocks.map((b, i) => [b, i]).filter(([b]) => b.type === 'h1' || b.type === 'h2');
  if (heads.length) {
    const hasH1 = heads.some(([b]) => b.type === 'h1');
    for (const [b, i] of heads) add(b.text, i, hasH1 && b.type === 'h2' ? 'lvl2' : '', b.page);
  } else {
    const p = document.createElement('p');
    p.className = 'none';
    p.textContent = 'Nenhum título detectado. Ir para a página do PDF:';
    els.tocList.appendChild(p);
    const stepPages = state.book.pageCount > 60 ? 10 : state.book.pageCount > 20 ? 5 : 1;
    for (let pg = 1; pg <= state.book.pageCount; pg += stepPages) {
      const i = state.blocks.findIndex((b) => b.page >= pg);
      if (i >= 0) add(`Página ${pg}`, i, '', pg);
    }
  }
}

/* ---- página original ---- */

let originalPage = 1;
async function showOriginal(pageNo) {
  originalPage = Math.max(1, Math.min(state.book.pageCount, pageNo));
  els.originalTitle.textContent = `Página ${originalPage} de ${state.book.pageCount}`;
  els.original.hidden = false;
  els.originalScroll.classList.remove('zoom');
  els.originalScroll.innerHTML = '<div class="spinner" style="margin-top:40px"></div>';
  try {
    const url = await renderPdfPage(originalPage, Math.min(els.originalScroll.clientWidth * 2.2, 2400));
    if (els.original.hidden) return;
    const img = new Image();
    img.src = url;
    img.alt = `Página ${originalPage} do PDF`;
    els.originalScroll.innerHTML = '';
    els.originalScroll.appendChild(img);
  } catch {
    els.originalScroll.innerHTML = '<p style="text-align:center">Não foi possível exibir a página.</p>';
  }
}
els.originalBtn.addEventListener('click', () => {
  if (!state.book) { toast('Abra um livro primeiro.'); return; }
  hideSheets();
  showOriginal(state.blocks[state.anchor]?.page || 1);
});
els.originalClose.addEventListener('click', () => { els.original.hidden = true; els.originalScroll.innerHTML = ''; });
els.originalPrev.addEventListener('click', () => showOriginal(originalPage - 1));
els.originalNext.addEventListener('click', () => showOriginal(originalPage + 1));
let lastTap = 0;
els.originalScroll.addEventListener('click', (e) => {
  const now = Date.now();
  if (now - lastTap < 320) {
    const s = els.originalScroll;
    const zooming = !s.classList.contains('zoom');
    const rx = (e.clientX - s.getBoundingClientRect().left + s.scrollLeft) / s.scrollWidth;
    const ry = (e.clientY - s.getBoundingClientRect().top + s.scrollTop) / s.scrollHeight;
    s.classList.toggle('zoom', zooming);
    if (zooming) { s.scrollLeft = rx * s.scrollWidth - s.clientWidth / 2; s.scrollTop = ry * s.scrollHeight - s.clientHeight / 2; }
  }
  lastTap = now;
});

/* ------------------------------------------------------------------ */
/* Início                                                              */
/* ------------------------------------------------------------------ */

els.fileInput.addEventListener('change', () => {
  const file = els.fileInput.files[0];
  els.fileInput.value = '';
  importFile(file);
});

// arrastar e soltar (computador/iPad)
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = [...(e.dataTransfer?.files || [])].find((f) => /pdf/i.test(f.type) || /\.pdf$/i.test(f.name));
  if (file) importFile(file);
});

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => relayout(), 150);
});
document.addEventListener('visibilitychange', () => { if (document.hidden && state.book) saveProgress.flush(); });
window.addEventListener('pagehide', () => { if (state.book) saveProgress.flush(); });

const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
els.installTip.hidden = !(isIOS && !standalone);

applySettings();
history.replaceState({ view: 'library' }, '', location.pathname);
renderLibrary().catch((err) => { console.error(err); toast('Armazenamento indisponível neste navegador.'); });

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// exposto para testes automatizados
window.__leitor = { state, settings, importFile, openBook, goToPage };
