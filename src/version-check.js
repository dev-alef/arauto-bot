/** Atualiza o TTS em diretórios isolados, sem modificar as dependências do bot. */
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { log } = require('./logger');

const executar = promisify(execFile);
const PACOTE = 'msedge-tts';
const REGISTRY = 'https://registry.npmjs.org';
const VERSAO_ESTAVEL = /^\d+\.\d+\.\d+$/;

function maisNova(nova, atual) {
    const a = nova.split('.').map(Number);
    const b = atual.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i]) return a[i] > b[i];
    }
    return false;
}

function criarAtualizador({
    raiz = path.join(__dirname, '..'),
    consultar = (...args) => fetch(...args),
    executarNpm = (args, options) => process.platform === 'win32'
        ? executar(process.execPath, [
            path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
            ...args,
        ], options)
        : executar('npm', args, options),
    carregar = require,
    registrar = log,
} = {}) {
    const runtime = path.join(raiz, '.tts-runtime');
    const estado = path.join(runtime, 'active.json');
    let ativo;
    let emAndamento;

    function lerPacote(diretorio) {
        const pacote = path.join(diretorio, 'node_modules', PACOTE);
        const { version } = JSON.parse(fs.readFileSync(path.join(pacote, 'package.json'), 'utf8'));
        const biblioteca = carregar(pacote);
        if (typeof biblioteca.MsEdgeTTS !== 'function' ||
            !biblioteca.OUTPUT_FORMAT?.AUDIO_24KHZ_48KBITRATE_MONO_MP3 ||
            typeof biblioteca.MsEdgeTTS.prototype.setMetadata !== 'function' ||
            typeof biblioteca.MsEdgeTTS.prototype.toStream !== 'function') {
            throw new Error('API do msedge-tts incompatível com o gerador de áudio');
        }
        return { version, biblioteca };
    }

    function obterAtivo() {
        if (ativo) return ativo;
        if (fs.existsSync(estado)) {
            try {
                const { version } = JSON.parse(fs.readFileSync(estado, 'utf8'));
                if (!VERSAO_ESTAVEL.test(version)) throw new Error('Versão inválida');
                ativo = lerPacote(path.join(runtime, version));
                if (ativo.version !== version) throw new Error('Versão instalada divergente');
                return ativo;
            } catch (error) {
                ativo = undefined;
                registrar(`⚠️ TTS salvo indisponível; usando dependência original: ${error.message}`, 'warn');
            }
        }
        ativo = lerPacote(raiz);
        return ativo;
    }

    async function atualizar() {
        let temporario;
        try {
            const atual = obterAtivo();
            registrar(`🔎 Verificando atualização do ${PACOTE} (atual: ${atual.version})...`);
            const res = await consultar(`${REGISTRY}/${PACOTE}/latest`, {
                signal: AbortSignal.timeout(10000),
                cache: 'no-store',
            });
            if (!res.ok) throw new Error(`Consulta ao npm retornou HTTP ${res.status}`);
            const { version } = await res.json();
            if (!VERSAO_ESTAVEL.test(version)) throw new Error('Versão estável inválida no npm');
            if (!maisNova(version, atual.version)) return;

            registrar(`📦 Atualizando ${PACOTE}: ${atual.version} → ${version}...`);
            fs.mkdirSync(runtime, { recursive: true });
            const destino = path.join(runtime, version);
            if (!fs.existsSync(destino)) {
                temporario = fs.mkdtempSync(path.join(runtime, 'install-'));
                // Sem scripts de instalação e sem alterar package.json/lockfile do bot.
                await executarNpm([
                    'install', `${PACOTE}@${version}`, '--prefix', temporario,
                    '--registry', REGISTRY, '--ignore-scripts', '--no-save',
                    '--package-lock=false', '--no-audit', '--no-fund',
                    '--engine-strict', '--fetch-retries=0', '--fetch-timeout=30000',
                ], { cwd: raiz, timeout: 120000, maxBuffer: 1024 * 1024 });
                fs.renameSync(temporario, destino);
                temporario = undefined;
            }
            let candidato;
            try {
                candidato = lerPacote(destino);
                if (candidato.version !== version) throw new Error('Versão instalada divergente');
            } catch (error) {
                // Uma tentativa futura deve carregar os arquivos reinstalados.
                for (const arquivo of Object.keys(require.cache)) {
                    if (arquivo.startsWith(destino + path.sep)) delete require.cache[arquivo];
                }
                fs.rmSync(destino, { recursive: true, force: true });
                throw error;
            }
            // Só troca a versão ativa depois de instalar e validar a nova biblioteca.
            const estadoTemporario = path.join(runtime, 'active.json.tmp');
            fs.writeFileSync(estadoTemporario, JSON.stringify({ version }) + '\n');
            fs.renameSync(estadoTemporario, estado);
            ativo = candidato;
            registrar(`✅ ${PACOTE} atualizado para ${version}; já será usado nesta reflexão.`);
        } catch (error) {
            registrar(`⚠️ Não foi possível verificar/atualizar ${PACOTE}; mantendo a versão disponível: ${error.message}`, 'warn');
        } finally {
            if (temporario) fs.rmSync(temporario, { recursive: true, force: true });
        }
    }

    function checarVersaoNova() {
        // Chamadas simultâneas compartilham a instalação. A próxima reflexão consulta novamente.
        if (!emAndamento) {
            emAndamento = atualizar().finally(() => { emAndamento = undefined; });
        }
        return emAndamento;
    }

    return { checarVersaoNova, obterBiblioteca: () => obterAtivo().biblioteca };
}

module.exports = { ...criarAtualizador(), criarAtualizador };
