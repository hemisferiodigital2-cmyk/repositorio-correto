import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const path = (rel) => new URL(rel, root);

test('rota administrativa do Radar existe com arquivos principais', () => {
  assert.equal(existsSync(path('admin/radar/index.html')), true);
  assert.equal(existsSync(path('admin/radar/radar-app.mjs')), true);
  assert.equal(existsSync(path('admin/radar/radar-core.mjs')), true);
  assert.equal(existsSync(path('admin/radar/radar.css')), true);
});

test('tela expõe ações editoriais sem publicação automática', () => {
  const html = readFileSync(path('admin/radar/index.html'), 'utf8');
  assert.match(html, /Hemisfério Radar/);
  assert.match(html, /Aguardando editor/i);
  assert.match(html, /Pedir apuração/i);
  assert.match(html, /Descartar/i);
  assert.match(html, /Publicar/i);
  assert.doesNotMatch(html, /publicar automaticamente/i);
});

test('aplicação usa a função radar-publicar e a tabela radar_materias', () => {
  const app = readFileSync(path('admin/radar/radar-app.mjs'), 'utf8');
  assert.match(app, /radar_materias/);
  assert.match(app, /radar-publicar/);
  assert.match(app, /materia_id/);
});

test('núcleo editorial conta os estados exibidos no painel', async () => {
  const { summarizeMatters } = await import(path('admin/radar/radar-core.mjs'));
  const summary = summarizeMatters([
    { status: 'aguardando_editor' },
    { status: 'aguardando_editor' },
    { status: 'apurar' },
    { status: 'rejeitada' },
    { status: 'publicada' },
  ]);
  assert.deepEqual(summary, { prontas: 2, apuracao: 1, descartadas: 1, publicadas: 1, total: 5 });
});

test('núcleo editorial só permite publicar status revisável', async () => {
  const { canPublish } = await import(path('admin/radar/radar-core.mjs'));
  assert.equal(canPublish({ status: 'aguardando_editor' }), true);
  assert.equal(canPublish({ status: 'aprovada' }), true);
  assert.equal(canPublish({ status: 'apurar' }), false);
  assert.equal(canPublish({ status: 'publicada' }), false);
});
