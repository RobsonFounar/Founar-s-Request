# Founar Request Beta

Ferramenta em desenvolvimento para testes de APIs, collections, environments,
importação de cURL/OpenAPI e testes de carga.

## O que já existe

- editor de requests com abas
- auth por `Bearer`, `Basic` e `API Key`
- collections e requests salvas
- environments com variáveis `{{nomeDaVariável}}`
- importação de `cURL`
- importação de `OpenAPI` em `JSON` ou `YAML`
- área básica de testes de carga

## Rodando localmente

Requisitos:

- `Node.js 22+`
- `npm`

Instalação:

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

## Build de produção

```bash
npm run build
```

Esse comando gera:

- `dist/` com o frontend
- `server-dist/` com o backend compilado

Para iniciar em produção:

```bash
npm run start
```

Em produção, o backend serve o frontend e as rotas `/api` no mesmo domínio.

## Como disponibilizar para um grupo de teste

### Fluxo recomendado

1. subir este projeto para um repositório no `GitHub`
2. conectar o repositório ao `Render`
3. criar um `Web Service`
4. usar:
   - `Build Command`: `npm install --include=dev && npm run build`
   - `Start Command`: `npm run start`
5. compartilhar a URL gerada com o grupo

O projeto já inclui um arquivo `render.yaml` para facilitar esse deploy.

### Opção de repositório

- `privado`: melhor para grupo controlado
- `público`: mais fácil para divulgar e receber contribuições

## Scripts principais

- `npm run dev` inicia frontend e backend para desenvolvimento
- `npm run build` gera build de produção
- `npm run start` inicia o servidor de produção
- `npm run lint` executa o lint

## Observações para beta

- os testes de carga devem ser usados com responsabilidade
- esta versão ainda é um MVP
- o objetivo principal neste momento é coletar feedback de uso
