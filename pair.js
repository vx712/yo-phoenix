const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeInMemoryStore,
    DisconnectReason,
    Browsers
} = require("@whiskeysockets/baileys");
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { Boom } = require('@hapi/boom');

const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) });

async function startpairing(kingbadboiNumber) {
    const sessionPath = `./kingbadboitimewisher/pairing/${kingbadboiNumber}`;
    if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });
    
    // Completely wipe old pairing data for this attempt
    const pairingFile = './kingbadboitimewisher/pairing/pairing.json';
    if (fs.existsSync(pairingFile)) fs.unlinkSync(pairingFile);

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    const bad = makeWASocket({
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
        auth: state,
        version,
        // Using a verified Windows Chrome identity
        browser: Browsers.macOS("Chrome"),
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
    });

    if (store) store.bind(bad.ev);

    if (!state.creds.registered) {
        let phoneNumber = kingbadboiNumber.replace(/[^0-9]/g, '');
        
        setTimeout(async () => {
            try {
                // Request code with a simple name to avoid handshake errors
                let code = await bad.requestPairingCode(phoneNumber, 'PHOENIXX');
                // Ensure it's exactly the 8-character code WhatsApp expects
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                
                console.log(chalk.green(`📱 Code for ${phoneNumber}: ${code}`));

                fs.writeFileSync(
                    pairingFile,
                    JSON.stringify({ number: kingbadboiNumber, code: code, timestamp: new Date().toISOString() }, null, 2),
                    'utf8'
                );
            } catch (err) {
                console.log(chalk.red(`❌ Error: ${err.message}`));
                fs.writeFileSync(pairingFile, JSON.stringify({ error: err.message, timestamp: new Date().toISOString() }, null, 2), 'utf8');
            }
        }, 5000);
    }

    bad.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
            let reason = new Boom(lastDisconnect?.error)?.output.statusCode;
            if (reason === DisconnectReason.loggedOut || reason === 401) {
                if (fs.existsSync(sessionPath)) fs.rmSync(sessionPath, { recursive: true, force: true });
            } else {
                setTimeout(() => startpairing(kingbadboiNumber), 5000);
            }
        } else if (connection === "open") {
            console.log(chalk.green(`✅ Connected: ${kingbadboiNumber}`));
            try {
                await bad.sendMessage(bad.user.id, { text: "✅ *PHOENIXX MD CONNECTED!*" });
            } catch (e) {}
        }
    });

    bad.ev.on('messages.upsert', async chatUpdate => {
        try {
            let m = chatUpdate.messages[0];
            if (!m.message || (m.key && m.key.remoteJid === 'status@broadcast')) return;
            m.message = (Object.keys(m.message)[0] === 'ephemeralMessage') ? m.message.ephemeralMessage.message : m.message;
            
            // Minimal message processing to keep connection stable
            const drenox = require("./drenox");
            // Simple JID decoder
            bad.decodeJid = (jid) => {
                if (!jid) return jid;
                return /:\d+@/gi.test(jid) ? (jid.split('@')[0].split(':')[0] + '@' + jid.split('@')[1]) : jid;
            };
            // Mock smsg for drenox
            const msg = {
                ...m,
                chat: m.key.remoteJid,
                fromMe: m.key.fromMe,
                sender: bad.decodeJid(m.key.participant || m.key.remoteJid),
                body: m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || m.message.videoMessage?.caption || '',
                reply: (text) => bad.sendMessage(m.key.remoteJid, { text: text }, { quoted: m })
            };
            drenox(bad, msg, chatUpdate, store);
        } catch (err) {}
    });

    bad.ev.on('creds.update', saveCreds);
    return bad;
}

module.exports = startpairing;
