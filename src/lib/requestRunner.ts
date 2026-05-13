import type {
  ExecuteRequestInput,
  LoadTestConfig,
  LoadTestResult,
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

export async function runLoadTest(
  request: ExecuteRequestInput,
  config: LoadTestConfig,
  options?: { signal?: AbortSignal },
): Promise<LoadTestResult> {
  const body =
    config.mode === 'duration'
      ? {
          request,
          mode: 'duration' as const,
          durationSeconds: config.durationSeconds,
          concurrency: config.concurrency,
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
      },
      body: JSON.stringify(body),
      signal: options?.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Teste de carga cancelado.')
    }

    throw error
  }

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
