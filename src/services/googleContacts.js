const { google } = require('googleapis');
const env = require('../config/env');

function getOAuth2Client() {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN) {
        throw new Error('Credenciais da Google API incompletas em .env (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN).');
    }

    const oauth2Client = new google.auth.OAuth2(
        env.GOOGLE_CLIENT_ID,
        env.GOOGLE_CLIENT_SECRET
    );

    oauth2Client.setCredentials({
        refresh_token: env.GOOGLE_REFRESH_TOKEN
    });

    return oauth2Client;
}

function sanitizePhoneNumber(rawNumber) {
    if (!rawNumber || typeof rawNumber !== 'string') return null;

    const digitsOnly = rawNumber.replace(/\D/g, '');
    if (digitsOnly.length < 8 || digitsOnly.length > 15) {
        return null;
    }

    return `${digitsOnly}@s.whatsapp.net`;
}

async function fetchGoogleContacts(extraJids = []) {
    const jidSet = new Set();

    if (env.OWNER_NUMBER) {
        jidSet.add(`${env.OWNER_NUMBER}@s.whatsapp.net`);
    }

    for (const jid of extraJids) {
        if (jid && typeof jid === 'string' && jid.endsWith('@s.whatsapp.net')) {
            jidSet.add(jid);
        }
    }

    let googleContactsCount = 0;

    try {
        const auth = getOAuth2Client();
        const people = google.people({ version: 'v1', auth });

        let pageToken = undefined;

        do {
            const response = await people.people.connections.list({
                resourceName: 'people/me',
                pageSize: 1000,
                personFields: 'phoneNumbers',
                pageToken
            });

            const connections = response.data.connections || [];

            for (const person of connections) {
                const phoneNumbers = person.phoneNumbers || [];
                for (const phone of phoneNumbers) {
                    const sanitizedJid = sanitizePhoneNumber(phone.value);
                    if (sanitizedJid) {
                        jidSet.add(sanitizedJid);
                        googleContactsCount++;
                    }
                }
            }

            pageToken = response.data.nextPageToken;
        } while (pageToken);

        console.log(`[Google Contacts] Recuperados ${googleContactsCount} contatos válidos da conta Google.`);
    } catch (error) {
        console.error('[Google Contacts] Erro ao sincronizar contatos do Google:', error.message || error);
    }

    const uniqueJids = [...jidSet];
    console.log(`[Google Contacts] Total de destinatários configurados para o status: ${uniqueJids.length}`);
    return uniqueJids;
}

module.exports = {
    fetchGoogleContacts,
    sanitizePhoneNumber
};
