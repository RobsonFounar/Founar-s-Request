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

export type LoadTestConfig = {
  totalRequests: number
  concurrency: number
}

export type LoadTestResult = {
  startedAt: string
  totalRequests: number
  concurrency: number
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
}
