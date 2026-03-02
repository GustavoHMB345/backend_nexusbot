const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const logger = require('./logger'); // Importa o log

router.get('/', async (req, res) => {
    let status = 'OPERACIONAL';
    let badgeColor = '#238636';
    const dataAtual = new Date().toLocaleString("pt-BR", { timeZone: "America/Fortaleza" });

    try {
        const db = admin.firestore();
        // Teste de leitura rápido
        await db.collection('configuracoes').doc('planos').get();
    } catch (error) {
        status = 'INSTÁVEL';
        badgeColor = '#da3633';
        // Grava o erro para você analisar depois
        await logger.salvarErro("SISTEMA_GLOBAL", error, "Health Check da Página de Status");
    }

    res.send(`
        <!DOCTYPE html>
        <html lang="pt-br">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Status | NexusBot</title>
            <style>
                body { font-family: system-ui, sans-serif; background-color: #0e1117; color: white; text-align: center; padding: 50px; }
                .card { background: #161b22; border-radius: 15px; padding: 30px; display: inline-block; border: 1px solid #30363d; }
                .status-badge { background: ${badgeColor}; color: white; padding: 5px 15px; border-radius: 20px; font-weight: bold; }
                h1 { color: #58a6ff; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>🚀 NexusBot Status</h1>
                <p>O sistema de Teresina está: <span class="status-badge">${status}</span></p>
                <div class="time" style="margin-top:20px; color:#8b949e;">Verificado em: ${dataAtual}</div>
            </div>
        </body>
        </html>
    `);
});

module.exports = router;