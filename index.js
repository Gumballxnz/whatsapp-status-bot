const {
    makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    Browsers,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const env = require('./src/config/env');
const { startScheduler, triggerDailyStatus } = require('./src/services/scheduler');

const QR_FILE = path.join(__dirname, 'qrcode.png');
let activeSocket = null;
let schedulerStarted = false;
let pairingRequested = false;

async function startWhatsAppBot() {
    const { state, saveCreds } = await useMultiFileAuthState(env.SESSION_PATH);
    const { version, isLatest } = await fetchLatestBaileysVersion();

    console.log(`[Baileys] Versão: ${version.join('.')} (Mais recente: ${isLatest})`);

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
        },
        browser: Browsers.ubuntu('Chrome'),
        printQRInTerminal: !env.BOT_NUMBER,
        syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && !env.BOT_NUMBER) {
            console.log('[Auth] Novo QR Code gerado.');
            try {
                await QRCode.toFile(QR_FILE, qr, { width: 400 });
                console.log(`[Auth] QR Code salvo em: ${QR_FILE}`);
                if (process.platform === 'win32') {
                    exec(`start "" "${QR_FILE}"`);
                }
            } catch (err) {
                console.error('[Auth] Erro ao salvar imagem do QR Code:', err.message);
            }
        }

        if (connection === 'close') {
            activeSocket = null;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.warn(`[Conexão] Conexão encerrada. Código de status: ${statusCode}`);

            if (statusCode === DisconnectReason.loggedOut) {
                console.warn('[Conexão] Sessão finalizada pelo WhatsApp. Removendo dados de sessão...');
                if (fs.existsSync(env.SESSION_PATH)) {
                    fs.rmSync(env.SESSION_PATH, { recursive: true, force: true });
                }
                pairingRequested = false;
                console.log('[Conexão] Reiniciando para nova autenticação...');
                setTimeout(startWhatsAppBot, 2000);
            } else if (statusCode === 515 || statusCode === DisconnectReason.restartRequired) {
                console.log('🔄 WhatsApp confirmou o pareamento! Finalizando chaves...');
                setTimeout(startWhatsAppBot, 1500);
            } else {
                console.log('[Conexão] Reconectando em 3 segundos...');
                setTimeout(startWhatsAppBot, 3000);
            }
        } else if (connection === 'open') {
            console.log('=============================================');
            console.log('✅ WHATSAPP CONECTADO COM SUCESSO!');
            console.log(`📱 JID Conectado: ${sock.user?.id}`);
            console.log('=============================================');

            activeSocket = sock;

            if (fs.existsSync(QR_FILE)) {
                fs.unlinkSync(QR_FILE);
            }

            if (!schedulerStarted) {
                startScheduler(() => activeSocket);
                schedulerStarted = true;
            }

            setTimeout(() => {
                if (activeSocket) {
                    triggerDailyStatus(activeSocket, true);
                }
            }, 5000);
        }
    });

    if (!sock.authState.creds.registered && env.BOT_NUMBER && !pairingRequested) {
        pairingRequested = true;
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(env.BOT_NUMBER);
                code = code?.match(/.{1,4}/g)?.join('-') || code;
                console.log('\n========================================');
                console.log(`📱 NÚMERO DO BOT: +${env.BOT_NUMBER}`);
                console.log(`🔑 CÓDIGO DE PAREAMENTO: ${code}`);
                console.log('👉 No WhatsApp: Aparelhos conectados > Conectar um aparelho > Conectar com número de telefone');
                console.log('========================================\n');
            } catch (err) {
                console.error('[Pairing] Erro ao solicitar código de pareamento:', err.message);
            }
        }, 3000);
    }
}

startWhatsAppBot();
