const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const cors = require('cors');

// 1. CONFIGURAÇÕES INICIAIS E PORTA
const app = express();
const PORT = process.env.PORT || 8080;

// 2. INICIALIZAÇÃO DO FIREBASE (DEVE VIR ANTES DOS MÓDULOS QUE USAM DB)
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

// 3. IMPORTAÇÃO DE MÓDULOS QUE DEPENDEM DO FIREBASE JÁ INICIADO
const { iniciarAgendamentos } = require('./cron-jobs');
const statusRoute = require('./status');
const logger = require('./logger');

// Inicia as rotinas automáticas de reset
iniciarAgendamentos();

// 4. CONFIGURAÇÃO DE CORS E MIDDLEWARES
const allowedOrigins = [
    'http://localhost:5173',
    'https://nexusbot-admin-production.up.railway.app'
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Acesso negado por política de CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

app.use(express.json());

// 5. MIDDLEWARE DE AUTENTICAÇÃO
const verificarAutenticacao = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ erro: "Token de autorização ausente." });
    }
    const idToken = authHeader.split('Bearer ')[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.user = decodedToken;
        next();
    } catch (error) {
        return res.status(403).json({ erro: "Sessão inválida ou expirada." });
    }
};

// 6. ROTAS SISTÊMICAS
app.use('/status-sistema', statusRoute);

// 7. ENDPOINTS DO DASHBOARD (REACT)
app.get('/atendimentos/stats', verificarAutenticacao, async (req, res) => {
    try {
        // Mock de dados (Substituir por agregação real do Firestore no futuro)
        res.json({
            mes_atual: 1540,
            mes_passado: 1252,
            tendencia_percentual: 23,
            taxa_resolucao: 89,
            uso_plano_percentual: 92,
            alerta_limite: true
        });
    } catch (error) {
        await logger.salvarErro("API_STATS", error, "Erro ao processar estatísticas");
        res.status(500).json({ erro: "Falha interna." });
    }
});

app.get('/unidades', verificarAutenticacao, async (req, res) => {
    try {
        const snapshot = await db.collection('empresas')
            .where('admin_email', '==', req.user.email)
            .get();
        const unidades = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.json(unidades);
    } catch (error) {
        res.status(500).json({ erro: "Erro ao listar unidades." });
    }
});

// 8. WEBHOOKS DINÂMICOS (META/WHATSAPP)
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
            const text = message.text?.body?.trim() || "";

            const unidadeRef = db.collection('empresas').doc(unidadeId);
            await unidadeRef.update({
                mensagens_atuais: admin.firestore.FieldValue.increment(1),
                ultimo_phone_id: phone_number_id
            });

            await unidadeRef.collection('atendimentos').add({
                cliente: from,
                mensagem: text,
                origem: "cliente",
                unidade: unidadeId,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });

            // Resposta Automática
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
        await logger.salvarErro(unidadeId, error, `Erro no Webhook`);
        res.sendStatus(500);
    }
});

// 9. MANUAL RESET E INICIALIZAÇÃO
app.post('/admin/reset-mensal', verificarAutenticacao, async (req, res) => {
    const { phone_id } = req.body;
    try {
        const empresaRef = db.collection('empresas').doc(phone_id);
        const doc = await empresaRef.get();
        const total = doc.data()?.mensagens_atuais || 0;

        await empresaRef.update({
            mensagens_mes_anterior: total,
            mensagens_atuais: 0,
            ultimo_reset: admin.firestore.FieldValue.serverTimestamp()
        });
        res.send("Reset concluído.");
    } catch (e) {
        res.sendStatus(500);
    }
});

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