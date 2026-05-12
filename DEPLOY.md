# Deploy do Beta

Este projeto foi preparado para subir como um unico servico Node:

- o frontend compilado fica em `dist/`
- o backend compilado fica em `server-dist/`
- em producao, o servidor Express entrega o frontend e as rotas `/api`

## 1. Criar repositorio no GitHub

Crie um repositorio novo no GitHub, de preferencia:

- `privado`, se o objetivo e um grupo fechado de teste
- com um nome como `founar-request-beta` ou `founar-request`

Depois conecte o repositorio local:

```bash
git remote add origin https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git
```

## 2. Publicar o codigo

Se ainda nao houver commit inicial:

```bash
git add .
git commit -m "prepare beta for public testing"
git branch -M main
git push -u origin main
```

## 3. Subir no Render

No Render:

1. clique em `New +`
2. escolha `Blueprint` ou `Web Service`
3. conecte o repositorio do GitHub
4. se usar `Blueprint`, o arquivo `render.yaml` do projeto deve ser detectado
5. se criar manualmente um `Web Service`, use:

- `Build Command`: `npm install && npm run build`
- `Start Command`: `npm run start`
- `Environment`: `Node`
- `NODE_ENV=production`

## 4. Validar

Depois do deploy:

- abra a URL publica
- confirme se a interface carrega
- teste a rota `GET /api/health`
- execute uma request simples
- valide a importacao de `cURL`
- valide a criacao de `collections`

## 5. Compartilhar com o grupo

Envie:

- a URL publica do beta
- uma mensagem curta dizendo que e uma versao em testes
- um formulario simples para feedback

Exemplo:

```text
Segue a versao beta da ferramenta de testes de API.

Link:
https://SEU-APP.onrender.com

Se possivel, testem:
- criar uma request
- salvar em collection
- usar environments
- importar um cURL
- rodar um teste de carga simples

Feedback:
https://SEU-FORMULARIO
```

## Observacoes

- o primeiro acesso no plano free pode ficar lento
- testes de carga devem ser usados com cuidado
- esta versao foi preparada para validacao funcional, nao para alta escala
