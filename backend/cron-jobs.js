const cron = require('node-cron');
const admin = require('firebase-admin');

const iniciarAgendamentos = () => {
    const db = admin.firestore();

    cron.schedule('0 0 1 * *', async () => {
        console.log('[CRON] Iniciando reset mensal das unidades...');
        try {
            const empresasSnapshot = await db.collection('empresas').get();
            if (empresasSnapshot.empty) return;

            const batch = db.batch();
            empresasSnapshot.forEach(doc => {
                const dados = doc.data();
                batch.update(doc.ref, {
                    mensagens_mes_anterior: dados.mensagens_atuais || 0,
                    mensagens_atuais: 0,
                    data_ultimo_reset: admin.firestore.FieldValue.serverTimestamp()
                });
            });
            await batch.commit();
            console.log(`[CRON] Reset mensal concluído para ${empresasSnapshot.size} unidades.`);
        } catch (error) {
            console.error('[CRON] Erro ao executar reset mensal:', error);
        }
    }, {
        scheduled: true,
        timezone: "America/Fortaleza"
    });
};

module.exports = { iniciarAgendamentos };