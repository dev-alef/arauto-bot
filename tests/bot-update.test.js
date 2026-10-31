const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate: proximoTurno } = require('node:timers/promises');

function preparar(t, audio = true, { env = {}, falharAudio = false } = {}) {
    const chamadas = [];
    const eventos = [];
    let concluirAtualizacao;
    const atualizacao = new Promise(resolve => { concluirAtualizacao = resolve; });
    const originais = new Map();
    function simular(nome, exports) {
        const arquivo = require.resolve(`../src/${nome}`);
        originais.set(arquivo, require.cache[arquivo]);
        require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports };
    }
    simular('version-check', { checarVersaoNova: async () => {
        eventos.push('consulta');
        await atualizacao;
        eventos.push('atualizado');
    } });
    simular('ai-adapter', { adaptTextWithAI: async (texto, prompt) => {
        chamadas.push({ etapa: 'ia', texto, prompt });
        eventos.push('ia');
        return { texto: 'Reflexão', narracao: 'Reflexão narrada' };
    } });
    simular('speechma', { generateAudio: async (texto) => {
        eventos.push('audio');
        chamadas.push({ etapa: 'audio', texto });
        if (falharAudio) throw new Error('TTS indisponível');
        return '/audio.mp3';
    } });
    simular('whatsapp', {
        sendToGroup: async (destino, texto, audio) => { eventos.push('envio-com-audio'); chamadas.push({ etapa: 'envio', destino, texto, audio }); },
        sendText: async (destino, texto) => { eventos.push('envio-texto'); chamadas.push({ etapa: 'envio', destino, texto }); },
    });
    simular('logger', { log() {} });
    const variaveis = {
        AUDIO_ENABLED: String(audio), WATCH_NUMBER: '5511999999999',
        TARGET_GROUP_ID: 'grupo-atual@g.us', IA_WATCH_NUMBER: '', IA_TARGET_NUMBER: '',
        ...env,
    };
    const anteriores = Object.fromEntries(Object.keys(variaveis).map(nome => [nome, process.env[nome]]));
    Object.assign(process.env, variaveis);
    const botPath = require.resolve('../src/bot');
    delete require.cache[botPath];
    const bot = require(botPath);
    t.after(() => {
        delete require.cache[botPath];
        for (const [arquivo, valor] of originais) {
            if (valor) require.cache[arquivo] = valor;
            else delete require.cache[arquivo];
        }
        for (const [nome, valor] of Object.entries(anteriores)) {
            if (valor === undefined) delete process.env[nome];
            else process.env[nome] = valor;
        }
    });
    return { ...bot, eventos, chamadas, concluirAtualizacao };
}
const reflexao = { text: 'Shalom, amado! Uma reflexão.', from: '5511999999999@s.whatsapp.net', messageId: '1' };

test('cada reflexão espera a atualização antes do áudio e do envio, mantendo a fila', async t => {
    const ctx = preparar(t);
    await ctx.processMessage(reflexao);
    await ctx.processMessage({ ...reflexao, messageId: '2' });
    await proximoTurno();
    assert.deepEqual(ctx.eventos, ['consulta']);
    ctx.concluirAtualizacao();
    await proximoTurno();
    assert.deepEqual(ctx.eventos, [
        'consulta', 'atualizado', 'ia', 'audio', 'envio-com-audio',
        'consulta', 'atualizado', 'ia', 'audio', 'envio-com-audio',
    ]);
});

test('também checa antes de reflexões com áudio desativado', async t => {
    const ctx = preparar(t, false);
    ctx.concluirAtualizacao();
    await ctx.processMessage(reflexao);
    await proximoTurno();
    assert.deepEqual(ctx.eventos, ['consulta', 'atualizado', 'ia', 'envio-texto']);
});

test('mensagens filtradas não consultam o npm', async t => {
    const ctx = preparar(t);
    await ctx.processMessage({ ...reflexao, text: 'Bom dia' });
    await ctx.processMessage({ ...reflexao, from: '000@s.whatsapp.net' });
    await ctx.processMessage({ ...reflexao, text: '' });
    await proximoTurno();
    assert.deepEqual(ctx.eventos, []);
});

const aula = { ...reflexao, text: 'Shalom, amado! Aula 66 do Curso Progressivo de Inteligência Artificial. Hoje estudaremos GPUs.' };
const envCurso = { IA_TARGET_NUMBER: '5524999990000', IA_WATCH_NUMBER: '5511999999999' };

test('fila intercala reflexão e aula enviando texto e narração aos destinos correspondentes', async t => {
    const ctx = preparar(t, true, { env: envCurso });
    ctx.concluirAtualizacao();
    await ctx.processMessage(reflexao);
    await ctx.processMessage(aula);
    await ctx.processMessage({ ...reflexao, messageId: '3' });
    await proximoTurno();
    const envios = ctx.chamadas.filter(c => c.etapa === 'envio');
    assert.deepEqual(envios.map(c => c.destino), ['grupo-atual@g.us', '5524999990000', 'grupo-atual@g.us']);
    assert.ok(envios.every(c => c.audio === '/audio.mp3'));
    assert.deepEqual(ctx.chamadas.filter(c => c.etapa === 'audio').map(c => c.texto), Array(3).fill('Reflexão narrada'));
    const adaptacoes = ctx.chamadas.filter(c => c.etapa === 'ia');
    assert.equal(adaptacoes[0].prompt, ctx.CONFIG.AI_PROMPT);
    assert.match(adaptacoes[1].prompt, /Não resuma/);
    assert.equal(ctx.eventos.filter(e => e === 'consulta').length, 3);
});

test('aula sem destino configurado não chama IA, TTS ou envio ao grupo', async t => {
    const ctx = preparar(t);
    ctx.concluirAtualizacao();
    await ctx.processMessage(aula);
    await proximoTurno();
    assert.deepEqual(ctx.eventos, []);
    assert.deepEqual(ctx.chamadas, []);
});

test('falha de áudio na aula envia somente o texto ao contato correto', async t => {
    const ctx = preparar(t, true, { env: envCurso, falharAudio: true });
    ctx.concluirAtualizacao();
    await ctx.processMessage(aula);
    await proximoTurno();
    assert.deepEqual(ctx.chamadas.filter(c => c.etapa === 'envio'), [
        { etapa: 'envio', destino: '5524999990000', texto: 'Reflexão' },
    ]);
});
