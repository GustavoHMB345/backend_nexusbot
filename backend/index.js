const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const cors = require('cors');

// 1. CONFIGURAÇÕES INICIAIS
const app = express();
const PORT = process.env.PORT || 8080;

// 2. MIDDLEWARES ESSENCIAIS (O Express precisa disso antes das rotas)
app.use(cors());
app.use(express.json());

// 3. ROTA DE HEALTHCHECK (A primeira de todas para o Railway não derrubar o bot)
app.get('/', (req, res) => {
    res.status(200).send('🚀 NexusBot Online e Operante!');
});

// 4. INICIALIZAÇÃO DO FIREBASE
if (!admin.apps.length) {
    try {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
            })
        });
        console.log("✅ Firebase conectado com sucesso.");
    } catch (err) {
        console.error("❌ Erro ao iniciar Firebase:", err.message);
    }
}

const db = admin.firestore();

// 5. IMPORTAÇÃO DE MÓDULOS (Certifique-se que os arquivos existem)
const { iniciarAgendamentos } = require('./cron-jobs');
const statusRoute = require('./status');

try {
    iniciarAgendamentos();
} catch (e) {
    console.log("Aviso: Falha ao iniciar agendamentos.");
}

// 6. ROTAS DE NEGÓCIO
app.use('/status-sistema', statusRoute);

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
            const msgText = message.text?.body || "Mensagem sem texto";

            console.log(`📩 Mensagem de ${from}: ${msgText}`);

            const unidadeRef = db.collection('empresas').doc(unidadeId);
            await unidadeRef.set({
                mensagens_atuais: admin.firestore.FieldValue.increment(1),
                ultima_mensagem: new Date().toISOString()
            }, { merge: true });

            await axios.post(`https://graph.facebook.com/v21.0/${phone_number_id}/messages`, {
                messaging_product: "whatsapp",
                to: from,
                type: "text",
                text: { body: `NexusBot [${unidadeId}]: Recebemos sua mensagem!` },
            }, {
                headers: { "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}` }
            });
        }
        res.sendStatus(200);
    } catch (error) {
        console.error('❌ Erro no Webhook:', error.message);
        res.sendStatus(200);
    }
});

// Adicione isso logo acima do app.listen no seu index.js
console.log(`DEBUG: Tentando ligar na porta ${PORT} com IP 0.0.0.0`);

app.listen(PORT, '0.0.0.0', () => {
    console.log(` SUCESSO! NexusBot operacional na porta ${PORT}`);
});