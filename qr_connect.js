/**
 * qr_connect.js — Utilitário de primeira ligação
 * 
 * Execute este script UMA VEZ para:
 *   1. Escanear o QR Code e autenticar a sessão
 *   2. Deixar o WhatsApp sincronizar os seus contactos
 *   3. Aguardar o número de contactos estabilizar antes de parar
 * 
 * Após terminar, o index.js principal já terá a sessão e o contacts_cache.json prontos.
 * 
 * Uso: node qr_connect.js
 */

const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const SESSION_PATH = path.join(__dirname, 'session');
const CONTACTS_FILE = path.join(__dirname, 'contacts_cache.json');

async function start() {
    console.log('=============================================');
    console.log('   UTILITÁRIO DE CONEXÃO — BOT STATUS       ');
    console.log('=============================================');
    console.log('Preparando sessão...\n');

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`[BAILEYS] Usando versão: ${version.join('.')} | Última: ${isLatest}`);

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        syncFullHistory: true, // Ativado aqui para capturar todos os contactos
    });

    sock.ev.on('creds.update', saveCreds);

    let contactsArray = [];

    // Carrega cache existente se houver
    try {
        if (fs.existsSync(CONTACTS_FILE)) {
            contactsArray = JSON.parse(fs.readFileSync(CONTACTS_FILE));
            console.log(`[CONTACTOS] Cache existente carregado: ${contactsArray.length} contactos.`);
        }
    } catch (e) {
        console.log('[CONTACTOS] Sem cache anterior. Iniciando do zero.');
    }

    sock.ev.on('contacts.upsert', (contacts) => {
        const jids = contacts.map(c => c.id).filter(id => id && id.endsWith('@s.whatsapp.net'));
        const newContacts = jids.filter(id => !contactsArray.includes(id));

        if (newContacts.length > 0) {
            contactsArray.push(...newContacts);
            fs.writeFileSync(CONTACTS_FILE, JSON.stringify(contactsArray));
            console.log(`[CONTACTOS] Sincronizados: ${contactsArray.length} total (+${newContacts.length} novos)`);
        }
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n📱 Gerando QR Code... Aguarde!');
            const qrPath = path.join(__dirname, 'qr_code.png');
            QRCode.toFile(qrPath, qr, { width: 400 }, (err) => {
                if (err) {
                    console.error('Erro ao gerar QR Code:', err);
                } else {
                    console.log(`✅ QR Code salvo em: ${qrPath}`);
                    // Abre automaticamente no Windows
                    if (process.platform === 'win32') {
                        exec(`start "" "${qrPath}"`);
                    } else {
                        console.log('👉 Abra o arquivo qr_code.png e escaneie com o WhatsApp.');
                    }
                }
            });
        }

        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            console.log(`\n⚠️ Conexão encerrada. Código: ${reason}`);

        } else if (connection === 'open') {
            console.log('\n✅✅✅ WHATSAPP CONECTADO COM SUCESSO! ✅✅✅');
            console.log(`   JID: ${sock.user?.id}`);
            console.log('\n⏳ ATENÇÃO: NÃO feche este terminal ainda!');
            console.log('   O WhatsApp está sincronizando seus contactos...');
            console.log('   Aguarde o número de contactos PARAR DE CRESCER,');
            console.log('   depois pode fechar e iniciar o bot principal.\n');

            // Limpa o QR code após conectar
            const qrPath = path.join(__dirname, 'qr_code.png');
            if (fs.existsSync(qrPath)) {
                fs.unlinkSync(qrPath);
                console.log('[LIMPEZA] qr_code.png removido.');
            }
        }
    });
}

start().catch(err => {
    console.error('Erro fatal:', err);
    process.exit(1);
});
