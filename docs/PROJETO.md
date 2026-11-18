# GymAI · Projeto frontend

## Problema e objetivo
Quem organiza o treino precisa consultar equipamentos, planos e execuções sem alternar entre anotações dispersas. O GymAI reúne essas ações numa interface web. Na página inicial, até um visitante pode organizar uma lista temporária de equipamentos antes de entrar na conta.

## Referencial teórico
Segundo o WHATWG (2026), o DOM representa a página como uma árvore de elementos que o programa pode consultar e modificar. A propagação de eventos permite reagir a ações do usuário, e um evento cancelável pode ter sua ação padrão impedida. No GymAI, o JavaScript intercepta o envio do formulário com preventDefault(), altera os itens e redesenha a lista. Assim o visitante continua na mesma página e mantém o contexto da tarefa.

Segundo o W3C (2016), o armazenamento de sessão associa pares de chave e valor a uma sessão de navegação e à origem do documento. O GymAI transforma a lista de equipamentos em texto JSON ao salvar e a reconstrói ao carregar a página. Isso permite pressionar F5 na mesma aba sem perder a seleção. Os registros vinculados à conta seguem pelo servidor e são persistidos no banco.

Conforme o W3C (2024), informações e comandos precisam continuar perceptíveis e operáveis com diferentes formas de navegação e dimensões de tela. No frontend, títulos HTML organizam as seções, rótulos identificam campos, botões têm nomes acessíveis e alterações da lista são anunciadas por uma região de status. O CSS permite que as ações de cada item passem à linha seguinte em telas estreitas.

## Resultados obtidos
A lista da página inicial permite adicionar um equipamento, trocar a seleção e remover um item. O teste automatizado acompanha as navegações, recarrega a página e confere a lista após a edição e a exclusão. A validação de senha aceita de 8 a 128 caracteres no cadastro e na redefinição.

| Aplicação hospedada | Código público |
|---|---|
| [Abrir GymAI](https://gymia-gym-ia1.vercel.app) | [Abrir GitHub](https://github.com/mattospower/gymAI) |
| ![QR Code do site GymAI](qr-aplicacao.svg) | ![QR Code do repositório GymAI](qr-repositorio.svg) |

## Teste com usuários e matriz de feedback
Aplicar individualmente a pelo menos cinco pessoas. Usar U1 a U5 e guardar evidências autorizadas sem nomes, e-mails ou senhas. Solicitar que cada pessoa adicione Halteres, troque por Banco, atualize a página e remova Banco. Observar onde hesita sem instruí-la sobre qual botão usar. Perguntar o que facilitaria a tarefa.

| Pessoa | Data e dispositivo | Tarefa concluída? | Dificuldade observada ou sugestão | Evidência | Alteração e reteste |
|---|---|---|---|---|---|
| U1 | Pendente | — | — | — | — |
| U2 | Pendente | — | — | — | — |
| U3 | Pendente | — | — | — | — |
| U4 | Pendente | — | — | — | — |
| U5 | Pendente | — | — | — | — |

Após os testes, selecionar uma dificuldade observada, registrar a decisão, implementar a melhoria e vincular o commit e as capturas de antes e depois. Pedir que a pessoa repita a mesma tarefa e registrar o resultado. Até a coleta, nenhuma alteração pode ser atribuída ao retorno dos participantes.

## Referências
- WHATWG. DOM Standard. 2026. https://dom.spec.whatwg.org/
- W3C. Web Storage. 2. ed. 2016. https://www.w3.org/TR/2016/REC-webstorage-20160419/
- W3C. Web Content Accessibility Guidelines (WCAG) 2.2. 2024. https://www.w3.org/TR/WCAG22/
