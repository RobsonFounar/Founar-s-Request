export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'

export type KeyValueRow = {
  id: string
  key: string
  value: string
  enabled: boolean
}

export type AuthConfig =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'apiKey'; key: string; value: string; addTo: 'header' | 'query' }

export type RequestBody =
  | { mode: 'none' }
  | { mode: 'json'; content: string }
  | { mode: 'text'; content: string }
  | { mode: 'form'; entries: KeyValueRow[] }

/** Mapeia um campo do JSON da resposta para uma variável do ambiente ativo. */
export type ResponseCaptureRule = {
  id: string
  enabled: boolean
  /** Caminho a partir da raiz, ex.: `access_token`, `data.token`, `items.0.id`. */
  jsonPath: string
  /** Nome da variável no ambiente (cria a linha se ainda não existir). */
  variableName: string
}

export type RequestResponse = {
  ok: boolean
  status: number
  statusText: string
  durationMs: number
  headers: Array<{ key: string; value: string }>
  body: string
  receivedAt: string
  error?: string
}

export type RequestTab = {
  id: string
  name: string
  method: HttpMethod
  url: string
  headers: KeyValueRow[]
  queryParams: KeyValueRow[]
  auth: AuthConfig
  body: RequestBody
  response?: RequestResponse
  isSending?: boolean
  collectionId?: string
  savedRequestId?: string
  /** Regras aplicadas após envio bem-sucedido (body JSON) ao ambiente ativo. */
  responseCaptures?: ResponseCaptureRule[]
}

export type EnvironmentColor =
  | 'verde'
  | 'vermelho'
  | 'amarelo'
  | 'branco'
  | 'lilas'

export type EnvironmentItem = {
  id: string
  name: string
  color: EnvironmentColor
  variables: KeyValueRow[]
}

export type SavedRequestItem = {
  id: string
  name: string
  updatedAt: string
  request: RequestTab
}

export type CollectionItem = {
  id: string
  name: string
  requests: SavedRequestItem[]
}

export type HistoryEntry = {
  id: string
  executedAt: string
  method: HttpMethod
  url: string
  resolvedUrl?: string
  status: number
  durationMs: number
  environmentName?: string
  tabSnapshot: RequestTab
}

export type ExecuteRequestInput = Pick<
  RequestTab,
  'method' | 'url' | 'headers' | 'queryParams' | 'auth' | 'body'
>

export type LoadTestMode = 'count' | 'duration' | 'rampUp' | 'peak'

export type LoadTestConfig = {
  mode: LoadTestMode
  totalRequests: number
  durationSeconds: number
  concurrency: number
  /**
   * Ramp-up: concorrência inicial. Peak: concorrência no vale (início e fim da curva).
   */
  rampStartConcurrency: number
  /**
   * No ramp-up: segundos em que a concorrência sobe do inicial ao final.
   * Deve ser ≤ durationSeconds (duração total do teste).
   */
  rampDurationSeconds: number
  /**
   * Peak: segundos para subir do vale à concorrência no pico (`concurrency`).
   * Com `peakDescendSeconds`, a soma deve ser ≤ `durationSeconds`.
   */
  peakAscendSeconds: number
  /**
   * Peak: segundos no **final** da janela em que a concorrência desce do pico ao vale.
   * A descida **começa** no segundo `durationSeconds - peakDescendSeconds` (ex.: 60s
   * totais e 10s de descida → começa no segundo 50).
   */
  peakDescendSeconds: number
}

export type LoadTestSample = {
  index: number
  elapsedMs: number
  durationMs: number
  ok: boolean
  status: number
  method?: string
  url?: string
  error?: string
}

export type LoadTestLogEntry = {
  index: number
  method: string
  url: string
  status: number
  ok: boolean
  durationMs: number
  error?: string
}

export type LoadTestResult = {
  mode: LoadTestMode
  startedAt: string
  totalRequests: number
  concurrency: number
  durationSeconds?: number
  rampStartConcurrency?: number
  rampDurationSeconds?: number
  peakAscendSeconds?: number
  peakDescendSeconds?: number
  successfulRequests: number
  failedRequests: number
  totalDurationMs: number
  requestsPerSecond: number
  minLatencyMs: number
  avgLatencyMs: number
  maxLatencyMs: number
  p50LatencyMs: number
  p95LatencyMs: number
  statusCounts: Array<{ label: string; count: number }>
  errorSamples: string[]
  samples: LoadTestSample[]
}
