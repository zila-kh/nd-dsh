import { describe, expect, it } from 'vitest'
import { parseMarkdownBlocks, tokenizeInline } from '../src/shared/markdown-lite.js'

describe('tokenizeInline', () => {
  it('returns a single text token for plain prose', () => {
    expect(tokenizeInline('just text')).toEqual([{ kind: 'text', text: 'just text' }])
  })

  it('splits code, bold, and italic tokens', () => {
    const tokens = tokenizeInline('run `pnpm test` for **all** *flakes*')
    expect(tokens).toEqual([
      { kind: 'text', text: 'run ' },
      { kind: 'code', text: 'pnpm test' },
      { kind: 'text', text: ' for ' },
      { kind: 'bold', text: 'all' },
      { kind: 'text', text: ' ' },
      { kind: 'italic', text: 'flakes' },
    ])
  })

  it('keeps bold markers literal inside inline code', () => {
    const tokens = tokenizeInline('`**not bold**`')
    expect(tokens).toEqual([{ kind: 'code', text: '**not bold**' }])
  })
})

describe('parseMarkdownBlocks', () => {
  it('parses fenced code with its language', () => {
    const blocks = parseMarkdownBlocks('```ts\nconst a = 1\n```')
    expect(blocks).toEqual([{ kind: 'code', language: 'ts', text: 'const a = 1' }])
  })

  it('treats an unclosed fence (streaming) as a code block to EOF', () => {
    const blocks = parseMarkdownBlocks('```js\nlet b = 2')
    expect(blocks).toEqual([{ kind: 'code', language: 'js', text: 'let b = 2' }])
  })

  it('groups consecutive bullets and ordered items', () => {
    const blocks = parseMarkdownBlocks('- one\n- two\n1. first\n2. second')
    expect(blocks).toEqual([
      { kind: 'bullet-list', items: ['one', 'two'] },
      { kind: 'ordered-list', items: ['first', 'second'] },
    ])
  })

  it('parses headings, quotes, and paragraphs', () => {
    const blocks = parseMarkdownBlocks('## Title\n> quoted line\nplain words\nmore words')
    expect(blocks).toEqual([
      { kind: 'heading', level: 2, text: 'Title' },
      { kind: 'quote', text: 'quoted line' },
      { kind: 'paragraph', text: 'plain words more words' },
    ])
  })

  it('stops a paragraph at a fence start so mixed content splits', () => {
    const blocks = parseMarkdownBlocks('text before\n```py\nprint(1)\n```')
    expect(blocks).toEqual([
      { kind: 'paragraph', text: 'text before' },
      { kind: 'code', language: 'py', text: 'print(1)' },
    ])
  })
})
