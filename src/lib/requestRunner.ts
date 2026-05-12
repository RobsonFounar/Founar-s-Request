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
): Promise<LoadTestResult> {
  const response = await fetch('/api/load-tests/run', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      request,
      totalRequests: config.totalRequests,
      concurrency: config.concurrency,
    }),
  })

  const payload = (await response.json()) as LoadTestResult & { error?: string }

  if (!response.ok) {
    throw new Error(payload.error ?? 'Falha ao executar o teste de carga.')
  }

  return payload
}
