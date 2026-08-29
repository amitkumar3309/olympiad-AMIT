import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { api, ApiError } from '../../api/client'
import type { GalleryItem, GalleryStatus, Pagination } from '../../api/types'
import AdminShell from './AdminShell'
import Button from '../../components/Button'
import Spinner from '../../components/Spinner'
import {
  Alert,
} from '../../components/ui'
import styles from './Gallery.module.css'

interface GalleryListResponse {
  gallery: GalleryItem[]
  pagination: Pagination
}

const STATUS_LABELS: Record<GalleryStatus, string> = {
  published: 'Published',
  archived: 'Archived',
}

/** Matches `MAX_GALLERY_IMAGE_BYTES` on the backend. Checked here only to fail fast. */
const MAX_BYTES = 1024 * 1024

/**
 * Reads a chosen file into the base64 data URL the API expects.
 *
 * Images travel inside the JSON body rather than as multipart, which is the
 * existing convention in this codebase (see the Milestone 4 ADR) — it keeps the
 * request atomic and needs no new dependency.
 */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read that file'))
    reader.readAsDataURL(file)
  })
}

export default function Gallery() {
  const [items, setItems] = useState<GalleryItem[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState('')
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')

  // Upload form
  const [title, setTitle] = useState('')
  const [caption, setCaption] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [displayOrder, setDisplayOrder] = useState('0')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(page), limit: '12' })
      if (statusFilter) params.set('status', statusFilter)
      if (appliedSearch) params.set('search', appliedSearch)

      const res = await api.get<GalleryListResponse>(`/admin/gallery?${params.toString()}`)
      setItems(res.gallery)
      setPagination(res.pagination)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the gallery.')
      setItems([])
      setPagination(null)
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter, appliedSearch])

  useEffect(() => {
    void load()
  }, [load])

  async function handleUpload(e: FormEvent) {
    e.preventDefault()
    setError('')
    setNotice('')

    if (!file) {
      setError('Choose a photo to upload.')
      return
    }
    // Checked here purely to fail fast with a clear message; the backend enforces
    // it for real, and by magic bytes rather than by what the file claims to be.
    if (file.size > MAX_BYTES) {
      setError(`That photo is ${Math.round(file.size / 1024)} KB. The limit is ${MAX_BYTES / 1024} KB.`)
      return
    }

    setUploading(true)
    try {
      const image = await readAsDataUrl(file)
      await api.post('/admin/gallery', {
        title: title.trim(),
        caption: caption.trim() || undefined,
        eventDate: eventDate || undefined,
        displayOrder: Number(displayOrder) || 0,
        image,
      })
      setNotice(`“${title.trim()}” was added to the gallery.`)
      setTitle('')
      setCaption('')
      setEventDate('')
      setDisplayOrder('0')
      setFile(null)
      if (fileInput.current) fileInput.current.value = ''
      setPage(1)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add that photo.')
    } finally {
      setUploading(false)
    }
  }

  async function setStatus(item: GalleryItem, status: GalleryStatus) {
    setBusyId(item.id)
    setError('')
    setNotice('')
    try {
      const res = await api.patch<{ item: GalleryItem }>(`/admin/gallery/${item.id}`, { status })
      setItems((list) => list.map((i) => (i.id === item.id ? res.item : i)))
      setNotice(
        status === 'archived'
          ? `“${item.title}” is no longer public. Its image is not served either.`
          : `“${item.title}” is public again.`,
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update that photo.')
    } finally {
      setBusyId('')
    }
  }

  async function remove(item: GalleryItem) {
    setBusyId(item.id)
    setError('')
    setNotice('')
    try {
      await api.del(`/admin/gallery/${item.id}`)
      setNotice(`“${item.title}” was deleted permanently.`)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete that photo.')
    } finally {
      setBusyId('')
    }
  }

  function applySearch(e: FormEvent) {
    e.preventDefault()
    setPage(1)
    setAppliedSearch(search.trim())
  }

  return (
    <AdminShell title="Event Gallery">
      <div className={`card ${styles.panel}`}>
        <h3>Add a photo</h3>
        <p className={styles.hint}>
          Photographs of real events, shown on the public gallery page. JPEG, PNG or WebP, up to {MAX_BYTES / 1024} KB
          each — images are stored in the database, so keep them small.
        </p>

        <form className={styles.uploadForm} onSubmit={handleUpload}>
          <div className="form-group">
            <label htmlFor="g-title">Title</label>
            <input id="g-title" className="form-control" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="form-group">
            <label htmlFor="g-caption">Caption (optional)</label>
            <input id="g-caption" className="form-control" value={caption} onChange={(e) => setCaption(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="g-date">Event date (optional)</label>
            <input id="g-date" type="date" className="form-control" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="g-order">Display order</label>
            <input
              id="g-order"
              type="number"
              min="0"
              className="form-control"
              value={displayOrder}
              onChange={(e) => setDisplayOrder(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="g-file">Photo</label>
            <input
              id="g-file"
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="form-control"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
            />
          </div>
          <Button type="submit" disabled={uploading}>
            {uploading ? 'Uploading...' : 'Add photo'}
          </Button>
        </form>
      </div>

      <div className={`card ${styles.panel}`}>
        <form className={styles.filters} onSubmit={applySearch}>
          <input
            className="form-control"
            placeholder="Search title or caption"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search the gallery"
          />
          <select
            className="form-control"
            value={statusFilter}
            onChange={(e) => {
              setPage(1)
              setStatusFilter(e.target.value)
            }}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
          <button type="submit" className={styles.searchBtn}>
            Search
          </button>
        </form>

        {notice && <p className={styles.notice}>{notice}</p>}
        {error && <Alert tone="danger">{error}</Alert>}

        {loading ? (
          <Spinner label="Loading the gallery..." />
        ) : items.length === 0 ? (
          <p className={styles.empty}>
            {appliedSearch || statusFilter
              ? 'No photos match these filters.'
              : 'No photos yet. Add one above and it will appear on the public gallery page.'}
          </p>
        ) : (
          <div className={styles.grid}>
            {items.map((item) => (
              <figure key={item.id} className={`${styles.tile} ${busyId === item.id ? styles.busy : ''}`}>
                <img src={item.imageUrl} alt={item.caption ?? item.title} loading="lazy" />
                <figcaption>
                  <strong>{item.title}</strong>
                  {item.caption && <span className={styles.caption}>{item.caption}</span>}
                  <span className={styles.meta}>
                    <span className={styles[`status_${item.status}`]}>{STATUS_LABELS[item.status]}</span>
                    {' · '}
                    {item.eventDate ?? 'no date'}
                    {' · '}
                    {Math.round(item.size / 1024)} KB
                    {' · order '}
                    {item.displayOrder}
                  </span>
                  <span className={styles.tileActions}>
                    <button
                      className={styles.actionBtn}
                      disabled={busyId === item.id}
                      onClick={() => void setStatus(item, item.status === 'published' ? 'archived' : 'published')}
                    >
                      {item.status === 'published' ? 'Archive' : 'Publish'}
                    </button>
                    <button className={styles.dangerBtn} disabled={busyId === item.id} onClick={() => void remove(item)}>
                      Delete
                    </button>
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        )}

        {pagination && pagination.totalPages > 1 && (
          <div className={styles.pager}>
            <button disabled={pagination.page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <span>
              Page {pagination.page} of {pagination.totalPages} · {pagination.total} photos
            </span>
            <button disabled={pagination.page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        )}
      </div>
    </AdminShell>
  )
}
