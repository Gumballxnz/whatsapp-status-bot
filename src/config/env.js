const path = require('path');
require('dotenv').config();

module.exports = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
    GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN || '',
    OWNER_NUMBER: (process.env.OWNER_NUMBER || '258XXXXXXXXX').replace(/\D/g, ''),
    STATUS_CRON: process.env.STATUS_CRON || '0 9 * * *',
    TIMEZONE: process.env.TIMEZONE || 'Africa/Maputo',
    START_DATE: process.env.START_DATE || '2026-01-01',
    MEDIA_PATH: process.env.MEDIA_PATH ? path.resolve(process.env.MEDIA_PATH) : path.join(__dirname, '../../video.mp4'),
    SESSION_PATH: path.join(__dirname, '../../session')
};
