import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { canPublish, formatDate, shortText, statusMeta, summarizeMatters } from './radar-core.mjs';

const SUPABASE_URL = 'https://qhofpntovhbjtwjsqgwi.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ukFS4mVWa2FNwH7p-KA3Xg_CTAcNLXw';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const $ = (id) => document.getElementById(id);
const state = { matters: [], current: null, filter: 'aguardando_editor', user: null };

const refs = {
  authPanel: $('authPanel'), dashboard: $('dashboard'), loginForm: $('loginForm'),
  loginMessage: $('loginMessage'), userLabel: $('userLabel'), refreshBtn: $('refreshBtn'),
  matterList: $('matterList'), emptyState: $('emptyState'), lastEvent: $('lastEvent'),
  readyCount: $('readyCount'), investigateCount: $('investigateCount'),
  discardedCount: $('discardedCount'), publishedCount: $('publishedCount'),
  dialog: $('matterDialog'), dialogStatus: $('dialogStatus'), dialogHeading: $('dialogHeading'),
  dialogMessage: $('dialogMessage'), publishBtn: $('publishBtn'), saveBtn: $('saveBtn'),
  discardBtn: $('discardBtn'), investigateBtn: $('investigateBtn'), toast: $('toast'),
};

const editFields = {
  chapeu: $('fieldChapeu'), titulo_seo: $('fieldTituloSeo'), linha_fina: $('fieldLinhaFina'),
  titulo_card: $('fieldTituloCard'), categoria: $('fieldCategoria'), autor_exibicao: $('fieldAutor'),
  lead: $('fieldLead'), conteudo: $('fieldContent'), instagram_chamada: $('fieldInstagramCall'),
  instagram_feed: $('fieldInstagramFeed'), instagram_story: $('fieldInstagramStory'),
  instagram_story_cta: $('fieldInstagramCta'),
};

function toast(message) {
  refs.toast.textContent = message;
  refs.toast.classList.add('show');
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => refs.toast.classList.remove('show'), 2600);
}

function setAuthView(authorized) {
  refs.authPanel.classList.toggle('hidden', authorized);
  refs.dashboard.classList.toggle('hidden', !authorized);
}

function toneClass(tone) {
  return ['warning', 'muted', 'published', 'danger'].includes(tone) ? tone : '';
}

function button(label, className, action, disabled = false) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `button ${className}`;
  el.textContent = label;
  el.dataset.action = action;
  el.disabled = disabled;
  return el;
}

function renderSummary() {
  const summary = summarizeMatters(state.matters);
  refs.readyCount.textContent = summary.prontas;
  refs.investigateCount.textContent = summary.apuracao;
  refs.discardedCount.textContent = summary.descartadas;
  refs.publishedCount.textContent = summary.publicadas;
}

function filteredMatters() {
  if (state.filter === 'all') return state.matters;
  return state.matters.filter((matter) => matter.status === state.filter);
}

function renderMatters() {
  const matters = filteredMatters();
  refs.matterList.replaceChildren();
  refs.emptyState.classList.toggle('hidden', matters.length > 0);

  for (const matter of matters) {
    const status = statusMeta(matter.status);
    const card = document.createElement('article');
    card.className = `matter-card status-${status.tone}`;
    card.dataset.id = matter.id;

    const accent = document.createElement('div');
    accent.className = 'accent';
    const content = document.createElement('div');
    content.className = 'matter-content';
    const text = document.createElement('div');

    const meta = document.createElement('div');
    meta.className = 'matter-meta';
    const statusEl = document.createElement('span');
    statusEl.className = `status-pill ${toneClass(status.tone)}`;
    statusEl.textContent = status.label;
    const category = document.createElement('span');
    category.className = 'category-pill';
    category.textContent = matter.categoria || 'Geral';
    meta.append(statusEl, category);

    const title = document.createElement('h2');
    title.textContent = matter.titulo_seo || matter.titulo || 'Sem título';
    const desc = document.createElement('p');
    desc.textContent = matter.linha_fina || matter.resumo || shortText(matter.conteudo, 190) || 'Sem linha fina.';

    const scores = document.createElement('div');
    scores.className = 'score-row';
    scores.innerHTML = `<span>Relevância <strong>${matter.relevancia ?? '—'}</strong></span><span>Confiança <strong>${matter.confianca ?? '—'}</strong></span><span>Risco <strong>${matter.risco_editorial || '—'}</strong></span><span>${formatDate(matter.criado_em)}</span>`;
    text.append(meta, title, desc, scores);

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    actions.append(button('Ler / editar', 'secondary', 'open'));
    if (!['publicada', 'rejeitada'].includes(matter.status)) {
      actions.append(button('Pedir apuração', 'warning-outline', 'investigate'));
      actions.append(button('Descartar', 'danger-outline', 'discard'));
    }
    if (canPublish(matter)) actions.append(button('Publicar', 'primary', 'publish'));

    content.append(text, actions);
    card.append(accent, content);
    refs.matterList.append(card);
  }
}

async function loadLatestEvent() {
  const { data } = await supabase.from('radar_eventos').select('criado_em,mensagem').order('criado_em', { ascending: false }).limit(1).maybeSingle();
  refs.lastEvent.textContent = data ? formatDate(data.criado_em) : 'Sem evento registrado';
  if (data?.mensagem) refs.lastEvent.title = data.mensagem;
}

async function loadMatters() {
  refs.refreshBtn.disabled = true;
  try {
    const { data, error } = await supabase.from('radar_materias').select('*').order('criado_em', { ascending: false }).limit(100);
    if (error) throw error;
    state.matters = data || [];
    renderSummary();
    renderMatters();
    await loadLatestEvent();
  } catch (error) {
    console.error(error);
    toast(`Não foi possível carregar o Radar: ${error.message || error}`);
  } finally {
    refs.refreshBtn.disabled = false;
  }
}

async function authorize(session) {
  if (!session?.user) {
    state.user = null;
    refs.userLabel.textContent = 'Não autenticado';
    setAuthView(false);
    return false;
  }
  const { data: profile, error } = await supabase.from('perfis').select('nome,papel').eq('id', session.user.id).maybeSingle();
  if (error || !profile || !['admin', 'jornalista'].includes(profile.papel)) {
    refs.loginMessage.textContent = 'Seu usuário não tem permissão para acessar o Radar.';
    refs.userLabel.textContent = 'Acesso não autorizado';
    setAuthView(false);
    return false;
  }
  state.user = { ...session.user, profile };
  refs.userLabel.textContent = `${profile.nome || session.user.email} · ${profile.papel}`;
  setAuthView(true);
  await loadMatters();
  return true;
}

function fillDialog(matter) {
  state.current = matter;
  const status = statusMeta(matter.status);
  refs.dialogStatus.className = `status-pill ${toneClass(status.tone)}`;
  refs.dialogStatus.textContent = status.label;
  refs.dialogHeading.textContent = matter.titulo_seo || matter.titulo || 'Matéria';
  refs.dialogMessage.textContent = '';

  for (const [key, field] of Object.entries(editFields)) field.value = matter[key] ?? (key === 'autor_exibicao' ? 'Redação' : '');
  $('qualityRelevance').textContent = matter.relevancia ?? '—';
  $('qualityConfidence').textContent = matter.confianca ?? '—';
  $('qualityRisk').textContent = matter.risco_editorial || '—';

  const sources = $('sourcesList');
  sources.replaceChildren();
  const items = Array.isArray(matter.fontes) ? matter.fontes : [];
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'source-item';
    empty.textContent = 'Nenhuma fonte estruturada registrada.';
    sources.append(empty);
  } else {
    for (const source of items) {
      const row = document.createElement('div');
      row.className = 'source-item';
      const url = typeof source === 'string' ? source : source?.url;
      const label = typeof source === 'string' ? source : (source?.nome || source?.titulo || source?.fonte || url || 'Fonte');
      if (url && /^https?:\/\//i.test(url)) {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.textContent = label;
        row.append(anchor);
      } else row.textContent = label;
      sources.append(row);
    }
  }

  const locked = ['publicada', 'rejeitada'].includes(matter.status);
  refs.publishBtn.disabled = !canPublish(matter);
  refs.saveBtn.disabled = locked;
  refs.discardBtn.disabled = locked;
  refs.investigateBtn.disabled = locked;
  refs.dialog.showModal();
}

async function updateStatus(matter, status, successMessage) {
  if (!matter) return;
  const { error } = await supabase.from('radar_materias').update({ status, atualizado_em: new Date().toISOString() }).eq('id', matter.id);
  if (error) throw error;
  toast(successMessage);
  refs.dialog.close();
  await loadMatters();
}

async function saveCurrent() {
  const matter = state.current;
  if (!matter) return;
  const patch = { atualizado_em: new Date().toISOString() };
  for (const [key, field] of Object.entries(editFields)) {
    if (key !== 'autor_exibicao') patch[key] = field.value.trim();
  }
  refs.saveBtn.disabled = true;
  refs.dialogMessage.textContent = 'Salvando…';
  try {
    const { error } = await supabase.from('radar_materias').update(patch).eq('id', matter.id);
    if (error) throw error;
    refs.dialogMessage.textContent = 'Edição salva.';
    toast('Matéria atualizada');
    await loadMatters();
    const updated = state.matters.find((item) => item.id === matter.id);
    if (updated) fillDialog(updated);
  } catch (error) {
    refs.dialogMessage.textContent = error.message || String(error);
  } finally {
    refs.saveBtn.disabled = false;
  }
}

async function publishMatter(matter) {
  if (!matter || !canPublish(matter)) return;
  refs.publishBtn.disabled = true;
  refs.dialogMessage.textContent = 'Publicando no portal…';
  try {
    const { data, error } = await supabase.functions.invoke('radar-publicar', { body: { materia_id: matter.id } });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || 'Falha na publicação');
    refs.dialog.close();
    toast('Matéria publicada no portal');
    await loadMatters();
  } catch (error) {
    refs.dialogMessage.textContent = error.message || String(error);
    refs.publishBtn.disabled = false;
  }
}

refs.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  refs.loginMessage.textContent = 'Entrando…';
  const { data, error } = await supabase.auth.signInWithPassword({
    email: $('emailInput').value.trim(),
    password: $('passwordInput').value,
  });
  if (error) {
    refs.loginMessage.textContent = 'Não foi possível entrar. Verifique e-mail e senha.';
    return;
  }
  refs.loginMessage.textContent = '';
  await authorize(data.session);
});

refs.refreshBtn.addEventListener('click', loadMatters);

document.querySelector('.filter-row').addEventListener('click', (event) => {
  const filter = event.target.closest('[data-filter]');
  if (!filter) return;
  state.filter = filter.dataset.filter;
  document.querySelectorAll('.filter').forEach((el) => el.classList.toggle('active', el === filter));
  renderMatters();
});

refs.matterList.addEventListener('click', async (event) => {
  const action = event.target.closest('[data-action]');
  const card = event.target.closest('[data-id]');
  if (!action || !card) return;
  const matter = state.matters.find((item) => item.id === card.dataset.id);
  if (!matter) return;
  try {
    if (action.dataset.action === 'open') fillDialog(matter);
    if (action.dataset.action === 'investigate') await updateStatus(matter, 'apurar', 'Matéria enviada para apuração');
    if (action.dataset.action === 'discard') await updateStatus(matter, 'rejeitada', 'Matéria descartada');
    if (action.dataset.action === 'publish') {
      fillDialog(matter);
      await publishMatter(matter);
    }
  } catch (error) { toast(error.message || String(error)); }
});

refs.saveBtn.addEventListener('click', saveCurrent);
refs.publishBtn.addEventListener('click', () => publishMatter(state.current));
refs.discardBtn.addEventListener('click', async () => {
  try { await updateStatus(state.current, 'rejeitada', 'Matéria descartada'); } catch (error) { refs.dialogMessage.textContent = error.message || String(error); }
});
refs.investigateBtn.addEventListener('click', async () => {
  try { await updateStatus(state.current, 'apurar', 'Matéria enviada para apuração'); } catch (error) { refs.dialogMessage.textContent = error.message || String(error); }
});

supabase.auth.onAuthStateChange((_event, session) => { if (session?.user && !state.user) authorize(session); });
const { data: { session } } = await supabase.auth.getSession();
await authorize(session);
