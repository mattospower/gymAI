# GymIA — Etapa 3

## Base e escopo

O PR #2 foi integrado à `main` no commit `04def687a5bf91901852b663bf56cf865304f4c4`. A branch `feat/etapa-3-evolucao-gymia` parte desse commit. Não houve merge automático ou publicação. Não foi encontrado TCC nos arquivos disponíveis; README e funcionalidades existentes orientaram a implementação.

## Funcionalidades

- **Painel em `treinos.html`:** plano ativo, próxima data planejada, contagem integral de sessões concluídas e parciais, cinco últimos treinos e links diretos para seus registros. Sem dados, os cartões explicam como começar.
- **`calendario.html`:** mês/semana, navegação, primeiro dia da semana configurável, agendamento manual, alteração com controle de versão e cancelamento confirmado. Agendamentos guardam nomes como uma cópia do momento do planejamento. Excluir ou editar um plano não reescreve esses nomes; se a sessão deixou de existir, escolha outro plano/sessão ao reagendar. Agendar nunca inicia nem conclui um treino. O calendário mostra também sessões em andamento, concluídas e parciais.
- **`evolucao.html`:** filtros de período, exercício e estado; sessões por semana/mês, dias com registros, frequência semanal normalizada, intervalo médio, exercícios mais registrados, cargas, repetições/duração e comparação com período anterior de igual duração. Gráficos de barras nativos com rótulos acessíveis, números visíveis e tabelas. Sem classificação corporal ou metas automáticas.
- **Biblioteca:** 16 movimentos, preservando os dez IDs anteriores. Seis adições com textos próprios e referências individuais da ACE. Pesquisa sem acentos por nome/região/categoria, filtro de região, equipamento, categoria e equipamentos do perfil. O seletor do editor usa a mesma biblioteca. Sem mídia de terceiros.
- **Treinos:** duplicação de sessão no editor com novos identificadores; indicador de envio do plano; revisão de rascunho no mesmo editor; acesso direto do calendário/painel a um registro específico do histórico, inclusive fora dos 500 mais recentes. Permanecem confirmação de exclusão, versões, salvamento e retomada das sessões existentes.
- **`configuracoes.html`:** fuso IANA, visualização inicial, início da semana, dois consentimentos separados, exportação JSON completa e acessos a edição do perfil, exclusão de conta com senha e privacidade.
- **`assistente.html`:** perguntas gerais, explicação da biblioteca, contexto opcional de plano e perfil, rascunhos revisáveis, lista de rascunhos pendentes, retomada e descarte. A instalação começa em demonstração editorial local, claramente identificada.

As extensões usam os tokens, fontes, cartões, botões, cabeçalho, rodapé e navegação existentes. Não há framework CSS novo. O CSS anterior foi preservado e recebeu regras locais para os novos componentes.

## Definições dos indicadores

O fuso padrão é `America/Sao_Paulo`, alterável em Configurações. Agendamentos são datas sem hora. O calendário e os agrupamentos estatísticos usam o fuso salvo; o histórico anterior continua exibindo horários no fuso do navegador.

Somente sessões encerradas entram nas estatísticas; o filtro distingue `completed` e `partial`. A conclusão é a escolha registrada pelo usuário e não implica que todas as séries tenham sido preenchidas. O filtro de exercício seleciona sessões que contêm esse exercício no snapshot. Séries com valor diferente de `null` entram nas somas, mesmo sem a marca de conclusão. Zero informado é preservado; ausência de carga continua ausente.

- Frequência semanal = número de sessões filtradas ÷ dias inclusivos do período × 7.
- Dias registrados = datas distintas com sessões encerradas filtradas.
- Intervalo médio = média dos intervalos entre os inícios das sessões filtradas, em dias de 24 horas. Com menos de duas sessões, exibe ausência de informação.
- Exercícios mais registrados = sessões distintas com ao menos um valor realizado informado para aquele exercício.
- Carga = maior valor informado por exercício, modo e sessão; repetições e segundos são somados separadamente. Entradas repetidas do mesmo exercício/modo são agrupadas. Não se calcula carga a partir do peso corporal nem se preenchem campos vazios.
- Semana respeita o primeiro dia configurado. Buckets nas bordas abrangem apenas os dias do filtro. Sem registros, o bucket tem zero.
- Comparação utiliza o período imediatamente anterior com a mesma quantidade de dias.

Dashboard, calendário, estatísticas e exportação não usam o corte de 500 registros da listagem antiga de histórico. O período consultável no calendário/estatísticas é de até 366 dias. O piloto lê os registros do proprietário em memória; bancos grandes exigirão paginação/agrupamentos persistidos. Não há teste de carga de produção.

## Banco e preservação

Migração transacional `PRAGMA user_version: 2 → 3` (ou `1 → 2 → 3`):

| Tabela nova | Conteúdo |
| --- | --- |
| `user_preferences` | Fuso, calendário, consentimentos, versão e atualização |
| `calendar_events` | Proprietário, data, cópia do plano/sessão, versão e datas de criação/atualização |
| `ai_drafts` | Rascunho, preferências usadas, origem, criação e expiração |

Payloads novos usam AES-256-GCM e a chave existente, com contexto vinculado ao usuário e ao tipo/ID do recurso. Datas, IDs, versões e vínculos necessários às consultas são metadados em colunas. As tabelas antigas não são reescritas; contas, perfis, planos, cookies de sessão, snapshots, registros encerrados e sessões em andamento são preservados. Exclusão de conta usa cascatas. Erro de migração faz rollback e fecha a conexão. Banco de versão futura e chave incompatível são recusados.

Limites: 1000 agendamentos por conta; datas entre hoje e dois anos à frente; 20 rascunhos pendentes, válidos por sete dias. Rascunhos expirados ficam inacessíveis e são removidos na próxima chamada ao assistente. Limites anteriores de planos e treinos manuais continuam os mesmos.

## Provedores de IA e configuração

`server/ai.mjs` define o contrato `generate({kind, message, preferences, organization, plan, exerciseId}) → {answer, plan}`. O despachante, consentimentos e validações independem da implementação. Há dois adaptadores: `demo` e `openai`. Um novo adaptador deve ser explicitamente adicionado à fábrica; não existe endpoint externo arbitrário recebido do navegador.

O modo `demo` retorna explicações editoriais e uma estrutura fixa de exemplo. Não interpreta perguntas nem produz personalização por IA. Não envia dados à rede e não requer autorização de cobrança. O objetivo do formulário é copiado para o exemplo; os exercícios e valores são fixos e declarados como tal.

Para ativar OpenAI, o responsável precisa autorizar os custos do próprio serviço, verificar acesso a um modelo compatível com Responses e Structured Outputs e configurar **no servidor**, sem publicar valores:

```dotenv
AI_PROVIDER=openai
AI_ALLOW_PAID=true
OPENAI_API_KEY=seu-segredo-somente-no-servidor
AI_MODEL=modelo-compativel-disponivel-na-sua-conta
```

Não há modelo ou preço presumido. Não preencha esses exemplos literalmente. `AI_ALLOW_PAID` é uma trava operacional, não compra créditos nem substitui o controle de gastos da conta. Configure limites no provedor antes de habilitar. Com configuração incompleta, a interface informa indisponibilidade; não inventa uma resposta ou troca silenciosamente para demonstração.

Nenhuma chamada externa paga foi executada durante o desenvolvimento. O adaptador foi testado com transporte controlado somente nos testes. Compatibilidade e qualidade com a credencial/modelo que forem escolhidos permanecem pendentes de teste autorizado.

O adaptador usa `POST https://api.openai.com/v1/responses`, saída com JSON Schema, `store:false`, máximo de 3000 tokens de saída, timeout de 20 segundos, resposta limitada a 128 KiB e nenhuma ferramenta externa. Recusa, resposta incompleta, JSON inválido, falha HTTP e timeout geram erro claro sem salvar plano. Não há retry automático que possa multiplicar cobranças.

Fontes do contrato: [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create) e [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs). A interface exibe respostas como texto, sem interpretar HTML/Markdown do provedor.

### Dados enviados e consentimento

Para cada chamada externa são necessários consentimento persistido e confirmação de envio da solicitação. O perfil tem autorização separada, desmarcada por padrão. O usuário pode usar os campos manuais de objetivo, experiência, disponibilidade e equipamento sem compartilhar seu perfil salvo.

| Dado | Quando é enviado |
| --- | --- |
| Mensagem e preferência de organização | Quando preenchidos e o envio é confirmado |
| Objetivo, experiência, dias, minutos e grupos de equipamentos | Campos manuais do rascunho, ou perfil após autorização e seleção explícitas |
| Objetivo e exercícios/séries/alvos/descansos de um plano | Somente se o usuário selecionar o plano, validado como próprio |
| Biblioteca e instruções gerais do GymIA | Contexto do aplicativo |
| Nome, e-mail, identificador da conta, limitações físicas, nomes e observações de planos/treinos | Não adicionados automaticamente |

Não escreva dados sensíveis em campos livres: o texto digitado é enviado quando autorizado. O grupo “outros” e a descrição livre de equipamento não são usados nos rascunhos; use os grupos suportados. Mensagens/respostas de conversa não ficam no banco ou nos logs do GymIA. Somente rascunhos validados são persistidos, criptografados, até expirar, ser descartados ou ser convertidos em plano.

`store:false` não é promessa de retenção zero no provedor. O responsável deve revisar as políticas da conta/provedor antes de disponibilizar a integração. Revogar consentimento impede novos envios; não desfaz o que já chegou ao provedor. Se a autorização mudar enquanto uma chamada aguarda resposta, o retorno é descartado; autenticação também é revalidada após a espera.

### Controles de uso e conteúdo

- Até 2000 caracteres por mensagem e 200 por organização; corpo das rotas novas até 32 KiB.
- 20 pedidos por usuário/hora, 200 por instalação/hora; contadores SQLite persistem ao reiniciar. No máximo dois pedidos simultâneos por processo e um por usuário. Limites gerais das rotas novas: 300 consultas/alterações em 15 minutos por conta; exportação: cinco por hora.
- Pedidos identificados como saúde/risco ou dietas restritivas recebem orientação local para procurar profissional, sem chamada externa. Instruções do modelo proíbem diagnóstico, prescrição clínica, garantias, padrões corporais prejudiciais e incentivo a ignorar dor.
- Rascunhos: IDs existentes da biblioteca, objetivo compatível, no máximo quatro sessões e os dias disponíveis, seis exercícios por sessão, três séries, 20 repetições ou 60 segundos por série, descanso entre 30 e 180 segundos, equipamento disponível e estimativa de tempo dentro da disponibilidade. Esses limites são barreiras do software, **não recomendações pessoais**.
- Rascunho nunca é ativado automaticamente. O usuário revisa no editor, pode alterar e deve confirmar antes de salvar. O servidor valida novamente os limites e cria um plano `saved`, mantendo o plano ativo anterior. A conversão e a remoção do rascunho são atômicas.

Os controles de texto são heurísticos e o modelo pode errar; não equivalem a avaliação clínica ou garantia de segurança. Revisão profissional e avaliação adicional de prompts adversariais são necessárias antes de usar com participantes externos. A IA não tem acesso de escrita às contas, ao calendário ou ao histórico.

## Executar no Windows

Instale Node.js 24 LTS (24.14 ou superior da série 24) e pnpm 11. No PowerShell, dentro da pasta do projeto:

```powershell
pnpm install --frozen-lockfile
pnpm run setup
pnpm start
```

Abra `http://localhost:3000`. `setup` cria `.env` somente se ele não existir; nunca substitui a chave. Também é possível usar npm instalado com Node, mas o lockfile do projeto é o do pnpm. Não abra o HTML diretamente: é necessário o servidor Node para autenticação e persistência.

O padrão é demonstração local. Não é necessário configurar OpenAI nem contratar serviços para calendário, evolução, biblioteca, exportação ou treinos.

## Atualizar uma instalação da Etapa 2

1. Reserve uma janela de manutenção e confira o local do banco em `DATABASE_PATH`. Não execute testes contra esse banco.
2. Com o código anterior ainda disponível, execute `node --env-file=.env scripts/backup.mjs`. O script usa a SQLite Backup API e cria uma cópia consistente no diretório `backups` ao lado do banco. Guarde a chave e `.env` em cópia protegida separada.
3. Pare a aplicação. Preserve também uma cópia da instalação anterior. Atualize somente os arquivos de código da versão revisada; não substitua `.env`, `data/` ou backups. A branch de desenvolvimento deve ser revisada antes de integrar à `main`.
4. Execute `pnpm install --frozen-lockfile`. Não regenere `DATA_ENCRYPTION_KEY`. As novas variáveis de IA são opcionais: a ausência mantém o modo local. Se adicioná-las, edite apenas os novos campos, mantendo os segredos existentes.
5. Inicie com `pnpm start`. A migração para v3 é automática e transacional. Confira login, perfil, plano ativo, sessão em andamento, histórico e exportação com uma conta controlada.
6. Valide a cópia de backup em diretório isolado antes de liberar o uso. Os testes automatizados não utilizam nem alteram a instalação real.

### Restaurar sem misturar banco e WAL antigos

Pare o servidor. Preserve o diretório da instalação com problema para análise. Copie o backup consistente para **um diretório novo e vazio**, por exemplo `data-restaurados/gymia.sqlite`; não misture o arquivo restaurado com `-wal`/`-shm` de outra base. Configure `DATABASE_PATH` para esse novo arquivo e use a chave correspondente ao backup. Nunca gere outra chave para “corrigir” falha de descriptografia.

Antes de reabrir o serviço, o responsável deve reaplicar exclusões ocorridas depois do backup e revogar cookies/links de recuperação anteriores. Em uma cópia restaurada, isso pode ser feito com SQLite apagando somente as linhas de `sessions` e `resets`, com o servidor parado. Depois confira `PRAGMA integrity_check` e `PRAGMA foreign_key_check`, login e leitura do perfil/histórico. Teste inicialmente com acesso local restrito.

O código da Etapa 2 recusa um banco v3. Para voltar à Etapa 2, restaure o backup v2 junto com o código antigo e sua chave; novos registros feitos após o backup não estarão nessa cópia. Não altere `user_version` manualmente em dados reais.

## Testes e limites de validação

Na entrega de 24/10/2026, `pnpm test` aprovou 42 testes e `pnpm test:e2e` aprovou 18 cenários. O backup foi criado pelo script real com a base aberta e restaurado em diretório isolado, preservando conta e perfil criptografado; as verificações de integridade e vínculos passaram. Nenhum banco de produção foi utilizado.

```powershell
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
```

Os testes usam bases temporárias em `test-results`, chaves aleatórias e contas fictícias. Incluem regressões das Etapas 1/2, migrações v1/v2, rollback, chave incompatível, sessão em andamento, persistência, isolamento de calendário/estatísticas/rascunhos/exportação, CSRF, limites, estados concluído/parcial, períodos/fuso, histórico com mais de 500 registros, consumo do rascunho após revisão e falhas do adaptador. A simulação de transporte do provedor existe somente nos testes; o modo de demonstração da aplicação é editorial e explicitamente rotulado.

O navegador verifica as telas e os fluxos em Chromium desktop e emulação móvel, larguras de 320 a 1440 px, limites dos campos, foco/teclado, axe WCAG A/AA, tokens e fontes, XSS como texto e capturas de tela. Não equivale a teste em aparelho físico, cobertura de todos os leitores de tela ou auditoria independente. O relatório da entrega registra resultados realmente executados.

Limitações: sem IA externa validada com credenciais reais; sem conversas persistentes ou memória de chat; sem automação de calendário/recorrência ou vínculo automático entre agendamento e execução; sem modo offline; catálogo inicial de 16 exercícios; processamento de estatísticas e exportação em memória adequado ao piloto; sem teste de carga ou restauração de produção; SMTP externo depende da instalação anterior. O rascunho respeita tetos técnicos conservadores e pode ser recusado se não couber na disponibilidade.

## Organização dos arquivos

| Arquivos | Responsabilidade |
| --- | --- |
| `server/evolution.mjs` | Preferências, calendário, dashboard, agregações e exportação |
| `server/ai.mjs` | Adaptadores, limites, consentimento, segurança, rascunhos e revisão |
| `server/store.mjs` | Migração v3 e rollback |
| `server/app.mjs`, `server/index.mjs` | Rotas autenticadas, arquivos privados e configuração de provedor |
| `server/exercises.mjs` | Biblioteca ampliada com fontes |
| `assets/evolution.js` | Interfaces de calendário, estatísticas, assistente e configurações; resumo do painel |
| `assets/training.js`, `assets/training-ui.js` | Integração do editor, duplicação, revisão, links ao histórico e filtros |
| `assistente.html`, `calendario.html`, `evolucao.html`, `configuracoes.html` | Novas páginas privadas usando o tema original |
| `style.css` | Somente extensão dos componentes para as novas telas |
| HTMLs existentes | Navegação e textos de disponibilidade/privacidade da Etapa 3 |
| `.env.example`, `README.md`, `docs/ETAPA3.md` | Configuração, operação e documentação |
| `tests/evolution.test.mjs`, `tests/browser/evolution.spec.mjs` | Cobertura da Etapa 3 |
| `tests/backup.test.mjs` | Backup real e restauração em base isolada |
| Testes de treinos anteriores | Expectativas atualizadas para schema v3 e catálogo de 16 itens |
