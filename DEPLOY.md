# Deploy do Beta

Este projeto foi preparado para subir como um único serviço Node:

- o frontend compilado fica em `dist/`
- o backend compilado fica em `server-dist/`
- em produção, o servidor Express entrega o frontend e as rotas `/api`

## 1. Criar repositório no GitHub

Crie um repositório novo no GitHub, de preferência:

- `privado`, se o objetivo é um grupo fechado de teste
- com um nome como `founar-request-beta` ou `founar-request`

Depois conecte o repositório local:

```bash
git remote add origin https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git
```

## 2. Publicar o código

Se ainda não houver commit inicial:

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
3. conecte o repositório do GitHub
4. se usar `Blueprint`, o arquivo `render.yaml` do projeto deve ser detectado
5. se criar manualmente um `Web Service`, use:

- `Build Command`: `npm install --include=dev && npm run build`
- `Start Command`: `npm run start`
- `Environment`: `Node`

## 4. Validar

Depois do deploy:

- abra a URL pública
- confirme se a interface carrega
- teste a rota `GET /api/health`
- execute uma request simples
- valide a importação de `cURL`
- valide a criação de `collections`

## 5. Compartilhar com o grupo

Envie:

- a URL pública do beta
- uma mensagem curta dizendo que é uma versão em testes
- um formulário simples para feedback

Exemplo:

```text
Segue a versão beta da ferramenta de testes de API.

Link:
https://SEU-APP.onrender.com

Se possível, testem:
- criar uma request
- salvar em collection
- usar environments
- importar um cURL
- rodar um teste de carga simples

Feedback:
https://SEU-FORMULARIO
```

## Observações

- o primeiro acesso no plano free pode ficar lento
- testes de carga devem ser usados com cuidado
- esta versão foi preparada para validação funcional, não para alta escala
