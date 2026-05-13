import { parse as parseYaml } from 'yaml'

import type {
  HttpMethod,
  KeyValueRow,
  RequestBody,
  RequestTab,
} from '../types'

type OpenApiDocument = {
  openapi?: string
  swagger?: string
  info?: {
    title?: string
  }
  servers?: Array<{
    url?: string
  }>
  paths?: Record<string, Record<string, OpenApiOperation>>
  components?: {
    schemas?: Record<string, unknown>
  }
}

type OpenApiOperation = {
  summary?: string
  operationId?: string
  tags?: string[]
  parameters?: OpenApiParameter[]
  requestBody?: {
    content?: Record<string, OpenApiMediaType>
  }
}

type OpenApiParameter = {
  name?: string
  in?: 'query' | 'header' | 'path' | 'cookie'
  required?: boolean
  example?: unknown
  schema?: Record<string, unknown>
}

type OpenApiMediaType = {
  example?: unknown
  examples?: Record<string, { value?: unknown }>
  schema?: Record<string, unknown>
}

type ImportOpenApiResult = {
  collectionName: string
  requests: RequestTab[]
}

const HTTP_METHODS: HttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]

const OPENAPI_METHODS = HTTP_METHODS.map((method) => method.toLowerCase())

export function importCurl(command: string, currentTab: RequestTab): RequestTab {
  const normalizedCommand = command.trim()

  if (!normalizedCommand) {
    throw new Error('Cole um comando cURL antes de importar.')
  }

  const tokens = tokenizeShellCommand(normalizedCommand)

  if (tokens.length === 0 || tokens[0].toLowerCase() !== 'curl') {
    throw new Error('O texto informado não parece ser um comando cURL válido.')
  }

  let method: HttpMethod = 'GET'
  let url = ''
  let forceGet = false
  const headers: KeyValueRow[] = []
  const queryParams: KeyValueRow[] = []
  let auth = currentTab.auth
  let body: RequestBody = { mode: 'none' }
  let inferredContentType = ''

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]

    if (!token) {
      continue
    }

    if (token === '--request' || token === '-X') {
      method = toHttpMethod(tokens[index + 1] ?? 'GET')
      index += 1
      continue
    }

    if (token === '--url') {
      url = tokens[index + 1] ?? url
      index += 1
      continue
    }

    if (token === '--get' || token === '-G') {
      forceGet = true
      method = 'GET'
      continue
    }

    if (token === '--header' || token === '-H') {
      const headerValue = tokens[index + 1] ?? ''
      const parsedHeader = parseHeader(headerValue)

      if (parsedHeader) {
        const lowerKey = parsedHeader.key.toLowerCase()

        if (lowerKey === 'authorization') {
          const nextAuth = parseAuthorizationHeader(parsedHeader.value)

          if (nextAuth) {
            auth = nextAuth
          } else {
            headers.push(parsedHeader)
          }
        } else {
          if (lowerKey === 'content-type') {
            inferredContentType = parsedHeader.value
          }

          headers.push(parsedHeader)
        }
      }

      index += 1
      continue
    }

    if (
      token === '--data' ||
      token === '--data-raw' ||
      token === '--data-binary' ||
      token === '--data-ascii' ||
      token === '-d'
    ) {
      const rawBody = tokens[index + 1] ?? ''
      body = parseBody(rawBody, inferredContentType)

      if (!forceGet && method === 'GET') {
        method = 'POST'
      }

      index += 1
      continue
    }

    if (token === '--user' || token === '-u') {
      const rawUser = tokens[index + 1] ?? ''
      const [username = '', password = ''] = rawUser.split(':')
      auth = { type: 'basic', username, password }
      index += 1
      continue
    }

    if (!token.startsWith('-') && !url) {
      url = token
    }
  }

  if (!url) {
    throw new Error('Não foi possível identificar a URL no comando cURL.')
  }

  const { cleanUrl, queryRows } = splitUrlAndQuery(url)

  return {
    ...currentTab,
    method,
    url: cleanUrl,
    headers: headers.length > 0 ? headers : [createRow()],
    queryParams:
      [...queryRows, ...queryParams].length > 0
        ? [...queryRows, ...queryParams]
        : [createRow()],
    auth,
    body,
    response: undefined,
    isSending: false,
  }
}

export function importOpenApi(source: string): ImportOpenApiResult {
  const normalizedSource = source.trim()

  if (!normalizedSource) {
    throw new Error('Cole o conteúdo OpenAPI antes de importar.')
  }

  let document: OpenApiDocument

  try {
    document = parseYaml(normalizedSource) as OpenApiDocument
  } catch {
    throw new Error('Não foi possível ler o arquivo OpenAPI em JSON/YAML.')
  }

  if (!document?.paths || typeof document.paths !== 'object') {
    throw new Error('A especificação OpenAPI não possui o campo paths.')
  }

  const serverUrl = document.servers?.[0]?.url?.trim() ?? ''
  const collectionName = document.info?.title?.trim() || 'OpenAPI importada'
  const requests: RequestTab[] = []

  for (const [pathName, pathItem] of Object.entries(document.paths)) {
    if (!pathItem || typeof pathItem !== 'object') {
      continue
    }

    for (const methodName of OPENAPI_METHODS) {
      const operation = pathItem[methodName]

      if (!operation) {
        continue
      }

      const method = methodName.toUpperCase() as HttpMethod
      const combinedUrl = joinUrl(serverUrl, pathName)
      const parameters = operation.parameters ?? []
      const queryParameters = parameters
        .filter((parameter) => parameter.in === 'query')
        .map((parameter) =>
          createRow(
            parameter.name ?? '',
            stringifyExample(getParameterExample(parameter, document)),
          ),
        )
      const headerParameters = parameters
        .filter((parameter) => parameter.in === 'header')
        .map((parameter) =>
          createRow(
            parameter.name ?? '',
            stringifyExample(getParameterExample(parameter, document)),
          ),
        )

      const { body, contentTypeHeader } = buildBodyFromOperation(
        operation,
        document,
      )

      if (contentTypeHeader) {
        headerParameters.push(createRow('Content-Type', contentTypeHeader))
      }

      requests.push({
        id: crypto.randomUUID(),
        name: buildOperationName(method, pathName, operation),
        method,
        url: combinedUrl,
        headers: headerParameters.length > 0 ? headerParameters : [createRow()],
        queryParams: queryParameters.length > 0 ? queryParameters : [createRow()],
        auth: { type: 'none' },
        body,
      })
    }
  }

  if (requests.length === 0) {
    throw new Error('Nenhuma operação suportada foi encontrada no OpenAPI.')
  }

  return {
    collectionName,
    requests,
  }
}

function tokenizeShellCommand(command: string): string[] {
  const sanitizedCommand = command
    .replace(/\\\r?\n/g, ' ')
    .replace(/\^\r?\n/g, ' ')
    .trim()
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null

  for (let index = 0; index < sanitizedCommand.length; index += 1) {
    const char = sanitizedCommand[index]

    if (quote) {
      if (char === quote) {
        quote = null
        continue
      }

      if (char === '\\' && quote === '"' && index + 1 < sanitizedCommand.length) {
        current += sanitizedCommand[index + 1]
        index += 1
        continue
      }

      current += char
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (char === '\\' && index + 1 < sanitizedCommand.length) {
      current += sanitizedCommand[index + 1]
      index += 1
      continue
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (current) {
    tokens.push(current)
  }

  return tokens
}

function parseHeader(rawHeader: string): KeyValueRow | null {
  const separatorIndex = rawHeader.indexOf(':')

  if (separatorIndex === -1) {
    return null
  }

  return createRow(
    rawHeader.slice(0, separatorIndex).trim(),
    rawHeader.slice(separatorIndex + 1).trim(),
  )
}

function parseAuthorizationHeader(value: string) {
  const bearerMatch = value.match(/^Bearer\s+(.+)$/i)

  if (bearerMatch) {
    return { type: 'bearer' as const, token: bearerMatch[1] }
  }

  const basicMatch = value.match(/^Basic\s+(.+)$/i)

  if (basicMatch) {
    try {
      const decoded = atob(basicMatch[1])
      const [username = '', password = ''] = decoded.split(':')
      return { type: 'basic' as const, username, password }
    } catch {
      return null
    }
  }

  return null
}

function parseBody(rawBody: string, contentType: string): RequestBody {
  const normalizedContentType = contentType.toLowerCase()

  if (
    normalizedContentType.includes('application/x-www-form-urlencoded') &&
    rawBody.includes('=')
  ) {
    const params = new URLSearchParams(rawBody)

    return {
      mode: 'form',
      entries:
        [...params.entries()].map(([key, value]) => createRow(key, value)) || [
          createRow(),
        ],
    }
  }

  if (normalizedContentType.includes('application/json') || looksLikeJson(rawBody)) {
    return {
      mode: 'json',
      content: formatJson(rawBody),
    }
  }

  return {
    mode: 'text',
    content: rawBody,
  }
}

function splitUrlAndQuery(url: string) {
  try {
    const parsedUrl = new URL(url)
    const queryRows = [...parsedUrl.searchParams.entries()].map(([key, value]) =>
      createRow(key, value),
    )

    parsedUrl.search = ''

    return {
      cleanUrl: parsedUrl.toString(),
      queryRows,
    }
  } catch {
    return {
      cleanUrl: url,
      queryRows: [] as KeyValueRow[],
    }
  }
}

function toHttpMethod(value: string): HttpMethod {
  const candidate = value.toUpperCase() as HttpMethod

  if (HTTP_METHODS.includes(candidate)) {
    return candidate
  }

  return 'GET'
}

function joinUrl(serverUrl: string, pathName: string) {
  if (!serverUrl) {
    return pathName
  }

  const normalizedServer = serverUrl.replace(/\/+$/, '')
  const normalizedPath = pathName.startsWith('/') ? pathName : `/${pathName}`

  return `${normalizedServer}${normalizedPath}`
}

function buildOperationName(
  method: HttpMethod,
  pathName: string,
  operation: OpenApiOperation,
) {
  const baseName =
    operation.summary?.trim() ||
    operation.operationId?.trim() ||
    `${method} ${pathName}`
  const tag = operation.tags?.[0]?.trim()

  return tag ? `[${tag}] ${baseName}` : baseName
}

function buildBodyFromOperation(
  operation: OpenApiOperation,
  document: OpenApiDocument,
) {
  const content = operation.requestBody?.content

  if (!content || typeof content !== 'object') {
    return {
      body: { mode: 'none' } as RequestBody,
      contentTypeHeader: '',
    }
  }

  const jsonMediaType =
    content['application/json'] ||
    firstMediaType(content, (mediaType) => mediaType.includes('json'))

  if (jsonMediaType) {
    const example = resolveMediaTypeExample(jsonMediaType, document)

    return {
      body: {
        mode: 'json',
        content: JSON.stringify(example ?? {}, null, 2),
      } as RequestBody,
      contentTypeHeader: 'application/json',
    }
  }

  const formMediaType = content['application/x-www-form-urlencoded']

  if (formMediaType) {
    const example = resolveMediaTypeExample(formMediaType, document)

    if (example && typeof example === 'object' && !Array.isArray(example)) {
      return {
        body: {
          mode: 'form',
          entries: Object.entries(example).map(([key, value]) =>
            createRow(key, stringifyExample(value)),
          ),
        } as RequestBody,
        contentTypeHeader: 'application/x-www-form-urlencoded',
      }
    }
  }

  const textMediaType =
    content['text/plain'] || firstMediaType(content, (mediaType) => mediaType.startsWith('text/'))

  if (textMediaType) {
    const example = resolveMediaTypeExample(textMediaType, document)

    return {
      body: {
        mode: 'text',
        content: typeof example === 'string' ? example : stringifyExample(example),
      } as RequestBody,
      contentTypeHeader: firstMediaTypeKey(content, textMediaType) ?? 'text/plain',
    }
  }

  return {
    body: { mode: 'none' } as RequestBody,
    contentTypeHeader: '',
  }
}

function resolveMediaTypeExample(
  mediaType: OpenApiMediaType,
  document: OpenApiDocument,
) {
  if (mediaType.example !== undefined) {
    return mediaType.example
  }

  const firstExample = mediaType.examples
    ? Object.values(mediaType.examples)[0]?.value
    : undefined

  if (firstExample !== undefined) {
    return firstExample
  }

  if (mediaType.schema) {
    return buildExampleFromSchema(mediaType.schema, document, 0)
  }

  return undefined
}

function getParameterExample(
  parameter: OpenApiParameter,
  document: OpenApiDocument,
) {
  if (parameter.example !== undefined) {
    return parameter.example
  }

  if (parameter.schema) {
    return buildExampleFromSchema(parameter.schema, document, 0)
  }

  return ''
}

function buildExampleFromSchema(
  schema: Record<string, unknown>,
  document: OpenApiDocument,
  depth: number,
): unknown {
  if (depth > 4) {
    return ''
  }

  if (schema.example !== undefined) {
    return schema.example
  }

  if (schema.default !== undefined) {
    return schema.default
  }

  const ref = typeof schema.$ref === 'string' ? schema.$ref : ''

  if (ref) {
    const resolvedSchema = resolveRef(ref, document)

    if (resolvedSchema && typeof resolvedSchema === 'object') {
      return buildExampleFromSchema(
        resolvedSchema as Record<string, unknown>,
        document,
        depth + 1,
      )
    }
  }

  if (schema.enum && Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0]
  }

  if (schema.type === 'array') {
    const itemSchema =
      schema.items && typeof schema.items === 'object'
        ? (schema.items as Record<string, unknown>)
        : undefined

    return itemSchema
      ? [buildExampleFromSchema(itemSchema, document, depth + 1)]
      : []
  }

  if (schema.type === 'object' || schema.properties) {
    const properties =
      schema.properties && typeof schema.properties === 'object'
        ? (schema.properties as Record<string, unknown>)
        : {}

    return Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [
        key,
        buildExampleFromSchema(
          (value as Record<string, unknown>) ?? {},
          document,
          depth + 1,
        ),
      ]),
    )
  }

  switch (schema.type) {
    case 'integer':
    case 'number':
      return 0
    case 'boolean':
      return true
    case 'string':
      return ''
    default:
      return ''
  }
}

function resolveRef(ref: string, document: OpenApiDocument) {
  if (!ref.startsWith('#/')) {
    return undefined
  }

  const segments = ref
    .replace(/^#\//, '')
    .split('/')
    .map((segment) => decodeURIComponent(segment))

  let current: unknown = document

  for (const segment of segments) {
    if (!current || typeof current !== 'object' || !(segment in current)) {
      return undefined
    }

    current = (current as Record<string, unknown>)[segment]
  }

  return current
}

function stringifyExample(value: unknown) {
  if (value === undefined || value === null) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  return JSON.stringify(value)
}

function looksLikeJson(rawBody: string) {
  const trimmed = rawBody.trim()
  return (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  )
}

function formatJson(rawBody: string) {
  try {
    return JSON.stringify(JSON.parse(rawBody), null, 2)
  } catch {
    return rawBody
  }
}

function firstMediaType(
  content: Record<string, OpenApiMediaType>,
  predicate: (mediaType: string) => boolean,
) {
  const match = Object.entries(content).find(([mediaType]) => predicate(mediaType))
  return match?.[1]
}

function firstMediaTypeKey(
  content: Record<string, OpenApiMediaType>,
  target: OpenApiMediaType,
) {
  return Object.entries(content).find(([, mediaType]) => mediaType === target)?.[0]
}

function createRow(key = '', value = ''): KeyValueRow {
  return {
    id: crypto.randomUUID(),
    key,
    value,
    enabled: true,
  }
}
