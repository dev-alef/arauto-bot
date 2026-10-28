const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarAtualizador } = require('../src/version-check');

function pacote(raiz, version, valido = true) {
    const dir = path.join(raiz, 'node_modules', 'msedge-tts');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version, main: 'index.js' }));
    fs.writeFileSync(path.join(dir, 'index.js'), valido ? `
        class MsEdgeTTS { setMetadata() {} toStream() {} }
        module.exports = { MsEdgeTTS, OUTPUT_FORMAT: { AUDIO_24KHZ_48KBITRATE_MONO_MP3: 'mp3' }, version: '${version}' };
    ` : 'module.exports = {};');
}

function contexto(t, options = {}) {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'arauto-tts-'));
    t.after(() => fs.rmSync(raiz, { recursive: true, force: true }));
    pacote(raiz, '2.1.1');
    const logs = [];
    const instalacoes = [];
    let consultas = 0;
    const deps = {
        raiz,
        registrar: (message) => logs.push(message),
        consultar: async () => { consultas++; return { ok: true, json: async () => ({ version: '2.1.2' }) }; },
        executarNpm: async (args, opts) => {
            instalacoes.push({ args, opts });
            pacote(args[args.indexOf('--prefix') + 1], '2.1.2');
        },
        ...options,
    };
    return { raiz, deps, logs, instalacoes, consultas: () => consultas, ...criarAtualizador(deps) };
}

test('consulta novamente em cada reflexão, mesmo sem atualização', async t => {
    let consultas = 0;
    const ctx = contexto(t, { consultar: async (_url, opts) => {
        consultas++;
        assert.ok(opts.signal);
        return { ok: true, json: async () => ({ version: '2.1.1' }) };
    } });
    await ctx.checarVersaoNova();
    await ctx.checarVersaoNova();
    assert.equal(consultas, 2);
    assert.equal(ctx.instalacoes.length, 0);
});

test('instala isoladamente, troca biblioteca já carregada e persiste após reinício', async t => {
    const ctx = contexto(t);
    const anterior = ctx.obterBiblioteca();
    await ctx.checarVersaoNova();
    assert.equal(ctx.obterBiblioteca().version, '2.1.2');
    assert.notEqual(ctx.obterBiblioteca(), anterior);
    assert.equal(ctx.instalacoes.length, 1);
    assert.ok(ctx.instalacoes[0].args.includes('--ignore-scripts'));
    assert.ok(ctx.instalacoes[0].opts.timeout > 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(ctx.raiz, 'node_modules/msedge-tts/package.json'))).version, '2.1.1');
    const reiniciado = criarAtualizador(ctx.deps);
    assert.equal(reiniciado.obterBiblioteca().version, '2.1.2');
    await reiniciado.checarVersaoNova();
    assert.equal(ctx.instalacoes.length, 1);
});

test('compara versões numericamente e não faz downgrade', async t => {
    const ctx = contexto(t, { consultar: async () => ({ ok: true, json: async () => ({ version: '2.0.9' }) }) });
    await ctx.checarVersaoNova();
    assert.equal(ctx.instalacoes.length, 0);
    assert.equal(ctx.obterBiblioteca().version, '2.1.1');
});

test('consultas simultâneas aguardam a mesma instalação', async t => {
    const ctx = contexto(t);
    await Promise.all([ctx.checarVersaoNova(), ctx.checarVersaoNova(), ctx.checarVersaoNova()]);
    assert.equal(ctx.consultas(), 1);
    assert.equal(ctx.instalacoes.length, 1);
    await ctx.checarVersaoNova();
    assert.equal(ctx.consultas(), 2);
});

for (const [nome, consultar] of [
    ['rede indisponível', async () => { throw new Error('offline'); }],
    ['timeout', async () => { throw new DOMException('Timeout', 'TimeoutError'); }],
    ['HTTP 503', async () => ({ ok: false, status: 503 })],
    ['versão inválida', async () => ({ ok: true, json: async () => ({ version: '../malicioso' }) })],
]) {
    test(`preserva biblioteca e registra falha: ${nome}`, async t => {
        const ctx = contexto(t, { consultar });
        await ctx.checarVersaoNova();
        assert.equal(ctx.obterBiblioteca().version, '2.1.1');
        assert.equal(ctx.instalacoes.length, 0);
        assert.match(ctx.logs.at(-1), /mantendo a versão disponível/);
    });
}

test('falha na instalação preserva versão anterior, limpa temporário e permite retry', async t => {
    const ctx = contexto(t, { executarNpm: async () => { throw new Error('npm falhou'); } });
    await ctx.checarVersaoNova();
    assert.equal(ctx.obterBiblioteca().version, '2.1.1');
    assert.deepEqual(fs.readdirSync(path.join(ctx.raiz, '.tts-runtime')), []);
    await ctx.checarVersaoNova();
    assert.equal(ctx.consultas(), 2);
});

test('API incompatível não é ativada', async t => {
    const ctx = contexto(t, { executarNpm: async args => pacote(args[args.indexOf('--prefix') + 1], '2.1.2', false) });
    await ctx.checarVersaoNova();
    assert.equal(ctx.obterBiblioteca().version, '2.1.1');
    assert.equal(fs.existsSync(path.join(ctx.raiz, '.tts-runtime/active.json')), false);
    assert.match(ctx.logs.at(-1), /incompatível/);
});

test('estado persistido inválido usa dependência original', t => {
    const ctx = contexto(t);
    fs.mkdirSync(path.join(ctx.raiz, '.tts-runtime'));
    fs.writeFileSync(path.join(ctx.raiz, '.tts-runtime/active.json'), '{"version":"../../fora"}');
    assert.equal(ctx.obterBiblioteca().version, '2.1.1');
});

test('uma instalação incompatível pode ser refeita sem reutilizar o cache inválido', async t => {
    let tentativas = 0;
    const ctx = contexto(t, { executarNpm: async args => {
        tentativas++;
        pacote(args[args.indexOf('--prefix') + 1], '2.1.2', tentativas > 1);
    } });
    await ctx.checarVersaoNova();
    assert.equal(ctx.obterBiblioteca().version, '2.1.1');
    await ctx.checarVersaoNova();
    assert.equal(ctx.obterBiblioteca().version, '2.1.2');
    assert.equal(tentativas, 2);
});

test('comparação numérica aceita 2.1.10 como superior a 2.1.2', async t => {
    const ctx = contexto(t, {
        consultar: async () => ({ ok: true, json: async () => ({ version: '2.1.10' }) }),
        executarNpm: async args => pacote(args[args.indexOf('--prefix') + 1], '2.1.10'),
    });
    pacote(ctx.raiz, '2.1.2');
    await ctx.checarVersaoNova();
    assert.equal(ctx.obterBiblioteca().version, '2.1.10');
});
