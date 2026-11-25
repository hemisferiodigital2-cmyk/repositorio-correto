// Núcleo do Leitor: transforma itens de texto posicionados (extraídos do PDF)
// em blocos refluíveis (títulos e parágrafos) para leitura no celular.
// Módulo puro, sem DOM, para poder ser testado no Node.

/**
 * @typedef {{str:string, x:number, y:number, w:number, size:number}} Item
 * @typedef {{items:Item[], width:number, height:number}} Page
 * @typedef {{type:'h1'|'h2'|'p'|'image', text?:string, page:number}} Block
 */

const SENTENCE_END = /[.!?:;…"”»)]$/;

/** Converte um item do pdf.js (com matriz transform) em Item simples. */
export function normalizeItem(raw) {
  const [a, b, c, d, e, f] = raw.transform;
  const size = Math.hypot(c, d) || Math.hypot(a, b) || raw.height || 0;
  return { str: raw.str, x: e, y: f, w: raw.width || 0, size };
}

/** Agrupa itens em linhas (mesma linha de base), de cima para baixo. */
export function groupLines(items) {
  const sorted = items
    .filter((it) => it.str && it.str.trim() !== '')
    .slice()
    .sort((p, q) => q.y - p.y || p.x - q.x);
  const lines = [];
  for (const it of sorted) {
    const tol = Math.max(2, it.size * 0.45);
    const line = lines.find((l) => Math.abs(l.y - it.y) <= tol);
    if (line) line.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  for (const line of lines) {
    line.items.sort((p, q) => p.x - q.x);
    let text = '';
    let lastEnd = null;
    for (const it of line.items) {
      if (lastEnd !== null) {
        const gap = it.x - lastEnd;
        const needsSpace = gap > it.size * 0.15 && !text.endsWith(' ') && !it.str.startsWith(' ');
        if (needsSpace) text += ' ';
      }
      text += it.str;
      lastEnd = it.x + it.w;
    }
    line.text = text.replace(/\s+/g, ' ').trim();
    line.x = line.items[0].x;
    line.right = lastEnd;
    // tamanho dominante da linha (ponderado pelo número de caracteres)
    const weights = new Map();
    for (const it of line.items) {
      const k = Math.round(it.size * 2) / 2;
      weights.set(k, (weights.get(k) || 0) + it.str.length);
    }
    line.size = [...weights.entries()].sort((p, q) => q[1] - p[1])[0][0];
  }
  lines.sort((p, q) => q.y - p.y);
  return lines.filter((l) => l.text !== '');
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
 * Marca cabeçalhos/rodapés repetidos e números de página para remoção.
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

/**
 * Converte páginas (itens já normalizados) em blocos de leitura.
 * @param {Page[]} pages
 * @returns {Block[]}
 */
export function reflow(pages) {
  const rawLines = pages.map((p) => groupLines(p.items));
  const pagesLines = stripRunningHeaders(rawLines);
  const body = bodyFontSize(pagesLines);
  const blocks = [];
  let current = null; // parágrafo em construção (pode atravessar páginas)
  let prev = null; // linha anterior (também atravessa páginas)

  const flush = () => { if (current) { blocks.push(current); current = null; } };

  const isBody = (l) => Math.abs(l.size - body) <= body * 0.15;
  // largura típica da coluna no documento, usada em páginas com pouco texto
  const measured = pagesLines.map((lines) => {
    const bl = lines.filter(isBody);
    if (!bl.length) return null;
    return { n: bl.length, w: Math.max(...bl.map((l) => l.right)) - Math.min(...bl.map((l) => l.x)) };
  }).filter(Boolean);
  const full = measured.filter((m) => m.n >= 5).map((m) => m.w).sort((p, q) => p - q);
  const docWidth = full.length ? full[Math.floor(full.length / 2)]
    : measured.length ? Math.max(...measured.map((m) => m.w)) : null;

  pagesLines.forEach((lines, pageIndex) => {
    const pageNo = pageIndex + 1;
    if (lines.length === 0) {
      flush();
      blocks.push({ type: 'image', page: pageNo });
      return;
    }
    // métricas da página
    const bodyLines = lines.filter(isBody);
    const ref = bodyLines.length ? bodyLines : lines;
    const leftMargin = Math.min(...ref.map((l) => l.x));
    const ownWidth = Math.max(...ref.map((l) => l.right)) - leftMargin;
    const colWidth = Math.max(1, bodyLines.length >= 5 || !docWidth ? ownWidth : Math.max(ownWidth, docWidth));
    const gaps = [];
    for (let i = 1; i < lines.length; i++) {
      const g = lines[i - 1].y - lines[i].y;
      if (g > 0 && isBody(lines[i])) gaps.push(g);
    }
    gaps.sort((p, q) => p - q);
    const lineGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : body * 1.3;

    for (const line of lines) {
      const ratio = line.size / body;
      const isHeading = ratio >= 1.18 && line.text.length <= 160;
      if (isHeading) {
        const level = ratio >= 1.6 ? 'h1' : 'h2';
        const last = blocks[blocks.length - 1];
        // títulos que quebram em várias linhas viram um único título
        if (!current && last && last.type === level && prev && prev.isHeading && prev.page === pageNo && Math.abs(prev.size - line.size) < 0.5
            && prev.y - line.y < line.size * 1.9) {
          last.text = joinText(last.text, line.text);
        } else {
          flush();
          blocks.push({ type: level, text: line.text, page: pageNo });
        }
        prev = { ...line, page: pageNo, isHeading: true };
        continue;
      }

      let newPara = !current;
      if (current && prev) {
        if (prev.isHeading) newPara = true;
        else if (prev.page !== pageNo) {
          // continuação entre páginas: só quebra se a anterior terminou frase e era curta
          newPara = SENTENCE_END.test(current.text) && current.lastShort;
        } else {
          const gap = prev.y - line.y;
          const indent = line.x - leftMargin;
          if (gap > lineGap * 1.45) newPara = true;
          else if (Math.abs(line.size - prev.size) > body * 0.2) newPara = true;
          else if (indent > body * 0.9 && indent < colWidth * 0.3 && SENTENCE_END.test(current.text)) newPara = true;
          else if (current.lastShort && SENTENCE_END.test(current.text)) newPara = true;
          else if (/^([•▪●◦‣–—-]|\d{1,3}[.)]|[a-z][)])\s/.test(line.text)) newPara = true;
        }
      }
      if (newPara) {
        flush();
        current = { type: 'p', text: line.text, page: pageNo };
      } else {
        current.text = joinText(current.text, line.text);
      }
      current.lastShort = (line.right - leftMargin) < colWidth * 0.82;
      prev = { ...line, page: pageNo, isHeading: false };
    }
  });
  flush();
  return blocks.map(({ lastShort, ...b }) => b);
}

/** Estima o tempo de leitura (minutos) a partir dos blocos. */
export function readingMinutes(blocks, wpm = 230) {
  const words = blocks.reduce((n, b) => n + (b.text ? b.text.split(/\s+/).length : 0), 0);
  return Math.max(1, Math.round(words / wpm));
}

/** Título amigável a partir do nome do arquivo. */
export function titleFromFilename(name) {
  return name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Documento';
}
