const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const app = express();

// 1. INICIALIZAÇÃO DO FIREBASE (Deve vir antes das rotas)
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

// 2. IMPORTAÇÃO DE MÓDULOS MODULARES
const statusRoute = require('./status');
const logger = require('./logger');

app.use(express.json());

// 3. ROTEAMENTO POR HOST (status.nexusbot.ia.br)
app.use((req, res, next) => {
    // Se o acesso vier pelo subdomínio de status, redireciona para o módulo de status
    if (req.headers.host === 'status.nexusbot.ia.br') {
        return statusRoute(req, res, next);
    }
    next();
});

// Mantemos a rota alternativa por segurança
app.use('/status-sistema', statusRoute);

// 4. CONFIGURAÇÕES DE LÓGICA DO BOT
const TEMPO_EXPIRACAO = 10 * 60 * 1000; // 10 minutos
const MAPA_OPCOES = {
    "1": "financeiro",
    "2": "atendimento",
    "3": "suporte"
};

// 5. WEBHOOK PRINCIPAL
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
            const text = message.text?.body?.trim().toLowerCase() || "";

            // --- LÓGICA DE SESSÃO E TEMPORIZADOR ---
            const sessaoRef = db.collection('empresas').doc(phone_number_id).collection('sessoes').doc(from);
            const sessaoDoc = await sessaoRef.get();
            const agora = Date.now();
            
            let menu_id = "inicio";
            let sessaoExpirada = false;

            if (sessaoDoc.exists) {
                const dadosSessao = sessaoDoc.data();
                const ultimaInteracao = dadosSessao.timestamp ? dadosSessao.timestamp.toMillis() : 0;
                
                if (agora - ultimaInteracao > TEMPO_EXPIRACAO) {
                    sessaoExpirada = true;
                } else {
                    // Se estiver no tempo, mapeia o número ou mantém o fluxo
                    menu_id = MAPA_OPCOES[text] || "inicio";
                }
            }

            // --- BUSCA MENSAGEM NO FIRESTORE ---
            const empresaDoc = await db.collection('empresas').doc(phone_number_id)
                                    .collection('fluxos').doc(menu_id).get();

            let resposta = empresaDoc.exists ? empresaDoc.data().mensagem : "Olá! Escolha uma opção: 1, 2 ou 3.";
            
            if (sessaoExpirada) {
                resposta = "Sua sessão expirou por inatividade.\n\n" + resposta;
            }

            // --- ENVIO VIA WHATSAPP API ---
            await axios({
                method: "POST",
                url: `https://graph.facebook.com/v18.0/${phone_number_id}/messages`,
                data: {
                    messaging_product: "whatsapp",
                    to: from,
                    text: { body: resposta },
                },
                headers: { "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}` },
            });

            // --- ATUALIZAÇÃO DE ESTADO ---
            await sessaoRef.set({ timestamp: admin.firestore.FieldValue.serverTimestamp() });

            await db.collection('empresas').doc(phone_number_id).collection('atendimentos').add({
                cliente: from,
                mensagem: text,
                origem: "cliente",
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
        }
        res.sendStatus(200);
    } catch (error) {
        // REGISTRO DE ERRO NO SISTEMA DE LOGS PERSISTENTES
        console.error("Erro no Webhook:", error);
        await logger.salvarErro("SISTEMA_WEBHOOK", error, "Falha no processamento da mensagem");
        res.sendStatus(500);
    }
});

app.get('/forcar-erro', async (req, res) => {
    try {
        throw new Error("Simulação de falha técnica no NexusBot!");
    } catch (error) {
        const logger = require('./logger');
        // Usamos um ID genérico para o teste
        await logger.salvarErro("TESTE_SISTEMA", error, "Teste manual de logs persistentes");
        res.status(500).send("Erro forçado e registrado com sucesso!");
    }
});

/**
 * SISTEMA DE RESET MENSAL
 * Transfere o contador atual para 'mensagens_mes_anterior' e limpa as interações.
 */
async function executarResetMensal(phone_number_id) {
    const db = admin.firestore();
    const empresaRef = db.collection('empresas').doc(phone_number_id);

    try {
        // 1. Conta quantas mensagens foram enviadas no mês que se encerra
        const atendimentosRef = empresaRef.collection('atendimentos');
        const snapshot = await atendimentosRef.get();
        const totalMesEncerrado = snapshot.size;

        // 2. Salva esse valor no histórico da empresa
        await empresaRef.update({
            mensagens_mes_anterior: totalMesEncerrado,
            ultimo_reset: admin.firestore.FieldValue.serverTimestamp()
        });

        // 3. Limpeza da coleção para o novo mês (Batch para performance)
        // Nota: Em sistemas de alta escala, você moveria esses docs para uma coleção 'arquivo'
        const batch = db.batch();
        snapshot.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();

        console.log(`Reset concluído para ${phone_number_id}. Total arquivado: ${totalMesEncerrado}`);
        return true;
    } catch (error) {
        await logger.salvarErro(phone_number_id, error, "Falha no Reset Mensal");
        return false;
    }
}

// Rota para gatilho manual ou via   Cron do Railway
app.post('/admin/reset-mensal', async (req, res) => {
    const { key, phone_id } = req.body;
    if (key === process.env.ADMIN_SECRET_KEY) { // Proteção básica
        await executarResetMensal(phone_id);
        return res.send("Reset processado.");
    }
    res.sendStatus(403);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`NexusBot rodando na porta ${PORT}`));