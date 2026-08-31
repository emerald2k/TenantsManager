import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { Table } from '@/components/shared/Table'

const COLUMNS = [
  { key: 'name', header: 'Nume', primary: true, render: (r) => r.name },
  { key: 'city', header: 'Oraș', render: (r) => r.city },
  {
    key: 'amount',
    header: 'Sumă',
    align: 'right',
    render: (r) => `${r.amount} lei`,
  },
]

const ROWS = [
  { id: '1', name: 'Alfa', city: 'Cluj', amount: 100 },
  { id: '2', name: 'Beta', city: 'Iași', amount: 200 },
]

describe('Table', () => {
  it('renders one header cell per column and one row per data row', async () => {
    await renderWithProviders(
      <Table columns={COLUMNS} rows={ROWS} getRowKey={(r) => r.id} />,
    )

    expect(screen.getByRole('columnheader', { name: 'Nume' })).toBeVisible()
    expect(screen.getByRole('columnheader', { name: 'Oraș' })).toBeVisible()
    expect(screen.getByRole('columnheader', { name: 'Sumă' })).toBeVisible()
    // Header row + 2 data rows.
    expect(screen.getAllByRole('row')).toHaveLength(3)
    expect(screen.getByText('Alfa')).toBeVisible()
    expect(screen.getByText('Beta')).toBeVisible()
  })

  it('a cell renders ONLY its value — the mobile label never leaks into textContent', async () => {
    // The regression this guards: an earlier version rendered the card
    // view's label as a real (CSS-hidden) DOM span, which jsdom does not
    // actually hide, silently polluting every `cell.textContent` read in
    // every consuming page's tests (caught converting TenantsListPage's).
    await renderWithProviders(
      <Table columns={COLUMNS} rows={ROWS} getRowKey={(r) => r.id} />,
    )

    const row = screen.getByText('Alfa').closest('tr')
    const cityCell = within(row).getAllByRole('cell')[1]
    expect(cityCell.textContent).toBe('Cluj')
    expect(cityCell.dataset.mobileLabel).toBe('Oraș')
  })

  it('the primary column never carries a data-mobile-label (its header is never shown)', async () => {
    await renderWithProviders(
      <Table columns={COLUMNS} rows={ROWS} getRowKey={(r) => r.id} />,
    )

    const row = screen.getByText('Alfa').closest('tr')
    const nameCell = within(row).getAllByRole('cell')[0]
    expect(nameCell.dataset.mobileLabel).toBeUndefined()
  })

  it('calls onRowClick with the row when a clickable row is clicked or activated via keyboard', async () => {
    const onRowClick = vi.fn()
    const user = userEvent.setup()
    await renderWithProviders(
      <Table
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={(r) => r.id}
        onRowClick={onRowClick}
      />,
    )

    await user.click(screen.getByText('Alfa'))
    expect(onRowClick).toHaveBeenCalledWith(ROWS[0])

    const row = screen.getByText('Beta').closest('tr')
    row.focus()
    await user.keyboard('{Enter}')
    expect(onRowClick).toHaveBeenCalledWith(ROWS[1])
  })

  it('isRowClickable lets a page mix clickable and inert rows in one table', async () => {
    const onRowClick = vi.fn()
    const user = userEvent.setup()
    await renderWithProviders(
      <Table
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={(r) => r.id}
        onRowClick={onRowClick}
        isRowClickable={(row) => row.id === '1'}
      />,
    )

    const clickableRow = screen.getByText('Alfa').closest('tr')
    const inertRow = screen.getByText('Beta').closest('tr')
    expect(clickableRow.tabIndex).toBe(0)
    expect(inertRow.tabIndex).toBe(-1)

    await user.click(screen.getByText('Beta'))
    expect(onRowClick).not.toHaveBeenCalled()

    await user.click(screen.getByText('Alfa'))
    expect(onRowClick).toHaveBeenCalledWith(ROWS[0])
  })

  it('with no onRowClick, no row is focusable or click-activatable', async () => {
    await renderWithProviders(
      <Table columns={COLUMNS} rows={ROWS} getRowKey={(r) => r.id} />,
    )

    const row = screen.getByText('Alfa').closest('tr')
    expect(row.tabIndex).toBe(-1)
  })

  it('merges rowClassName onto the row', async () => {
    await renderWithProviders(
      <Table
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={(r) => r.id}
        rowClassName={(row) => (row.id === '1' ? 'opacity-60' : undefined)}
      />,
    )

    expect(screen.getByText('Alfa').closest('tr').className).toContain(
      'opacity-60',
    )
    expect(screen.getByText('Beta').closest('tr').className).not.toContain(
      'opacity-60',
    )
  })
})
