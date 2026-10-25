# GymIA — Etapa 4

## Base e revisão

Esta etapa parte de `2cb87f9c28f9aa9ab8ec5dc476d6c487b050b4e3`, a entrega completa da Etapa 3. Na auditoria de 25/10/2026 a `main` ainda estava em `04def687a5bf91901852b663bf56cf865304f4c4`, com as Etapas 1/2. A branch desta entrega é `feat/etapa-4-expansao-gymia`.

O PR da Etapa 4 deve ter **base `feat/etapa-3-evolucao-gymia`**. Depois que a Etapa 3 for integrada, o responsável deve atualizar a base do PR para `main` e verificar novamente o diff e os testes. Não há merge ou publicação automática. A validação automatizada não depende de testes manuais do usuário.

## Funcionalidades

- Calendário mensal/semanal com recorrência por dias da semana e intervalo de 1–12 semanas, data final explícita, edição de ocorrência ou série, cancelamento, filtro de plano e preferência inicial pelo plano ativo.
- Associação opcional e explícita de agendamentos a registros do mesmo plano. O seletor carrega páginas de 100 registros. Um registro pode estar vinculado a um único agendamento e vice-versa. É possível remover ou substituir o vínculo com confirmação.
- **Iniciar pelo agendamento** cria uma execução real em andamento e vincula os dois itens em uma transação. Não preenche valores, não retroage a data do registro e não conclui o treino. O estado exibido vem do registro, incluindo sessões parciais.
- Biblioteca de 40 atividades, preservando os 16 IDs anteriores. As 24 adições abrangem máquinas, pesos livres, mobilidade, alongamentos, aeróbico e peso corporal. Textos próprios e fontes primárias; nenhuma imagem ou vídeo de terceiros. Busca por nome, região, categoria, equipamento e tipo; filtros e carregamento de 12 cartões por vez no catálogo e no editor.
- Quatro modelos de organização editáveis, somente com nomes de sessões. Não incluem exercícios, séries, cargas ou frequência prescritos. Substituir as sessões da edição exige confirmação; o plano salvo só muda ao salvar.
- Duplicação de sessões com IDs novos, seletor de posição, busca no editor, pré-visualização e comparação dos valores antes de decidir.
- Até 30 versões recentes dos planos, incluindo mudanças de estado. A versão atual no momento da atualização é o ponto inicial: versões anteriores à instalação da Etapa 4 não são inventadas. Comparar não restaura nem sobrescreve dados automaticamente.
- Conflito de edição retorna 409, mantém o conteúdo local e permite comparar com o servidor. Reabrir a versão do servidor exige confirmação quando há alterações locais.
- Assistente com atalhos de assuntos que apenas preenchem a pergunta. Rascunhos continuam editáveis, exigem revisão e podem ser comparados com um plano existente. O modo demonstração permanece identificado como editorial fixo; o adaptador real, consentimentos, minimização, limites e proteção de conteúdo da Etapa 3 continuam em vigor.
- `relatorios.html` oferece histórico por período/plano/exercício/estado, comparação com período anterior, frequência, séries, repetições/duração e cargas reais. A consulta usa páginas de 25 sessões, com exportação completa do período em CSV ou JSON e impressão de todas as páginas.
- Dashboard com resumo da semana configurada, próximas cinco datas ainda sem registro vinculado, sessão em andamento, histórico recente e atalhos.
- Histórico com paginação por cursor, sem perder acesso aos registros além dos primeiros 500. Na interface, 25 registros por página; na API, limite de 1–500. O cursor ordena por instante decrescente e ID crescente, inclusive quando vários registros têm o mesmo instante.

## Recorrência e fuso

Agendamentos representam **datas locais sem horário**. Não são alarmes nem compromissos com hora marcada. O fuso IANA das preferências é usado para determinar “hoje” e a data local de cada execução. Somente a exibição muda ao trocar esse fuso: as datas já planejadas não são deslocadas silenciosamente.

A recorrência é materializada em datas finitas e registra o fuso escolhido naquele momento. A semana da regra começa na segunda-feira; o primeiro dia visual do calendário continua configurável. Horário de verão não produz soma de horas locais: a expansão opera sobre datas, sem um horário suscetível a ser perdido ou duplicado.

Limites: até 200 séries por conta, 200 ocorrências por série, 1000 agendamentos no total e datas até dois anos à frente. Não há extensão infinita ou renovação automática da série.

Editar uma ocorrência cria uma exceção. Cancelar uma ocorrência deixa uma exceção sem agendamento. Ao editar a série, são substituídas apenas as ocorrências futuras sem alteração individual e sem vínculo. Datas passadas, cancelamentos individuais, ocorrências alteradas e registros vinculados são preservados. A nova data inicial define a referência do intervalo semanal da regra editada.

Cancelar a série remove os agendamentos de hoje em diante ainda sem vínculo, incluindo exceções futuras que continuavam agendadas. Mantém datas passadas e registros vinculados. A série fica identificada como cancelada e não pode ser reativada; crie outra se desejar um novo planejamento. Cancelar qualquer agendamento não apaga ou altera o registro realizado.

No calendário, um vínculo pode aparecer na data planejada e a execução na data em que realmente começou. São identificados como vínculo e registro, respectivamente. Dashboard e estatísticas contam apenas linhas reais de execução, uma vez cada; não somam agendamentos como treinos realizados.

## Métricas, relatórios e exportação

As definições da [Etapa 3](ETAPA3.md#definições-dos-indicadores) foram mantidas: sessões encerradas, distinção concluída/parcial, data de início no fuso salvo, campos nulos preservados, zeros informados preservados e comparação com período anterior de igual duração. Valores informados em séries não marcadas como concluídas também são mostrados. Não há inferência clínica, classificação corporal ou estimativa de resultados.

O filtro de exercício seleciona sessões que continham o exercício em seu snapshot. As tabelas/exportações de séries ficam restritas ao exercício selecionado; as contagens referem-se às sessões correspondentes. Planos excluídos continuam preservados nos snapshots do histórico, relatórios e exportações; o seletor de plano lista os planos ainda cadastrados. Em Histórico, nomes de planos antigos são acrescentados conforme registros são carregados.

O CSV contém uma linha por série, com data local, fuso, início ISO, nomes do plano/sessão, estado da sessão, exercício, número da série, marca de conclusão, medida, valor e carga. Ausência de valor vira célula vazia. Campos são citados e aspas são escapadas. Textos com prefixos que poderiam virar fórmula em planilhas recebem um apóstrofo de proteção. O CSV não inclui observações privadas. JSON inclui os snapshots e registros selecionados e o resumo/comparação do período. A exportação integral da conta em Configurações continua disponível e inclui também perfil, preferências, versões, séries recorrentes e rascunhos válidos.

A impressão carrega uma única cópia completa do período, com resumo, comparação e valores de todas as páginas. A folha de impressão oculta navegação, filtros e botões e usa tabelas com cabeçalhos. O navegador oferece as opções de impressora ou salvar PDF; nenhum serviço externo é usado.

O período máximo é de 366 dias. Para proteger a memória do piloto, relatórios recusam consultas acima de 5000 registros ou 32 MiB de payloads criptografados, incluindo período anterior e margem de fuso; pedem um intervalo menor em vez de truncar silenciosamente. CSV, JSON e preparação de impressão entram no limite de cinco exportações por hora da conta, compartilhado com a exportação integral.

## Banco de dados v4

Migração transacional `user_version: 3 → 4`:

| Tabela | Finalidade |
| --- | --- |
| `calendar_series` | Regra criptografada, proprietário, versão e estado cancelado |
| `calendar_occurrences` | Mapeamento entre data original e ocorrência; exceção e tombstone de cancelamento |
| `calendar_links` | Vínculo único entre agendamento e execução do mesmo proprietário |
| `plan_versions` | Até 30 snapshots recentes de conteúdo/estado por plano |

Índices apoiam busca por proprietário, plano e data. Triggers registram versões na mesma operação que grava o plano, inclusive quando outro plano ativo volta ao estado salvo. Excluir um plano remove suas versões; os snapshots de execução permanecem. Excluir a conta remove todas as tabelas novas por cascata.

As tabelas e os payloads das Etapas 1–3 não são reescritos. A chave AES existente é preservada. Payloads de regras usam AES-256-GCM com contexto do proprietário e ID; versões conservam o payload criptografado vinculado ao plano. IDs, datas, vínculos e versões são metadados necessários às consultas. Erros da migração v4 fazem rollback de toda essa migração e fecham a conexão. Uma instalação anterior recusa bancos de versão futura.

Consultas e mutações seguem autenticadas, parametrizadas, com limites, verificação de proprietário, controle de versão, proteção de origem/CSRF e renderização como texto. Não há credencial nova no repositório.

## Organização e desempenho

| Módulo | Responsabilidade |
| --- | --- |
| `server/calendar.mjs` | Recorrência, exceções, vínculos, transações e versões de agendamentos |
| `server/dates.mjs` | Datas locais, validação e intervalos compartilhados |
| `server/reports.mjs` | Paginação dos relatórios e serialização CSV/JSON |
| `server/evolution.mjs` | Dashboard, agregações, preferências, integração e exportação integral |
| `server/training.mjs` | Planos/modelos/versões e paginação do histórico por cursor |
| `server/exercise-additions.mjs` | 24 atividades com fonte individual e classificação |
| `assets/data-ui.js` | Tabelas, campos e download compartilhados |
| `assets/plan-tools.js` | Modelos, pré-visualização, comparação e resolução explícita de conflitos |
| `assets/reports.js` | Relatórios, filtros, exportação e preparação para impressão |
| `assets/evolution.js`, `assets/training*.js` | Integração com as telas e fluxos anteriores |
| `tests/expansion.test.mjs` | Dados, recorrências, versões, relatórios, migração e backup/restauração |
| `tests/browser/expansion.spec.mjs` | Fluxos completos, impressão, acessibilidade e responsividade |

As consultas de calendário/estatísticas/relatórios restringem os instantes no SQLite antes de descriptografar e depois aplicam o fuso exato. O dashboard procura a execução em andamento diretamente. A interface do histórico evita carregar 500 registros de uma vez. A biblioteca apresenta 12 cartões por vez. Tabelas e controles compartilhados reduzem duplicação. Não houve reescrita da plataforma nem mudança de tecnologias/dependências.

## Executar e atualizar no Windows

Node.js 24.14 ou superior da série 24 e pnpm 11. Em uma instalação nova, extraia o código em pasta nova e execute:

```powershell
pnpm install --frozen-lockfile
pnpm run setup
pnpm start
```

Abra `http://localhost:3000`. O setup não sobrescreve `.env` existente. Não abra os HTMLs diretamente.

Para atualizar uma instalação com dados:

1. Reserve manutenção, identifique `DATABASE_PATH`, guarde o código anterior e mantenha uma cópia protegida separada de `.env` e `DATA_ENCRYPTION_KEY`.
2. Antes de atualizar, execute na instalação anterior: `node --env-file=.env scripts/backup.mjs`. A SQLite Backup API gera uma cópia consistente em `backups/` ao lado do banco.
3. Pare o servidor. Atualize somente arquivos de código da versão revisada. Não substitua `.env`, dados ou backups. Não regenere a chave.
4. Execute `pnpm install --frozen-lockfile`. Não é necessário habilitar IA externa ou adicionar serviços pagos.
5. Inicie normalmente; cada migração pendente é aplicada em sua própria transação. Confira login, perfil, preferências, planos, sessão em andamento, calendário e rascunhos com uma conta controlada.
6. Antes de liberar o uso, valide o backup em diretório isolado e confira integridade, vínculos e leitura dos dados. Os testes automatizados deste projeto nunca devem apontar para o banco real.

### Restauração

Pare o servidor e preserve a instalação que apresentou problema. Copie o backup consistente para um diretório novo e vazio; não misture o arquivo com WAL/SHM de outra base. Aponte `DATABASE_PATH` para esse arquivo e use a chave original correspondente.

Antes de reabrir acesso externo, reaplique exclusões feitas depois do backup e revogue sessões/links antigos. Em uma cópia restaurada e com o processo parado, o responsável pode apagar somente as linhas de `sessions` e `resets` com SQLite. Depois confira `PRAGMA integrity_check`, `PRAGMA foreign_key_check`, login e leitura de perfil/planos/histórico. Nunca altere `user_version` para tentar rebaixar o banco.

Para voltar à Etapa 3, restaure um backup v3 junto com o código da Etapa 3. Registros posteriores ao backup não estarão nessa cópia. Código antigo recusa o banco v4, evitando abertura incompatível.

## Testes e limites de validação

Na entrega de 25/10/2026, a suíte completa aprovou 55 testes de API/banco e 20 cenários de navegador (desktop e emulação móvel). Após ajustes de apresentação da comparação, impressão e capturas, os dois cenários completos da Etapa 4 foram reexecutados; o relatório da entrega registra seu resultado e os logs. Os totais do Node incluem agrupadores; a rechecagem repete cenários existentes.

```powershell
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
```

Os testes usam contas fictícias, chaves aleatórias e diretórios temporários. Cobrem regressões de contas/perfis/treinos, isolamento, consentimento, falhas do adaptador, migrações v1/v2/v3 e rollback, preservação de registros e sessão em andamento, recorrências/exceções/cancelamento, vínculos únicos, concorrência, versões, filtros/cálculos, CSV protegido, exportação e paginação de mais de 500 registros com empates de instante.

Backup e restauração são executados pelo script real com a base aberta, incluindo contas, perfis, planos, preferências, regras, exceções, vínculos, versões e rascunhos. A restauração é aberta em diretório isolado com a mesma chave, compara tabelas, verifica integridade e vínculos e recusa chave diferente.

O navegador verifica larguras de 320 a 1440 px, campos, rolagem, teclado, axe WCAG A/AA, tokens/fontes, estado vazio, demonstração, modelos, comparação, conflito entre abas, recorrência, execução vinculada, relatórios, exportações, navegação por páginas e estilos de impressão. As capturas usam dados fictícios. O relatório da entrega registra os resultados efetivamente executados.

Não há teste em aparelhos físicos, todos os leitores de tela, impressoras físicas, SMTP externo, IA de produção ou carga de produção. A impressão foi exercitada pelo navegador com uma chamada de impressão interceptada no teste e inspeção do CSS de mídia impressa; não foi aberta uma impressora real.

## Limitações e próximos passos

As recorrências são semanais, finitas e sem horário, alertas ou renovação automática. Não há calendário compartilhado, importação iCalendar ou integração com serviços externos. A comparação de planos é por campos/sessões, sem mesclagem automática; a restauração de versões antigas é manual pelo editor. Algumas agregações e exportação integral ainda são realizadas em memória: o piloto não é uma solução de alto volume.

IA real continua opcional e desativada por padrão. Nenhuma chamada paga foi feita. A configuração e os dados enviados estão em [ETAPA3.md](ETAPA3.md#provedores-de-ia-e-configuração). Teste com modelo/credencial real depende da autorização do responsável; não se afirma qualidade ou segurança clínica. Os controles de texto são heurísticos e a revisão humana continua obrigatória.

Para a Etapa 5, recomenda-se: agregações incrementais e exportação em fluxo para bases maiores; limites operacionais medidos; metadados indexados para filtros de planos excluídos; auditoria independente de segurança/acessibilidade; aparelhos físicos e impressão real; fluxo de verificação de e-mail; operação/retensão de backups definida; avaliação autorizada do modelo com casos adversariais; e, se houver necessidade, recorrência mensal/alertas com consentimento separado.

## Fontes da biblioteca

Cada atividade tem sua referência clicável. As adições usam [ACE Exercise Library](https://www.acefitness.org/resources/everyone/exercise-library/), [NHS — flexibilidade](https://www.nhs.uk/live-well/exercise/flexibility-exercises/), [NHS — alongamentos](https://www.nhs.uk/live-well/exercise/how-to-stretch-after-exercising/), [University of Illinois — cat/camel](https://eat-move-save.extension.illinois.edu/move/exercise/cat-camel-stretch), [UCLA Health — movimentos do tronco](https://www.uclahealth.org/programs/sports-performance/resources/stay-home-resources/movement-series/core-and-abs-exercise-technique), [American College of Cardiology — atividades](https://www.cardiosmart.org/topics/healthy-living/move-more/tips-to-get-and-stay-active) e [American Heart Association — exercícios](https://www.heart.org/en/health-topics/cardiac-rehab/getting-physically-active/strength-and-balance-exercises). As fontes não representam avaliação individual do usuário e seus volumes de treino não foram incorporados como prescrições.
