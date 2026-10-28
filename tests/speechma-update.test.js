const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const fs = require('node:fs');

test('gerador usa a biblioteca ativa em cada áudio, mesmo após já ter sido carregado', async t => {
    function biblioteca(version) {
        return {
            OUTPUT_FORMAT: { AUDIO_24KHZ_48KBITRATE_MONO_MP3: 'mp3' },
            MsEdgeTTS: class {
                async setMetadata() {}
                toStream() { return { audioStream: Readable.from([Buffer.from(version)]) }; }
            },
        };
    }
    let ativa = biblioteca('anterior');
    const updaterPath = require.resolve('../src/version-check');
    const speechmaPath = require.resolve('../src/speechma');
    const original = require.cache[updaterPath];
    require.cache[updaterPath] = { id: updaterPath, filename: updaterPath, loaded: true, exports: { obterBiblioteca: () => ativa } };
    delete require.cache[speechmaPath];
    const arquivos = [];
    t.after(() => {
        delete require.cache[speechmaPath];
        if (original) require.cache[updaterPath] = original;
        else delete require.cache[updaterPath];
        for (const arquivo of arquivos) fs.rmSync(arquivo, { force: true });
    });
    const { generateAudio } = require('../src/speechma');
    arquivos.push(await generateAudio('Teste', 'teste-anterior'));
    ativa = biblioteca('atualizada');
    arquivos.push(await generateAudio('Teste', 'teste-atualizada'));
    assert.equal(fs.readFileSync(arquivos[0], 'utf8'), 'anterior');
    assert.equal(fs.readFileSync(arquivos[1], 'utf8'), 'atualizada');
});
