import { zipSync, strToU8 } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import { MAX_DOCX_BYTES, previewDocx } from '../src/main/workspace/docx-preview.js'
import { WorkspaceService } from '../src/main/workspace/workspace-service.js'
import { createCoreWorkspaceFileSystem } from '../src/main/core/core-workspace.js'

vi.mock('electron', () => ({ dialog: {} }))

function document() {
  return Buffer.from(zipSync({
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    'word/document.xml': strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t>Hello &lt;script&gt; &amp; world</w:t></w:r></w:p><w:p><w:hyperlink r:id="evil"><w:r><w:t>Click me</w:t></w:r></w:hyperlink></w:p></w:body></w:document>'),
    'word/_rels/document.xml.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="evil" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:alert(1)" TargetMode="External"/></Relationships>'),
  }))
}

describe('lightweight DOCX previews', () => {
  it('renders real OOXML content while removing active links and markup', async () => {
    const preview = await previewDocx(document())
    expect(preview.previewHtml).toContain('<p>Hello &lt;script&gt; &amp; world</p>')
    expect(preview.previewHtml).toContain('Click me')
    expect(preview.previewHtml).not.toMatch(/javascript:|<script|<a\b|<img\b/)
    expect(preview.previewHtml).toContain('Content-Security-Policy')
    expect(preview.content).toContain('Hello')
  })

  it('refuses oversized input, decompression bombs and non-documents', async () => {
    await expect(previewDocx(Buffer.alloc(MAX_DOCX_BYTES + 1))).rejects.toThrow('2 MiB')
    await expect(previewDocx(Buffer.from(zipSync({ 'word/document.xml': new Uint8Array(17 * 1024 * 1024) })))).rejects.toThrow('archive exceeds')
    await expect(previewDocx(Buffer.from(zipSync({ 'other.xml': strToU8('hello') })))).rejects.toThrow('not a DOCX')
  })

  it('reads binary documents through ND Core and fails on a truncated read', async () => {
    let truncated = false
    const files = createCoreWorkspaceFileSystem({ request: async (method, params) => {
      expect(method).toBe('workspace.read-binary')
      expect(params).toEqual({ root: expect.any(String), path: 'draft.docx', maxBytes: MAX_DOCX_BYTES })
      return { data: [...document()], truncated } as never
    } })
    const workspace = new WorkspaceService('C:/project', { files })
    expect((await workspace.read('draft.docx')).previewHtml).toContain('Hello')
    truncated = true
    await expect(workspace.read('draft.docx')).rejects.toThrow('2 MiB')
    workspace.setContext({ binding: 'unlinked' })
    await expect(workspace.read('draft.docx')).rejects.toThrow('no workspace linked')
  })
})
