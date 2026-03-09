const cron = require('node-cron');
const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * Lógica de Reset Mensal: 
 * Executa no dia 1º de cada mês, às 00:00 (Meia-noite)
 */
const iniciarAgendamentos = () => {
    // Padrão cron: minuto hora dia mes dia-da-semana
    cron.schedule('0 0 1 * *', async () => {
        console.log('[CRON] Iniciando reset mensal das unidades...');

        try {
            const empresasSnapshot = await db.collection('empresas').get();

            if (empresasSnapshot.empty) {
                console.log('[CRON] Nenhuma unidade encontrada para resetar.');
                return;
            }

            const batch = db.batch();

            empresasSnapshot.forEach(doc => {
                const dados = doc.data();
                const atual = dados.mensagens_atuais || 0;

                // Move o valor atual para o histórico e zera o contador
                batch.update(doc.ref, {
                    mensagens_mes_anterior: atual,
                    mensagens_atuais: 0,
                    data_ultimo_reset: admin.firestore.FieldValue.serverTimestamp()
                });
            });

            await batch.commit();
            console.log(`[CRON] Reset mensal concluído para ${empresasSnapshot.size} unidades.`);

        } catch (error) {
            console.error('[CRON] Erro ao executar reset mensal:', error);
        }
    });
};

module.exports = { iniciarAgendamentos };