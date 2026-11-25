// Núcleo do Leitor: transforma itens de texto posicionados (extraídos do PDF)
// em blocos refluíveis (títulos, parágrafos, listas e tabelas) para leitura no celular.
// Módulo puro, sem DOM, para poder ser testado no Node.
//
// Etapas por página:
//   1. itens de texto → linhas (mesma linha de base)
//   2. remoção de cabeçalhos, rodapés e números de página repetidos
//   3. detecção de colunas (artigos em 2 colunas): a página vira "segmentos"
//      na ordem de leitura — faixa larga, coluna esquerda, coluna direita…
//   4. em cada segmento: marcadores de lista (texto ou desenhados) e tabelas
//   5. montagem de títulos, parágrafos, itens de lista e tabelas

/**
 * @typedef {{str:string, x:number, y:number, w:number, size:number}} Item
 * @typedef {{x:number, y:number, w:number, h:number}} Mark  forma pequena desenhada (possível marcador)
 * @typedef {{items:Item[], width:number, height:number, marks?:Mark[]}} Page
 * @typedef {{type:'h1'|'h2'|'p'|'li'|'table'|'image', text?:string, marker?:string, rows?:string[][], page:number}} Block
 */

const SENTENCE_END = /[.!?:;…"”»)]$/;
// marcadores escritos como caractere (inclui a área de uso privado das fontes Symbol/Wingdings)
const BULLET_CHAR = /^[•▪●◦‣∙·■□▫◆◇►▸▹➢➤➔→✓✔❖❑-■-◿]$/;
const BULLET_PREFIX = /^[•▪●◦‣∙·■□▫◆◇►▸▹➢➤➔→✓✔❖❑-■-◿]\s*/;
// travessão (—/–) não entra: em português ele abre diálogos
const DASH_PREFIX = /^[-*]\s+(?=\S)/;
const NUMBER_PREFIX = /^((\d{1,3}(\.\d{1,2})*|[a-z]|[ivx]{1,5})[.)]|\((\d{1,3}|[a-z]|[ivx]{1,5})\))\s+(?=\S)/;

const median = (arr) => {
  if (!arr.length) return null;
  const s = arr.slice().sort((p, q) => p - q);
  return s[Math.floor(s.length / 2)];
};

/** Converte um item do pdf.js (com matriz transform) em Item simples. */
export function normalizeItem(raw) {
  const [a, b, c, d, e, f] = raw.transform;
  const size = Math.hypot(c, d) || Math.hypot(a, b) || raw.height || 0;
  return { str: raw.str, x: e, y: f, w: raw.width || 0, size };
}

/** Monta uma linha a partir dos seus itens (texto, extremos e tamanho dominante). */
export function makeLine(items, y) {
  const sorted = items.slice().sort((p, q) => p.x - q.x);
  let text = '';
  let lastEnd = null;
  for (const it of sorted) {
    if (lastEnd !== null) {
      const gap = it.x - lastEnd;
      if (gap > it.size * 0.15 && !text.endsWith(' ') && !it.str.startsWith(' ')) text += ' ';
    }
    text += it.str;
    lastEnd = Math.max(lastEnd ?? -Infinity, it.x + it.w);
  }
  const weights = new Map();
  for (const it of sorted) {
    const k = Math.round(it.size * 2) / 2;
    weights.set(k, (weights.get(k) || 0) + it.str.length);
  }
  return {
    y: y ?? sorted[0].y,
    items: sorted,
    text: text.replace(/\s+/g, ' ').trim(),
    x: sorted[0].x,
    right: lastEnd,
    size: [...weights.entries()].sort((p, q) => q[1] - p[1])[0][0],
  };
}

/** Agrupa itens em linhas (mesma linha de base), de cima para baixo. */
export function groupLines(items) {
  const sorted = items
    .filter((it) => it.str && it.str.trim() !== '')
    .slice()
    .sort((p, q) => q.y - p.y || p.x - q.x);
  const groups = [];
  for (const it of sorted) {
    const tol = Math.max(2, it.size * 0.45);
    const g = groups.find((l) => Math.abs(l.y - it.y) <= tol);
    if (g) g.items.push(it);
    else groups.push({ y: it.y, items: [it] });
  }
  return groups
    .map((g) => makeLine(g.items, g.y))
    .filter((l) => l.text !== '')
    .sort((p, q) => q.y - p.y);
}

/** Tamanho de fonte do corpo do texto: o mais frequente no documento. */
export function bodyFontSize(pagesLines) {
  const weights = new Map();
  for (const lines of pagesLines) {
    for (const l of lines) weights.set(l.size, (weights.get(l.size) || 0) + l.text.length);
  }
  if (weights.size === 0) return 10;
  return [...weights.entries()].sort((p, q) => q[1] - p[1])[0][0];
}

const signature = (text) => text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
const isPageNumber = (text) => /^(p(á|a)g(ina)?\.?\s*)?[-–—\s]*\d{1,4}([\s/]*(de|of)?\s*\d{1,4})?[-–—\s]*$/i.test(text) || /^[ivxlcdm]{1,6}$/i.test(text);

/**
 * Remove cabeçalhos/rodapés repetidos e números de página.
 * Considera as 2 primeiras e 2 últimas linhas de cada página.
 */
export function stripRunningHeaders(pagesLines) {
  const counts = new Map();
  const edge = (lines) => [...lines.slice(0, 2), ...lines.slice(-2)];
  for (const lines of pagesLines) {
    const seen = new Set();
    for (const l of edge(lines)) {
      const s = signature(l.text);
      if (!seen.has(s)) { seen.add(s); counts.set(s, (counts.get(s) || 0) + 1); }
    }
  }
  const minRepeat = Math.max(3, Math.ceil(pagesLines.length * 0.4));
  return pagesLines.map((lines) => {
    const edges = new Set(edge(lines));
    return lines.filter((l) => {
      if (!edges.has(l)) return true;
      if (isPageNumber(l.text)) return false;
      return pagesLines.length < 3 || (counts.get(signature(l.text)) || 0) < minRepeat;
    });
  });
}

/** Junta duas linhas de um mesmo parágrafo, desfazendo hifenização. */
export function joinText(prev, next) {
  if (/[A-Za-zÀ-ÿ]-$/.test(prev) && /^[a-zà-ÿ]/.test(next)) return prev.slice(0, -1) + next;
  return prev + ' ' + next;
}

/* ------------------------------------------------------------------ */
/* Colunas                                                             */
/* ------------------------------------------------------------------ */

/**
 * Procura um "corredor" vertical vazio no meio da página que separe duas colunas de texto.
 * @returns {{x0:number, x1:number}|null}
 */
export function detectGutter(lines, body) {
  if (lines.length < 8) return null;
  const items = lines.flatMap((l) => l.items);
  const minX = Math.min(...items.map((i) => i.x));
  const maxX = Math.max(...items.map((i) => i.x + i.w));
  const span = maxX - minX;
  if (span < body * 22) return null;

  // quantas linhas cobrem cada faixa de 1pt na horizontal
  const n = Math.ceil(span) + 1;
  const cov = new Uint16Array(n);
  const seen = new Int32Array(n).fill(-1);
  lines.forEach((l, li) => {
    for (const it of l.items) {
      const a = Math.max(0, Math.floor(it.x - minX));
      const b = Math.min(n - 1, Math.ceil(it.x + it.w - minX) - 1);
      for (let k = a; k <= b; k++) if (seen[k] !== li) { seen[k] = li; cov[k]++; }
    }
  });
  const lo = Math.floor(span * 0.28);
  const hi = Math.ceil(span * 0.72);
  let minCov = Infinity;
  for (let k = lo; k <= hi; k++) minCov = Math.min(minCov, cov[k]);
  if (minCov > lines.length * 0.5) return null;

  // corredor mais largo com cobertura mínima
  const limit = minCov + Math.max(1, Math.floor(lines.length * 0.03));
  let best = null;
  for (let k = lo; k <= hi; k++) {
    if (cov[k] > limit) continue;
    let e = k;
    while (e + 1 < n && cov[e + 1] <= limit) e++;
    let s = k;
    while (s - 1 >= 0 && cov[s - 1] <= limit) s--;
    if (!best || e - s > best.e - best.s) best = { s, e };
    k = e;
  }
  if (!best || best.e - best.s + 1 < body * 0.5) return null;
  const x0 = minX + best.s;
  const x1 = minX + best.e + 1;

  // validação: precisa haver texto "cheio" dos dois lados (e não uma tabela ou versos)
  const leftW = [];
  const rightW = [];
  for (const l of lines) {
    const lp = l.items.filter((it) => it.x + it.w <= x0 + 1);
    const rp = l.items.filter((it) => it.x >= x1 - 1);
    if (lp.length + rp.length < l.items.length) continue; // atravessa o corredor
    if (lp.length) leftW.push(Math.max(...lp.map((it) => it.x + it.w)) - Math.min(...lp.map((it) => it.x)));
    if (rp.length) rightW.push(Math.max(...rp.map((it) => it.x + it.w)) - Math.min(...rp.map((it) => it.x)));
  }
  if (leftW.length < 4 || rightW.length < 4) return null;
  if (median(leftW) < (x0 - minX) * 0.55 || median(rightW) < (maxX - x1) * 0.55) return null;
  return { x0, x1 };
}

/**
 * Divide a página em segmentos na ordem de leitura (esquerda → direita, de cima para baixo).
 * Linhas que atravessam o corredor (título, resumo, figura larga) quebram a página em faixas;
 * em cada faixa lê-se a coluna esquerda inteira e depois a direita.
 */
export function layoutSegments(lines, body) {
  const g = detectGutter(lines, body);
  if (!g) return [{ lines, cols: 1 }];
  const forced = wideTableLines(lines, g, body);
  const segs = [];
  let L = [];
  let R = [];
  let S = [];
  const flushLR = () => {
    if (L.length) segs.push({ lines: L, cols: 2 });
    if (R.length) segs.push({ lines: R, cols: 2 });
    L = []; R = [];
  };
  const flushS = () => { if (S.length) segs.push({ lines: S, cols: 1 }); S = []; };
  for (const line of lines) {
    const lp = [];
    const rp = [];
    let crossing = false;
    for (const it of line.items) {
      if (it.x + it.w <= g.x0 + 1) lp.push(it);
      else if (it.x >= g.x1 - 1) rp.push(it);
      else crossing = true;
    }
    if (crossing || forced.has(line)) { flushLR(); S.push(line); continue; }
    flushS();
    if (lp.length) L.push(makeLine(lp, line.y));
    if (rp.length) R.push(makeLine(rp, line.y));
  }
  flushS();
  flushLR();
  return segs;
}

/**
 * Linhas de tabelas largas (que ocupam as duas colunas): devem ficar inteiras,
 * e não divididas entre coluna esquerda e direita.
 */
function wideTableLines(lines, g, body) {
  const forced = new Set();
  const items = lines.flatMap((l) => l.items);
  const minX = Math.min(...items.map((i) => i.x));
  const maxX = Math.max(...items.map((i) => i.x + i.w));
  const gaps = [];
  for (let i = 1; i < lines.length; i++) {
    const gp = lines[i - 1].y - lines[i].y;
    if (gp > 0) gaps.push(gp);
  }
  const gapEst = median(gaps) || body * 1.3;
  // parte de uma linha que é texto corrido de coluna (larga e sem espaços grandes)
  const isProse = (its, colW) => {
    if (!its.length) return false;
    const part = makeLine(its);
    return part.right - part.x >= colW * 0.75 && cellsOf(part).length === 1;
  };
  for (let i = 0; i < lines.length; i++) {
    if (cellsOf(lines[i]).length < 2) continue;
    const t = tableAt(lines, i, gapEst, body);
    if (!t) continue;
    const rows = lines.slice(i, t.end);
    const prose = rows.some((l) => isProse(l.items.filter((it) => it.x + it.w <= g.x0 + 1), g.x0 - minX)
      || isProse(l.items.filter((it) => it.x >= g.x1 - 1), maxX - g.x1));
    const usesBoth = rows.some((l) => l.x < g.x0 && l.right > g.x1);
    if (!prose && usesBoth) {
      rows.forEach((l) => forced.add(l));
      i = t.end - 1;
    }
  }
  return forced;
}

/* ------------------------------------------------------------------ */
/* Listas                                                              */
/* ------------------------------------------------------------------ */

/** Associa formas pequenas desenhadas (bolinhas, quadradinhos) às linhas à direita delas. */
export function attachDrawnBullets(lines, marks) {
  if (!marks || !marks.length) return;
  for (const line of lines) {
    const s = line.size;
    const hit = marks.find((m) => {
      if (m.w < s * 0.12 || m.h < s * 0.12 || m.w > s * 0.95 || m.h > s * 0.95) return false;
      const ratio = m.w / m.h;
      if (ratio < 0.4 || ratio > 2.5) return false;
      const cy = m.y + m.h / 2;
      if (cy < line.y - s * 0.35 || cy > line.y + s * 0.95) return false;
      const right = m.x + m.w;
      return right <= line.x + 1 && line.x - right <= s * 3;
    });
    if (hit) line.drawnBullet = true;
  }
}

/**
 * Identifica se a linha começa um item de lista.
 * @returns {{marker:string, text:string, textX:number}|null}
 */
export function listMarker(line) {
  if (line.drawnBullet) return { marker: '•', text: line.text, textX: line.x };
  const first = line.items[0];
  const firstStr = first.str.trim();
  const second = line.items[1];
  // marcador como item separado: "•", "", "o", "-" seguido de espaço visível
  if (second && (BULLET_CHAR.test(firstStr) || /^[o\-*]$/.test(firstStr)) && second.x - (first.x + first.w) >= -0.5) {
    if (firstStr !== 'o' || second.x - (first.x + first.w) > first.size * 0.4) {
      return { marker: '•', text: makeLine(line.items.slice(1), line.y).text, textX: second.x };
    }
  }
  const approxX = (n) => line.x + n * line.size * 0.5;
  let m = line.text.match(BULLET_PREFIX);
  if (m && line.text.length > m[0].length) return { marker: '•', text: line.text.slice(m[0].length), textX: approxX(m[0].length) };
  m = line.text.match(DASH_PREFIX);
  if (m) return { marker: '–', text: line.text.slice(m[0].length), textX: approxX(m[0].length) };
  m = line.text.match(NUMBER_PREFIX);
  if (m) return { marker: m[1], text: line.text.slice(m[0].length), textX: approxX(m[0].length) };
  return null;
}

/* ------------------------------------------------------------------ */
/* Tabelas                                                             */
/* ------------------------------------------------------------------ */

/** Divide a linha em células nos espaços largos entre itens. */
export function cellsOf(line) {
  const cells = [];
  let cur = null;
  const minGap = Math.max(line.size * 1.1, 5);
  for (const it of line.items) {
    if (cur && it.x - cur.right > minGap) { cells.push(cur); cur = null; }
    if (!cur) cur = { x: it.x, right: it.x + it.w, items: [it] };
    else { cur.right = Math.max(cur.right, it.x + it.w); cur.items.push(it); }
  }
  if (cur) cells.push(cur);
  return cells.map((c) => ({ x: c.x, right: c.right, text: makeLine(c.items, line.y).text }));
}

/**
 * Procura uma tabela começando em lines[start].
 * @returns {{rows:string[][], end:number}|null} end = índice após a última linha da tabela
 */
export function tableAt(lines, start, lineGap, body) {
  const run = [];
  let j = start;
  while (j < lines.length) {
    const line = lines[j];
    const cells = cellsOf(line);
    if (run.length) {
      const gap = run[run.length - 1].line.y - line.y;
      if (gap <= 0 || gap > Math.max(lineGap * 2.6, body * 3.5)) break;
    }
    if (cells.length >= 2) { run.push({ line, cells }); j++; continue; }
    // linha de uma célula só: continuação de célula quebrada, ou rótulo de grupo seguido de mais linhas
    const next = lines[j + 1];
    const contGap = run.length ? run[run.length - 1].line.y - line.y : Infinity;
    if (run.length && (contGap <= lineGap * 1.4 || (next && cellsOf(next).length >= 2))) {
      run.push({ line, cells });
      j++;
      continue;
    }
    break;
  }
  while (run.length && run[run.length - 1].cells.length < 2) run.pop();
  const multi = run.filter((r) => r.cells.length >= 2);
  if (multi.length < 3 && !(multi.length >= 2 && multi.every((r) => r.cells.length >= 3))) return null;

  // texto corrido em duas colunas não é tabela
  const allCells = multi.flatMap((r) => r.cells);
  const avgLen = allCells.reduce((n, c) => n + c.text.length, 0) / allCells.length;
  if (avgLen > 55) return null;

  // colunas = intervalos horizontais sobrepostos
  const ivs = run.flatMap((r) => r.cells.map((c) => [c.x, c.right])).sort((p, q) => p[0] - q[0]);
  const cols = [];
  for (const [a, b] of ivs) {
    const last = cols[cols.length - 1];
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else cols.push([a, b]);
  }
  if (cols.length < 2) return null;
  const colOf = (c) => {
    const mid = (c.x + c.right) / 2;
    let k = cols.findIndex(([a, b]) => mid >= a - 1 && mid <= b + 1);
    if (k < 0) k = cols.reduce((bi, [a, b], i) => (Math.abs((a + b) / 2 - mid) < Math.abs((cols[bi][0] + cols[bi][1]) / 2 - mid) ? i : bi), 0);
    return k;
  };

  const rows = [];
  let prevY = null;
  for (const r of run) {
    const cellsText = Array(cols.length).fill('');
    for (const c of r.cells) {
      const k = colOf(c);
      cellsText[k] = cellsText[k] ? cellsText[k] + ' ' + c.text : c.text;
    }
    const gap = prevY === null ? Infinity : prevY - r.line.y;
    const isContinuation = rows.length && cellsText[0] === '' && gap <= lineGap * 1.4;
    if (isContinuation) {
      const last = rows[rows.length - 1];
      cellsText.forEach((t, k) => { if (t) last[k] = last[k] ? joinText(last[k], t) : t; });
    } else {
      rows.push(cellsText);
    }
    prevY = r.line.y;
  }
  // descarta colunas totalmente vazias
  const keep = cols.map((_, k) => rows.some((row) => row[k] !== ''));
  const clean = rows.map((row) => row.filter((_, k) => keep[k]));
  if (clean[0].length < 2 || clean.length < 2) return null;
  return { rows: clean, end: start + run.length };
}

/* ------------------------------------------------------------------ */
/* Montagem                                                            */
/* ------------------------------------------------------------------ */

/**
 * Converte páginas (itens já normalizados) em blocos de leitura.
 * @param {Page[]} pages
 * @returns {Block[]}
 */
export function reflow(pages) {
  const rawLines = pages.map((p) => groupLines(p.items));
  const pagesLines = stripRunningHeaders(rawLines);
  const body = bodyFontSize(pagesLines);
  const isBody = (l) => Math.abs(l.size - body) <= body * 0.15;

  // segmentos (colunas/faixas) de cada página, com suas métricas
  const pageSegs = pagesLines.map((lines, idx) => {
    const segs = layoutSegments(lines, body);
    for (const seg of segs) {
      attachDrawnBullets(seg.lines, pages[idx].marks);
      const bl = seg.lines.filter(isBody);
      const ref = bl.length ? bl : seg.lines;
      seg.left = Math.min(...ref.map((l) => l.x));
      seg.width = Math.max(...ref.map((l) => l.right)) - seg.left;
      seg.bodyCount = bl.length;
      const gaps = [];
      for (let i = 1; i < seg.lines.length; i++) {
        const gp = seg.lines[i - 1].y - seg.lines[i].y;
        if (gp > 0 && isBody(seg.lines[i])) gaps.push(gp);
      }
      seg.lineGap = median(gaps);
    }
    return segs;
  });

  // largura típica de coluna, usada em trechos com pouco texto
  const allSegs = pageSegs.flat();
  const fullWidths = allSegs.filter((s) => s.bodyCount >= 5).map((s) => s.width);
  const docWidth = fullWidths.length ? median(fullWidths)
    : allSegs.length ? Math.max(...allSegs.map((s) => s.width)) : null;
  const docGap = median(allSegs.map((s) => s.lineGap).filter(Boolean)) || body * 1.3;

  const blocks = [];
  let current = null; // parágrafo/item em construção (pode atravessar colunas e páginas)
  let prev = null; // linha anterior
  let segSeq = 0;
  const flush = () => { if (current) { blocks.push(current); current = null; } };

  pageSegs.forEach((segs, pageIndex) => {
    const pageNo = pageIndex + 1;
    if (pagesLines[pageIndex].length === 0) {
      flush();
      blocks.push({ type: 'image', page: pageNo });
      prev = { breakAfter: true };
      return;
    }
    for (const seg of segs) {
      const segId = ++segSeq;
      const leftMargin = seg.left;
      const colWidth = Math.max(1, seg.bodyCount >= 5 || !docWidth ? seg.width : Math.max(seg.width, docWidth));
      const lineGap = seg.lineGap || docGap;
      const lines = seg.lines;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // tabela?
        if (cellsOf(line).length >= 2) {
          const table = tableAt(lines, i, lineGap, body);
          if (table) {
            flush();
            blocks.push({ type: 'table', rows: table.rows, page: pageNo });
            prev = { breakAfter: true };
            i = table.end - 1;
            continue;
          }
        }

        // título?
        const ratio = line.size / body;
        const isHeading = ratio >= 1.18 && line.text.length <= 160;
        if (isHeading) {
          const level = ratio >= 1.6 ? 'h1' : 'h2';
          const last = blocks[blocks.length - 1];
          // títulos que quebram em várias linhas viram um único título
          if (!current && last && last.type === level && prev && prev.isHeading && prev.seg === segId
              && Math.abs(prev.size - line.size) < 0.5 && prev.y - line.y < line.size * 1.9) {
            last.text = joinText(last.text, line.text);
          } else {
            flush();
            blocks.push({ type: level, text: line.text, page: pageNo });
          }
          prev = { ...line, seg: segId, isHeading: true };
          continue;
        }

        // item de lista?
        const lm = listMarker(line);
        if (lm) {
          flush();
          current = { type: 'li', marker: lm.marker, text: lm.text, page: pageNo, textX: lm.textX };
          current.lastShort = (line.right - leftMargin) < colWidth * 0.82;
          prev = { ...line, seg: segId };
          continue;
        }

        let newPara = !current;
        if (current && prev) {
          if (prev.isHeading || prev.breakAfter) newPara = true;
          else if (prev.seg !== segId) {
            // mudança de coluna ou de página: só quebra se a anterior terminou frase e era curta
            newPara = SENTENCE_END.test(current.text) && current.lastShort;
          } else {
            const gap = prev.y - line.y;
            const indent = line.x - leftMargin;
            const centered = (l) => {
              const lg = l.x - leftMargin;
              const rg = leftMargin + colWidth - l.right;
              return lg > colWidth * 0.1 && rg > colWidth * 0.1 && Math.abs(lg - rg) < colWidth * 0.08;
            };
            if (gap > lineGap * 1.45 || gap < 0) newPara = true;
            else if (centered(prev) !== centered(line)) newPara = true;
            else if (Math.abs(line.size - prev.size) > body * 0.2) newPara = true;
            else if (current.type === 'li') {
              // fim da lista: voltou para a margem depois de uma linha curta
              if (current.lastShort && (SENTENCE_END.test(current.text) || line.x < current.textX - body * 0.5)) newPara = true;
            } else if (indent > body * 0.9 && indent < colWidth * 0.3 && SENTENCE_END.test(current.text)) newPara = true;
            else if (current.lastShort && SENTENCE_END.test(current.text)) newPara = true;
          }
        }
        if (newPara) {
          flush();
          current = { type: 'p', text: line.text, page: pageNo };
        } else {
          current.text = joinText(current.text, line.text);
        }
        current.lastShort = (line.right - leftMargin) < colWidth * 0.82;
        prev = { ...line, seg: segId };
      }
    }
  });
  flush();
  return blocks.map(({ lastShort, textX, ...b }) => b);
}

/** Texto simples de um bloco (para contagem de palavras e busca). */
export function blockText(b) {
  if (b.type === 'table') return b.rows.map((r) => r.join(' ')).join(' ');
  return b.text || '';
}

/** Estima o tempo de leitura (minutos) a partir dos blocos. */
export function readingMinutes(blocks, wpm = 230) {
  const words = blocks.reduce((n, b) => {
    const t = blockText(b).trim();
    return n + (t ? t.split(/\s+/).length : 0);
  }, 0);
  return Math.max(1, Math.round(words / wpm));
}

/** Título amigável a partir do nome do arquivo. */
export function titleFromFilename(name) {
  return name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Documento';
}

/* ------------------------------------------------------------------ */
/* Formas desenhadas (para marcadores de lista)                         */
/* ------------------------------------------------------------------ */

const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function boxOf(ctm, x0, y0, x1, y1) {
  const pts = [apply(ctm, x0, y0), apply(ctm, x1, y0), apply(ctm, x0, y1), apply(ctm, x1, y1)];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Caixa de um caminho a partir dos seus pontos (inclui pontos de controle das curvas). */
function pathBounds(ops, args, OPS) {
  if (!Array.isArray(ops) || !args) return null;
  const count = { [OPS.moveTo]: 2, [OPS.lineTo]: 2, [OPS.curveTo]: 6, [OPS.curveTo2]: 4, [OPS.curveTo3]: 4, [OPS.closePath]: 0 };
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const add = (x, y) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); };
  let j = 0;
  for (const op of ops) {
    if (op === OPS.rectangle) {
      const [x, y, w, h] = [args[j], args[j + 1], args[j + 2], args[j + 3]];
      add(x, y); add(x + w, y + h);
      j += 4;
    } else {
      const n = count[op] ?? 0;
      for (let k = 0; k < n; k += 2) add(args[j + k], args[j + k + 1]);
      j += n;
    }
  }
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
}

/**
 * Extrai da lista de operações do pdf.js as formas pequenas pintadas na página
 * (caminhos preenchidos/contornados e imagens), em coordenadas da página.
 * @param {{fnArray:number[], argsArray:any[]}} opList
 * @param {Record<string, number>} OPS  tabela de códigos do pdf.js
 */
export function extractMarks(opList, OPS, maxSize = 20) {
  const marks = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let pending = null; // caixa do último caminho construído
  const paint = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke,
    OPS.closeEOFillStroke, OPS.stroke, OPS.closeStroke]);
  const push = (b) => { if (b.w > 0.5 && b.h > 0.5 && b.w <= maxSize && b.h <= maxSize) marks.push(b); };
  const { fnArray, argsArray } = opList;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (Array.isArray(args?.[0]) && args[0].length === 6) ctm = mul(ctm, args[0]);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (fn === OPS.constructPath) {
      const bb = pathBounds(args?.[0], args?.[1], OPS);
      pending = bb ? boxOf(ctm, bb[0], bb[1], bb[2], bb[3]) : null;
    } else if (paint.has(fn)) {
      if (pending) push(pending);
      pending = null;
    } else if (fn === OPS.endPath) pending = null;
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) {
      push(boxOf(ctm, 0, 0, 1, 1));
    }
  }
  return marks;
}
