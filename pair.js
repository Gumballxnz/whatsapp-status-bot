const {
    makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    Browsers,
    DisconnectReason
} = require('@whiskeysockets/baileys');
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

function cleanSession() {
    try {
        if (fs.existsSync(SESSION_PATH)) {
            const files = fs.readdirSync(SESSION_PATH);
            for (const file of files) {
                fs.unlinkSync(path.join(SESSION_PATH, file));
            }
        } else {
            fs.mkdirSync(SESSION_PATH, { recursive: true });
        }
    } catch (e) {
        // Ignora erros de limpeza inicial
    }
}

cleanSession();

let isConnected = false;
let isPairingCompleted = false;

async function startPairingLoop() {
    if (isConnected) return;

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        version,
        browser: Browsers.ubuntu('Chrome'),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
        },
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: false,
        syncFullHistory: false,
        defaultQueryTimeoutMs: 120000,
        connectTimeoutMs: 60000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (!isConnected) {
                if (statusCode === 515 || statusCode === DisconnectReason.restartRequired) {
                    isPairingCompleted = true;
                    console.log('\n🔄 WhatsApp confirmou o pareamento! Finalizando chaves...');
                    setTimeout(startPairingLoop, 1500);
                } else {
                    console.log(`\n⏳ Conexão reiniciada (${statusCode || 'timeout'})...`);
                    if (!isPairingCompleted) cleanSession();
                    setTimeout(startPairingLoop, 2000);
                }
            }
        }

        if (connection === 'open') {
            isConnected = true;
            console.log('\n==================================================');
            console.log('🎉 BOT CONECTADO COM SUCESSO AO WHATSAPP!');
            console.log(`📱 JID Conectado: ${sock.user?.id}`);
            console.log('⏳ Gravando chaves de segurança no disco...');
            console.log('==================================================\n');

            setTimeout(() => {
                console.log('✅ Sessão gravada com sucesso em ./session');
                console.log('▶ Inicie o bot no PM2: pm2 start ecosystem.config.cjs');
                process.exit(0);
            }, 6000);
        }
    });

    if (!sock.authState.creds.registered && !isPairingCompleted) {
        setTimeout(async () => {
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
                console.error('❌ Erro ao solicitar código de pareamento:', err.message);
            }
        }, 3000);
    }
}

startPairingLoop();
