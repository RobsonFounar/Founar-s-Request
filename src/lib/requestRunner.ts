import type {
  ExecuteRequestInput,
  LoadTestConfig,
  LoadTestLogEntry,
  LoadTestResult,
  LoadTestSample,
  RequestResponse,
} from '../types'

export async function executeRequest(
  input: ExecuteRequestInput,
): Promise<RequestResponse> {
  const response = await fetch('/api/requests/execute', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  const payload = (await response.json()) as RequestResponse

  if (!response.ok && !payload.error) {
    throw new Error(`Falha ao executar request: ${response.status}`)
  }

  return payload
}

type StreamSampleEvent = {
  type: 'sample'
  index: number
  elapsedMs: number
  durationMs: number
  ok: boolean
  status: number
  method?: string
  url?: string
  error?: string
}

type StreamResultEvent = { type: 'result' } & LoadTestResult

type StreamErrorEvent = { type?: undefined; error?: string }

type StreamEvent = StreamSampleEvent | StreamResultEvent | StreamErrorEvent

export type LoadTestRunOptions = {
  signal?: AbortSignal
  onLog?: (entry: LoadTestLogEntry) => void
  onSample?: (sample: LoadTestSample) => void
}

export async function runLoadTest(
  request: ExecuteRequestInput,
  config: LoadTestConfig,
  options: LoadTestRunOptions = {},
): Promise<LoadTestResult> {
  const body =
    config.mode === 'duration'
      ? {
          request,
          mode: 'duration' as const,
          durationSeconds: config.durationSeconds,
          concurrency: config.concurrency,
        }
      : config.mode === 'rampUp'
        ? {
            request,
            mode: 'rampUp' as const,
            durationSeconds: config.durationSeconds,
            concurrency: config.concurrency,
            rampStartConcurrency: config.rampStartConcurrency,
            rampDurationSeconds: config.rampDurationSeconds,
          }
        : config.mode === 'peak'
          ? {
              request,
              mode: 'peak' as const,
              durationSeconds: config.durationSeconds,
              concurrency: config.concurrency,
              rampStartConcurrency: config.rampStartConcurrency,
              peakAscendSeconds: config.peakAscendSeconds,
              peakDescendSeconds: config.peakDescendSeconds,
            }
          : {
              request,
              mode: 'count' as const,
              totalRequests: config.totalRequests,
              concurrency: config.concurrency,
            }

  let response: Response

  try {
    response = await fetch('/api/load-tests/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/x-ndjson',
      },
      body: JSON.stringify(body),
      signal: options.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Teste de carga cancelado.', { cause: error })
    }
    throw error
  }

  const contentType = response.headers.get('content-type') ?? ''

  if (!response.ok && !contentType.includes('ndjson')) {
    const payload = (await response.json()) as { error?: string }
    throw new Error(payload.error ?? 'Falha ao executar o teste de carga.')
  }

  if (!contentType.includes('ndjson')) {
    const payload = (await response.json()) as Partial<LoadTestResult> & {
      error?: string
    }

    if (!response.ok) {
      throw new Error(payload.error ?? 'Falha ao executar o teste de carga.')
    }

    const normalized = payload as LoadTestResult
    return {
      ...normalized,
      mode: normalized.mode ?? config.mode,
      samples: normalized.samples ?? [],
    }
  }

  if (!response.body) {
    throw new Error('Resposta de streaming sem corpo.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let finalResult: LoadTestResult | null = null

  try {
    while (true) {
      const chunk = await reader.read()

      if (chunk.done) {
        break
      }

      buffer += decoder.decode(chunk.value, { stream: true })

      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex !== -1) {
        const rawLine = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)

        if (rawLine) {
          let event: StreamEvent | null = null
          try {
            event = JSON.parse(rawLine) as StreamEvent
          } catch {
            event = null
          }

          if (event && event.type === 'sample') {
            const sample: LoadTestSample = {
              index: event.index,
              elapsedMs: event.elapsedMs,
              durationMs: event.durationMs,
              ok: event.ok,
              status: event.status,
              method: event.method,
              url: event.url,
              error: event.error,
            }
            options.onSample?.(sample)

            if (event.method && event.url) {
              options.onLog?.({
                index: event.index,
                method: event.method,
                url: event.url,
                status: event.status,
                ok: event.ok,
                durationMs: event.durationMs,
                error: event.error,
              })
            }
          } else if (event && event.type === 'result') {
            const { type, ...rest } = event
            void type
            finalResult = rest as LoadTestResult
          } else if (event && 'error' in event && typeof event.error === 'string') {
            throw new Error(event.error)
          }
        }

        newlineIndex = buffer.indexOf('\n')
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Teste de carga cancelado.', { cause: error })
    }
    throw error
  } finally {
    reader.releaseLock()
  }

  if (!finalResult) {
    throw new Error('Stream finalizado sem resultado do servidor.')
  }

  return {
    ...finalResult,
    mode: finalResult.mode ?? config.mode,
    samples: finalResult.samples ?? [],
  }
}
