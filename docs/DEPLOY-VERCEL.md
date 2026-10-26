# Publicação do GymIA na Vercel

Esta branch parte da Etapa 4 (`152e3bd`) e contém as Etapas 1–4. Os PRs #3 e #4 ainda estavam abertos em 25/10/2026; a main estava na Etapa 2 (`04def68`). O PR desta adaptação usa como base `feat/etapa-4-expansao-gymia`, evitando repetir as entregas anteriores. Nenhum merge é necessário para publicar esta branch explicitamente.

## Arquitetura

O HTML/CSS/JavaScript original e a API Node 24 são servidos pela mesma origem HTTPS. `pnpm run build` gera `.vercel/output` pelo Build Output API, com uma função `gymia` para todas as rotas. A função reutiliza o pool de conexões, mas consulta cada sessão no banco. Páginas privadas continuam autenticadas no servidor; não são expostas como arquivos estáticos. Cores, fontes e arquivos de interface não foram redesenhados.

`DATABASE_URL` seleciona PostgreSQL. Sem ela, a instalação local continua usando SQLite v4. **Na Vercel a ausência de DATABASE_URL causa recusa de inicialização**, sem fallback para `/tmp`, memória, arquivos locais ou demonstração de persistência. A camada PostgreSQL preserva IDs, relacionamentos, exclusões em cascata, um único plano ativo, uma execução em andamento, histórico independente, versões e criptografia dos payloads.

O PostgreSQL guarda contas, hashes de sessões/recuperação, preferências, planos, versões, execuções, calendário, recorrências, vínculos e rascunhos. Não há uploads de arquivos. Exportações são respostas HTTP; backups são produzidos pelo operador fora do diretório público.

As transações usam uma conexão dedicada e bloqueios por conta, inclusive entre instâncias da Vercel, antes de conferir a versão e salvar. O limite de requisições é atualizado atomicamente no banco. A migração inicial e a conferência de chave são transacionais e usam bloqueio próprio. Timestamps e contagens mantêm o contrato numérico da API anterior.

## Serviços e planos

Escolha prevista: **Vercel Hobby + Neon Free**, usando a URL com pool do Neon. Nenhum serviço foi provisionado por esta documentação, nenhuma cobrança foi autorizada e nenhuma credencial está no repositório.

Em consulta às páginas oficiais em 25/10/2026, o Neon Free indicava 1 GB e 100 CU-h mensais por projeto, suspensão de computação ociosa e restauração pontual limitada a até 6 horas/1 GB de alterações. O Hobby da Vercel restringe-se a uso pessoal não comercial, com cotas próprias e suspensão de recursos ao excedê-las. Confirme os números e a oferta efetiva no momento da criação; planos do Marketplace podem ter condições diferentes. Não habilite upgrade, cartão ou cobrança automática para este piloto.

- [Vercel Hobby](https://vercel.com/docs/plans/hobby)
- [Neon Free e limites](https://neon.com/pricing)
- [Neon na Vercel](https://vercel.com/marketplace/neon)

## Publicação específica desta branch

1. Autentique sua conta em [Vercel](https://vercel.com/dashboard). Se aparecer autorização do GitHub, conclua somente com a conta e o acesso que você pretende usar. Se for necessário aceitar termos ou ampliar permissões do repositório, o responsável deve conferir e concluir essa etapa.
2. Importe `mattospower/gymAI` como projeto **GymIA**. Selecione explicitamente `feat/deploy-vercel-gymia` como branch de produção. Não publique a main enquanto as Etapas 3/4 não forem integradas por revisão.
3. Use plano gratuito, Framework **Other**, raiz do repositório, Node **24.x**, instalação `pnpm install --frozen-lockfile` e build `pnpm run build`. Não selecione uma pasta de HTML público como Output Directory: o build gera `.vercel/output` com a função autenticada.
4. Crie um projeto PostgreSQL **vazio** no Neon Free e obtenha sua URL com pool. Use a mesma região, ou uma região próxima da função (padrão Vercel `iad1`, Washington). Não importe nenhum SQLite existente nesta etapa.
5. Configure as variáveis abaixo nos segredos do projeto da Vercel para Production. Registre as chaves em um gerenciador de senhas separado. Não as publique no GitHub, em screenshots ou neste chat.
6. Confirme o domínio gratuito atribuído ao projeto e defina APP_ORIGIN com essa origem exata HTTPS, sem barra final. Faça o deploy da branch indicada. A primeira inicialização aplica o esquema PostgreSQL transacionalmente.
7. Acesse a origem configurada e execute os fluxos de aceitação abaixo com contas fictícias. A URL única de um deploy e outros aliases não são aceitos como origens extras; a aplicação rejeita Host e Origin diferentes de APP_ORIGIN. Para previews, use outro banco e outras chaves e configure a origem do preview. Nunca compartilhe o banco de produção com PRs não confiáveis.

| Variável | Configuração |
| --- | --- |
| NODE_ENV | `production` |
| APP_ORIGIN | Origem HTTPS pública exata do projeto |
| DATABASE_URL | URL PostgreSQL com pool; TLS verificado em produção |
| DATA_ENCRYPTION_KEY | 32 bytes aleatórios, 64 dígitos hexadecimais; persistente |
| AI_PROVIDER | `demo` |
| AI_ALLOW_PAID | `false` |
| SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, MAIL_FROM | Opcionais, todos necessários para recuperação; porta 465/587 com TLS |

Gere uma chave nova para a instalação vazia usando um gerenciador seguro ou `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` num terminal privado. Não execute isso para substituir a chave de uma instalação que já tem dados. O build não precisa de acesso ao banco nem de segredos; eles só são usados pelo servidor na execução. Não configure nomes `PUBLIC_` ou `NEXT_PUBLIC_` para essas variáveis.

Sem SMTP, a recuperação é exibida como indisponível. Com SMTP, confirme entrega real, remetente autorizado, expiração e revogação. Os testes automatizados capturam e-mail somente em memória: não comprovam entrega externa. O envio é aguardado pela invocação, e uma falha invalida o token sem registrar destinatário, mensagem ou segredo.

O assistente permanece no modo editorial demonstrativo identificado que já existia no produto. O restante do site usa dados e autenticação reais. Ativar OpenAI exige configurar credencial/modelo, habilitar custos explicitamente e validar separadamente; esta publicação não autoriza chamadas pagas.

## Segurança e operação

- HTTPS é fornecido pelo domínio da Vercel. A aplicação exige origem HTTPS em produção e envia HSTS, CSP, proteção de frame, tipos de conteúdo e `no-store`.
- Cookies `__Host-`, Secure, HttpOnly, SameSite=Strict, validade absoluta de 12 horas; tokens só em hash no banco. Logout, troca de senha e exclusão revogam o acesso.
- Mutação exige JSON, origem exata e cabeçalho personalizado. Não há CORS aberto. Validação e isolamento por usuário continuam no servidor; payloads sensíveis usam AES-256-GCM e senhas usam scrypt.
- O IP encaminhado é aceito apenas no runtime da Vercel, pelo cabeçalho que ela fornece. Contadores usam HMAC e expiração persistente. Limites de operação por instância (duas derivações de senha ou chamadas simultâneas de IA) continuam locais; quotas de tentativas e de uso ficam no PostgreSQL. Isto não substitui proteção volumétrica da plataforma.
- Pool limitado a quatro conexões por instância, consulta e conexão com timeout; configure o limite de conexões e observe o uso do provedor. Não armazene dados reais antes de definir responsáveis, contato privado e retenção de backups.
- Exportações usam a função com streaming habilitado, preservando relatórios completos. A Vercel limita respostas não transmitidas por streaming a 4,5 MB. Confirme exportações grandes na URL hospedada; relatórios continuam limitados a 5.000 registros/32 MiB por período conforme Etapa 4.

## Migração opcional de dados SQLite

**Nenhum dado pessoal real foi transferido.** Uma nova publicação deve começar com banco vazio. Preserve `.env`, chave e SQLite original. A ferramenta abaixo só deve ser executada após autorização específica do responsável para enviar aqueles dados ao serviço escolhido.

1. Pare gravações no servidor antigo ou use o backup consistente já existente (`scripts/backup.mjs`). Preserve uma cópia intocada do SQLite original. Atualize somente uma cópia para o esquema v4, se necessário.
2. Em ambiente administrativo protegido, configure DATABASE_URL do destino vazio e DATA_ENCRYPTION_KEY **original**, fora do Git. A importação lê o SQLite com acesso somente de leitura e confere integridade e relacionamentos.
3. Execute deliberadamente:

```sh
node --env-file=.env scripts/postgres-data.mjs import-sqlite CAMINHO-DA-COPIA-v4.sqlite --allow-personal-data-transfer
```

O destino é bloqueado e deve estar vazio. Inserções e conferência de contagens são uma transação; erro desfaz a importação. IDs e payloads criptografados são preservados. Sessões, links de recuperação e contadores antigos não são importados, exigindo novo login. Nenhuma tabela existente é sobrescrita. Execute validação de amostras e aceite antes de alterar a origem pública; o SQLite original não é excluído.

## Backup e restauração

Configure também **BACKUP_ENCRYPTION_KEY**, 32 bytes/64 hex, separada da chave dos dados. Guarde as duas fora do backup. A captura PostgreSQL usa snapshot consistente em transação REPEATABLE READ; o arquivo inteiro é criptografado, incluindo nomes e e-mails. Arquivos não são sobrescritos.

```sh
node --env-file=.env scripts/postgres-data.mjs backup backups/gymia-2026-10-25.gymia-backup
```

Copie o backup criptografado para armazenamento privado sob responsabilidade da equipe. A ferramenta é manual: não há agendamento nem promessa de backup automático. Defina frequência e retenção antes de uso com participantes; a janela curta do plano gratuito não substitui sua cópia independente.

Para testar ou restaurar, configure DATABASE_URL de **outro banco vazio**, DATA_ENCRYPTION_KEY original e BACKUP_ENCRYPTION_KEY do arquivo:

```sh
node --env-file=.env scripts/postgres-data.mjs restore backups/gymia-2026-10-25.gymia-backup --confirm-empty-target
```

A restauração confere chave, formato, integridade referencial e contagens, preserva versões e revoga sessões/links antigos. Confira usuários, planos, registros, recorrências, exceções, vínculos, preferências e rascunhos. Antes de recolocar um backup antigo em serviço, reaplique exclusões e retiradas de consentimento feitas após sua captura. Para reverter código, publique um deploy anterior compatível com o mesmo esquema/chave; não apague o banco nem gere outra chave.

## Verificação reproduzível

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm run build
pnpm run test:deploy
pnpm exec playwright install chromium
pnpm run test:e2e:postgres
```

`pnpm test` inclui regressões SQLite, engine PostgreSQL real compilada para WASM (PGlite), migração, restauração, concorrência e reinício em disco. `test:e2e:postgres` executa a mesma suíte de navegador usando PostgreSQL, em desktop e emulação móvel. `test:deploy` testa o pacote produzido, resolução interna das dependências e ausência de segredos/dados; seu teste HTTP usa SQLite temporário fictício para conferir o empacotamento, não simula a infraestrutura da Vercel. Os testes não acessam contas reais nem serviços externos.

Depois da publicação, é obrigatório verificar na **URL pública**: cadastro, login/logout, cookie seguro, perfil/preferências, 40 exercícios, plano/versões/ativação, início e término de treino, histórico, calendário e recorrência, dashboard, relatórios/CSV/JSON/impressão, exportação, assistente demonstrativo e recuperação quando configurada. Faça novo deploy e confirme persistência e sessão; tente acesso cruzado com uma segunda conta fictícia. A validação local não comprova DNS/HTTPS, TLS do provedor, entrega SMTP, limites de concorrência hospedados ou desempenho real.

Referências: [Build Output API](https://vercel.com/docs/build-output-api/primitives), [Node.js](https://vercel.com/docs/functions/runtimes/node-js), [limites de funções](https://vercel.com/docs/functions/limitations), [cabeçalhos da Vercel](https://vercel.com/docs/headers/request-headers), [transações node-postgres](https://node-postgres.com/features/transactions).
