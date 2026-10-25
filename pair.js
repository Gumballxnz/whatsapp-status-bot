const baileys = require('baileys');
const makeWASocket = baileys.default || baileys.makeWASocket || baileys;
const {
    Browsers,
    DisconnectReason,
    fetchLatestBaileysVersion,
    useMultiFileAuthState
} = baileys;
const pino = require('pino');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const SESSION_PATH = path.join(__dirname, 'session');

const targetNumber = (
    process.argv[2] ||
    process.env.BOT_NUMBER ||
    process.env.PAIRING_NUMBER ||
    process.env.OWNER_NUMBER ||
    ''
).replace(/\D/g, '');

if (!targetNumber) {
    console.error('❌ Nenhum número informado!');
    console.error('👉 Uso: node pair.js <DDI+DDD+NUMERO>');
    console.error('   Exemplo: node pair.js 258XXXXXXXXX');
    process.exit(1);
}

function hasValidSession() {
    try {
        const credsPath = path.join(SESSION_PATH, 'creds.json');
        if (!fs.existsSync(credsPath)) return false;
        const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
        return !!(creds.me && creds.me.id);
    } catch {
        return false;
    }
}

let isConnected = false;
let pairingRequested = false;

async function startPairing() {
    if (isConnected) return;

    if (!fs.existsSync(SESSION_PATH)) {
        fs.mkdirSync(SESSION_PATH, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);

    let version;
    try {
        const fetched = await fetchLatestBaileysVersion();
        version = fetched.version;
    } catch (e) {
        version = [2, 3000, 1044006379];
    }

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        syncFullHistory: false,
        markOnlineOnConnect: true,
        browser: Browsers.ubuntu('Chrome')
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            if (hasValidSession()) return;

            pairingRequested = true;
            try {
                let code = await sock.requestPairingCode(targetNumber);
                code = code?.match(/.{1,4}/g)?.join('-') || code;
                console.log('\n========================================');
                console.log(`📱 NÚMERO ALVO: +${targetNumber}`);
                console.log(`🔑 CÓDIGO DE PAREAMENTO: ${code}`);
                console.log('👉 No WhatsApp do celular:');
                console.log('   Aparelhos conectados > Conectar um aparelho > Conectar com número de telefone');
                console.log('========================================\n');
            } catch (err) {
                console.error('❌ Erro ao solicitar código:', err.message);
            }
        }

        if (connection === 'open') {
            isConnected = true;
            console.log('\n==================================================');
            console.log('🎉 WHATSAPP CONECTADO COM SUCESSO!');
            console.log(`📱 JID Conectado: ${sock.user?.id}`);
            console.log('==================================================\n');

            setTimeout(() => {
                console.log('✅ Sessão salva em ./session com sucesso!');
                process.exit(0);
            }, 3000);
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode === DisconnectReason.loggedOut) {
                console.log('❌ Sessão desconectada. Limpando credenciais...');
                fs.rmSync(SESSION_PATH, { recursive: true, force: true });
                process.exit(1);
            } else if (!isConnected) {
                pairingRequested = false;
                setTimeout(startPairing, 2000);
            }
        }
    });
}

startPairing();
