# Pendencias futuras

## Recuperacao de senha por email

- Integrar um provedor real de email para enviar o codigo de recuperacao.
- Definir variaveis de ambiente do provedor no deploy.
- Manter a API sem retornar o codigo de recuperacao na resposta HTTP.
- Depois da integracao, testar o fluxo completo: solicitar codigo, receber email, redefinir senha e invalidar codigo usado/expirado.

## Seguranca da sessao

- Migrar autenticacao para cookie `HttpOnly` controlado pelo backend.
- Usar `Secure` em producao e manter `SameSite=Lax` ou avaliar `SameSite=Strict`.
- Remover persistencia de token JWT em `localStorage`.
- Remover envio manual de `Authorization: Bearer` no frontend quando a sessao estiver baseada apenas em cookie.
- Ajustar upload via `XMLHttpRequest` para depender do cookie de sessao.
- Revisar expiracao, logout e renovacao de sessao antes de publicar para usuarios reais.

## Multi-clube

- Criar conceito explicito de clube ativo no frontend.
- Mostrar seletor de clube quando o usuario pertencer a mais de um clube.
- Salvar o clube ativo escolhido pelo usuario, possivelmente em `localStorage`.
- Enviar `teamId` explicitamente em todas as chamadas de videos, playlists, anotacoes, uploads e cortes.
- Evitar que o backend escolha uma membership automaticamente quando a rota depender de clube.
- Para admin global, exigir escolha explicita do clube antes de acessar biblioteca, upload, analise e cortes.