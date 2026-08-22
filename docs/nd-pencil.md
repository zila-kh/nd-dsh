# ND Pencil

ND Pencil is the native Freeform engine inside ND Design.

The implementation is derived from the MIT-licensed OpenPencil engine pinned under `vendor/openpencil`, but OpenPencil is not a user-facing product dependency. ND owns the UI, workspace binding, document lifecycle, agent integration, packaging, security policy, and product identity.

## Product boundary

ND Pencil keeps the local design primitives ND needs:

- editable `.op` documents
- vector canvas, frames, text, shapes, images, layers, layout, variables, components
- selection, viewport, undo/redo, import/export primitives
- the local MCP/editor command surface used by ND Agent
- local, project-scoped save/recovery

ND Pencil does not expose OpenPencil product services:

- account login or sign-up
- teams, collaboration, relay sessions, or cloud tenancy
- OpenPencil AI chat/provider configuration
- OpenPencil update UI, billing, or standalone app workflow
- external OpenPencil installation or PATH discovery

The embedded renderer is treated as an untrusted local design surface: its Electron partition denies permissions and popups, and ND limits HTTP(S) traffic to loopback. Authentication, collaboration, and upstream AI routes are blocked even on loopback.

Normal users should only see the name **ND Pencil** in the product. The upstream OpenPencil name remains only in source-provenance and license files where attribution is required.
