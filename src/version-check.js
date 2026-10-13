/**
 * Verifica (sem instalar nada) se existe versão nova do msedge-tts no npm.
 * Consulta no máximo uma vez a cada 6 horas e só avisa nos logs.
 */
const fs = require('fs');
const path = require('path');
const { log } = require('./logger');

const PACOTE = 'msedge-tts';
const INTERVALO_MS = 1 * 60 * 60 * 1000;
let ultimaChecagem = 0;
let ultimoAviso = '';

function versaoInstalada() {
    const p = path.join(__dirname, '..', 'node_modules', PACOTE, 'package.json');
    return JSON.parse(fs.readFileSync(p, 'utf8')).version;
}

async function checarVersaoNova() {
    if (Date.now() - ultimaChecagem < INTERVALO_MS) return;
    ultimaChecagem = Date.now();

    try {
        const res = await fetch(`https://registry.npmjs.org/${PACOTE}/latest`);
        if (!res.ok) return;
        const { version: nova } = await res.json();
        const atual = versaoInstalada();

        if (nova !== atual && nova !== ultimoAviso) {
            ultimoAviso = nova;
            log(`🆕 Nova versão do ${PACOTE}: ${atual} → ${nova}. Confira as notas no GitHub e, se quiser, atualize: npm install ${PACOTE}@${nova} && pm2 restart arauto-bot`, 'warn');
        }
    } catch (e) {
        // checagem é só informativa: nunca pode derrubar o fluxo
    }
}

module.exports = { checarVersaoNova };