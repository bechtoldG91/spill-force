



Riscos Médios
teams.js (line 361) retorna todos os clubes para usuário sem time. Isso contradiz o README em README.md (line 22), que diz que não existe busca pública nem solicitação aberta.
Vídeos autenticados são servidos com Cache-Control: public em static.js (line 98). Como o conteúdo é privado, prefira private, no-store ou estratégia explícita de cache privado.
Persistência em JSON funciona para MVP/local, mas é frágil para produção com muitos usuários, uploads grandes e concorrência. A arquitetura já prevê DATABASE_URL, mas ainda não há banco real.
Não há suíte automatizada além de node --check server.js. Fluxos sensíveis como convite, último admin, permissões, reset de senha, exclusão em cascata e escopo por clube precisam de testes.
Pontos Positivos
Boa separação básica entre auth.js, teams.js, videos.js, playlists.js, annotations.js, static.js e repository.js.
Há validação de configuração em produção, incluindo JWT_SECRET forte em config.js (line 70).
Upload tem limite de tamanho, validação de tipo e limpeza de temporários.
Regras importantes de clube aparecem implementadas, como proteção contra remover o último admin.
O frontend tem fluxo funcional e bem direcionado para biblioteca, análise, upload e gestão de clube.
Prioridade Recomendada
Bloquear cadastro sem convite, exceto admin global configurado.
Remover resetCode da resposta e integrar envio real por email.
Migrar JWT para cookie HttpOnly; Secure e parar de salvar token em localStorage.
Introduzir seleção explícita de clube ativo e enviar teamId em todas as rotas de vídeo/playlists/anotações.
Tirar processamento ffmpeg de dentro da transação de metadados.
Adicionar testes automatizados para autenticação, convites, permissões e escopo por clube.