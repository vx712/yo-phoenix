const {
    default: makeWASocket,
    jidDecode,
    DisconnectReason,
    PHONENUMBER_MCC,
    makeCacheableSignalKeyStore,
    useMultiFileAuthState,
    Browsers,
    getContentType,
    proto,
    downloadContentFromMessage,
    fetchLatestBaileysVersion,
    makeInMemoryStore,
    generateWAMessageContent  
} = require("@whiskeysockets/baileys");
const handleMessage = require("./drenox");
const NodeCache = require("node-cache");
const _ = require('lodash')
const {
    Boom
} = require('@hapi/boom')
const PhoneNumber = require('awesome-phonenumber')
let phoneNumber = "923104609886";
const pairingCode = !!phoneNumber || process.argv.includes("--pairing-code");
const useMobile = process.argv.includes("--mobile");
const readline = require("readline");
const pino = require('pino')
const FileType = require('file-type')
const fs = require('fs')
const path = require('path')
let themeemoji = "😎";
const chalk = require('chalk')
const { writeExif, imageToWebp, videoToWebp, writeExifImg, writeExifVid } = require('./allfunc/exif');
const { isUrl, generateMessageTag, getBuffer, getSizeMedia, fetch } = require('./allfunc/myfunc')
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const store = makeInMemoryStore ? makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) }) : null;

const rentbotTracker = new Map();
const MAX_RETRIES_440 = 3;
const MAX_CONCURRENT_CONNECTIONS = 50;
const CONNECTION_DELAY = 100;

const connectionQueue = [];
let activeConnections = 0;

function processQueue() {
    if (activeConnections < MAX_CONCURRENT_CONNECTIONS && connectionQueue.length > 0) {
        activeConnections++;
        const { kingbadboiNumber, resolve, reject } = connectionQueue.shift();
        
        startpairing(kingbadboiNumber)
            .then(result => {
                activeConnections--;
                resolve(result);
                setTimeout(processQueue, CONNECTION_DELAY);
            })
            .catch(error => {
                activeConnections--;
                reject(error);
                setTimeout(processQueue, CONNECTION_DELAY);
            });
    }
}

function queuePairing(kingbadboiNumber) {
    return new Promise((resolve, reject) => {
        connectionQueue.push({ kingbadboiNumber, resolve, reject });
        processQueue();
    });
}

function deleteFolderRecursive(folderPath) {
    if (fs.existsSync(folderPath)) {
        fs.readdirSync(folderPath).forEach(file => {
            const curPath = path.join(folderPath, file);
            if (fs.lstatSync(curPath).isDirectory()) {
                deleteFolderRecursive(curPath);
            } else {
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(folderPath);
    }
}

async function validateSession(kingbadboiNumber) {
    const sessionPath = `./kingbadboitimewisher/pairing/${kingbadboiNumber}`;
    const credsPath = path.join(sessionPath, 'creds.json');
    if (!fs.existsSync(credsPath)) return false;
    try {
        const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
        if (!creds.me || !creds.me.id) {
            deleteFolderRecursive(sessionPath);
            return false;
        }
        return true;
    } catch (e) {
        deleteFolderRecursive(sessionPath);
        return false;
    }
}

function forceCleanupSession(kingbadboiNumber) {
    const sessionPath = `./kingbadboitimewisher/pairing/${kingbadboiNumber}`;
    try {
        if (fs.existsSync(sessionPath)) deleteFolderRecursive(sessionPath);
        if (rentbotTracker.has(kingbadboiNumber)) {
            const tracker = rentbotTracker.get(kingbadboiNumber);
            if (tracker.connection) {
                try {
                    tracker.connection.end();
                    tracker.connection.ws?.close();
                } catch (e) {}
            }
            rentbotTracker.delete(kingbadboiNumber);
        }
        return true;
    } catch (e) {
        return false;
    }
}

function ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

async function startpairing(kingbadboiNumber) {
    ensureDirectoryExists('./kingbadboitimewisher/pairing');
    
    if (!rentbotTracker.has(kingbadboiNumber)) {
        rentbotTracker.set(kingbadboiNumber, {
            connection: null,
            retryCount: 0,
            disconnected: false,
            lastActivity: Date.now()
        });
    }
    
    const tracker = rentbotTracker.get(kingbadboiNumber);
    tracker.retryCount++;
    tracker.disconnected = false;
    tracker.lastActivity = Date.now();

    const { version } = await fetchLatestBaileysVersion();
    
    const sessionPath = `./kingbadboitimewisher/pairing/${kingbadboiNumber}`;
    ensureDirectoryExists(sessionPath);
    
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    const bad = makeWASocket({
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
        auth: state,
        version,
        browser: Browsers.macOS("Chrome"),
        getMessage: async key => {
            if (!store) return { conversation: '' };
            const jid = key.remoteJid;
            const msg = await store.loadMessage(jid, key.id);
            return msg?.message || '';
        },
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
        emitOwnEvents: true,
        fireInitQueries: true,
        generateHighQualityLinkPreview: true,
        syncFullHistory: true,
        markOnlineOnConnect: true,
    })
    
    tracker.connection = bad;
    if (store) store.bind(bad.ev);

    if (pairingCode && !state.creds.registered) {
        let phoneNumber = kingbadboiNumber.replace(/[^0-9]/g, '');
        setTimeout(async () => {
            try {
                console.log(chalk.blue(`📡 Requesting pairing code for ${phoneNumber}...`));
                let code = await bad.requestPairingCode(phoneNumber, 'PHOENIXX');
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(chalk.bgGreen.black(`📱 Pairing code for ${kingbadboiNumber}: ${chalk.white.bold(code)}`));
                ensureDirectoryExists('./kingbadboitimewisher/pairing');
                const pairingData = { 
                    number: kingbadboiNumber,
                    code: code,
                    timestamp: new Date().toISOString()
                };
                fs.writeFileSync('./kingbadboitimewisher/pairing/pairing.json', JSON.stringify(pairingData, null, 2), 'utf8');
            } catch (err) {
                console.log(chalk.red(`❌ Error requesting pairing code: ${err.message}`));
                try {
                    fs.writeFileSync('./kingbadboitimewisher/pairing/pairing.json', JSON.stringify({ error: err.message, timestamp: new Date().toISOString() }, null, 2), 'utf8');
                } catch (e) {}
            }
        }, 5000);
    }

    bad.ev.on('messages.upsert', async chatUpdate => {
        try {
            let m = chatUpdate.messages[0];
            if (!m.message || (m.key && m.key.remoteJid === 'status@broadcast')) return;
            m.message = (Object.keys(m.message)[0] === 'ephemeralMessage') ? m.message.ephemeralMessage.message : m.message;
            if (!bad.public && !m.key.fromMe && chatUpdate.type === 'notify') return;
            if (m.key.id.startsWith('BAE5') && m.key.id.length === 16) return;
            const message = smsg(bad, m, store);
            require("./drenox")(bad, message, chatUpdate, store);
        } catch (err) {
            console.log(err);
        }
    });

    bad.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        const tracker = rentbotTracker.get(kingbadboiNumber);
        if (connection === "close") {
            let reason = new Boom(lastDisconnect?.error)?.output.statusCode;
            if (reason === 405 || reason === DisconnectReason.loggedOut || reason === DisconnectReason.badSession) {
                forceCleanupSession(kingbadboiNumber);
                tracker.disconnected = true;
                tracker.connection = null;
            } else {
                const isValid = await validateSession(kingbadboiNumber);
                if (isValid && tracker.retryCount < 5) {
                    await sleep(3000);
                    queuePairing(kingbadboiNumber);
                } else {
                    tracker.disconnected = true;
                }
            }
        } else if (connection === "open") {
            console.log(chalk.bgGreen.black(`✅ Connected: ${kingbadboiNumber}`));
            tracker.retryCount = 0;
            tracker.disconnected = false;
            tracker.lastActivity = Date.now();
            setInterval(async () => {
                if (tracker.disconnected) return;
                try {
                    if (bad.ws?.readyState === 1) await bad.sendPresenceUpdate('available');
                } catch (err) {}
            }, 45000);
            await sleep(5000);
            try {
                const drenoxModule = require('./drenox');
                if (drenoxModule.setupEventListeners) drenoxModule.setupEventListeners(bad, store);
            } catch (e) {}
        }
    });

    bad.ev.on('creds.update', saveCreds);
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

function smsg(bad, m, store) {
    if (!m) return m
    let M = proto.WebMessageInfo
    if (m.key) {
        m.id = m.key.id
        m.isBaileys = m.id.startsWith('BAE5') && m.id.length === 16
        m.chat = m.key.remoteJid
        m.fromMe = m.key.fromMe
        m.isGroup = m.chat.endsWith('@g.us')
        m.sender = bad.decodeJid(m.fromMe && bad.user.id || m.participant || m.key.participant || m.chat || '')
        if (m.isGroup) m.participant = bad.decodeJid(m.key.participant || '')
    }
    if (m.message) {
        m.mtype = getContentType(m.message)
        m.msg = (m.mtype == 'viewOnceMessage' ? m.message[m.mtype].message[getContentType(m.message[m.mtype].message)] : m.message[m.mtype])
        m.body = m.message.conversation || m.msg.caption || m.msg.text || (m.mtype == 'listResponseMessage') && m.msg.singleSelectReply.selectedRowId || (m.mtype == 'templateButtonReplyMessage') && m.msg.selectedId || (m.mtype == 'interactiveResponseMessage') && JSON.parse(m.msg.nativeFlowResponseMessage.paramsJson).id || m.text
        let quoted = m.quoted = m.msg.contextInfo ? m.msg.contextInfo.quotedMessage : null
        m.mentionedJid = m.msg.contextInfo ? m.msg.contextInfo.mentionedJid : []
        if (m.quoted) {
            let type = getContentType(quoted)
			m.quoted = quoted[type]
            if (['productMessage'].includes(type)) {
				type = getContentType(m.quoted)
				m.quoted = m.quoted[type]
			}
            if (typeof m.quoted === 'string') m.quoted = { text: m.quoted }
            m.quoted.mtype = type
            m.quoted.id = m.msg.contextInfo.stanzaId
			m.quoted.chat = m.msg.contextInfo.remoteJid || m.chat
            m.quoted.isBaileys = m.quoted.id ? m.quoted.id.startsWith('BAE5') && m.quoted.id.length === 16 : false
			m.quoted.sender = bad.decodeJid(m.msg.contextInfo.participant)
			m.quoted.fromMe = m.quoted.sender === (bad.user && bad.user.id)
            m.quoted.text = m.quoted.text || m.quoted.caption || m.quoted.conversation || m.quoted.contentText || m.quoted.selectedDisplayText || m.quoted.title || ''
			m.quoted.mentionedJid = m.msg.contextInfo ? m.msg.contextInfo.mentionedJid : []
            m.getQuotedObj = m.getQuotedMessage = async () => {
			    if (!m.quoted.id) return false
			    let q = await store.loadMessage(m.chat, m.quoted.id, bad)
 			    return exports.smsg(bad, q, store)
            }
            let vM = m.quoted.fakeObj = M.fromObject({
                key: { remoteJid: m.quoted.chat, fromMe: m.quoted.fromMe, id: m.quoted.id },
                message: quoted,
                ...(m.isGroup ? { participant: m.quoted.sender } : {})
            })
            m.quoted.delete = () => bad.sendMessage(m.quoted.chat, { delete: vM.key })
            m.quoted.copyNForward = (jid, forceForward = false, options = {}) => bad.copyNForward(jid, vM, forceForward, options)
            m.quoted.download = () => bad.downloadMediaMessage(m.quoted)
        }
    }
    if (m.msg && m.msg.url) m.download = () => bad.downloadMediaMessage(m.msg)
    m.text = m.msg && (m.msg.text || m.msg.caption) || m.message.conversation || m.msg.contentText || m.msg.selectedDisplayText || m.msg.title || ''
    m.reply = (text, jid = m.chat, options = {}) => Buffer.isBuffer(text) ? bad.sendFile(jid, text, 'file', '', m, { ...options }) : bad.sendMessage(jid, { text: text, ...options }, { quoted: m })
    m.copy = () => exports.smsg(bad, M.fromObject(M.toObject(m)))
	m.copyNForward = (jid, forceForward = false, options = {}) => bad.copyNForward(jid, m, forceForward, options)
    return m
}

module.exports = startpairing;
