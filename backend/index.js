const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8080;

// 1. MIDDLEWARES (Configuração rápida)
app.use(cors());
app.use(express.json());

// 2. ROTA DE HEALTHCHECK (Prioridade Máxima)
// Quando o Railway bater aqui, o bot responde "Tô vivo!" instantaneamente.
app.get('/', (req, res) => {
    console.log("🚦 Railway checou a saúde do bot!");
    res.status(200).send('🚀 NexusBot Online');
});

// 3. ABRIR A PORTA IMEDIATAMENTE
// Não espere o Firebase. Abra a porta primeiro para o Railway ficar feliz.
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ [OK] Servidor ouvindo na porta ${PORT}`);
    
    // 4. INICIALIZAÇÃO "PREGUIÇOSA" (Lazy Load)
    // Só carrega o pesado depois que a porta já está aberta
    setTimeout(() => {
        iniciarTudo();
    }, 1000);
});

async function iniciarTudo() {
    try {
        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: process.env.FIREBASE_PROJECT_ID,
                    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
                })
            });
            console.log("🔥 [FIREBASE] Conectado.");
        }

        const { iniciarAgendamentos } = require('./cron-jobs');
        iniciarAgendamentos();
        console.log("⏰ [CRON] Ativado.");
    } catch (err) {
        console.error("⚠️ Erro no carregamento secundário:", err.message);
    }
}

// 5. ROTAS DO WEBHOOK (Mantendo sua lógica de sucesso)
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
            const msgText = message.text?.body || "";

            console.log(`📩 Mensagem de ${from}: ${msgText}`);

            await admin.firestore().collection('empresas').doc(unidadeId).set({
                mensagens_atuais: admin.firestore.FieldValue.increment(1),
                ultima_interacao: new Date().toISOString()
            }, { merge: true });

            await axios.post(`https://graph.facebook.com/v21.0/${phone_number_id}/messages`, {
                messaging_product: "whatsapp",
                to: from,
                text: { body: `NexusBot [${unidadeId}]: Recebemos sua mensagem!` },
            }, { headers: { "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}` } });
        }
        res.sendStatus(200);
    } catch (error) { res.sendStatus(200); }
});