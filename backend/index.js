const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const cors = require('cors');

// 1. CONFIGURAÇÕES INICIAIS E PORTA
const app = express();
const PORT = process.env.PORT || 8080;

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

// 4. MIDDLEWARES
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
        return res.status(401).json({ erro: "Token ausente." });
    }
    const idToken = authHeader.split('Bearer ')[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.user = decodedToken;
        next();
    } catch (error) {
        return res.status(403).json({ erro: "Sessão expirada." });
    }
};

// 6. ROTAS
app.use('/status-sistema', statusRoute);

app.get('/atendimentos/stats', verificarAutenticacao, async (req, res) => {
    res.json({
        mes_atual: 1540,
        mes_passado: 1252,
        tendencia_percentual: 23,
        taxa_resolucao: 89,
        uso_plano_percentual: 92,
        alerta_limite: true
    });
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

// 6. WEBHOOKS DINÂMICOS (PARA SUPORTAR /webhook/admin)

// Validação da URL (GET)
app.get('/webhook/:unidadeId', (req, res) => {
    const { unidadeId } = req.params;
    const verify_token = process.env.WEBHOOK_VERIFY_TOKEN;

    if (req.query['hub.verify_token'] === verify_token) {
        console.log(`[META] Unidade ${unidadeId} validada com sucesso.`);
        res.status(200).send(req.query['hub.challenge']);
    } else {
        res.sendStatus(403);
    }
});

// Recebimento de Mensagens (POST)
app.post('/webhook/:unidadeId', async (req, res) => {
    const { unidadeId } = req.params; // Captura "admin" da URL
    try {
        const value = req.body.entry?.[0]?.changes?.[0]?.value;
        const message = value?.messages?.[0];

        if (message) {
            const phone_number_id = value.metadata.phone_number_id;
            const from = message.from;
            const text = message.text?.body?.trim() || "";

            // Atualiza a unidade específica no Firestore usando o ID da URL
            const unidadeRef = db.collection('empresas').doc(unidadeId);

            await unidadeRef.update({
                mensagens_atuais: admin.firestore.FieldValue.increment(1)
            });

            await unidadeRef.collection('atendimentos').add({
                cliente: from,
                mensagem: text,
                origem: "cliente",
                unidade: unidadeId,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });

            // Resposta Automática
            await axios({
                method: "POST",
                url: `https://graph.facebook.com/v18.0/${phone_number_id}/messages`,
                data: {
                    messaging_product: "whatsapp",
                    to: from,
                    text: { body: `NexusBot [${unidadeId}]: Recebemos sua mensagem.` },
                },
                headers: { "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}` },
            });
        }
        res.sendStatus(200);
    } catch (error) {
        await logger.salvarErro(unidadeId, error, `Erro no Webhook da unidade: ${unidadeId}`);
        res.sendStatus(500);
    }
});

// RESET MANUAL
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

// ÚNICO APP.LISTEN AO FINAL
app.listen(PORT, () => {
    console.log(`[SERVER] NexusBot operacional na porta ${PORT}`);
});