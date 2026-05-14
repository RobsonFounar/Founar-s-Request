import type {
  ChangeEvent,
  ComponentPropsWithoutRef,
  CSSProperties,
} from 'react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  segmentJson,
  type Segment,
} from '../lib/jsonHighlightSegments'

export type { Segment } from '../lib/jsonHighlightSegments'

const VARIABLE_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g

type HighlightLanguage = 'none' | 'json'

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
