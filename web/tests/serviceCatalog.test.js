import { describe, expect, it } from 'vitest'
import { serviceLabel } from '@/features/properties/serviceCatalog'

// Fast band — pure function. `t` is stubbed to echo the key so the test
// asserts WHICH label path was taken, not the translation text itself.
const t = (key) => key

describe('serviceLabel', () => {
  it('translates a catalog service through its i18n key (property shape, source: catalog)', () => {
    expect(
      serviceLabel(
        { serviceId: 'electricity', name: 'Electricitate', source: 'catalog' },
        t,
      ),
    ).toBe('properties.services.electricity')
  })

  it('translates a catalog service on a REPORT cost line, which carries no source', () => {
    // audit #4: a signed report's serviceCosts line is { serviceId, name,
    // amount, notes, attachments } — no `source`. A catalog-id hit is enough.
    expect(serviceLabel({ serviceId: 'gas', name: 'Gaz' }, t)).toBe(
      'properties.services.gas',
    )
  })

  it('keeps the stored name for a custom service (UUID id, source: custom)', () => {
    expect(
      serviceLabel(
        {
          serviceId: 'a8b85d43-8569-4c0e-9b1e-000000000000',
          name: 'Salubritate',
          source: 'custom',
        },
        t,
      ),
    ).toBe('Salubritate')
  })

  it('keeps the stored name for an unknown serviceId with no source', () => {
    expect(serviceLabel({ serviceId: 'not-in-catalog', name: 'Ceva' }, t)).toBe(
      'Ceva',
    )
  })

  it('never translates a catalog id that is explicitly marked source: custom', () => {
    expect(
      serviceLabel(
        { serviceId: 'water', name: 'Apă de la robinet', source: 'custom' },
        t,
      ),
    ).toBe('Apă de la robinet')
  })
})
