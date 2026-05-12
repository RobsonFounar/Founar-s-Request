# Founar Request Beta

Ferramenta em desenvolvimento para testes de APIs, collections, environments,
importacao de cURL/OpenAPI e testes de carga.

## O que ja existe

- editor de requests com abas
- auth por `Bearer`, `Basic` e `API Key`
- collections e requests salvas
- environments com variaveis `{{nomeDaVariavel}}`
- importacao de `cURL`
- importacao de `OpenAPI` em `JSON` ou `YAML`
- area basica de testes de carga

## Rodando localmente

Requisitos:

- `Node.js 22+`
- `npm`

Instalacao:

```bash
npm install
```

Modo desenvolvimento:

```bash
npm run dev
```

O app sobe com:

- frontend Vite
- backend Express

## Build de producao

```bash
npm run build
```

Esse comando gera:

- `dist/` com o frontend
- `server-dist/` com o backend compilado

Para iniciar em producao:

```bash
npm run start
```

Em producao, o backend serve o frontend e as rotas `/api` no mesmo dominio.

## Como disponibilizar para um grupo de teste

### Fluxo recomendado

1. subir este projeto para um repositorio no `GitHub`
2. conectar o repositorio ao `Render`
3. criar um `Web Service`
4. usar:
   - `Build Command`: `npm install --include=dev && npm run build`
   - `Start Command`: `npm run start`
5. compartilhar a URL gerada com o grupo

O projeto ja inclui um arquivo `render.yaml` para facilitar esse deploy.

### Opcao de repositorio

- `privado`: melhor para grupo controlado
- `publico`: mais facil para divulgar e receber contribuicoes

## Scripts principais

- `npm run dev` inicia frontend e backend para desenvolvimento
- `npm run build` gera build de producao
- `npm run start` inicia o servidor de producao
- `npm run lint` executa o lint

## Observacoes para beta

- os testes de carga devem ser usados com responsabilidade
- esta versao ainda e um MVP
- o objetivo principal neste momento e coletar feedback de uso
