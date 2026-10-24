const fs = require('fs');
const path = require('path');

async function postVideoStatus(sock, videoBuffer, caption, jidList) {
    return await sock.sendMessage(
        'status@broadcast',
        { video: videoBuffer, mimetype: 'video/mp4', caption: caption || '' },
        { statusJidList: jidList, broadcast: true }
    );
}

async function postImageStatus(sock, imageBuffer, caption, jidList) {
    return await sock.sendMessage(
        'status@broadcast',
        { image: imageBuffer, mimetype: 'image/jpeg', caption: caption || '' },
        { statusJidList: jidList, broadcast: true }
    );
}

async function postTextStatus(sock, text, jidList) {
    return await sock.sendMessage(
        'status@broadcast',
        { text: text },
        { statusJidList: jidList, broadcast: true }
    );
}

async function postMediaFileStatus(sock, filePath, caption, jidList) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Arquivo de mídia não encontrado: ${filePath}`);
    }

    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.mp4') {
        return await postVideoStatus(sock, buffer, caption, jidList);
    }

    if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
        return await postImageStatus(sock, buffer, caption, jidList);
    }

    throw new Error(`Formato de mídia não suportado para status: ${ext}`);
}

module.exports = {
    postVideoStatus,
    postImageStatus,
    postTextStatus,
    postMediaFileStatus
};
