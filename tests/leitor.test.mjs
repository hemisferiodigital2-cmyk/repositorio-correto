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
