const {
    default: makeWASocket,
    jidDecode,
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeInMemoryStore,
    proto
} = require("@whiskeysockets/baileys");
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { Boom } = require('@hapi/boom');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) });

function ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

async function startpairing(kingbadboiNumber) {
    const sessionPath = `./kingbadboitimewisher/pairing/${kingbadboiNumber}`;
    ensureDirectoryExists(sessionPath);
    
    // Clear old session data to prevent "Check phone number" error
    const pairingFile = './kingbadboitimewisher/pairing/pairing.json';
    if (fs.existsSync(pairingFile)) {
        try {
            fs.unlinkSync(pairingFile);
        } catch (e) {}
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    const bad = makeWASocket({
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
        auth: state,
        version,
        // Using a very simple browser identity to bypass strict checks
        browser: ["PHOENIXX", "Chrome", "1.0.0"],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
        emitOwnEvents: true,
        fireInitQueries: true,
        generateHighQualityLinkPreview: true,
        syncFullHistory: true,
        markOnlineOnConnect: true,
    });

    if (store) store.bind(bad.ev);

    // PAIRING CODE LOGIC
    if (!state.creds.registered) {
        let phoneNumber = kingbadboiNumber.replace(/[^0-9]/g, '');
        
        // Wait 5 seconds for connection stability
        setTimeout(async () => {
            try {
                console.log(chalk.blue(`📡 Requesting code for ${phoneNumber}...`));
                let code = await bad.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                
                console.log(chalk.bgGreen.black(`📱 Code for ${kingbadboiNumber}: ${chalk.white.bold(code)}`));

                const pairingData = { 
                    number: kingbadboiNumber,
                    code: code,
                    timestamp: new Date().toISOString()
                };
                
                fs.writeFileSync(
                    './kingbadboitimewisher/pairing/pairing.json',
                    JSON.stringify(pairingData, null, 2),
                    'utf8'
                );
            } catch (err) {
                console.log(chalk.red(`❌ Pairing Error: ${err.message}`));
                try {
                    fs.writeFileSync(
                        './kingbadboitimewisher/pairing/pairing.json',
                        JSON.stringify({ error: err.message, timestamp: new Date().toISOString() }, null, 2),
                        'utf8'
                    );
                } catch (e) {}
            }
        }, 5000);
    }

    // CONNECTION HANDLER
    bad.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "close") {
            let reason = new Boom(lastDisconnect?.error)?.output.statusCode;
            if (reason === DisconnectReason.loggedOut || reason === 401 || reason === 405) {
                if (fs.existsSync(sessionPath)) {
                    fs.rmSync(sessionPath, { recursive: true, force: true });
                }
                console.log(chalk.red(`❌ Session logged out for ${kingbadboiNumber}`));
            } else {
                console.log(chalk.yellow(`🔄 Reconnecting ${kingbadboiNumber}...`));
                setTimeout(() => startpairing(kingbadboiNumber), 3000);
            }
        } else if (connection === "open") {
            console.log(chalk.bgGreen.black(`✅ Connected: ${kingbadboiNumber}`));
            
            // Keep-alive presence
            setInterval(async () => {
                try {
                    if (bad.ws?.readyState === 1) await bad.sendPresenceUpdate('available');
                } catch (e) {}
            }, 30000);

            // Notify user
            try {
                await bad.sendMessage(bad.user.id, { text: "🎉 *PHOENIXX MD CONNECTED SUCCESSFULLY!*" });
            } catch (e) {}
        }
    });

    // MESSAGE HANDLER
    bad.ev.on('messages.upsert', async chatUpdate => {
        try {
            let m = chatUpdate.messages[0];
            if (!m.message || (m.key && m.key.remoteJid === 'status@broadcast')) return;
            m.message = (Object.keys(m.message)[0] === 'ephemeralMessage') ? m.message.ephemeralMessage.message : m.message;
            
            const message = smsg(bad, m, store);
            require("./drenox")(bad, message, chatUpdate, store);
        } catch (err) {}
    });

    bad.ev.on('creds.update', saveCreds);

    // HELPER: DECODE JID
    bad.decodeJid = (jid) => {
        if (!jid) return jid;
        if (/:\d+@/gi.test(jid)) {
            let decode = jidDecode(jid) || {};
            return decode.user && decode.server && `${decode.user}@${decode.server}` || jid;
        } else {
            return jid;
        }
    };

    return bad;
}

// SMSG FUNCTION
function smsg(bad, m, store) {
    if (!m) return m;
    let M = proto.WebMessageInfo;
    if (m.key) {
        m.id = m.key.id;
        m.chat = m.key.remoteJid;
        m.fromMe = m.key.fromMe;
        m.isGroup = m.chat.endsWith('@g.us');
        m.sender = bad.decodeJid(m.fromMe && bad.user.id || m.participant || m.key.participant || m.chat || '');
    }
    if (m.message) {
        const getContentType = (msg) => {
            if (!msg) return undefined;
            const keys = Object.keys(msg);
            return keys.find(k => k !== 'messageContextInfo' && k !== 'senderKeyDistributionMessage');
        };
        m.mtype = getContentType(m.message);
        m.msg = (m.mtype == 'viewOnceMessage' ? m.message[m.mtype].message[getContentType(m.message[m.mtype].message)] : m.message[m.mtype]);
        m.body = m.message.conversation || m.msg.caption || m.msg.text || '';
    }
    m.reply = (text) => bad.sendMessage(m.chat, { text: text }, { quoted: m });
    return m;
}

module.exports = startpairing;
