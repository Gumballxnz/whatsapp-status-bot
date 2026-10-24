const cron = require('node-cron');
const moment = require('moment-timezone');
const env = require('../config/env');
const { fetchGoogleContacts } = require('./googleContacts');
const { postMediaFileStatus } = require('./statusPoster');

let activeCronJob = null;

function calculateCurrentDay() {
    const start = moment.tz(env.START_DATE, env.TIMEZONE).startOf('day');
    const today = moment.tz(env.TIMEZONE).startOf('day');
    return today.diff(start, 'days') + 1;
}

async function triggerDailyStatus(getSocket, isTest = false) {
    const sock = typeof getSocket === 'function' ? getSocket() : getSocket;

    if (!sock?.user) {
        console.error('[Scheduler] Não foi possível postar: Socket do WhatsApp não está conectado.');
        return;
    }

    try {
        const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
        const recipients = await fetchGoogleContacts([botJid]);

        if (recipients.length === 0) {
            console.warn('[Scheduler] Nenhum destinatário válido disponível para envio.');
            return;
        }

        const dayNumber = calculateCurrentDay();
        const caption = isTest ? `DAY ${dayNumber} (TESTE)` : `DAY ${dayNumber}`;

        console.log(`[Scheduler] Disparando status: "${caption}" para ${recipients.length} destinatário(s)...`);
        await postMediaFileStatus(sock, env.MEDIA_PATH, caption, recipients);
        console.log('[Scheduler] Status diário postado com sucesso no WhatsApp!');
    } catch (error) {
        console.error('[Scheduler] Falha na execução do envio de status:', error.message || error);
    }
}

function startScheduler(getSocket) {
    if (activeCronJob) {
        activeCronJob.stop();
    }

    console.log(`[Scheduler] Agendamento ativo: "${env.STATUS_CRON}" (Fuso: ${env.TIMEZONE})`);

    activeCronJob = cron.schedule(
        env.STATUS_CRON,
        async () => {
            await triggerDailyStatus(getSocket, false);
        },
        {
            scheduled: true,
            timezone: env.TIMEZONE
        }
    );

    return activeCronJob;
}

module.exports = {
    startScheduler,
    triggerDailyStatus,
    calculateCurrentDay
};
