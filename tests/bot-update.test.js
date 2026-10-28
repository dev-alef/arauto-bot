const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate: proximoTurno } = require('node:timers/promises');

function preparar(t, audio = true) {
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
    simular('ai-adapter', { adaptTextWithAI: async () => {
        eventos.push('ia');
        return { texto: 'Reflexão', narracao: 'Reflexão narrada' };
    } });
    simular('speechma', { generateAudio: async () => { eventos.push('audio'); return '/audio.mp3'; } });
    simular('whatsapp', {
        sendToGroup: async () => { eventos.push('envio-com-audio'); },
        sendText: async () => { eventos.push('envio-texto'); },
    });
    simular('logger', { log() {} });
    const anteriores = { AUDIO_ENABLED: process.env.AUDIO_ENABLED, WATCH_NUMBER: process.env.WATCH_NUMBER };
    process.env.AUDIO_ENABLED = String(audio);
    process.env.WATCH_NUMBER = '5511999999999';
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
    return { ...bot, eventos, concluirAtualizacao };
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
