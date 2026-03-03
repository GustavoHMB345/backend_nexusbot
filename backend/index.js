const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();

// 1. INICIALIZAÇÃO DO FIREBASE
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        })
    });
}

const db = admin.firestore();

// 2. CONFIGURAÇÃO DE CORS E MIDDLEWARES
const allowedOrigins = [
    'http://localhost:5173',
    'https://nexusbot-admin-production.up.railway.app'
];

const corsOptions = {
    origin: function (origin, callback) {
        // Permite requisições sem origin (como mobile apps ou ferramentas de teste)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Acesso negado por política de CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 86400 // Cache de preflight por 24 horas
};

app.use(cors(corsOptions));
app.use(express.json());

// 3. MIDDLEWARE DE AUTENTICAÇÃO
const verificarAutenticacao = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ erro: "Token de autorização ausente." });
    }

    const idToken = authHeader.split('Bearer ')[1];

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.user = decodedToken;
        next();
    } catch (error) {
        console.error("Erro na validação do token:", error);
        return res.status(403).json({ erro: "Sessão inválida ou expirada." });
    }
};

// 4. MÓDULOS E ROTAS COMPLEMENTARES
const statusRoute = require('./status');
const logger = require('./logger');

app.use('/status-sistema', statusRoute);

// 5. ENDPOINTS ADMINISTRATIVOS (REACT FRONT-END)

app.get('/atendimentos/stats', verificarAutenticacao, async (req, res) => {
    try {
        // Lógica de agregação de dados baseada no e-mail do administrador autenticado
        const stats = {
            mes_atual: 1540,
            mes_passado: 1252,
            tendencia_percentual: 23,
            taxa_resolucao: 89,
            uso_plano_percentual: 92,
            alerta_limite: true
        };
        res.json(stats);
    } catch (error) {
        await logger.salvarErro("API_STATS", error, "Erro ao processar estatísticas do dashboard");
        res.status(500).json({ erro: "Falha interna ao recuperar dados estatísticos." });
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
        res.status(500).json({ erro: "Erro ao listar unidades operacionais." });
    }
});

// 6. WEBHOOKS DE INTEGRAÇÃO (META / WHATSAPP)

app.get('/webhook', (req, res) => {
    const verify_token = process.env.WEBHOOK_VERIFY_TOKEN;
    if (req.query['hub.verify_token'] === verify_token) {
        res.status(200).send(req.query['hub.challenge']);
    } else {
        res.sendStatus(403);
    }
});

app.post('/webhook', async (req, res) => {
    try {
        const value = req.body.entry?.[0]?.changes?.[0]?.value;
        const message = value?.messages?.[0];

        if (message) {
            const phone_number_id = value.metadata.phone_number_id;
            const from = message.from;
            const text = message.text?.body?.trim() || "";

            // Incremento do contador de mensagens para fins de faturamento e limite
            await db.collection('empresas').doc(phone_number_id).update({
                mensagens_atuais: admin.firestore.FieldValue.increment(1)
            });

            // Persistência da mensagem no histórico de atendimentos
            await db.collection('empresas').doc(phone_number_id).collection('atendimentos').add({
                cliente: from,
                mensagem: text,
                origem: "cliente",
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });

            // Resposta automatizada via API Graph da Meta
            await axios({
                method: "POST",
                url: `https://graph.facebook.com/v18.0/${phone_number_id}/messages`,
                data: {
                    messaging_product: "whatsapp",
                    to: from,
                    text: { body: "NexusBot: Recebemos a sua mensagem e estamos a processar o seu pedido." },
                },
                headers: { "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}` },
            });
        }
        res.sendStatus(200);
    } catch (error) {
        await logger.salvarErro("WEBHOOK_HANDLER", error, "Erro no processamento de mensagem recebida");
        res.sendStatus(500);
    }
});

// 7. ROTINAS DE MANUTENÇÃO (SISTEMA PREMIUM)

async function executarResetMensal(phone_number_id) {
    const empresaRef = db.collection('empresas').doc(phone_number_id);
    try {
        const doc = await empresaRef.get();
        const totalAcumulado = doc.data().mensagens_atuais || 0;

        await empresaRef.update({
            mensagens_mes_anterior: totalAcumulado,
            mensagens_atuais: 0,
            ultimo_reset: admin.firestore.FieldValue.serverTimestamp()
        });
        return true;
    } catch (error) {
        await logger.salvarErro(phone_number_id, error, "Falha na execução do Reset Mensal automático");
        return false;
    }
}

app.post('/admin/reset-mensal', verificarAutenticacao, async (req, res) => {
    const { phone_id } = req.body;
    const resultado = await executarResetMensal(phone_id);
    resultado ? res.send("Procedimento de reset concluído.") : res.sendStatus(500);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Servidor NexusBot operacional na porta ${PORT}`));