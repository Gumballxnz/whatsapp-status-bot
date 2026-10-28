const baileys = require('baileys');
const makeWASocket = baileys.default || baileys.makeWASocket || baileys;
const {
    Browsers,
    DisconnectReason,
    fetchLatestBaileysVersion,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore
} = baileys;
const pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const env = require('./src/config/env');
const { startScheduler, triggerDailyStatus, hasPostedToday } = require('./src/services/scheduler');

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

function startPresenceKeepAlive(sock) {
    if (presenceInterval) {
        clearInterval(presenceInterval);
        presenceInterval = null;
    }

    sock.sendPresenceUpdate('available').catch(() => {});

    // Envia sinal a cada 25 segundos para manter a conexão WebSocket viva com o WhatsApp
    presenceInterval = setInterval(() => {
        if (activeSocket?.user) {
            activeSocket.sendPresenceUpdate('available').catch(() => {});
        }
    }, 25000);

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
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
        },
        browser: Browsers.ubuntu('Chrome'),
        printQRInTerminal: !env.BOT_NUMBER,
        syncFullHistory: false,
        markOnlineOnConnect: true,
        keepAliveIntervalMs: 25000,
        defaultQueryTimeoutMs: 180000,
        connectTimeoutMs: 60000
    });

    sock.ev.on('creds.update', saveCreds);

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
            if (presenceInterval) {
                clearInterval(presenceInterval);
                presenceInterval = null;
            }

            try {
                sock.end?.(undefined);
            } catch (e) {}

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
            } else {
                pairingRequested = false;
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

            startPresenceKeepAlive(sock);

            if (!schedulerStarted) {
                startScheduler(() => activeSocket);
                schedulerStarted = true;
            }

            // Verifica se o status de hoje ainda não foi postado (ex: horário passou enquanto offline)
            setTimeout(async () => {
                if (activeSocket?.user && !hasPostedToday()) {
                    console.log('[Scheduler] Nenhuma postagem registrada para hoje. Disparando status pendente...');
                    await triggerDailyStatus(() => activeSocket, false);
                }
            }, 5000);
        }
    });
}

startWhatsAppBot();
