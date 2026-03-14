const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8080;

app.get('/', (req, res) => {
    res.send('NexusBot Backend Operacional - Teresina');
});

// 2. INICIALIZAÇÃO DO FIREBASE
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        })
    });
}

const db = admin.firestore();

const { iniciarAgendamentos } = require('./cron-jobs');
const statusRoute = require('./status');
const logger = require('./logger');

iniciarAgendamentos();

const allowedOrigins = [
    'http://localhost:5173',
    'https://nexusbot-admin-production.up.railway.app'
];

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Acesso negado por CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

app.use(express.json());

// Rota raiz para status rápido
app.get('/', (req, res) => {
    res.send(' NexusBot Server [Teresina] operacional.');
});

app.use('/status-sistema', statusRoute);

app.get('/atendimentos/stats', async (req, res) => {
    res.json({ mes_atual: 1540, tendencia: 23 });
});

app.get('/webhook/:unidadeId', (req, res) => {
    if (req.query['hub.verify_token'] === process.env.WEBHOOK_VERIFY_TOKEN) {
        res.status(200).send(req.query['hub.challenge']);
    } else {
        res.sendStatus(403);
    }
});

app.post('/webhook/:unidadeId', async (req, res) => {
    const { unidadeId } = req.params;
    try {
        const entry = req.body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const message = value?.messages?.[0];

        if (message) {
            const phone_number_id = value.metadata.phone_number_id;
            const from = message.from; 
            const msgText = message.text?.body || "";

            // Incremento no Firestore
            const unidadeRef = db.collection('empresas').doc(unidadeId);
            await unidadeRef.set({mensagens_atuais: 
                admin.firestore.FieldValue.increment(1)
            }, { merge: true });

            // Resposta Automática
            await axios.post(`https://graph.facebook.com/v21.0/${phone_number_id}/messages`, {
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to: from,
                type: "text",
                text: { body: `NexusBot [${unidadeId}]: Recebemos sua mensagem: "${msgText}". Como podemos ajudar?` },
            }, {
                headers: { "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}` }
            });
        }
        res.sendStatus(200);
    } catch (error) {
        console.error('Erro Webhook:', error.response?.data || error.message);
        res.sendStatus(200); // Mantém 200 para evitar retentativas infinitas da Meta
    }
});

app.listen(PORT, () => {
    console.log(`[SERVER] NexusBot operacional na porta ${PORT}`);
});

