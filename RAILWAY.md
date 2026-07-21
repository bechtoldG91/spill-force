# Deploy no Railway

Este projeto continua simples: o backend Node salva contas, clubes, videos e
metadados em arquivos JSON dentro da pasta de storage.

No Railway, essa pasta precisa ficar em um Volume persistente. Quando o Volume
esta anexado, o Railway cria a variavel `RAILWAY_VOLUME_MOUNT_PATH`, e o app usa
esse caminho automaticamente.

## Passo a passo

1. Crie um projeto no Railway a partir do repositorio do GitHub.
2. Anexe um Volume ao servico Node.
3. Nao precisa configurar `STORAGE_DIR` no Railway. O app usa
   `RAILWAY_VOLUME_MOUNT_PATH`.
4. Configure as variaveis do servico:

```bash
NODE_ENV=production
HOST=0.0.0.0
JWT_SECRET=<valor-aleatorio-com-32+-caracteres>
DATABASE_URL=json://storage
PUBLIC_DIR=public
GLOBAL_ADMIN_EMAILS=gbechtold91@gmail.com
MAX_UPLOAD_MB=1024
```

O Railway define `PORT` automaticamente.

## O que o railway.json faz

- Build: `npm ci --include=dev && npm run build`
- Start: `npm start`
- Healthcheck: `/api/health`
- Restart: tenta reiniciar em falha

## Como explicar

Localmente, o app grava em `storage/`.

No Railway, o app grava no Volume. Isso evita perder `users.json`,
`teams.json`, `videos.json`, `playlists.json`, `annotations.json` e os arquivos
de video depois de redeploy ou restart.

Se o app iniciar em producao no Railway sem Volume, ele encerra de proposito
para evitar criar contas em armazenamento temporario.
