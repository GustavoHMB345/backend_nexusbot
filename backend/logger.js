const admin = require('firebase-admin');

// Função centralizada para registrar erros no Firestore
const salvarErro = async (phone_number_id, erro, contexto) => {
    try {
        const db = admin.firestore();
        await db.collection('empresas').doc(phone_number_id)
                .collection('logs_erros').add({
                    erro: erro.message || erro,
                    contexto: contexto,
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                });
    } catch (e) {
        console.error("Erro fatal ao tentar gravar log no Firestore:", e);
    }
};

module.exports = { salvarErro };