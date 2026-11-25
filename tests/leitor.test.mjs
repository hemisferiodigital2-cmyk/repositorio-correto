import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const path = (rel) => new URL(rel, root);
const core = await import(path('leitor/leitor-core.mjs'));

// item no formato já normalizado: x, y (origem embaixo), largura e tamanho da fonte
const it = (str, x, y, size = 10, w = str.length * size * 0.5) => ({ str, x, y, w, size });

test('arquivos do Leitor existem e a rota está configurada', () => {
  for (const f of ['index.html', 'leitor-app.mjs', 'leitor-core.mjs', 'leitor.css', 'sw.js', 'manifest.webmanifest',
    'icon-180.png', 'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs']) {
    assert.equal(existsSync(path('leitor/' + f)), true, f);
  }
  const redirects = readFileSync(path('_redirects'), 'utf8');
  assert.ok(redirects.indexOf('/leitor') < redirects.indexOf('\n/*  '), 'rota do leitor antes do curinga');
});

test('agrupa itens da mesma linha e ordena de cima para baixo', () => {
  const lines = core.groupLines([it('mundo', 60, 700), it('Olá', 40, 700), it('Segunda', 40, 686)]);
  assert.deepEqual(lines.map((l) => l.text), ['Olá mundo', 'Segunda']);
});

test('junta linhas desfazendo hifenização', () => {
  assert.equal(core.joinText('uma pala-', 'vra'), 'uma palavra');
  assert.equal(core.joinText('Norte-', 'Americano'), 'Norte- Americano');
  assert.equal(core.joinText('fim', 'começo'), 'fim começo');
});

test('reflui páginas em título e parágrafos, removendo cabeçalho e número de página', () => {
  const page = (n, body) => ({
    width: 600, height: 800,
    items: [
      it('Revista Exemplo', 250, 780, 8),
      ...body,
      it(String(n), 295, 20, 8),
    ],
  });
  const long = 'x'.repeat(100);
  const pages = [
    page(1, [
      it('Introdução', 40, 720, 18),
      it(`Primeira linha do texto ${long}`, 40, 690),
      it('continua aqui e termina.', 40, 676),
      it(`Novo parágrafo com recuo ${long}`, 55, 662),
      it('que segue na próxima pági-', 40, 648, 10, 560),
    ]),
    page(2, [it('na sem quebrar.', 40, 720)]),
    page(3, [it(`Outro texto ${long}`, 40, 720)]),
  ];
  const blocks = core.reflow(pages);
  assert.deepEqual(blocks.map((b) => b.type), ['h1', 'p', 'p', 'p']);
  assert.equal(blocks[0].text, 'Introdução');
  assert.match(blocks[1].text, /^Primeira linha .* continua aqui e termina\.$/);
  assert.match(blocks[2].text, /próxima página sem quebrar\.$/);
  assert.ok(!blocks.some((b) => /Revista Exemplo/.test(b.text)), 'cabeçalho repetido removido');
  assert.ok(!blocks.some((b) => /^\d+$/.test(b.text)), 'número de página removido');
});

test('página sem texto vira bloco de imagem (PDF escaneado)', () => {
  const blocks = core.reflow([{ width: 600, height: 800, items: [] }]);
  assert.deepEqual(blocks, [{ type: 'image', page: 1 }]);
});

test('utilitários de título e tempo de leitura', () => {
  assert.equal(core.titleFromFilename('meu_livro_final.PDF'), 'meu livro final');
  assert.equal(core.readingMinutes([{ type: 'p', text: Array(460).fill('a').join(' ') }]), 2);
});

test('artigo em duas colunas: lê a esquerda inteira, depois a direita, com o título largo antes', () => {
  const items = [it('Um Título Largo Que Atravessa As Duas Colunas Da Página', 120, 760, 16, 380)];
  for (let k = 0; k < 10; k++) {
    items.push(it(`esquerda ${k + 1} texto corrido da coluna`, 40, 700 - k * 12, 10, 240));
    items.push(it(`direita ${k + 1} texto corrido da coluna`, 310, 700 - k * 12, 10, 240));
  }
  const blocks = core.reflow([{ width: 600, height: 800, items }]);
  assert.equal(blocks[0].type, 'h1');
  const text = blocks.slice(1).map((b) => b.text).join(' ');
  const order = [...text.matchAll(/(esquerda|direita) (\d+)/g)].map((m) => m[1][0] + m[2]);
  assert.deepEqual(order, [...Array(10)].map((_, k) => 'e' + (k + 1)).concat([...Array(10)].map((_, k) => 'd' + (k + 1))));
});

test('página de uma coluna só não é dividida', () => {
  const items = [];
  for (let k = 0; k < 12; k++) items.push(it(`linha ${k} de um texto normal que ocupa a largura toda`, 40, 700 - k * 12, 10, 520));
  assert.equal(core.layoutSegments(core.groupLines(items), 10).length, 1);
});

test('tabela vira bloco com linhas e colunas', () => {
  const items = [it('Antes da tabela vem um parágrafo comum de texto.', 40, 720, 10, 300)];
  const rows = [['Estado', 'População', 'Área'], ['Amapá', '733 mil', '142 mil km²'], ['Pará', '8,1 mi', '1,2 mi km²'], ['Acre', '830 mil', '164 mil km²']];
  rows.forEach((r, k) => r.forEach((c, j) => items.push(it(c, 40 + j * 160, 690 - k * 14, 10, c.length * 5))));
  const blocks = core.reflow([{ width: 600, height: 800, items }]);
  const table = blocks.find((b) => b.type === 'table');
  assert.ok(table, 'tabela detectada');
  assert.deepEqual(table.rows, rows);
});

test('célula quebrada em duas linhas é juntada na mesma linha da tabela', () => {
  const lines = [
    ['Item', 'Descrição'], ['A', 'primeira parte'], [null, 'continuação'], ['B', 'outra'], ['C', 'mais uma'],
  ];
  const items = [];
  lines.forEach((r, k) => r.forEach((c, j) => { if (c) items.push(it(c, 40 + j * 200, 700 - k * 12, 10)); }));
  const table = core.reflow([{ width: 600, height: 800, items }]).find((b) => b.type === 'table');
  assert.deepEqual(table.rows[1], ['A', 'primeira parte continuação']);
  assert.equal(table.rows.length, 4);
});

test('listas: marcador desenhado, caractere de fonte Symbol e numeração', () => {
  const items = [
    it('Os objetivos são:', 40, 720),
    it('identificar colunas;', 60, 706),
    it('adaptar tabelas.', 60, 692),
    it('', 40, 678, 10, 4), it('marcador da fonte Symbol', 52, 678),
    it('2. item numerado', 40, 664),
  ];
  const marks = [{ x: 48, y: 707, w: 4, h: 4 }, { x: 48, y: 693, w: 4, h: 4 }];
  const blocks = core.reflow([{ width: 600, height: 800, items, marks }]);
  assert.deepEqual(blocks.map((b) => [b.type, b.marker || '', b.text]), [
    ['p', '', 'Os objetivos são:'],
    ['li', '•', 'identificar colunas;'],
    ['li', '•', 'adaptar tabelas.'],
    ['li', '•', 'marcador da fonte Symbol'],
    ['li', '2.', 'item numerado'],
  ]);
});

test('travessão de diálogo não vira item de lista', () => {
  const blocks = core.reflow([{ width: 600, height: 800, items: [it('— Bom dia, disse ela.', 40, 700)] }]);
  assert.equal(blocks[0].type, 'p');
});

test('extrai formas pequenas desenhadas aplicando as transformações', () => {
  const OPS = { save: 10, restore: 11, transform: 12, moveTo: 13, lineTo: 14, curveTo: 15, curveTo2: 16, curveTo3: 17,
    closePath: 18, rectangle: 19, fill: 22, eoFill: 23, fillStroke: 24, eoFillStroke: 25, closeFillStroke: 26,
    closeEOFillStroke: 27, stroke: 20, closeStroke: 21, endPath: 28, constructPath: 91,
    paintFormXObjectBegin: 74, paintFormXObjectEnd: 75, paintImageXObject: 85, paintInlineImageXObject: 86, paintImageMaskXObject: 83 };
  const opList = {
    fnArray: [OPS.save, OPS.transform, OPS.constructPath, OPS.fill, OPS.constructPath, OPS.fill, OPS.restore],
    argsArray: [null, [0.5, 0, 0, 0.5, 100, 200],
      [[OPS.moveTo, OPS.curveTo, OPS.closePath], [0, 0, 0, 8, 8, 8, 8, 0], null], null,
      [[OPS.rectangle], [0, 0, 1000, 2], null], null, null],
  };
  const marks = core.extractMarks(opList, OPS);
  assert.equal(marks.length, 1, 'a linha longa (borda de tabela) é ignorada');
  assert.deepEqual(marks[0], { x: 100, y: 200, w: 4, h: 4 });
});
