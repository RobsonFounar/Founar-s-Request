import type {
  ChangeEvent,
  ComponentPropsWithoutRef,
  CSSProperties,
} from 'react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'

const VARIABLE_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g

export type Segment = {
  text: string
  className?: string
}

type HighlightLanguage = 'none' | 'json'

const EMPTY_VARIABLE_SET: ReadonlySet<string> = new Set()

function classifyVariable(
  name: string,
  variableNames: ReadonlySet<string>,
): string {
  return variableNames.has(name) ? 'var-token--valid' : 'var-token--missing'
}

function segmentVariablesOnly(
  value: string,
  variableNames: ReadonlySet<string>,
): Segment[] {
  if (!value) {
    return []
  }

  const segments: Segment[] = []
  let lastIndex = 0

  for (const match of value.matchAll(VARIABLE_PATTERN)) {
    const matchIndex = match.index ?? 0

    if (matchIndex > lastIndex) {
      segments.push({ text: value.slice(lastIndex, matchIndex) })
    }

    const raw = match[0]
    const name = match[1]?.trim() ?? ''
    segments.push({
      text: raw,
      className: classifyVariable(name, variableNames),
    })

    lastIndex = matchIndex + raw.length
  }

  if (lastIndex < value.length) {
    segments.push({ text: value.slice(lastIndex) })
  }

  return segments
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

function buildSegments(
  value: string,
  variableNames: ReadonlySet<string>,
  language: HighlightLanguage,
): Segment[] {
  if (language === 'json') {
    return segmentJson(value, variableNames)
  }

  return segmentVariablesOnly(value, variableNames)
}

function renderSegments(segments: Segment[]) {
  if (segments.length === 0) {
    return '\u200b'
  }

  return segments.map((segment, index) => {
    if (!segment.className) {
      return <span key={index}>{segment.text}</span>
    }

    return (
      <span key={index} className={segment.className}>
        {segment.text}
      </span>
    )
  })
}

type SharedProps = {
  variableNames: ReadonlySet<string>
}

type VariableHighlightedInputProps = Omit<
  ComponentPropsWithoutRef<'input'>,
  'value' | 'onChange'
> & {
  value: string
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
} & SharedProps

export function VariableHighlightedInput({
  value,
  onChange,
  variableNames,
  className,
  style,
  ...inputProps
}: VariableHighlightedInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const ghostRef = useRef<HTMLDivElement | null>(null)
  const [scrollLeft, setScrollLeft] = useState(0)

  const segments = useMemo(
    () => segmentVariablesOnly(value, variableNames),
    [value, variableNames],
  )

  useLayoutEffect(() => {
    const inputElement = inputRef.current
    if (!inputElement) {
      return
    }

    const handleScroll = () => {
      setScrollLeft(inputElement.scrollLeft)
    }

    handleScroll()
    inputElement.addEventListener('scroll', handleScroll)

    return () => {
      inputElement.removeEventListener('scroll', handleScroll)
    }
  }, [value])

  return (
    <div
      className={`variable-highlight variable-highlight--input ${className ?? ''}`}
      style={style}
    >
      <div
        ref={ghostRef}
        className="variable-highlight__ghost"
        aria-hidden="true"
        style={{ transform: `translateX(${-scrollLeft}px)` }}
      >
        {renderSegments(segments)}
      </div>
      <input
        {...inputProps}
        ref={inputRef}
        className="variable-highlight__field"
        value={value}
        onChange={(event) => {
          setScrollLeft(event.currentTarget.scrollLeft)
          onChange(event)
        }}
      />
    </div>
  )
}

type VariableHighlightedTextareaProps = Omit<
  ComponentPropsWithoutRef<'textarea'>,
  'value' | 'onChange'
> & {
  value: string
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  language?: HighlightLanguage
  withLineNumbers?: boolean
} & SharedProps

export function VariableHighlightedTextarea({
  value,
  onChange,
  variableNames,
  className,
  style,
  language = 'none',
  withLineNumbers = false,
  ...textareaProps
}: VariableHighlightedTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const ghostRef = useRef<HTMLDivElement | null>(null)
  const gutterInnerRef = useRef<HTMLDivElement | null>(null)

  const segments = useMemo(
    () => buildSegments(value, variableNames, language),
    [value, variableNames, language],
  )

  const lineCount = useMemo(() => {
    if (!value) {
      return 1
    }

    let count = 1
    for (let index = 0; index < value.length; index += 1) {
      if (value[index] === '\n') {
        count += 1
      }
    }
    return count
  }, [value])

  useLayoutEffect(() => {
    const textareaElement = textareaRef.current
    const ghostElement = ghostRef.current
    const gutterInnerElement = gutterInnerRef.current
    if (!textareaElement) {
      return
    }

    const syncScroll = () => {
      if (ghostElement) {
        ghostElement.scrollTop = textareaElement.scrollTop
        ghostElement.scrollLeft = textareaElement.scrollLeft
      }
      if (gutterInnerElement) {
        gutterInnerElement.style.transform = `translateY(${-textareaElement.scrollTop}px)`
      }
    }

    syncScroll()
    textareaElement.addEventListener('scroll', syncScroll)

    return () => {
      textareaElement.removeEventListener('scroll', syncScroll)
    }
  }, [value])

  const ghostStyle: CSSProperties = withLineNumbers
    ? { whiteSpace: 'pre', overflowWrap: 'normal' }
    : { whiteSpace: 'pre-wrap', wordBreak: 'break-word' }

  const wrapperClassName = [
    'variable-highlight',
    'variable-highlight--textarea',
    withLineNumbers ? 'variable-highlight--gutter' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={wrapperClassName} style={style}>
      {withLineNumbers && (
        <div
          className="variable-highlight__gutter"
          aria-hidden="true"
        >
          <div
            ref={gutterInnerRef}
            className="variable-highlight__gutter-inner"
          >
            {Array.from({ length: lineCount }, (_value, lineIndex) => (
              <span
                key={lineIndex}
                className="variable-highlight__gutter-line"
              >
                {lineIndex + 1}
              </span>
            ))}
          </div>
        </div>
      )}
      <div
        ref={ghostRef}
        className="variable-highlight__ghost"
        aria-hidden="true"
        style={ghostStyle}
      >
        {renderSegments(segments)}
        {value.endsWith('\n') ? '\u200b' : ''}
      </div>
      <textarea
        {...textareaProps}
        ref={textareaRef}
        className="variable-highlight__field"
        value={value}
        onChange={onChange}
      />
    </div>
  )
}
