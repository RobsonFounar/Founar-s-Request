import { Fragment, useMemo } from 'react'

import { segmentJson, type Segment } from '../lib/jsonHighlightSegments'

type JsonViewerProps = {
  code: string
  className?: string
}

export function JsonViewer({ code, className }: JsonViewerProps) {
  const lines = useMemo(() => {
    if (!code) {
      return [[] as Segment[]]
    }

    return code.split('\n').map((line) => segmentJson(line))
  }, [code])

  return (
    <div className={`json-viewer ${className ?? ''}`}>
      <div className="json-viewer__grid">
        {lines.map((segments, lineIndex) => (
          <Fragment key={lineIndex}>
            <span className="json-viewer__gutter">{lineIndex + 1}</span>
            <div className="json-viewer__line">
              {segments.length === 0
                ? '\u200b'
                : segments.map((segment, segmentIndex) =>
                    segment.className ? (
                      <span key={segmentIndex} className={segment.className}>
                        {segment.text}
                      </span>
                    ) : (
                      <span key={segmentIndex}>{segment.text}</span>
                    ),
                  )}
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  )
}
