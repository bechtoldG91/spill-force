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

## Como funciona

- O frontend fica em `public/`.
- O backend fica em `server.js`.
- Videos enviados ficam em `storage/videos/`.
- Metadados ficam em `storage/videos.json`.
- O servidor suporta streaming com `Range`, entao o player consegue avancar no video.

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
