# Spill&Force

Plataforma esportiva privada para clubes, elenco e video. O app e focado em
analise de jogos, treinos e biblioteca de video; usuarios podem criar conta e
pedir entrada em um clube ou entrar diretamente por convite enviado por admin ou
treinador.

## Stack

- Backend Node.js com servidor HTTP proprio em `server.js`.
- Frontend React + Vite + Tailwind em `client/`.
- Autenticacao com JWT em cookie e senhas com bcrypt.
- Persistencia local em JSON dentro de `storage/`.
- Videos em arquivo dentro de `storage/videos/`.
- Build estatico gerado em `public/` e servido pelo backend.

## Fluxo principal

1. O admin global cria o clube inicial.
2. Usuarios podem criar conta sem convite e solicitar autorizacao para entrar em um clube.
3. Admins e treinadores do clube podem aprovar pedidos de entrada.
4. Admins e treinadores tambem podem criar convites em `Configuracoes do clube`.
5. O convidado recebe um codigo/link de convite e cria a conta por `/cadastro`.
6. Quando ha convite valido, o convite define o clube e a funcao inicial do usuario, e a entrada acontece direto.
7. Depois de entrar em um clube, a funcao efetiva do usuario passa a ser definida dentro daquele clube.

## Funcoes e permissoes

As funcoes de clube sao:

- `admin`: administra o clube, cria convites, altera funcoes, edita marca do clube e pode excluir o clube.
- `treinador`: gerencia elenco, eventos e videos, mas nao pode criar/remover admins.
- `atleta`: acessa o clube e videos permitidos, pode editar seus proprios dados esportivos.

Regras importantes:

- Sempre deve existir pelo menos um `admin` por clube.
- O ultimo admin nao pode sair do clube nem ser alterado para outra funcao.
- Apenas admin de clube ou admin global pode excluir um clube.
- Apenas admin global pode criar clubes.
- Cadastro sem convite e permitido, mas o usuario fica sem clube ate ter um pedido de entrada aprovado.
- Cadastro com convite valido vincula o usuario diretamente ao clube e a funcao do convite.
- Treinador pode convidar atletas e treinadores; apenas admin pode convidar admins.
- Atleta pode alterar apenas seus proprios campos esportivos: apelido, camisa, setor e posicao.
- Treinador e admin nao exibem campos de atleta como setor, posicao, camisa e apelido.
- A troca de funcao dentro de um clube acontece por solicitacao e aprovacao.

## Admin global

Admins globais sao configurados por email em `GLOBAL_ADMIN_EMAILS`.

O admin global pode:

- Ver e administrar contas pela pagina de configuracoes da conta.
- Deletar contas de usuarios.
- Acessar clubes para suporte administrativo.

O email padrao local e:

```text
gbechtold91@gmail.com
```

## Clubes

Pagina `Clube > Meu clube`:

- Mostra o clube ativo do usuario.
- Lista membros na ordem: admins, treinadores e atletas.
- Mostra dados de atletas como camisa, apelido, setor e posicao.
- Permite que atleta edite seus proprios dados esportivos.
- Permite solicitar troca de funcao.
- Permite sair do time, respeitando a regra do ultimo admin.

Pagina `Configuracoes do clube` (`/club-manage`):

- Permite criar e cancelar convites de entrada.
- Mostra convites pendentes com codigo e link de cadastro.
- Exibe pedidos pendentes de mudanca de funcao quando existirem.
- Permite editar membros em formato de tabela.
- Tem busca, filtros por setor/posicao e ordenacao.
- Salva alteracoes de membros em lote, com botao visivel apenas quando ha mudancas.
- Centraliza trocar logo, trocar fundo e excluir clube.

## Posicoes de atleta

Setores:

- `Ataque`: QB, RB, WR, TE, OL
- `Defesa`: DL, LB, DB
- `Special Teams`: K/P

## Videos

Recursos atuais:

- Upload de videos por admin/treinador.
- Remocao de audio no processamento do upload.
- Biblioteca com playlists.
- Selecao em lote, mover videos e excluir playlists.
- Player com suporte a `Range`, permitindo avancar no video.
- Analise de video com marcacoes, notas e navegacao.
- Corte longo e geracao de clipes.

## Rotas principais

Frontend:

- `/` feed inicial.
- `/time` meu clube.
- `/club-manage` configuracoes do clube.
- `/configuracoes-da-conta` configuracoes de conta.
- `/upload` upload de videos.
- `/biblioteca` biblioteca de videos.
- `/analise` analise de videos.
- `/corte-longo` corte longo.

API:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `PATCH /api/auth/me`
- `DELETE /api/auth/me`
- `GET /api/admin/users`
- `DELETE /api/admin/users/:userId`
- `GET /api/teams`
- `POST /api/teams`
- `GET /api/teams/:teamId`
- `PATCH /api/teams/:teamId`
- `DELETE /api/teams/:teamId`
- `GET /api/teams/:teamId/members`
- `PATCH /api/teams/:teamId/members/:memberId`
- `PATCH /api/teams/:teamId/my-membership`
- `DELETE /api/teams/:teamId/leave`
- `GET /api/teams/:teamId/invites`
- `POST /api/teams/:teamId/invites`
- `DELETE /api/teams/:teamId/invites/:inviteId`
- `GET /api/teams/:teamId/role-change-requests`
- `POST /api/teams/:teamId/role-change-requests`
- `POST /api/teams/:teamId/role-change-requests/:requestId/approve`
- `GET /api/playlists`
- `POST /api/playlists`
- `DELETE /api/playlists/:playlistId`
- `GET /api/videos`
- `POST /api/videos`
- `PATCH /api/videos/:videoId`
- `DELETE /api/videos/:videoId`
- `POST /api/videos/:videoId/trim`
- `POST /api/videos/:videoId/long-cut`
- `GET /api/videos/:videoId/annotations`
- `PUT /api/videos/:videoId/annotations`
- `GET /videos/:storageName`

## Instalar

```bash
npm install
```

## Configuracao

O projeto le variaveis de ambiente reais e tambem carrega um `.env` local quando
ele existir. Nao commite `.env`.

```bash
cp .env.example .env
```

Variaveis principais:

- `NODE_ENV`: use `production` em deploy.
- `PORT`: porta HTTP. Provedores como Heroku normalmente definem isso.
- `HOST`: host de bind. Use `0.0.0.0` em servidor.
- `DATABASE_URL`: reservado para trocar a camada JSON por banco real. Hoje o padrao e `json://storage`.
- `JWT_SECRET`: obrigatorio em producao, com 32+ caracteres aleatorios.
- `JWT_TTL_SECONDS`: duracao dos tokens.
- `PASSWORD_HASH_ROUNDS`: custo do bcrypt.
- `GLOBAL_ADMIN_EMAILS`: emails separados por virgula com permissao de admin global.
- `MAX_UPLOAD_MB`: limite de upload por video.
- `STORAGE_DIR`: pasta de videos e JSON.
- `PUBLIC_DIR`: pasta servida pelo backend com o build do frontend.
- `LOG_DIR`: pasta de logs/PIDs do supervisor local.

Em `NODE_ENV=production`, o servidor valida a configuracao ao iniciar e encerra se
`JWT_SECRET` estiver ausente, curto ou com valor de exemplo.

## Desenvolvimento local

Para subir o backend sem supervisor:

```bash
npm run start:foreground
```

Abra:

```text
http://localhost:3000
```

Para editar o frontend com hot reload, rode o backend em uma janela e o Vite em
outra:

```bash
npm run dev
```

Depois abra:

```text
http://localhost:5173
```

O Vite usa proxy para `/api` e `/videos`, apontando para o backend local.

Para subir o servidor local em modo estavel no Windows:

```bash
npm run start:stable
```

Para parar e consultar o modo estavel:

```bash
npm run stop
npm run status
```

## Build

O build do frontend e gerado diretamente na pasta `public/`, que e servida pelo
backend Node.

```bash
npm run build
```

Esse comando executa `vite build` e valida se `public/index.html` e
`public/assets/` foram gerados.

Para validar a sintaxe do backend:

```bash
npm run check
```

Observacao: como este repositorio versiona `public/`, confira `git status` depois
do build. Se o deploy depender dos arquivos ja gerados no repositorio, inclua
`public/index.html` e os assets novos.

## Producao

`npm start` e o comando portavel de producao. Ele define `NODE_ENV=production`
antes de iniciar `server.js`.

Configure no provedor:

```bash
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
JWT_SECRET=<valor-aleatorio-com-32+-caracteres>
DATABASE_URL=json://storage
STORAGE_DIR=storage
PUBLIC_DIR=public
LOG_DIR=storage/.runtime
GLOBAL_ADMIN_EMAILS=gbechtold91@gmail.com
```

Fluxo recomendado em servidor:

```bash
npm ci
npm run build
npm start
```

Heroku executa `npm start` por padrao e o projeto tambem define
`heroku-postbuild` para gerar `public/`.

## Render

O repositorio inclui `render.yaml` para criar um Web Service com Node, build de
producao, variaveis e disco persistente.

No Render Dashboard, crie um Blueprint apontando para:

```text
https://github.com/bechtoldG91/spill-force
```

O Blueprint configura:

- `buildCommand`: `npm ci --include=dev && npm run build`
- `startCommand`: `npm start`
- `HOST=0.0.0.0`
- `NODE_ENV=production`
- `JWT_SECRET` gerado automaticamente pelo Render
- `GLOBAL_ADMIN_EMAILS=gbechtold91@gmail.com`
- disco persistente em `/opt/render/project/src/storage`

O disco persistente e necessario para preservar contas, clubes, videos e
metadados JSON entre deploys e restarts.

## PM2

```bash
npm ci
npm run build
pm2 start scripts/start-production.js --name spill-force --time --update-env
pm2 save
```

Exemplo de variaveis para PM2:

```bash
NODE_ENV=production PORT=3000 JWT_SECRET=<valor-aleatorio-com-32+-caracteres> \
  pm2 start scripts/start-production.js --name spill-force --time --update-env
```

Na pratica, prefira configurar variaveis no shell, no arquivo de ambiente do
servidor ou no `ecosystem.config.cjs`, sem versionar segredos.

## systemd

Exemplo de unidade:

```ini
[Unit]
Description=SpillForce Node server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/spill-force
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOST=0.0.0.0
Environment=JWT_SECRET=CHANGE_ME_RANDOM_VALUE_WITH_32_PLUS_CHARACTERS
Environment=DATABASE_URL=json://storage
Environment=GLOBAL_ADMIN_EMAILS=gbechtold91@gmail.com
ExecStart=/usr/bin/node /opt/spill-force/scripts/start-production.js
Restart=always
RestartSec=5
StandardOutput=append:/var/log/spill-force/out.log
StandardError=append:/var/log/spill-force/error.log

[Install]
WantedBy=multi-user.target
```

## Dados locais

- `storage/*.json` guarda contas, clubes, playlists, videos e anotacoes.
- `storage/videos/` guarda os arquivos enviados.
- `storage/.runtime/` guarda logs, PIDs e segredo local de desenvolvimento.
- Esses dados sao ignorados pelo git, exceto `.gitkeep`.

Para limpar o ambiente local, pare o servidor antes e remova ou edite os JSONs e
arquivos de video com cuidado. Preserve pelo menos um admin global configurado em
`GLOBAL_ADMIN_EMAILS` para conseguir administrar novas contas.

## Comandos

```bash
npm install
npm run build
npm start
npm run start:foreground
npm run start:stable
npm run dev
npm run check
npm run stop
npm run status
```

## Pontos de atencao

- A notificacao por email de convite ainda esta registrada em log no servidor.
  Para producao, conecte um provedor real de email.
- O fluxo multi-clube exige cuidado com `teamId` nas areas de video, playlists e
  player. Ao evoluir essas telas, garanta que cada chamada use o clube ativo.
- Ainda nao ha uma suite automatizada cobrindo convites, cadastro por convite,
  ultimo admin, saida do time, exclusao de conta e permissoes.
