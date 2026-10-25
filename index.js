const baileys = require('baileys');
const makeWASocket = baileys.default || baileys.makeWASocket || baileys;
const {
    Browsers,
    DisconnectReason,
    fetchLatestBaileysVersion,
    useMultiFileAuthState
} = baileys;
const pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const env = require('./src/config/env');
const { startScheduler } = require('./src/services/scheduler');

const QR_FILE = path.join(__dirname, 'qrcode.png');
let activeSocket = null;
let schedulerStarted = false;
let pairingRequested = false;
let presenceInterval = null;

function hasValidSession() {
    try {
        const credsPath = path.join(env.SESSION_PATH, 'creds.json');
        if (!fs.existsSync(credsPath)) return false;
        const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
        return !!(creds.me && creds.me.id);
    } catch {
        return false;
    }
}

function startAlwaysOnlinePresence(sock) {
    sock.sendPresenceUpdate('available').catch(() => {});

    if (presenceInterval) {
        clearInterval(presenceInterval);
    }

    // Mantém presença "Online" ativa a cada 20 segundos
    presenceInterval = setInterval(() => {
        if (activeSocket) {
            activeSocket.sendPresenceUpdate('available').catch(() => {});
        }
    }, 20000);

    presenceInterval.unref?.();
}

async function startWhatsAppBot() {
    if (!fs.existsSync(env.SESSION_PATH)) {
        fs.mkdirSync(env.SESSION_PATH, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(env.SESSION_PATH);

    let version;
    try {
        const fetched = await fetchLatestBaileysVersion();
        version = fetched.version;
    } catch (e) {
        version = [2, 3000, 1044006379];
    }

    console.log(`[Baileys] Versão: ${version.join('.')}`);

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: state,
        browser: Browsers.ubuntu('Chrome'),
        printQRInTerminal: !env.BOT_NUMBER,
        syncFullHistory: false,
        markOnlineOnConnect: true
    });

    sock.ev.on('creds.update', saveCreds);

    // Confirma entrega (2 tracinhos cinzas) automaticamente para todas as mensagens recebidas
    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const m of messages) {
            if (!m.key?.fromMe && m.key?.remoteJid && m.key?.id) {
                try {
                    await sock.sendReceipt(m.key.remoteJid, m.key.participant, [m.key.id], 'delivery');
                } catch (e) {
                    // Silencia erros de recibo se houver
                }
            }
        }
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && !hasValidSession()) {
            if (env.BOT_NUMBER) {
                pairingRequested = true;
                try {
                    let code = await sock.requestPairingCode(env.BOT_NUMBER);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    console.log('\n========================================');
                    console.log(`📱 NÚMERO DO BOT: +${env.BOT_NUMBER}`);
                    console.log(`🔑 CÓDIGO DE PAREAMENTO: ${code}`);
                    console.log('👉 No WhatsApp: Aparelhos conectados > Conectar um aparelho > Conectar com número de telefone');
                    console.log('========================================\n');
                } catch (err) {
                    console.error('[Pairing] Erro ao gerar código:', err.message);
                }
            } else {
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
        }

        if (connection === 'close') {
            activeSocket = null;
            if (presenceInterval) {
                clearInterval(presenceInterval);
                presenceInterval = null;
            }

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
            } else {
                pairingRequested = false;
                console.log('[Conexão] Reconectando em 3 segundos...');
                setTimeout(startWhatsAppBot, 3000);
            }
        } else if (connection === 'open') {
            console.log('=============================================');
            console.log('✅ WHATSAPP CONECTADO COM SUCESSO!');
            console.log(`📱 JID Conectado: ${sock.user?.id}`);
            console.log('🟢 MODO SEMPRE ONLINE ATIVO (Heartbeat 20s)');
            console.log('✔️✔️ CONFIRMAÇÃO DE ENTREGA (2 CERTOS) ATIVA');
            console.log('=============================================');

            activeSocket = sock;

            if (fs.existsSync(QR_FILE)) {
                fs.unlinkSync(QR_FILE);
            }

            startAlwaysOnlinePresence(sock);

            if (!schedulerStarted) {
                startScheduler(() => activeSocket);
                schedulerStarted = true;
            }
        }
    });
}

startWhatsAppBot();
