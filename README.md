# Documentação da API Backend - NexusBot Platform

Esta documentação detalha os recursos, especificações e protocolos de integração da API NexusBot, desenvolvida em Node.js. O serviço atua como a camada de inteligência e integração entre a interface administrativa, o banco de dados Google Firestore e a API oficial do WhatsApp para a gestão das nove unidades operacionais em Teresina.

## 1. Tecnologias utilizadas

* **Ambiente de Execução:** Node.js v20.x ou superior.
* **Framework Principal:** Express.js.
* **Persistência de Dados:** Google Firestore (Firebase Admin SDK).
* **Autenticação:** Firebase Auth (OIDC).
* **Infraestrutura:** Railway.

## 2. Protocolo de Autenticação e Segurança

Com exceção dos webhooks de entrada destinados a serviços de terceiros, todos os endpoints exigem autenticação via protocolo Bearer Token no cabeçalho das requisições. O desenvolvedor front-end deve extrair o ID Token fornecido pelo Firebase Auth após a validação do utilizador.

**Exemplo de Cabeçalho:**
`Authorization: Bearer <ID_TOKEN_FIREBASE>`

---

## 3. Definição de Endpoints

### 3.1. Painel de Indicadores e Estatísticas
Recupera dados consolidados para os componentes de visualização de performance.

* **GET `/atendimentos/stats`**
  * **Descrição:** Retorna as métricas do mês vigente, histórico arquivado e status de limites.
  * **Exemplo de Resposta (JSON):**
    ```json
    {
      "mes_atual": 1540,
      "mes_passado": 1252,
      "tendencia_percentual": 23,
      "taxa_resolucao": 89,
      "uso_plano_percentual": 92,
      "alerta_limite": true
    }
    ```

### 3.2. Gestão de Instâncias (Controlo Master)
Endpoints destinados à manutenção e controle das nove unidades ativas.

* **GET `/unidades`**
  * **Descrição:** Retorna a listagem completa das unidades vinculadas ao perfil administrador.
* **POST `/unidades/:id/reiniciar`**
  * **Descrição:** Inicia o procedimento de reset na instância de processamento da unidade correspondente.
* **POST `/unidades/:id/sincronizar`**
  * **Descrição:** Força a integridade de dados entre a API de mensagens e o Firestore.

### 3.3. Histórico de Atendimentos
Acesso aos logs de conversas e fluxos de interação.

* **GET `/atendimentos/historico`**
  * **Descrição:** Recupera a lista resumida de conversas e últimos status.
* **GET `/atendimentos/:id/mensagens`**
  * **Descrição:** Retorna o log sequencial de mensagens de uma conversa específica para renderização no componente de chat.

### 3.4. Relatórios e Inteligência (Plano Premium)
Funcionalidades exclusivas para contas com nível de acesso Premium.

* **POST `/relatorios/gerar-pdf`**
  * **Descrição:** Dispara o motor de geração de documentos do servidor.
  * **Corpo (JSON):** `{ "unidadeId": "string", "filtros": ["mensal", "anual"] }`
  * **Resposta:** Objeto contendo o link temporário para download do arquivo PDF.

---

## 4. Estrutura do Banco de Dados (Firestore)

| Coleção | Documento | Atributos Principais |
| :--- | :--- | :--- |
| empresas | id_unidade | nome, admin_email, plano (premium/basic), whatsapp_id |
| stats | id_unidade | mensagens_atuais, mensagens_mes_anterior, limite_alerta |
| historico | id_conversa | cliente_nome, status, timestamp, log_mensagens (array) |

---

## 5. Configuração e Instalação

1. Clonar o repositório oficial.
2. Executar a instalação das dependências: `npm install`.
3. Configurar o arquivo de ambiente `.env` com as seguintes chaves:
   * `PORT`: Porta de rede.
   * `FIREBASE_KEY`: JSON de credenciais da conta de serviço.
   * `WHATSAPP_API_TOKEN`: Credencial da API Meta.
4. Executar em modo de desenvolvimento: `npm run dev`.

