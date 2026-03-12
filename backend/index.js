const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const cors = require('cors');

// 1. CONFIGURAÇÕES INICIAIS E PORTA
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

// 3. IMPORTAÇÃO DE MÓDULOS (APÓS FIREBASE INIT)
const { iniciarAgendamentos } = require('./cron-jobs');
const statusRoute = require('./status');
const logger = require('./logger');

// Inicia as rotinas de reset mensal
iniciarAgendamentos();

// 4. MIDDLEWARES E CORS
const allowedOrigins = [
    'http://localhost:5173',
    'https://nexusbot-admin-production.up.railway.app'
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
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

// 5. ROTAS DE STATUS E DASHBOARD
app.use('/status-sistema', statusRoute);

app.get('/atendimentos/stats', async (req, res) => {
    res.json({ mes_atual: 1540, tendencia: 23 }); // Mock inicial
});

// 6. WEBHOOKS DINÂMICOS (UNIDADES TERESINA)
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
        const value = req.body.entry?.[0]?.changes?.[0]?.value;
        const message = value?.messages?.[0];

        if (message) {
            const phone_number_id = value.metadata.phone_number_id;
            const from = message.from;
            
            const unidadeRef = db.collection('empresas').doc(unidadeId);
            await unidadeRef.update({
                mensagens_atuais: admin.firestore.FieldValue.increment(1)
            });

            await axios.post(`https://graph.facebook.com/v18.0/${phone_number_id}/messages`, {
                messaging_product: "whatsapp",
                to: from,
                text: { body: `NexusBot [${unidadeId}]: Recebemos sua mensagem.` },
            }, {
                headers: { "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}` }
            });
        }
        res.sendStatus(200);
    } catch (error) {
        res.sendStatus(500);
    }
});

// 7. INICIALIZAÇÃO ÚNICA DO SERVIDOR
app.listen(PORT, () => {
    console.log(`[SERVER] NexusBot operacional na porta ${PORT}`);
});

// ROTA TEMPORÁRIA PARA FORÇAR O REGISTRO NA META
app.get('/force-register-nexus', async (req, res) => {
    try {
        const response = await axios.post(
            `https://graph.facebook.com/v18.0/1084226368098115/register`,
            {
                messaging_product: "whatsapp",
                pin: "978025"
            },
            {
                headers: { 
                    'Authorization': `Bearer EAAM5ZA4zmxX0BQZC2k1UHhTC24p9frfZBfLzQeiAzxky8HAkqPubkv8aNZAFbDZC84yGC6m9zdgSJRSEWZAU0vjCfh62PI57To2Gxa7BHby0iJZB9oAd54pp4ZCVRsnoqaV2LBYBNsPsKwMAZBpEYZAgRZCUXDQca7VKeBvbQ4LZAaS4ttEjtaVXDD4VrJeQUKQrcI2VNwZDZD`,
                    'Content-Type': 'application/json' 
                }
            }
        );
        res.send(`✅ Sucesso! Resposta da Meta: ${JSON.stringify(response.data)}`);
    } catch (error) {
        res.status(500).send(`❌ Erro: ${error.response ? JSON.stringify(error.response.data) : error.message}`);
    }
});