import cors from 'cors'
import express from 'express'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

type KeyValueRow = {
  key: string
  value: string
  enabled: boolean
}

type AuthConfig =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'apiKey'; key: string; value: string; addTo: 'header' | 'query' }

type RequestBody =
  | { mode: 'none' }
  | { mode: 'json'; content: string }
  | { mode: 'text'; content: string }
  | { mode: 'form'; entries: KeyValueRow[] }

type ExecuteRequestInput = {
  method: string
  url: string
  headers: KeyValueRow[]
  queryParams: KeyValueRow[]
  auth: AuthConfig
  body: RequestBody
}

type LoadTestInput = {
  request: ExecuteRequestInput
  totalRequests: number
  concurrency: number
}

type ExecutionResult = {
  ok: boolean
  status: number
  statusText: string
  durationMs: number
  headers: Array<{ key: string; value: string }>
  body: string
  receivedAt: string
  error?: string
}

const app = express()
const port = Number(process.env.PORT ?? 8787)
const currentFilePath = fileURLToPath(import.meta.url)
const currentDir = dirname(currentFilePath)
const distDir = join(currentDir, '..', 'dist')

app.use(cors())
app.use(express.json({ limit: '5mb' }))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.post('/api/requests/execute', async (req, res) => {
  const input = req.body as ExecuteRequestInput
  const result = await executeHttpRequest(input)

  if (result.error) {
    res.status(result.status).json(result)
    return
  }

  res.json(result)
})

app.post('/api/load-tests/run', async (req, res) => {
  const input = req.body as LoadTestInput
  const totalRequests = Number(input?.totalRequests)
  const concurrency = Number(input?.concurrency)

  if (!input?.request?.url) {
    res.status(400).json({
      error: 'Informe uma URL antes de iniciar o teste de carga.',
    })
    return
  }

  if (!Number.isInteger(totalRequests) || totalRequests < 1 || totalRequests > 1000) {
    res.status(400).json({
      error: 'Defina uma quantidade entre 1 e 1000 requests.',
    })
    return
  }

  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 50) {
    res.status(400).json({
      error: 'Defina uma concorrencia entre 1 e 50.',
    })
    return
  }

  const startedAt = new Date().toISOString()
  const suiteStartedAt = Date.now()
  let nextRequestIndex = 0
  const outcomes: Array<{
    durationMs: number
    ok: boolean
    status: number
    error?: string
  }> = []

  const workerCount = Math.min(concurrency, totalRequests)
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextRequestIndex < totalRequests) {
      const currentIndex = nextRequestIndex
      nextRequestIndex += 1

      if (currentIndex >= totalRequests) {
        break
      }

      const result = await executeHttpRequest(input.request)

      outcomes.push({
        durationMs: result.durationMs,
        ok: result.ok,
        status: result.status,
        error: result.error,
      })
    }
  })

  await Promise.all(workers)

  const totalDurationMs = Date.now() - suiteStartedAt
  const latencies = outcomes.map((outcome) => outcome.durationMs).sort((a, b) => a - b)
  const successfulRequests = outcomes.filter((outcome) => outcome.ok).length
  const failedRequests = outcomes.length - successfulRequests
  const avgLatencyMs =
    latencies.length > 0
      ? latencies.reduce((sum, current) => sum + current, 0) / latencies.length
      : 0
  const statusCounts = [...countByStatus(outcomes).entries()].map(([label, count]) => ({
    label,
    count,
  }))
  const errorSamples = [
    ...new Set(
      outcomes
        .map((outcome) => outcome.error)
        .filter((error): error is string => Boolean(error)),
    ),
  ].slice(0, 5)

  res.json({
    startedAt,
    totalRequests,
    concurrency,
    successfulRequests,
    failedRequests,
    totalDurationMs,
    requestsPerSecond:
      totalDurationMs > 0 ? Number((outcomes.length / (totalDurationMs / 1000)).toFixed(2)) : 0,
    minLatencyMs: latencies[0] ?? 0,
    avgLatencyMs: Number(avgLatencyMs.toFixed(2)),
    maxLatencyMs: latencies[latencies.length - 1] ?? 0,
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    statusCounts,
    errorSamples,
  })
})

if (existsSync(distDir)) {
  app.use(express.static(distDir))

  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(join(distDir, 'index.html'))
  })
}

app.listen(port, () => {
  console.log(`Servidor ouvindo em http://localhost:${port}`)
})

function applyAuth(headers: Headers, targetUrl: URL, auth: AuthConfig) {
  switch (auth?.type) {
    case 'bearer':
      if (auth.token.trim()) {
        headers.set('Authorization', `Bearer ${auth.token.trim()}`)
      }
      break
    case 'basic': {
      const encoded = Buffer.from(
        `${auth.username ?? ''}:${auth.password ?? ''}`,
      ).toString('base64')

      headers.set('Authorization', `Basic ${encoded}`)
      break
    }
    case 'apiKey':
      if (!auth.key.trim()) {
        break
      }

      if (auth.addTo === 'query') {
        targetUrl.searchParams.set(auth.key.trim(), auth.value)
      } else {
        headers.set(auth.key.trim(), auth.value)
      }
      break
    default:
      break
  }
}

function buildFetchOptions(input: ExecuteRequestInput, headers: Headers) {
  const method = (input.method || 'GET').toUpperCase()
  const baseOptions: RequestInit = {
    method,
    headers,
  }

  if (method === 'GET' || method === 'HEAD') {
    return baseOptions
  }

  switch (input.body?.mode) {
    case 'json':
      if (input.body.content.trim()) {
        ensureHeader(headers, 'Content-Type', 'application/json')
        baseOptions.body = input.body.content
      }
      break
    case 'text':
      if (input.body.content) {
        baseOptions.body = input.body.content
      }
      break
    case 'form': {
      const params = new URLSearchParams()

      for (const row of input.body.entries ?? []) {
        if (row.enabled && row.key.trim()) {
          params.set(row.key.trim(), row.value)
        }
      }

      ensureHeader(
        headers,
        'Content-Type',
        'application/x-www-form-urlencoded;charset=UTF-8',
      )
      baseOptions.body = params.toString()
      break
    }
    default:
      break
  }

  return baseOptions
}

function ensureHeader(headers: Headers, key: string, value: string) {
  if (!headers.has(key)) {
    headers.set(key, value)
  }
}

function formatResponseBody(rawBody: string, contentType: string) {
  if (!rawBody) {
    return ''
  }

  if (contentType.includes('application/json')) {
    try {
      return JSON.stringify(JSON.parse(rawBody), null, 2)
    } catch {
      return rawBody
    }
  }

  return rawBody
}

async function executeHttpRequest(
  input: ExecuteRequestInput,
): Promise<ExecutionResult> {
  if (!input?.url) {
    return createErrorResponse(400, 'Bad Request', 'Informe uma URL antes de enviar a request.')
  }

  let targetUrl: URL

  try {
    targetUrl = new URL(input.url)
  } catch {
    return createErrorResponse(400, 'Bad Request', 'A URL informada não é válida.')
  }

  for (const row of input.queryParams ?? []) {
    if (row.enabled && row.key.trim()) {
      targetUrl.searchParams.set(row.key.trim(), row.value)
    }
  }

  const headers = new Headers()

  for (const row of input.headers ?? []) {
    if (row.enabled && row.key.trim()) {
      headers.set(row.key.trim(), row.value)
    }
  }

  applyAuth(headers, targetUrl, input.auth)

  const fetchOptions = buildFetchOptions(input, headers)
  const startedAt = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)

  try {
    const response = await fetch(targetUrl, {
      ...fetchOptions,
      signal: controller.signal,
    })

    clearTimeout(timeout)

    const rawBody = await response.text()
    const contentType = response.headers.get('content-type') ?? ''

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      durationMs: Date.now() - startedAt,
      headers: Array.from(response.headers.entries()).map(([key, value]) => ({
        key,
        value,
      })),
      body: formatResponseBody(rawBody, contentType),
      receivedAt: new Date().toISOString(),
    }
  } catch (error) {
    clearTimeout(timeout)

    const message =
      error instanceof Error && error.name === 'AbortError'
        ? 'A request excedeu o timeout de 30 segundos.'
        : error instanceof Error
          ? error.message
          : 'Falha inesperada ao executar a request.'

    const status = message.includes('timeout') ? 504 : 500

    return createErrorResponse(
      status,
      status === 504 ? 'Gateway Timeout' : 'Internal Server Error',
      message,
      Date.now() - startedAt,
    )
  }
}

function createErrorResponse(
  status: number,
  statusText: string,
  error: string,
  durationMs = 0,
): ExecutionResult {
  return {
    ok: false,
    status,
    statusText,
    durationMs,
    headers: [],
    body: '',
    receivedAt: new Date().toISOString(),
    error,
  }
}

function percentile(values: number[], ratio: number) {
  if (values.length === 0) {
    return 0
  }

  const index = Math.max(0, Math.ceil(values.length * ratio) - 1)
  return values[index] ?? 0
}

function countByStatus(
  outcomes: Array<{ status: number; error?: string }>,
) {
  return outcomes.reduce((accumulator, outcome) => {
    const label = outcome.error ? `erro ${outcome.status}` : String(outcome.status)
    accumulator.set(label, (accumulator.get(label) ?? 0) + 1)
    return accumulator
  }, new Map<string, number>())
}
