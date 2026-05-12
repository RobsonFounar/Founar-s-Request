import type {
  AuthConfig,
  EnvironmentItem,
  ExecuteRequestInput,
  KeyValueRow,
  RequestBody,
} from '../types'

const VARIABLE_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g

export function resolveRequestInput(
  input: ExecuteRequestInput,
  environment?: EnvironmentItem,
): ExecuteRequestInput {
  const variableMap = buildVariableMap(environment)

  return {
    method: input.method,
    url: resolveTemplate(input.url, variableMap),
    headers: resolveRows(input.headers, variableMap),
    queryParams: resolveRows(input.queryParams, variableMap),
    auth: resolveAuth(input.auth, variableMap),
    body: resolveBody(input.body, variableMap),
  }
}

export function collectMissingVariables(
  input: ExecuteRequestInput,
  environment?: EnvironmentItem,
): string[] {
  const variableMap = buildVariableMap(environment)
  const missing = new Set<string>()

  collectMissingFromValue(input.url, variableMap, missing)

  for (const row of input.headers) {
    if (!row.enabled) {
      continue
    }

    collectMissingFromValue(row.key, variableMap, missing)
    collectMissingFromValue(row.value, variableMap, missing)
  }

  for (const row of input.queryParams) {
    if (!row.enabled) {
      continue
    }

    collectMissingFromValue(row.key, variableMap, missing)
    collectMissingFromValue(row.value, variableMap, missing)
  }

  collectMissingFromAuth(input.auth, variableMap, missing)
  collectMissingFromBody(input.body, variableMap, missing)

  return [...missing].sort((left, right) => left.localeCompare(right))
}

export function resolveTemplate(
  value: string,
  variableMap: Record<string, string>,
): string {
  return value.replace(VARIABLE_PATTERN, (fullMatch, variableName: string) => {
    const normalizedName = variableName.trim()

    if (Object.hasOwn(variableMap, normalizedName)) {
      return variableMap[normalizedName]
    }

    return fullMatch
  })
}

function buildVariableMap(environment?: EnvironmentItem) {
  return (environment?.variables ?? []).reduce<Record<string, string>>(
    (accumulator, row) => {
      if (!row.enabled || !row.key.trim()) {
        return accumulator
      }

      accumulator[row.key.trim()] = row.value
      return accumulator
    },
    {},
  )
}

function resolveRows(
  rows: KeyValueRow[],
  variableMap: Record<string, string>,
): KeyValueRow[] {
  return rows.map((row) => ({
    ...row,
    key: resolveTemplate(row.key, variableMap),
    value: resolveTemplate(row.value, variableMap),
  }))
}

function resolveAuth(
  auth: AuthConfig,
  variableMap: Record<string, string>,
): AuthConfig {
  switch (auth.type) {
    case 'bearer':
      return {
        ...auth,
        token: resolveTemplate(auth.token, variableMap),
      }
    case 'basic':
      return {
        ...auth,
        username: resolveTemplate(auth.username, variableMap),
        password: resolveTemplate(auth.password, variableMap),
      }
    case 'apiKey':
      return {
        ...auth,
        key: resolveTemplate(auth.key, variableMap),
        value: resolveTemplate(auth.value, variableMap),
      }
    default:
      return auth
  }
}

function resolveBody(
  body: RequestBody,
  variableMap: Record<string, string>,
): RequestBody {
  switch (body.mode) {
    case 'json':
    case 'text':
      return {
        ...body,
        content: resolveTemplate(body.content, variableMap),
      }
    case 'form':
      return {
        mode: 'form',
        entries: resolveRows(body.entries, variableMap),
      }
    default:
      return body
  }
}

function collectMissingFromAuth(
  auth: AuthConfig,
  variableMap: Record<string, string>,
  missing: Set<string>,
) {
  switch (auth.type) {
    case 'bearer':
      collectMissingFromValue(auth.token, variableMap, missing)
      break
    case 'basic':
      collectMissingFromValue(auth.username, variableMap, missing)
      collectMissingFromValue(auth.password, variableMap, missing)
      break
    case 'apiKey':
      collectMissingFromValue(auth.key, variableMap, missing)
      collectMissingFromValue(auth.value, variableMap, missing)
      break
    default:
      break
  }
}

function collectMissingFromBody(
  body: RequestBody,
  variableMap: Record<string, string>,
  missing: Set<string>,
) {
  switch (body.mode) {
    case 'json':
    case 'text':
      collectMissingFromValue(body.content, variableMap, missing)
      break
    case 'form':
      for (const row of body.entries) {
        if (!row.enabled) {
          continue
        }

        collectMissingFromValue(row.key, variableMap, missing)
        collectMissingFromValue(row.value, variableMap, missing)
      }
      break
    default:
      break
  }
}

function collectMissingFromValue(
  value: string,
  variableMap: Record<string, string>,
  missing: Set<string>,
) {
  for (const match of value.matchAll(VARIABLE_PATTERN)) {
    const variableName = match[1]?.trim()

    if (variableName && !Object.hasOwn(variableMap, variableName)) {
      missing.add(variableName)
    }
  }
}
