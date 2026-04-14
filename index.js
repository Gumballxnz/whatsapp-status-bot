const { 
    makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion,
    generateForwardMessageContent,
    prepareWAMessageMedia
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const cron = require('node-cron');
const moment = require('moment-timezone');
const fs = require('fs');
const path = require('path');

const SESSION_PATH = path.join(__dirname, 'session');
const VIDEO_PATH = path.join(__dirname, 'video.mp4');
const TIMEZONE = 'Africa/Maputo';
const START_DATE = '2026-01-01';

// JID fixo do dono para garantir que ele SEMPRE receba nos status
const OWNER_JID = '258879116693@s.whatsapp.net';

function calculateDay() {
    const start = moment.tz(START_DATE, TIMEZONE).startOf('day');
    const today = moment.tz(TIMEZONE).startOf('day');
    return today.diff(start, 'days') + 1;
}

const QRCode = require('qrcode');

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: true,
        browser: ['Status Bot', 'Chrome', '1.0.0'],
        syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('📌 NOVO QR CODE GERADO! Salvando imagem...');
            try {
                await QRCode.toFile(path.join(__dirname, 'qrcode.png'), qr);
                console.log('✅ QR Code salvo em qrcode.png');
            } catch (err) {
                console.error('❌ Erro ao salvar QR PNG:', err);
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect.error?.output?.statusCode;
            console.log(`Conexão fechada (Status: ${statusCode}). Reconectando...`);
            connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('✅ BOT ONLINE E CONECTADO!');
            // Deleta o QR após conectar para não confundir
            if (fs.existsSync(path.join(__dirname, 'qrcode.png'))) {
                fs.unlinkSync(path.join(__dirname, 'qrcode.png'));
            }
            setupCron(sock);
        }
    });
}

function setupCron(sock) {
    if (global.cronSet) return;
    global.cronSet = true;

    console.log('⏰ Cron Diário configurado para 00:00');
    
    cron.schedule('0 0 * * *', () => {
        postStatus(sock);
    }, { scheduled: true, timezone: TIMEZONE });

    // Teste imediato ao ligar para confirmar se desta vez aparece
    setTimeout(() => postStatus(sock, true), 5000);
}

async function postStatus(sock, isTest = false) {
    try {
        if (!fs.existsSync(VIDEO_PATH)) return console.error('Vídeo não encontrado');
        
        const dayNumber = calculateDay();
        const caption = isTest ? `DAY ${dayNumber} (TESTE FINAL)` : `DAY ${dayNumber}`;

        console.log(`🚀 Tentando postar Vídeo Status: ${caption}`);

        // O SEGREDO: Enviamos SEM lista de JIDs primeiro (Broadcast Universal) 
        // ou com uma lista MUITO curta no início
        await sock.sendMessage('status@broadcast', {
            video: fs.readFileSync(VIDEO_PATH),
            caption: caption,
            mimetype: 'video/mp4'
        }, {
            // Se o broadcast@status estiver bugando, usamos a lista direta
            statusJidList: [sock.user.id.split(':')[0] + '@s.whatsapp.net', OWNER_JID],
            broadcast: true
        });

        console.log('✅ Comando enviado para o WhatsApp!');
    } catch (err) {
        console.error('❌ Erro na postagem:', err);
    }
}

connectToWhatsApp();
