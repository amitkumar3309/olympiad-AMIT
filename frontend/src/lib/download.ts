/**
 * Hands a blob to the browser as a download. The object URL is revoked on the next tick,
 * once the click has been dispatched — revoking it synchronously cancels the download in
 * some browsers.
 */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
