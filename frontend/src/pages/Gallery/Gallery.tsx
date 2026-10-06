import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { GalleryItem, Pagination } from '../../api/types'
import Navbar from '../../components/Navbar'
import Footer from '../../components/Footer'
import Spinner from '../../components/Spinner'
import { Modal } from '../../components/ui'
import styles from './Gallery.module.css'
import { humanizeError } from '../../lib/errors'
import { AMIT_OLYMPIAD } from '../../lib/brand'

interface GalleryResponse {
  gallery: GalleryItem[]
  pagination: Pagination
}

/**
 * The public event gallery.
 *
 * Deliberately reachable without an account, like the leaderboard and Hall of Fame:
 * it is how a visitor sees the competition is real. It carries no personal data —
 * a title, a caption and a photograph the organisers chose to publish.
 */
export default function Gallery() {
  const [items, setItems] = useState<GalleryItem[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [lightbox, setLightbox] = useState<GalleryItem | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')

    api
      .get<GalleryResponse>(`/gallery?page=${page}&limit=12`)
      .then((res) => {
        if (cancelled) return
        setItems(res.gallery)
        setPagination(res.pagination)
      })
      .catch((err) => {
        if (!cancelled) setError(humanizeError(err, { fallback: 'Could not load the gallery.' }))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [page])

  return (
    <>
      <Navbar />
      <main id="main-content" className={styles.wrap}>
        <header className={styles.header}>
          <h1>Event Gallery</h1>
          <p>Moments from {AMIT_OLYMPIAD} events around the country.</p>
        </header>

        {error && <p className="error-text">{error}</p>}

        {loading ? (
          <Spinner label="Loading the gallery..." />
        ) : items.length === 0 ? (
          <p className={styles.empty}>
            No photographs have been published yet. They will appear here after the next event.
          </p>
        ) : (
          <div className={styles.grid}>
            {items.map((item) => (
              <figure key={item.id} className={styles.tile}>
                <button type="button" onClick={() => setLightbox(item)} aria-label={`View ${item.title}`}>
                  <img src={item.imageUrl} alt={item.caption ?? item.title} loading="lazy" />
                </button>
                <figcaption>
                  <strong>{item.title}</strong>
                  {item.caption && <span>{item.caption}</span>}
                  {item.eventDate && <time dateTime={item.eventDate}>{new Date(item.eventDate).toLocaleDateString()}</time>}
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
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <button disabled={pagination.page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        )}
      </main>

      {/* A `Modal` (audit D8): it was a clickable `div` with no Escape, no focus trap and
          nothing to stop the page behind it scrolling. The dialog is named by the photo's
          title; the caption, when there is one, is the alt text and the line beneath. */}
      <Modal open={lightbox !== null} onClose={() => setLightbox(null)} title={lightbox?.title ?? ''} size="lg">
        {lightbox && (
          <figure className={styles.lightbox}>
            <img src={lightbox.imageUrl} alt={lightbox.caption ?? lightbox.title} />
            {lightbox.caption && <figcaption>{lightbox.caption}</figcaption>}
          </figure>
        )}
      </Modal>

      <Footer />
    </>
  )
}
