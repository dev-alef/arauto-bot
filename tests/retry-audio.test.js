const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate: proximoTurno } = require('node:timers/promises');

const ERRO_STREAM = 'stream closed before the synthesis completed (no turn.end received); the audio is likely truncated';

function preparar(t, { falhas = Infinity, valorAleatorioMaximo = false, erroRelatorio = false, envExtra = {} } = {}) {
    const antigos = new Map();
    const envOriginal = {};
    const env = { AUDIO_ENABLED: 'true', WATCH_NUMBER: '5511999999999', TARGET_GROUP_ID: 'grupo@g.us',
        IA_WATCH_NUMBER: '', IA_TARGET_NUMBER: '', IA_TARGET_GROUP_ID: '', ERROR_REPORT_NUMBER: '5511888887777', ...envExtra };
    for (const [nome, valor] of Object.entries(env)) {
        envOriginal[nome] = process.env[nome];
        process.env[nome] = valor;
    }
    const resultado = { chamadas: [], tentativas: 0, esperas: [], horario: 0, logs: [], sinais: [] };
    function simular(nome, exports) {
        const arquivo = require.resolve(`../src/${nome}`);
        antigos.set(arquivo, require.cache[arquivo]);
        require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports };
    }
    simular('tempo', {
        agora: () => resultado.horario,
        sortear: (minimo, maximo) => valorAleatorioMaximo ? maximo : minimo,
        esperar: async ms => { resultado.esperas.push(ms); resultado.horario += ms; },
    });
    simular('version-check', { checarVersaoNova: async () => {} });
    simular('ai-adapter', { adaptTextWithAI: async () => ({ texto: 'Reflexão', narracao: 'Reflexão narrada' }) });
    simular('tts', { generateAudio: async () => {
        resultado.tentativas++;
        if (resultado.tentativas <= falhas) throw new Error(ERRO_STREAM);
        return '/audio.mp3';
    } });
    simular('whatsapp', {
        sendToGroup: async (destino, texto, audio) => resultado.chamadas.push({ destino, texto, audio }),
        sendText: async (destino, texto, opcoes = {}) => {
            resultado.sinais.push(opcoes.signal);
            if (erroRelatorio) throw new Error('Evolution indisponível');
            resultado.chamadas.push({ destino, texto });
        },
    });
    simular('logger', { log: mensagem => resultado.logs.push(mensagem) });
    const botPath = require.resolve('../src/bot');
    delete require.cache[botPath];
    resultado.bot = require(botPath);
    t.after(() => {
        delete require.cache[botPath];
        for (const [arquivo, original] of antigos) {
            if (original) require.cache[arquivo] = original;
            else delete require.cache[arquivo];
        }
        for (const [nome, valor] of Object.entries(envOriginal)) {
            if (valor === undefined) delete process.env[nome];
            else process.env[nome] = valor;
        }
    });
    return resultado;
}
const mensagem = { text: 'Shalom, amado! Uma reflexão.', from: '5511999999999@s.whatsapp.net', messageId: '1' };

test('erro de stream tenta novamente antes de publicar o par texto e áudio', async t => {
    const ctx = preparar(t, { falhas: 2 });
    await ctx.bot.processMessage(mensagem);
    await proximoTurno();
    assert.equal(ctx.tentativas, 3);
    assert.deepEqual(ctx.esperas, [180000, 180000]);
    assert.deepEqual(ctx.chamadas, [{ destino: 'grupo@g.us', texto: 'Reflexão', audio: '/audio.mp3' }]);
});

test('quatro falhas de stream notificam o número configurado sem publicar a reflexão', async t => {
    const ctx = preparar(t);
    await ctx.bot.processMessage(mensagem);
    await proximoTurno();
    assert.equal(ctx.tentativas, 4);
    assert.deepEqual(ctx.esperas, [180000, 180000, 180000]);
    assert.equal(ctx.chamadas.length, 1);
    assert.equal(ctx.chamadas[0].destino, '5511888887777');
    assert.ok(ctx.sinais[0] instanceof AbortSignal);
    assert.match(ctx.chamadas[0].texto, /stream closed/);
});


test('fila espera entre reflexões e conserva o intervalo mesmo após ficar vazia', async t => {
    const ctx = preparar(t, { falhas: 0 });
    await ctx.bot.processMessage(mensagem);
    await proximoTurno();
    assert.equal(ctx.chamadas.length, 1);
    ctx.horario += 20000; // a segunda mensagem chega 20s depois da primeira
    await ctx.bot.processMessage({ ...mensagem, messageId: '2' });
    await ctx.bot.processMessage({ ...mensagem, messageId: '3' });
    await proximoTurno();
    assert.equal(ctx.chamadas.length, 3);
    assert.deepEqual(ctx.esperas, [40000, 60000]);
});

test('espera de áudio mantém mensagens na fila e a próxima segue após o relatório', async t => {
    const ctx = preparar(t, { falhas: 4 });
    await ctx.bot.processMessage(mensagem);
    await ctx.bot.processMessage({ ...mensagem, messageId: '2' });
    await proximoTurno();
    assert.equal(ctx.tentativas, 5);
    assert.deepEqual(ctx.chamadas.map(c => c.destino), ['5511888887777', 'grupo@g.us']);
    assert.deepEqual(ctx.esperas, [180000, 180000, 180000]);
});


test('aceita os limites máximos de 5 minutos para tentativas e 3 entre reflexões', async t => {
    const ctx = preparar(t, { falhas: 2, valorAleatorioMaximo: true });
    await ctx.bot.processMessage(mensagem);
    await ctx.bot.processMessage({ ...mensagem, messageId: '2' });
    await proximoTurno();
    assert.deepEqual(ctx.esperas, [300000, 300000, 180000]);
    assert.equal(ctx.chamadas.length, 2);
});

test('ausência do número de relatório fica registrada e a fila continua', async t => {
    const ctx = preparar(t, { falhas: 4, envExtra: { ERROR_REPORT_NUMBER: '' } });
    await ctx.bot.processMessage(mensagem);
    await ctx.bot.processMessage({ ...mensagem, messageId: '2' });
    await proximoTurno();
    assert.match(ctx.logs.join('\n'), /configure ERROR_REPORT_NUMBER/);
    assert.deepEqual(ctx.chamadas.map(c => c.destino), ['grupo@g.us']);
});

test('se Evolution falhar ao receber o relatório, o erro fica em log e a fila continua', async t => {
    const ctx = preparar(t, { falhas: 4, erroRelatorio: true });
    await ctx.bot.processMessage(mensagem);
    await ctx.bot.processMessage({ ...mensagem, messageId: '2' });
    await proximoTurno();
    assert.match(ctx.logs.join('\n'), /Não foi possível enviar o relatório/);
    assert.deepEqual(ctx.chamadas.map(c => c.destino), ['grupo@g.us']);
});


test('cancelamento do alerta é transmitido pelo cliente da Evolution', async t => {
    const fetchOriginal = global.fetch;
    const arquivo = require.resolve('../src/whatsapp');
    const original = require.cache[arquivo];
    let requisicao;
    global.fetch = async (url, opcoes) => {
        requisicao = { url, opcoes };
        return new Promise((resolve, reject) => {
            opcoes.signal.addEventListener('abort', () => reject(new Error('cancelado')));
        });
    };
    delete require.cache[arquivo];
    t.after(() => {
        global.fetch = fetchOriginal;
        if (original) require.cache[arquivo] = original;
        else delete require.cache[arquivo];
    });
    const { sendText } = require(arquivo);
    const controle = new AbortController();
    const envio = sendText('5511888887777', 'Alerta de teste', { signal: controle.signal });
    assert.equal(requisicao.opcoes.signal, controle.signal);
    assert.equal(JSON.parse(requisicao.opcoes.body).number, '5511888887777');
    controle.abort();
    await assert.rejects(envio, /cancelado/);
});
