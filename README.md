# gymAI — etapa 1

Evolução do HTML/CSS original para contas reais e perfis de treinamento. Preserva a paleta, as fontes Archivo, DM Sans e JetBrains Mono e os componentes da página inicial. Não gera treinos por IA nesta etapa.

## Executar localmente

Requer **Node.js 24 LTS, versão 24.14 ou superior da série 24**, e pnpm 11 (ou npm instalado com Node).

```sh
pnpm install --frozen-lockfile
pnpm run setup
pnpm start
```

Abra **http://localhost:3000**. O comando `setup` cria `.env` com uma chave aleatória; não substitui uma configuração existente. Alternativamente, use `npm install`, `npm run setup` e `npm start`. O lockfile reproduzível adotado no projeto é `pnpm-lock.yaml`.

O servidor atende o HTML original e a API na mesma origem. **Abrir arquivos diretamente ou usar somente GitHub Pages/Live Server não executa a autenticação.** As páginas privadas são protegidas pelo servidor e pela API. Não há conta de demonstração ou senha padrão.

## Funcionalidades

- Cadastro com nome, e-mail, senha e aceite dos documentos; login e logout reais.
- Configuração de objetivo, experiência, dias, tempo, local, equipamentos e limitações opcionais em três passos.
- Painel com consulta, edição, retirada de consentimento e exclusão de conta com confirmação da senha.
- Recuperação de senha por link com validade de 30 minutos, uso único e revogação das sessões existentes. Depende de SMTP.
- Navegação responsiva com menu móvel, campos rotulados, foco visível e mensagens acessíveis.
- Páginas de termos, privacidade e contato adequadas ao estágio do protótipo.

## Arquitetura e escolha

HTML, CSS e JavaScript sem framework no navegador; servidor HTTP e SQLite nativos do Node; **Nodemailer é a única dependência de execução**. Não há SDK de IA nem serviços contratados.

Esta escolha permite executar e verificar contas e persistência sem criar um serviço externo. SQLite atende ao piloto acadêmico pequeno descrito no TCC, em uma única instância com disco persistente. Não é uma arquitetura para múltiplas réplicas ou alto volume. O `node:sqlite` é uma API ainda em evolução; a versão mínima é explícita e deve ser atualizada com os patches de segurança do Node.

Supabase/Firebase também permitiriam contas reais, mas exigiriam a criação de projeto, configuração de regras de acesso, e-mails e credenciais antes de verificar os fluxos completos. Podem ser avaliados se o grupo precisar manter hospedagem exclusivamente estática. A versão atual requer um processo Node e disco persistente; não pressupõe que haverá hospedagem gratuita com essas características.

## Configuração

Copie os nomes de `.env.example`, sem publicar valores reais:

| Variável | Uso |
| --- | --- |
| `NODE_ENV` | `development` local; `production` na hospedagem |
| `HOST` | `127.0.0.1` por padrão, adequado para acesso local/proxy |
| `PORT` | Porta interna, padrão `3000` |
| `APP_ORIGIN` | Origem exata, sem barra final, caminho ou parâmetros; HTTPS obrigatório em produção |
| `DATA_ENCRYPTION_KEY` | Chave de 32 bytes em hexadecimal; gerada no setup local |
| `DATABASE_PATH` | Caminho do SQLite, padrão `./data/gymia.sqlite` |
| `SMTP_HOST` | Servidor SMTP do provedor escolhido |
| `SMTP_PORT` | `587` com STARTTLS obrigatório ou `465` com TLS direto |
| `SMTP_USER` / `SMTP_PASSWORD` | Credenciais somente no servidor |
| `MAIL_FROM` | Remetente autorizado pelo provedor |

Para configurar recuperação, o responsável precisa escolher um provedor SMTP, autorizar o remetente e colocar **todos os campos SMTP** no `.env` ou gerenciador de segredos da hospedagem. Senhas de aplicativo/OAuth e validação de domínio dependem do provedor. Nada é contratado ou enviado automaticamente durante a instalação.

Sem SMTP, o site informa que a recuperação está indisponível e desativa o envio. Com SMTP, a resposta é genérica para proteger a existência de contas. Uma falha de entrega é registrada no servidor sem e-mail/token e o token daquela tentativa é invalidado. A aceitação SMTP não garante entrega na caixa de entrada: valide spam, expiração e remetente com contas de teste após configurar o provedor.

## Segurança e dados

- Senhas com **scrypt N=131072, r=8, p=1**, salt aleatório de 16 bytes. Operações caras assíncronas limitadas a duas simultâneas.
- Cookies `HttpOnly; SameSite=Strict`, duração absoluta de 12 horas. Em HTTPS, também `Secure` e prefixo `__Host-`. Logout, redefinição e exclusão invalidam sessões no servidor. Tokens aleatórios de 256 bits; somente seus hashes ficam no SQLite.
- Mutação exige a origem configurada, JSON e cabeçalho personalizado; não há CORS permissivo. Consultas SQL parametrizadas, limite de corpo e controles de tentativas persistidos no banco.
- Todas as preferências são criptografadas com AES-256-GCM, IV novo e contexto vinculado ao ID da conta. Nome e e-mail são armazenados no banco de contas. A chave fica fora do banco e nunca é enviada ao navegador. O aplicativo recusa iniciar com uma chave diferente da usada no banco.
- Limitações exigem autorização específica, registrada no perfil criptografado. Apagar o campo e salvar retira a autorização e o conteúdo da base ativa.
- Exclusão exige senha e `EXCLUIR`; remove conta, perfil, links e sessões por integridade referencial. `secure_delete` e checkpoint do WAL reduzem vestígios na base ativa. Isso não controla cópias de backup já existentes nem garante apagamento físico do dispositivo.
- Limites técnicos usam identificadores derivados por HMAC; expiram em até uma hora e são removidos na próxima chamada à API. Nenhum dado de formulário é registrado nos logs.
- Conteúdo privado usa `Cache-Control: no-store`; o navegador revalida páginas restauradas pelo histórico. Senhas, tokens e perfil não vão para `localStorage` ou `sessionStorage`.
- Arquivos do servidor, `.env`, SQLite e dependências não pertencem à lista de arquivos públicos. CSP restrita, proteção de frame, tipos de conteúdo e política de referência são enviados pelo servidor.

**Guarde uma cópia protegida da chave separadamente do backup do banco.** Perder a chave perde o acesso aos perfis. Não execute `setup` para trocar uma chave existente, não apague `.env` ao atualizar e não tente rotacionar a chave sem recriptografar os dados por uma migração específica.

O cadastro não inclui confirmação de propriedade do e-mail nesta etapa. Use contas de teste no piloto; confirme os endereços por um processo controlado antes de aceitar dados reais de participantes externos. Não há MFA, login Google/Apple, pesquisa com participantes, geração de treinos ou avaliação clínica.

## Antes de disponibilizar a participantes externos

Nenhuma publicação é feita por este projeto. A equipe precisa autorizar e preparar:

1. Hospedagem com Node 24 e **volume persistente**, HTTPS e proxy que preserve o cabeçalho Host da origem configurada. Apenas o proxy deve alcançar a porta interna. O servidor não confia em `X-Forwarded-For`; atrás de proxy o limite por IP será compartilhado, então configure também proteção por IP no próprio proxy.
2. Segredos de produção, acesso restrito aos arquivos e ao processo, backups criptografados com SQLite Backup API (ou processo parado), restauração testada e prazo explícito de retenção. Ao restaurar backup, reaplique exclusões de contas e revogue sessões/links antigos.
3. SMTP e teste de entrega real em um endereço controlado.
4. Identificação do responsável pela instalação, canal privado de contato e revisão dos documentos de privacidade, incluindo os prazos efetivos de backup. As páginas atuais deixam essas dependências claras.
5. Processo de verificação de e-mail e consentimento específico se houver pesquisa acadêmica. O aceite de uso da plataforma não autoriza participação em pesquisa.

Não hospede dados reais de saúde em um diretório público ou em disco efêmero. O grupo deve definir a operação antes de coletá-los. Isso não é uma declaração de conformidade legal ou auditoria de segurança independente.

## Testes

```sh
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
```

Os testes de API usam SQLite em disco temporário, contas fictícias e envio de e-mail capturado **somente em memória no teste**. Não existe caminho de envio simulado no aplicativo. Cobrem validação, isolamento, criptografia, reinício, login/logout, expiração, recuperação de uso único, revogação e exclusão. Não comprovam entrega SMTP externa.

Os testes de navegador usam Chromium desktop (1440px), emulação móvel (390px), checagem de overflow em 320px e axe para WCAG A/AA nas telas verificadas. Conferem links, tema, etapas, persistência, armazenamento, cookies e erros de JavaScript. Não substituem auditoria de acessibilidade manual ou testes em aparelhos físicos. As portas 3100, 3101 e 3102 devem estar livres.

## Organização

| Caminho | Responsabilidade |
| --- | --- |
| `index.html`, `style.css` | Página inicial e tema original, com correções e extensões |
| `entrar.html`, `cadastro.html` | Entrada e criação de conta |
| `configurar-perfil.html`, `perfil.html` | Configuração e manutenção do perfil |
| `recuperar-senha.html`, `redefinir-senha.html` | Recuperação e nova senha |
| `como-funciona.html`, `recursos.html` | Informações reais sobre a etapa |
| `recursoso.html` | Endereço antigo preservado com link para recursos |
| `termos.html`, `privacidade.html`, `contato.html` | Documentos e contato do projeto |
| `assets/` | Interações, formulários e chamadas à API |
| `server/` | Rotas, persistência, criptografia e SMTP |
| `scripts/setup.mjs` | Configuração local sem sobrescrever segredos |
| `tests/`, `playwright.config.mjs` | Testes de API e navegador |

As alterações desta etapa devem ser revisadas via Pull Request; não enviar diretamente para `main`.

## Referências técnicas

- [OWASP — armazenamento de senhas](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP — armazenamento criptográfico](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)
- [Node.js — SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)
- [Nodemailer — SMTP e TLS](https://nodemailer.com/smtp)
