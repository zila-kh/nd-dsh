import { useState, type FormEvent } from 'react'
import type { Milestone, OrganizationGoal, OrganizationMutation, OrganizationTask, Project } from '../../../shared/organization'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Button } from './ui/button'
import { Input } from './ui/input'

export function DeliveryMilestones({ project, milestones, goals, tasks, busy, onMutate }: {
  project: Project
  milestones: Milestone[]
  goals: OrganizationGoal[]
  tasks: OrganizationTask[]
  busy: boolean
  onMutate(mutation: OrganizationMutation): Promise<boolean>
}) {
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [outcome, setOutcome] = useState('')
  const milestone = milestones.find((item) => item.id === project.deliveryMilestoneId)
  const goal = goals.find((item) => item.id === milestone?.goalId)
  const scoped = milestone ? tasks.filter((task) => task.milestoneId === milestone.id) : tasks
  const completed = scoped.filter((task) => task.status === 'completed').length
  const active = tasks.filter((task) => task.status === 'in_progress' || task.status === 'review').length
  const ready = scoped.filter((task) => task.status === 'ready').length
  const blocked = scoped.filter((task) => task.status === 'blocked').length
  const dependencyIds = new Set(scoped.filter((task) => task.status !== 'completed').flatMap((task) => task.dependsOn))
  const externalDependencies = milestone ? tasks.filter((task) => dependencyIds.has(task.id) && task.milestoneId !== milestone.id && task.status !== 'completed') : []

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!await onMutate({ type: 'milestone.create', projectId: project.id, title, description: outcome })) return
    setTitle(''); setOutcome(''); setAdding(false)
  }

  return <section aria-label="Delivery milestone" className="mb-3 space-y-2 rounded-md border border-border-soft bg-secondary/30 p-3">
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="delivery-milestone" className="text-xs font-medium text-foreground">Deliver now</label>
      <Select value={project.deliveryMilestoneId ?? 'all'} disabled={busy} onValueChange={(value) => void onMutate({ type: 'project.update', id: project.id, patch: { deliveryMilestoneId: value === 'all' ? '' : value } })}>
        <SelectTrigger id="delivery-milestone" aria-label="Delivery milestone" className="h-8 w-[260px] max-w-full text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All work</SelectItem>
          {milestones.map((item) => <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>)}
        </SelectContent>
      </Select>
      <span className="text-xs text-muted-foreground">{completed}/{scoped.length} completed · {active} active across project</span>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setAdding(!adding)}>{adding ? 'Cancel milestone' : 'Add milestone'}</Button>
    </div>
    {goal ? <p className="text-xs text-muted-foreground">Delivery goal: <strong className="text-foreground">{goal.title}</strong></p> : null}
    <p className="text-xs text-muted-foreground">{milestone?.description ?? 'Select a milestone to focus the board and next-task dispatch on one deliverable.'}</p>
    {milestone ? <p className="text-xs text-muted-foreground">
      {milestone.status === 'completed' ? 'Milestone complete. Select the next milestone when ready.' : 'Run next, schedules, and automatic execution start tasks only in this milestone.'} Existing workers and their reviews can finish. Other work stays in the project.
    </p> : null}
    {milestone && !ready && completed < scoped.length ? <p className="text-xs text-muted-foreground">No ready tasks in this milestone. {blocked ? `${blocked} blocked; inspect their task details or retry when resolved.` : 'Tasks are waiting on dependencies or work already underway.'}</p> : null}
    {milestone && !scoped.length ? <p className="text-xs text-muted-foreground">Add tasks below, or assign existing work through its task details.</p> : null}
    {externalDependencies.length ? <p className="text-xs text-warning">Needs work from other milestones: {externalDependencies.map((task) => task.title).join(', ')}. Select that milestone to deliver the dependency, or move the task into this milestone.</p> : null}
    <p className="text-[11px] text-faint">Use the task arrows to set queue order within a milestone. Until reordered, priority decides the next ready task; dependencies still apply.</p>
    {adding ? <form onSubmit={(event) => void create(event)} className="flex flex-wrap gap-2">
      <Input required aria-label="Milestone title" placeholder="Milestone title" value={title} onChange={(event) => setTitle(event.target.value)} className="h-8 max-w-[240px] text-xs" />
      <Input required aria-label="Milestone outcome" placeholder="What can a user do when this is delivered?" value={outcome} onChange={(event) => setOutcome(event.target.value)} className="h-8 min-w-[240px] flex-1 text-xs" />
      <Button type="submit" size="sm" disabled={busy}>Create milestone</Button>
    </form> : null}
  </section>
}
