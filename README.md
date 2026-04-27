# Spill&Force

MVP de uma plataforma esportiva para enviar videos, organizar biblioteca e permitir que usuarios assistam no navegador.

## Rodar

```bash
npm start
```

Depois abra:

```text
http://localhost:3000
```

O `npm start` agora sobe um supervisor em background que reinicia o `server.js` automaticamente se ele cair.

Comandos uteis:

```bash
npm status
```

```bash
npm stop
```

Se voce alterou arquivos em `client/`, rode `npm run build` antes para atualizar `public/`.

Para rodar o servidor sem supervisor, no modo foreground:

```bash
npm run start:foreground
```

## Desenvolvimento

Para editar o frontend com hot reload, rode o backend em uma janela e o Vite em outra:

```bash
npm run start:foreground
```

```bash
npm run dev
```

Depois abra:

```text
http://localhost:5173
```

## Como funciona

- O frontend fica em `public/`.
- O backend fica em `server.js`.
- Videos enviados ficam em `storage/videos/`.
- Metadados ficam em `storage/videos.json`.
- O servidor suporta streaming com `Range`, entao o player consegue avancar no video.
- Logs e PIDs do modo estavel ficam em `storage/.runtime/`.

## Configuracao

Por padrao o limite de upload e de 1024 MB por video. Para alterar:

```bash
MAX_UPLOAD_MB=2048 npm start
```

No Windows PowerShell:

```powershell
$env:MAX_UPLOAD_MB = "2048"
npm start
```

## Proximos passos naturais

- Login e permissoes por equipe.
- Transcodificacao para HLS.
- Thumbnails automaticos.
- Comentarios e marcacoes no tempo do video.
- Banco de dados real e armazenamento em nuvem.
