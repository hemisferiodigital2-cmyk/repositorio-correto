export const STATUS = {
  aguardando_editor: { label: 'Aguardando editor', tone: 'ready' },
  apurar: { label: 'Pedir apuração', tone: 'warning' },
  em_analise: { label: 'Em análise', tone: 'info' },
  redigindo: { label: 'Redigindo', tone: 'info' },
  revisao_ia: { label: 'Revisão IA', tone: 'info' },
  aprovada: { label: 'Aprovada', tone: 'ready' },
  rejeitada: { label: 'Descartada', tone: 'muted' },
  publicada: { label: 'Publicada', tone: 'published' },
  erro: { label: 'Erro', tone: 'danger' },
};

export function statusMeta(status) {
  return STATUS[status] || { label: status || 'Sem status', tone: 'muted' };
}

export function canPublish(matter) {
  return ['aguardando_editor', 'aprovada'].includes(matter?.status);
}

export function summarizeMatters(matters = []) {
  return matters.reduce((acc, matter) => {
    acc.total += 1;
    if (matter.status === 'aguardando_editor') acc.prontas += 1;
    if (matter.status === 'apurar') acc.apuracao += 1;
    if (matter.status === 'rejeitada') acc.descartadas += 1;
    if (matter.status === 'publicada') acc.publicadas += 1;
    return acc;
  }, { prontas: 0, apuracao: 0, descartadas: 0, publicadas: 0, total: 0 });
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Belem',
  }).format(date);
}

export function plainText(html = '') {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function shortText(value = '', limit = 180) {
  const text = plainText(value);
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}
