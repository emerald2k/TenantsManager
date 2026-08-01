import { describe, expect, it, vi } from 'vitest'
import { base64ToBlob, downloadBlob } from '@/lib/blob'

// The REAL implementation is exercised here (M4 sub-stage 8 audit gate C1) —
// every other reference to this module across the suite mocks it away
// (sharedReport.page.test.jsx), so until this file existed neither function's
// actual code had ever run under test.

describe('base64ToBlob', () => {
  it('decodes a base64 string byte-for-byte into a Blob carrying the given contentType', async () => {
    const base64 = btoa('hello world')

    const blob = base64ToBlob(base64, 'text/plain')

    expect(blob.type).toBe('text/plain')
    expect(blob.size).toBe('hello world'.length)
    await expect(blob.text()).resolves.toBe('hello world')
  })

  it('falls back to application/octet-stream when contentType is falsy', () => {
    const blob = base64ToBlob(btoa('x'), undefined)

    expect(blob.type).toBe('application/octet-stream')
  })

  it('handles an empty base64 string as a zero-byte Blob', async () => {
    const blob = base64ToBlob('', 'text/plain')

    expect(blob.size).toBe(0)
    await expect(blob.text()).resolves.toBe('')
  })
})

describe('downloadBlob', () => {
  it('creates an object URL for the blob, sets it as the href/download of a throwaway <a>, clicks it, then revokes the URL', () => {
    const blob = new Blob(['x'], { type: 'text/plain' })
    const fakeUrl = 'blob:fake-url'
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue(fakeUrl)
    const revokeObjectURL = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {})
    let capturedHref = null
    let capturedDownload = null
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function capture() {
        capturedHref = this.getAttribute('href')
        capturedDownload = this.getAttribute('download')
      })

    downloadBlob(blob, 'raport.pdf')

    expect(createObjectURL).toHaveBeenCalledWith(blob)
    expect(capturedHref).toBe(fakeUrl)
    expect(capturedDownload).toBe('raport.pdf')
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith(fakeUrl)

    createObjectURL.mockRestore()
    revokeObjectURL.mockRestore()
    click.mockRestore()
  })
})
