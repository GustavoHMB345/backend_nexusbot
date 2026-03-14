const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8080;

// 1. PRIORIDADE ZERO: Responder ao Railway imediatamente
app.get('/', (req, res) => res.status(200).send('🚀 NexusBot Vivo!'));

// 2. MIDDLEWARES
app.use(cors());
app.use(express.json());

// 3. INICIAR SERVIDOR PRIMEIRO (Para o Healthcheck passar logo)
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ [RAILWAY] Porta ${PORT} aberta. Healthcheck deve passar.`);
});

// 4. INICIALIZAÇÃO DO FIREBASE (Depois que o servidor já abriu a porta)
if (!admin.apps.length) {
    try {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
            })
        });
        console.log("🔥 [FIREBASE] Conectado.");
    } catch (err) {
        console.error("❌ Erro Firebase:", err.message);
    }
}

const db = admin.firestore();
const { iniciarAgendamentos } = require('./cron-jobs');

// Inicia agendamentos com um pequeno delay para não travar o boot
setTimeout(() => {
    try { iniciarAgendamentos(); console.log("⏰ [CRON] Ativado."); } catch(e){}
}, 5000);

// 5. ROTAS DO WEBHOOK
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
        const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
        if (message) {
            const from = message.from;
            console.log(`📩 Mensagem recebida de ${from}`);
            
            // Incremento e Resposta (Lógica simplificada para teste)
            await db.collection('empresas').doc(unidadeId).set({
                mensagens_atuais: admin.firestore.FieldValue.increment(1)
            }, { merge: true });

            await axios.post(`https://graph.facebook.com/v21.0/${req.body.entry[0].changes[0].value.metadata.phone_number_id}/messages`, {
                messaging_product: "whatsapp",
                to: from,
                text: { body: `NexusBot: Recebemos sua mensagem na unidade ${unidadeId}!` },
            }, { headers: { "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}` } });
        }
        res.sendStatus(200);
    } catch (error) { res.sendStatus(200); }
});