const VARIABLE_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g

const EMPTY_VARIABLE_SET: ReadonlySet<string> = new Set()

export type Segment = {
  text: string
  className?: string
}

function classifyVariable(
  name: string,
  variableNames: ReadonlySet<string>,
): string {
  return variableNames.has(name) ? 'var-token--valid' : 'var-token--missing'
}

function pushVariablesInside(
  text: string,
  baseClass: string,
  variableNames: ReadonlySet<string>,
  segments: Segment[],
) {
  let lastIndex = 0

  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    const matchIndex = match.index ?? 0

    if (matchIndex > lastIndex) {
      segments.push({
        text: text.slice(lastIndex, matchIndex),
        className: baseClass,
      })
    }

    const raw = match[0]
    const name = match[1]?.trim() ?? ''
    segments.push({
      text: raw,
      className: classifyVariable(name, variableNames),
    })

    lastIndex = matchIndex + raw.length
  }

  if (lastIndex < text.length) {
    segments.push({
      text: text.slice(lastIndex),
      className: baseClass,
    })
  }
}

function isWhitespace(char: string) {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r'
}

export function segmentJson(
  value: string,
  variableNames: ReadonlySet<string> = EMPTY_VARIABLE_SET,
): Segment[] {
  if (!value) {
    return []
  }

  const segments: Segment[] = []
  let plainBuffer = ''
  let index = 0

  const flushPlain = () => {
    if (plainBuffer) {
      segments.push({ text: plainBuffer })
      plainBuffer = ''
    }
  }

  while (index < value.length) {
    const char = value[index]

    if (char === '{' && value[index + 1] === '{') {
      const end = value.indexOf('}}', index + 2)
      if (end !== -1) {
        flushPlain()
        const raw = value.slice(index, end + 2)
        const name = raw.slice(2, -2).trim()
        segments.push({
          text: raw,
          className: classifyVariable(name, variableNames),
        })
        index = end + 2
        continue
      }
    }

    if (char === '"') {
      flushPlain()
      let cursor = index + 1
      while (cursor < value.length) {
        const inner = value[cursor]
        if (inner === '\\' && cursor + 1 < value.length) {
          cursor += 2
          continue
        }
        if (inner === '"') {
          cursor += 1
          break
        }
        cursor += 1
      }

      const stringRaw = value.slice(index, cursor)

      let lookahead = cursor
      while (lookahead < value.length && isWhitespace(value[lookahead])) {
        lookahead += 1
      }
      const isKey = value[lookahead] === ':'
      const baseClass = isKey ? 'json-key' : 'json-string'

      pushVariablesInside(stringRaw, baseClass, variableNames, segments)
      index = cursor
      continue
    }

    if (char === '-' || (char >= '0' && char <= '9')) {
      const remaining = value.slice(index)
      const numberMatch = remaining.match(
        /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/,
      )
      if (numberMatch && numberMatch[0].length > 0) {
        flushPlain()
        segments.push({ text: numberMatch[0], className: 'json-number' })
        index += numberMatch[0].length
        continue
      }
    }

    if (char === 't' || char === 'f' || char === 'n') {
      const remaining = value.slice(index)
      const literalMatch = remaining.match(/^(true|false|null)\b/)
      if (literalMatch) {
        flushPlain()
        const literal = literalMatch[0]
        segments.push({
          text: literal,
          className: literal === 'null' ? 'json-null' : 'json-bool',
        })
        index += literal.length
        continue
      }
    }

    if (
      char === '{' ||
      char === '}' ||
      char === '[' ||
      char === ']' ||
      char === ',' ||
      char === ':'
    ) {
      flushPlain()
      segments.push({ text: char, className: 'json-punct' })
      index += 1
      continue
    }

    plainBuffer += char
    index += 1
  }

  flushPlain()
  return segments
}
