import { useState } from 'react'
import { CheckIcon, CopyIcon } from './Icons'
import { parseMarkdownBlocks, tokenizeInline } from '../../../shared/markdown-lite'
import { cn } from '../lib/utils'

/** Inline formatting: `code`, **bold**, *italic* → styled React nodes. */
function InlineText({ text }: { text: string }) {
  const tokens = tokenizeInline(text)
  return (
    <>
      {tokens.map((token, index) => {
        if (token.kind === 'code') {
          return (
            <code key={index} className="rounded border border-border-soft bg-surface-1 px-[4px] py-px font-mono text-[11px] text-primary">
              {token.text}
            </code>
          )
        }
        if (token.kind === 'bold') return <strong key={index} className="font-semibold text-foreground">{token.text}</strong>
        if (token.kind === 'italic') return <em key={index}>{token.text}</em>
        return <span key={index}>{token.text}</span>
      })}
    </>
  )
}

function CodeBlock({ language, text }: { language: string; text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_600)
    } catch {
      // Clipboard can be denied; the code stays visible either way.
    }
  }
  return (
    <div className="group/code my-1.5 overflow-hidden rounded-lg border border-border-soft bg-surface-0">
      <div className="flex items-center justify-between border-b border-border-soft bg-surface-1 px-2 py-[3px]">
        <span className="font-mono text-[8px] uppercase tracking-[0.08em] text-faint">{language || 'code'}</span>
        <button
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[8px] font-medium text-faint opacity-0 transition-all hover:bg-accent hover:text-foreground group-hover/code:opacity-100 [&_svg]:size-[9px]"
          onClick={() => void copy()}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="m-0 max-h-[280px] overflow-auto whitespace-pre px-2.5 py-1.5 font-mono text-[9.5px]/[1.6] text-soft">{text}</pre>
    </div>
  )
}

/** Chat-grade markdown renderer: block parser + inline tokens, no raw HTML. */
export function MarkdownLite({ text, className }: { text: string; className?: string }) {
  const blocks = parseMarkdownBlocks(text)
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'code':
            return <CodeBlock key={index} language={block.language} text={block.text} />
          case 'heading':
            return (
              <div
                key={index}
                className={cn(
                  'font-semibold text-foreground',
                  block.level === 1 ? 'text-[13px]' : block.level === 2 ? 'text-[12px]' : 'text-[11.5px]',
                )}
              >
                <InlineText text={block.text} />
              </div>
            )
          case 'bullet-list':
            return (
              <ul key={index} className="m-0 flex list-disc flex-col gap-0.5 pl-[18px]">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex} className="[overflow-wrap:anywhere] text-[12px]/[1.6] text-foreground/90">
                    <InlineText text={item} />
                  </li>
                ))}
              </ul>
            )
          case 'ordered-list':
            return (
              <ol key={index} className="m-0 flex list-decimal flex-col gap-0.5 pl-[18px]">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex} className="[overflow-wrap:anywhere] text-[12px]/[1.6] text-foreground/90">
                    <InlineText text={item} />
                  </li>
                ))}
              </ol>
            )
          case 'quote':
            return (
              <blockquote key={index} className="my-0.5 border-l-2 border-border-strong pl-2 text-[11.5px]/[1.6] text-faint">
                <InlineText text={block.text} />
              </blockquote>
            )
          default:
            return (
              <div key={index} className="whitespace-pre-wrap [overflow-wrap:anywhere] text-[12.5px]/[1.7] text-foreground/90">
                <InlineText text={block.text} />
              </div>
            )
        }
      })}
    </div>
  )
}
