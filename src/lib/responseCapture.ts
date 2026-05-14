import type { EnvironmentItem, ResponseCaptureRule } from '../types'

/**
 * LEMBRETE (próxima sessão): captura dinâmica a partir do body da resposta
 *
 * Comportamento atual: a cada envio bem-sucedido da aba, o JSON da resposta é
 * relido e as regras ativas atualizam o ambiente (upsert por nome de variável).
 *
 * Próximos ajustes sugeridos: seleção no JsonViewer (clique no campo → preenche
 * o caminho), captura a partir de headers, e feedback explícito quando o valor
 * capturado mudou ou se manteve igual entre chamadas.
 */

function valueToEnvString(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return JSON.stringify(value)
}

/**
 * Caminho estilo ponto a partir da raiz do JSON: `access_token`, `data.token`, `items.0.id`.
 * Segmentos numéricos tratam arrays (índice 0-based).
 */
export function getJsonValueAtPath(data: unknown, path: string): unknown {
  const trimmed = path.trim()
  if (!trimmed) {
    return data
  }

  const parts = trimmed.split('.').filter((p) => p.length > 0)
  let current: unknown = data

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined
    }

    const index = /^\d+$/.test(part) ? Number(part) : null

    if (index !== null && Array.isArray(current)) {
      current = current[index]
      continue
    }

    if (index !== null && typeof current === 'object') {
      current = (current as Record<string, unknown>)[part]
      continue
    }

    if (typeof current === 'object' && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[part]
      continue
    }

    return undefined
  }

  return current
}

export type CaptureComputeResult = {
  updates: Array<{ name: string; value: string }>
  warnings: string[]
}

export function computeCaptureUpdates(
  responseBody: string,
  rules: ResponseCaptureRule[],
): CaptureComputeResult {
  const activeRules = rules.filter(
    (rule) =>
      rule.enabled && rule.jsonPath.trim() !== '' && rule.variableName.trim() !== '',
  )

  if (activeRules.length === 0) {
    return { updates: [], warnings: [] }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(responseBody) as unknown
  } catch {
    return {
      updates: [],
      warnings: ['O body da resposta não é JSON válido; nada foi capturado.'],
    }
  }

  const updates: Array<{ name: string; value: string }> = []
  const warnings: string[] = []

  for (const rule of activeRules) {
    const path = rule.jsonPath.trim()
    const varName = rule.variableName.trim()
    const raw = getJsonValueAtPath(parsed, path)

    if (raw === undefined) {
      warnings.push(`Caminho "${path}" não encontrado no JSON.`)
      continue
    }

    updates.push({ name: varName, value: valueToEnvString(raw) })
  }

  return { updates, warnings }
}

export function upsertEnvironmentVariable(
  environment: EnvironmentItem,
  variableName: string,
  value: string,
): EnvironmentItem {
  const name = variableName.trim()
  if (!name) {
    return environment
  }

  const variables = [...environment.variables]
  const index = variables.findIndex((row) => row.key.trim() === name)

  if (index >= 0) {
    const row = variables[index]
    variables[index] = { ...row, value, enabled: true }
  } else {
    variables.push({
      id: crypto.randomUUID(),
      key: name,
      value,
      enabled: true,
    })
  }

  return { ...environment, variables }
}

export function applyCaptureUpdatesToEnvironment(
  environment: EnvironmentItem,
  updates: Array<{ name: string; value: string }>,
): EnvironmentItem {
  return updates.reduce(
    (acc, item) => upsertEnvironmentVariable(acc, item.name, item.value),
    environment,
  )
}
