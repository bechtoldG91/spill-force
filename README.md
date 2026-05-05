# Spill&Force

MVP de uma plataforma esportiva para enviar videos, organizar biblioteca e permitir que usuarios assistam no navegador.

## Instalar

```bash
npm install
```

## Configuracao

O projeto le variaveis de ambiente reais e tambem carrega um `.env` local quando ele existir. Nao commite `.env`.

```bash
cp .env.example .env
```

Variaveis principais:

- `NODE_ENV`: use `production` em deploy.
- `PORT`: porta HTTP. Provedores como Heroku normalmente definem isso.
- `HOST`: host de bind, opcional. Use `0.0.0.0` em servidor.
- `DATABASE_URL`: reservado para trocar a camada JSON por banco real. Hoje o padrao e `json://storage`.
- `JWT_SECRET`: obrigatorio em producao, com 32+ caracteres aleatorios.
- `JWT_TTL_SECONDS`: duracao dos tokens.
- `PASSWORD_HASH_ROUNDS`: custo do bcrypt.
- `MAX_UPLOAD_MB`: limite de upload por video.
- `STORAGE_DIR`: pasta de videos e JSON.
- `PUBLIC_DIR`: pasta servida pelo backend com o build do frontend.
- `LOG_DIR`: pasta de logs/PIDs do supervisor local.

Em `NODE_ENV=production`, o servidor valida a configuracao ao iniciar e encerra se `JWT_SECRET` estiver ausente, curto ou com valor de exemplo.

## Desenvolvimento local

Para subir o backend sem supervisor:

```bash
npm run start:foreground
```

Para editar o frontend com hot reload, rode o backend em uma janela e o Vite em outra:

```bash
npm run dev
```

Depois abra:

```text
http://localhost:5173
```

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

O build do frontend e gerado diretamente na pasta `public/`, que e servida pelo backend Node.

```bash
npm run build
```

Esse comando executa `vite build` e valida se `public/index.html` e `public/assets/` foram gerados.

Para validar a sintaxe do backend:

```bash
npm run check
```

## Producao

`npm start` e o comando portavel de producao. Ele define `NODE_ENV=production` antes de iniciar `server.js`.

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
```

Fluxo recomendado em servidor:

```bash
npm ci
npm run build
npm start
```

Heroku executa `npm start` por padrao e o projeto tambem define `heroku-postbuild` para gerar `public/`.

## Render

O repositorio inclui `render.yaml` para criar um Web Service com Node, build de producao, variaveis e disco persistente.

No Render Dashboard, crie um Blueprint apontando para:

```text
https://github.com/bechtoldG91/spill-force
```

O Blueprint configura:

- `buildCommand`: `npm ci && npm run build`
- `startCommand`: `npm start`
- `HOST=0.0.0.0`
- `NODE_ENV=production`
- `JWT_SECRET` gerado automaticamente pelo Render
- disco persistente em `/opt/render/project/src/storage`

O disco persistente e necessario para preservar contas, times, videos e metadados JSON entre deploys e restarts.

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

Na pratica, prefira configurar variaveis no shell, no arquivo de ambiente do servidor ou no `ecosystem.config.cjs`, sem versionar segredos.

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
ExecStart=/usr/bin/node /opt/spill-force/scripts/start-production.js
Restart=always
RestartSec=5
StandardOutput=append:/var/log/spill-force/out.log
StandardError=append:/var/log/spill-force/error.log

[Install]
WantedBy=multi-user.target
```

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

## Como funciona

- O frontend fica em `client/` durante o desenvolvimento.
- O build do frontend fica em `public/` e e servido pelo backend.
- O backend fica em `server.js`, com rotas separadas por dominio.
- Videos enviados ficam em `storage/videos/`.
- Metadados ficam em JSON via camada de repositorio em `storage/`.
- O servidor suporta streaming com `Range`, entao o player consegue avancar no video.
- A pagina de upload envia videos e o backend remove o audio antes de salvar.
- A biblioteca organiza videos por playlist, permite selecao em lote, mover videos e excluir playlists.
- A pagina de analise permite assistir videos, desenhar marcacoes, criar notas, pausar em notas e navegar entre videos.
- Logs e PIDs do modo estavel ficam em `LOG_DIR`.
