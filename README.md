# Domma Chat

Sistema de atendimento e vendas no WhatsApp com Inteligência Artificial, da **Domma Tecnologia**.
Implementação do *Descritivo Técnico v1.2 (08/11/2026)*. Primeira operação: Master Laudo.

- IA atende 24h com escrita humana ("digitando…", mensagens curtas, pausas variáveis)
- Três modos por conversa: **IA**, **IA sugere (você aprova)** e **Humano**, com devolução em duas opções
- **Fale com a IA**: copiloto na conversa, que pode discordar do pedido e sugerir outro caminho
- **Materiais**: a IA envia arquivos (ex.: Apresentação da Franquia) quando o momento combina, sem repetir
- Classificação de leads (nota, temperatura, interesse, motivo), retorno agendado, proteção contra loop
- API Oficial (Cloud API), QR Code (Evolution API) e **Simulador** para testar sem WhatsApp
- Vários provedores de IA com fallback automático (Claude, ChatGPT, Gemini, compatível com OpenAI)
- Entrada de leads do Goalfy / Zapier / Make / n8n com fonte, campanha e UTMs
- Dashboard ao vivo, Relatórios, cobrança (Asaas, Mercado Pago, Stripe), reuniões com vendedores
- **Exportação em PDF** com a identidade da Domma e **página única, sem quebra**: conversa, Dashboard e números do negócio (também TXT e CSV)
- PWA instalável no celular, com notificações push

## Estrutura

```
apps/web          painel React (Vite) + PWA  → Vercel
apps/api          API REST + WebSocket + receptores de webhook
apps/workers      consumidores das filas BullMQ (atendimento, envio, mídia, retornos, manutenção)
packages/db       migrações SQL, cliente do banco e seed
packages/core     filas, tempo real, serviços de conversa, alertas, push, armazenamento
packages/ia       camada de IA (provedores, fallback, prompts, motor de escrita, porteiro)
packages/whatsapp adaptadores Cloud API, Evolution e Simulador (interface única)
packages/pagamentos adaptadores Asaas, Mercado Pago, Stripe
packages/shared   criptografia, texto, horário comercial, tipos
infra/            docker-compose local (Postgres, Redis, Evolution, API, workers)
scripts/          teste ponta a ponta
```

## Rodar localmente

Requisitos: Node 22, PostgreSQL 16, Redis 7 (ou `docker compose -f infra/docker-compose.yml up -d postgres redis`).

```bash
npm install
```

```bash
cp .env.example .env
```

```bash
npm run db:seed
```

Em três terminais:

```bash
npm run dev:api
```

```bash
npm run dev:workers
```

```bash
npm run dev:web
```

Abra http://localhost:5173 e entre com `admin@domma.local` / `domma123` (também `ana@domma.local`, atendente, e `bruno@domma.local`, supervisor).
Vá em **Simulador** e converse como se fosse o cliente.

O seed cadastra o provedor **Simulado** (regras simples, sem custo, só para teste). Para a IA de verdade, cadastre a chave do Claude em **Agente de IA → Inteligências** (modelo padrão `claude-opus-5-5`) e coloque-o como principal. Os preços da base de exemplo estão como `[VALOR]`: troque pela tabela real.

### Testes

```bash
npm test
```

Com API e workers no ar, o teste ponta a ponta percorre o atendimento pelo simulador (saudação, base de conhecimento, envio da apresentação, transparência, transferência, devolução para a IA, Fale com a IA, retorno agendado, despedidas, SAIR, PDFs e entrada de lead):

```bash
npm run test:e2e
```

## Publicação (produção)

Sugestão de endereços no domínio da Domma Sistemas:

| Parte | Endereço | Onde roda |
|---|---|---|
| Painel (PWA) | `chat.dommasistemas.com.br` | Vercel (`apps/web`, já tem `vercel.json`) |
| API + webhooks + WebSocket | `api.chat.dommasistemas.com.br` | Containers (Railway, Fly.io ou AWS) com o `Dockerfile` |
| Workers | — | Mesma imagem, comando `npm run start:workers` (2+ instâncias) |
| Banco | — | Supabase (Postgres gerenciado) → `DATABASE_URL` |
| Filas | — | Redis gerenciado com `maxmemory-policy noeviction` |
| Arquivos | — | S3 ou Cloudflare R2 (`S3_*`) |
| Evolution API | `evo.dommasistemas.com.br` (só para o back-end) | Servidor com disco persistente |

A Vercel não roda processos permanentes (filas e WebSocket), por isso API e workers ficam em containers.

DNS: `chat` → CNAME para a Vercel; `api.chat` → o host dos containers.

Variáveis: veja `.env.example`. Em produção, **troque `JWT_SECRET` e `ENCRYPTION_KEY`** (as chaves de IA, gateways e WhatsApp ficam criptografadas com `ENCRYPTION_KEY`).

Webhooks a configurar:
- Meta: `https://api.chat.dommasistemas.com.br/webhooks/meta` (campo `messages`, verify token = `META_VERIFY_TOKEN`)
- Evolution: configurado automaticamente por conexão (`/webhooks/evolution/{id}`)
- Gateways: o endereço aparece em **Pagamentos**
- Goalfy/Zapier: o endereço e o token aparecem em **Conexões**

## Produção (no ar desde 08/11/2026)

| Parte | Onde | Endereço |
|---|---|---|
| Painel | Vercel · equipe REDBOX · projeto `domma-chat` (raiz `apps/web`) | https://chat.dommasistemas.com.br |
| API + webhooks | Railway · projeto `domma-chat` · serviço `api` (us-east4, `PAPEL=api`, `PORT=3333`) | https://api.chat.dommasistemas.com.br |
| Workers | Railway · serviço `workers` (`PAPEL=workers`) | — |
| Redis | Railway · serviço `Redis` | rede privada |
| Arquivos | Railway · bucket `arquivos` (S3) | — |
| Banco | Supabase · projeto `domma-chat` (sa-east-1), schema `domma`, usuário `domma_app` | pooler `aws-1-sa-east-1` |
| DNS | HostGator (`dommasistemas.com.br`) | CNAME `chat` → Vercel · CNAME `api.chat` → Railway |

Cada envio para a `main` publica o painel (Vercel) e a API e os workers (Railway).
Os segredos (`JWT_SECRET`, `ENCRYPTION_KEY`, senha do banco) ficam só nas variáveis do Railway. **Não troque `ENCRYPTION_KEY`**: as chaves de IA, gateways e WhatsApp salvas no banco deixariam de abrir.
As tabelas ficam no schema `domma`, que a API pública da Supabase não expõe. Novas migrações rodam sozinhas quando a API inicia.

## Situação da implementação

Pronto e testado neste ambiente (Postgres + Redis locais, simulador e provedor simulado):
atendimento com os três modos, motor de escrita, porteiro anti-loop, transparência, transferências, fallback entre provedores, Fale com a IA (executa, discorda ou recusa), sugestões, materiais, retorno agendado, classificação de leads, entrada de leads, Dashboard, Relatórios, exportações em PDF/TXT/CSV, equipe e filas, PWA.

Escrito conforme a documentação, mas **ainda não testado com contas reais**: WhatsApp Cloud API, Evolution API, Claude/ChatGPT/Gemini com chave real, Asaas/Mercado Pago/Stripe, Google Agenda, Web Push com VAPID, S3/R2, o `Dockerfile` e o `docker-compose` (não havia Docker disponível). Confira cada integração com a documentação vigente do fornecedor antes de ligar (regra da seção 6).

Ainda não feito (próximas entregas):
- Tela de **Campanhas** (as tabelas já existem; hoje há uma página explicando as etapas)
- Conexão OAuth do **Google Agenda** pelo vendedor (o envio do evento já está pronto no worker)
- Busca semântica com **pgvector** (hoje a base usa busca textual do Postgres em português)
- Painel Bull Board, retorno do status ao Goalfy, 2FA, visão kanban, MCP próprio
