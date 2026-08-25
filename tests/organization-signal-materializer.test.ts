import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { OrganizationSignal } from '../src/shared/organization-control.js'
import { materializeOrganizationSignal } from '../src/main/organization/signal-materializer.js'
import { OrganizationStore } from '../src/main/organization/store.js'

const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'nd-signal-'))
  temporary.push(root)
  const store = new OrganizationStore(join(root, 'organization.json'))
  let state = await store.mutate({ type: 'company.create', name: 'Acme', mission: 'Ship useful software' })
  const company = state.companies[0]!
  state = await store.mutate({ type: 'project.create', companyId: company.id, name: 'Product', objective: 'Improve the product' })
  const project = state.projects[0]!
  const now = Date.now()
  const signal: OrganizationSignal = {
    id: 'signal-1', companyId: company.id, projectId: project.id, source: 'customer',
    title: 'Checkout is confusing', summary: 'Users miss the confirm action.', status: 'new', createdAt: now, updatedAt: now,
  }
  return { store, signal }
}

describe('organization signal materializer', () => {
  it('turns a signal into one ready, independently-verifiable task and is retry safe', async () => {
    const { store, signal } = await fixture()
    await materializeOrganizationSignal(store, signal, 'task')
    await materializeOrganizationSignal(store, signal, 'task')
    const state = await store.state()
    const matching = state.tasks.filter((item) => item.description.includes(`[nd-signal:${signal.id}]`))
    expect(matching).toHaveLength(1)
    expect(matching[0]?.status).toBe('ready')
    expect(matching[0]?.acceptanceCriteria.join(' ')).toMatch(/independently verified/i)
  })

  it('promotes a signal into a durable project objective without duplicating it', async () => {
    const { store, signal } = await fixture()
    await materializeOrganizationSignal(store, signal, 'objective')
    await materializeOrganizationSignal(store, signal, 'objective')
    const state = await store.state()
    const matching = state.goals.filter((item) => item.description.includes(`[nd-signal:${signal.id}]`))
    expect(matching).toHaveLength(1)
    expect(matching[0]?.title).toBe(signal.title)
  })
})
