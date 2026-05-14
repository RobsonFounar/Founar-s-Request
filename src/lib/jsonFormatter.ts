const RAW_VAR_PLACEHOLDER_PREFIX = '\u0000VAR\u0000'
const RAW_VAR_PLACEHOLDER_SUFFIX = '\u0000'

function substituteRawVariables(value: string): string {
  let output = ''
  let index = 0
  let inString = false

  while (index < value.length) {
    const char = value[index]

    if (inString) {
      if (char === '\\' && index + 1 < value.length) {
        output += char + value[index + 1]
        index += 2
        continue
      }

      if (char === '"') {
        inString = false
        output += char
        index += 1
        continue
      }

      output += char
      index += 1
      continue
    }

    if (char === '"') {
      inString = true
      output += char
      index += 1
      continue
    }

    if (char === '{' && value[index + 1] === '{') {
      const end = value.indexOf('}}', index + 2)
      if (end !== -1) {
        const name = value.slice(index + 2, end).trim()
        output += `"${RAW_VAR_PLACEHOLDER_PREFIX}${name}${RAW_VAR_PLACEHOLDER_SUFFIX}"`
        index = end + 2
        continue
      }
    }

    output += char
    index += 1
  }

  return output
}

function restoreRawVariables(formatted: string): string {
  const NUL = String.fromCharCode(0)
  return formatted.replace(
    new RegExp(`"${NUL}VAR${NUL}([^"${NUL}]*?)${NUL}"`, 'g'),
    (_match, name: string) => `{{${name.trim()}}}`,
  )
}

export type FormatJsonResult =
  | { ok: true; value: string }
  | { ok: false; error: string }

export function formatJsonWithVariables(content: string): FormatJsonResult {
  const trimmed = content.trim()
  if (!trimmed) {
    return { ok: true, value: '' }
  }

  try {
    const parsed = JSON.parse(content) as unknown
    return { ok: true, value: JSON.stringify(parsed, null, 2) }
  } catch {
    /* tenta com placeholders para variáveis fora de strings */
  }

  const substituted = substituteRawVariables(content)
  try {
    const parsed = JSON.parse(substituted) as unknown
    const formatted = JSON.stringify(parsed, null, 2)
    return { ok: true, value: restoreRawVariables(formatted) }
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : 'JSON inválido.',
    }
  }
}

export function isJsonValid(content: string): boolean {
  if (!content.trim()) {
    return true
  }

  try {
    JSON.parse(content)
    return true
  } catch {
    /* tenta com placeholders para variáveis fora de strings */
  }

  try {
    JSON.parse(substituteRawVariables(content))
    return true
  } catch {
    return false
  }
}
