import { beforeEach, describe, expect, it } from 'vitest'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getStorage } from 'firebase-admin/storage'
import {
  buildDownloadUrl,
  copyPhotosToUser,
  deleteObjects,
  parseStoragePath,
} from '../src/photoMigration.js'

// This file runs standalone (does not import kyc.js), so — unlike
// kyc.test.js, which piggybacks on kyc.js's own `initializeApp()` — it must
// initialize the default Admin app itself before any Storage call.
if (!getApps().length) {
  initializeApp()
}

// Pure-function tests — no Storage emulator needed for these two: they are
// plain string parsing/building, the same URL shape PhotoCapture.jsx produces
// via the client SDK's getDownloadURL().

describe('parseStoragePath', () => {
  it('extracts the object path from a Firebase Storage download URL', () => {
    const url =
      'https://firebasestorage.googleapis.com/v0/b/demo-bucket/o/drafts%2Fdraft-1%2Fabc-front.jpg?alt=media&token=xyz'
    expect(parseStoragePath(url)).toBe('drafts/draft-1/abc-front.jpg')
  })

  it('decodes nested path segments correctly', () => {
    const url =
      'https://firebasestorage.googleapis.com/v0/b/demo-bucket/o/users%2Fuid-1%2Fdocuments%2Fabc-front.jpg?alt=media&token=xyz'
    expect(parseStoragePath(url)).toBe('users/uid-1/documents/abc-front.jpg')
  })

  it('throws on a URL that is not a Firebase Storage download URL', () => {
    expect(() => parseStoragePath('gs://bucket/1.jpg')).toThrow()
    expect(() => parseStoragePath('not a url at all')).toThrow()
  })
})

describe('buildDownloadUrl', () => {
  // `firebase emulators:exec` (which runs this whole file) sets
  // FIREBASE_STORAGE_EMULATOR_HOST for the duration of the process — these
  // tests save/restore it around each case rather than assume either state.
  const ambientEmulatorHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST

  it('builds a PRODUCTION download URL when no Storage emulator host is set', () => {
    delete process.env.FIREBASE_STORAGE_EMULATOR_HOST
    try {
      const url = buildDownloadUrl(
        'demo-bucket',
        'users/uid-1/documents/abc-front.jpg',
        'my-token',
      )
      expect(url).toBe(
        'https://firebasestorage.googleapis.com/v0/b/demo-bucket/o/users%2Fuid-1%2Fdocuments%2Fabc-front.jpg?alt=media&token=my-token',
      )
    } finally {
      if (ambientEmulatorHost) {
        process.env.FIREBASE_STORAGE_EMULATOR_HOST = ambientEmulatorHost
      }
    }
  })

  // The scenario this whole fix exists for: without this branch, a migrated
  // photo would carry a production host while its bytes only exist in the
  // local emulator — a broken image exactly where Bogdan checks (finalize a
  // KYC, open the gallery).
  it('builds an EMULATOR download URL (http, host:port) when FIREBASE_STORAGE_EMULATOR_HOST is set', () => {
    process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199'
    try {
      const url = buildDownloadUrl(
        'demo-bucket',
        'users/uid-1/documents/abc-front.jpg',
        'my-token',
      )
      expect(url).toBe(
        'http://127.0.0.1:9199/v0/b/demo-bucket/o/users%2Fuid-1%2Fdocuments%2Fabc-front.jpg?alt=media&token=my-token',
      )
    } finally {
      process.env.FIREBASE_STORAGE_EMULATOR_HOST = ambientEmulatorHost
    }
  })

  it('round-trips with parseStoragePath regardless of host', () => {
    const path = 'users/uid-1/guarantor/xyz-back.jpg'
    const url = buildDownloadUrl('demo-bucket', path, 'tok')
    expect(parseStoragePath(url)).toBe(path)
  })
})

// The rest of this file needs the REAL Storage emulator (functions
// test:emulator, --only auth,firestore,storage) — no mocking of the Storage
// boundary, same convention as kyc.test.js against Firestore/Auth.

const bucket = getStorage().bucket()

async function seedObject(path, content = 'fake-photo-bytes') {
  await bucket.file(path).save(Buffer.from(content), {
    metadata: { firebaseStorageDownloadTokens: 'seed-token' },
  })
}

async function readBytes(path) {
  const [contents] = await bucket.file(path).download()
  return contents.toString()
}

async function objectExists(path) {
  const [exists] = await bucket.file(path).exists()
  return exists
}

beforeEach(async () => {
  // Best-effort cleanup between tests — the Storage emulator does not reset
  // per-test the way Firestore's DELETE-all endpoint does.
  const [files] = await bucket.getFiles({ prefix: 'drafts/' })
  const [userFiles] = await bucket.getFiles({ prefix: 'users/' })
  await Promise.all(
    [...files, ...userFiles].map((f) => f.delete().catch(() => {})),
  )
})

describe('copyPhotosToUser', () => {
  it('copies each photo to users/{userId}/{destFolder}/, leaves the source intact, and issues a fresh download token', async () => {
    await seedObject('drafts/draft-1/abc-front.jpg', 'front-bytes')
    const photo = {
      url: buildDownloadUrl(
        bucket.name,
        'drafts/draft-1/abc-front.jpg',
        'seed-token',
      ),
      name: 'front.jpg',
      type: 'image',
    }

    const result = await copyPhotosToUser(
      bucket,
      [photo],
      'user-1',
      'documents',
    )

    expect(result.references).toHaveLength(1)
    const [ref] = result.references
    expect(ref.name).toBe('front.jpg')
    expect(ref.type).toBe('image')
    expect(parseStoragePath(ref.url)).toBe(
      'users/user-1/documents/abc-front.jpg',
    )
    // Physically present at the new path, correct bytes.
    expect(await objectExists('users/user-1/documents/abc-front.jpg')).toBe(
      true,
    )
    expect(await readBytes('users/user-1/documents/abc-front.jpg')).toBe(
      'front-bytes',
    )
    // COPY, not move: the source is untouched at this point — the caller
    // deletes it only after the Firestore transaction commits.
    expect(await objectExists('drafts/draft-1/abc-front.jpg')).toBe(true)
    expect(result.sourcePaths).toEqual(['drafts/draft-1/abc-front.jpg'])
    expect(result.destPaths).toEqual(['users/user-1/documents/abc-front.jpg'])
  })

  // The strongest proof: not just "the object exists" (Admin SDK level) but
  // "the URL an <img src> would actually use serves the right bytes" — this
  // is what Bogdan's browser validation checks, and the only thing in this
  // suite that would catch a wrong host/protocol/token in the built URL.
  it('the returned url is fetchable over HTTP and serves the migrated bytes', async () => {
    await seedObject('drafts/draft-1/abc-front.jpg', 'front-bytes')
    const photo = {
      url: buildDownloadUrl(
        bucket.name,
        'drafts/draft-1/abc-front.jpg',
        'seed-token',
      ),
      name: 'front.jpg',
      type: 'image',
    }

    const result = await copyPhotosToUser(
      bucket,
      [photo],
      'user-1',
      'documents',
    )

    const response = await fetch(result.references[0].url)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('front-bytes')
  })

  it('copies multiple photos, e.g. the guarantor folder', async () => {
    await seedObject('drafts/draft-1/a.jpg', 'a')
    await seedObject('drafts/draft-1/b.jpg', 'b')
    const photos = [
      {
        url: buildDownloadUrl(bucket.name, 'drafts/draft-1/a.jpg', 'tok'),
        name: 'a.jpg',
        type: 'image',
      },
      {
        url: buildDownloadUrl(bucket.name, 'drafts/draft-1/b.jpg', 'tok'),
        name: 'b.jpg',
        type: 'image',
      },
    ]

    const result = await copyPhotosToUser(bucket, photos, 'user-1', 'guarantor')

    expect(result.references).toHaveLength(2)
    expect(await objectExists('users/user-1/guarantor/a.jpg')).toBe(true)
    expect(await objectExists('users/user-1/guarantor/b.jpg')).toBe(true)
  })

  // Anti-vacuity: if the cleanup-on-failure were removed, this test fails
  // because the first photo's copy would be left behind at the new path.
  it('cleans up any already-copied destination objects if a later copy fails', async () => {
    await seedObject('drafts/draft-1/a.jpg', 'a')
    // 'b.jpg' is DELIBERATELY not seeded — its copy will fail (source missing).
    const photos = [
      {
        url: buildDownloadUrl(bucket.name, 'drafts/draft-1/a.jpg', 'tok'),
        name: 'a.jpg',
        type: 'image',
      },
      {
        url: buildDownloadUrl(bucket.name, 'drafts/draft-1/b.jpg', 'tok'),
        name: 'b.jpg',
        type: 'image',
      },
    ]

    await expect(
      copyPhotosToUser(bucket, photos, 'user-1', 'documents'),
    ).rejects.toThrow()

    expect(await objectExists('users/user-1/documents/a.jpg')).toBe(false)
  })
})

describe('deleteObjects', () => {
  it('deletes every object at the given paths', async () => {
    await seedObject('drafts/draft-1/a.jpg')
    await seedObject('drafts/draft-1/b.jpg')

    await deleteObjects(bucket, [
      'drafts/draft-1/a.jpg',
      'drafts/draft-1/b.jpg',
    ])

    expect(await objectExists('drafts/draft-1/a.jpg')).toBe(false)
    expect(await objectExists('drafts/draft-1/b.jpg')).toBe(false)
  })

  it('does not throw when a path does not exist (best-effort)', async () => {
    await expect(
      deleteObjects(bucket, ['drafts/does-not-exist/x.jpg']),
    ).resolves.not.toThrow()
  })
})
