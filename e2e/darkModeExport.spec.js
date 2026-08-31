import { test, expect } from '@playwright/test'

/**
 * NFR-UX-05 (M8 stage 9) — "exports stay light", one of the two flows added
 * to the E2E band at M8 (the other is the payments ledger, stage 12). This
 * is the automated half of stage 9's G2: sign in, switch to dark theme,
 * export both PDF and PNG from a signed report, and read the ACTUAL
 * downloaded bytes back — not just that a download happened.
 *
 * The pixel check is deliberately not "is the background white" alone.
 * `ReportSummaryView`'s `.force-light` mechanism was found, during this
 * same stage's manual browser validation, to correctly pin the BACKGROUND
 * light while leaving several rows' TEXT unreadably faint (`color` is an
 * inherited property resolved once at the nearest declaring ancestor -
 * <body>, itself under the dark ancestor - so anything relying on plain
 * inheritance rather than its own text-color utility kept body's dark-
 * resolved value). A background-only check would have stayed green through
 * that bug. This test samples a background corner pixel AND the darkest
 * pixel across a strip of the "Total final" row (present regardless of
 * locale/payment state), asserting each lands in the correct half of the
 * light/dark split.
 */

const REPORT_URL = '/admin/reports/seed-tenancy-occupied?month=7&year=2026'

async function loginAsAdmin(page) {
  await page.goto('/login')
  await page.locator('#email').fill('admin@test.ro')
  await page.locator('#password').fill('admin123')
  await page.getByRole('button', { name: 'Autentificare' }).click()
  await page.waitForURL('**/admin')
}

/** Reads a PNG's pixels via an in-page <canvas> — no image-decoding
 * dependency needed beyond what the browser already ships. Returns the RGB
 * at the given single point (fractions of image width/height). */
async function samplePixel(page, buffer, xFraction, yFraction) {
  const [{ r, g, b }] = await sampleRegion(
    page,
    buffer,
    xFraction,
    yFraction,
    xFraction,
    yFraction,
  )
  return { r, g, b }
}

/** Returns every pixel inside the box [x0,y0]..[x1,y1] (fractions of image
 * width/height). Used to find the darkest pixel in a text-bearing region
 * without betting on a single point landing on a glyph's ink rather than
 * the gap between letters. */
async function sampleRegion(page, buffer, x0, y0, x1, y1) {
  const base64 = buffer.toString('base64')
  return page.evaluate(
    async ({ base64, x0, y0, x1, y1 }) => {
      const img = new Image()
      const loaded = new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
      })
      img.src = `data:image/png;base64,${base64}`
      await loaded
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const left = Math.floor(img.width * x0)
      const top = Math.floor(img.height * y0)
      const width = Math.max(1, Math.floor(img.width * (x1 - x0)))
      const height = Math.max(1, Math.floor(img.height * (y1 - y0)))
      const { data } = ctx.getImageData(left, top, width, height)
      const pixels = []
      for (let i = 0; i < data.length; i += 4) {
        pixels.push({ r: data[i], g: data[i + 1], b: data[i + 2] })
      }
      return pixels
    },
    { base64, x0, y0, x1, y1 },
  )
}

function isLight({ r, g, b }) {
  return r > 200 && g > 200 && b > 200
}

function darkest(pixels) {
  return pixels.reduce((min, p) => Math.min(min, p.r, p.g, p.b), 255)
}

test('exports stay light when downloaded from dark mode (NFR-UX-05)', async ({
  page,
}) => {
  await loginAsAdmin(page)

  // Switch to dark mode - the button is labelled with the CURRENT theme
  // (M8 stage 10 relabel), so in the default (light) state it reads
  // "Temă · Deschisă"; clicking it switches to dark.
  await page.getByRole('button', { name: 'Temă · Deschisă' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)

  await page.goto(REPORT_URL)
  await expect(page.locator('html')).toHaveClass(/dark/)

  const pngDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Descarcă PNG' }).click()
  const png = await pngDownload
  const pngPath = await png.path()
  const pngBuffer = await test.step('read PNG bytes', async () => {
    const fs = await import('node:fs/promises')
    return fs.readFile(pngPath)
  })

  // Corner background pixel - the whole point of `.force-light`.
  const corner = await samplePixel(page, pngBuffer, 0.02, 0.02)
  expect(isLight(corner)).toBe(true)

  // "Total final" is the bottom-most guaranteed row (present regardless of
  // locale/payment state) and always carries `text-foreground` explicitly.
  // A strip across its label, rather than one point, tolerates not knowing
  // exactly where a glyph's ink falls - it just has to exist somewhere in
  // the row. This is the exact region that rendered near-invisible before
  // the `text-foreground` fix (color inherited from <body>, resolved under
  // the DARK ancestor rather than `.force-light`'s scope).
  const totalFinalRow = await sampleRegion(
    page,
    pngBuffer,
    0.03,
    0.7,
    0.3,
    0.75,
  )
  expect(darkest(totalFinalRow)).toBeLessThan(100)

  const pdfDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Descarcă PDF' }).click()
  const pdf = await pdfDownload
  const pdfPath = await pdf.path()
  const pdfHeader = await test.step('read PDF header bytes', async () => {
    const fs = await import('node:fs/promises')
    const handle = await fs.open(pdfPath, 'r')
    const { buffer } = await handle.read(Buffer.alloc(5), 0, 5, 0)
    await handle.close()
    return buffer
  })
  expect(pdfHeader.toString('ascii')).toBe('%PDF-')
})
