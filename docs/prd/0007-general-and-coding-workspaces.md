---
id: "0007"
title: "General and Coding Workspace Profiles"
status: in-progress
created: 2026-09-27
---

# PRD 0007 — General and Coding Workspace Profiles

## 1. Product outcome

ND is a **local-first extensible AI work desktop**, not only a coding IDE.

The desktop exposes two human-facing workspace profiles:

- **General** — everyday AI work for personal, company and project contexts: Home, chat/agents, projects, files/folders, browser, knowledge, design, launcher and extensions.
- **Coding** — General plus developer-specific surfaces: coding workbench/DSH, Git controls, QA/test surfaces, source-development tooling and the deeper coding-engine experience.

The profiles share the same ND identity, data, companies, projects, agents, extension installation and permission system. They are not separate products.

## 2. Non-negotiable state separation

Workspace profile is orthogonal to context, execution state and permission mode.

Changing General ↔ Coding **must never** pause, cancel, restart or otherwise mutate company/task/agent execution. UI navigation is not an execution command.

The existing **ND / DSH** control remains a coding-surface selector nested under Coding; it is not the General/Coding profile switch.

## 3. Fresh-install and upgrade behavior

- Fresh user data starts in **General**.
- Existing ND-DSH installs that already persisted the legacy coding `surface` setting migrate to **Coding**, avoiding a surprise regression for current beta users.
- Choosing General while DSH is active returns the visible surface to the ND workbench. This is presentation cleanup only.

## 4. General MVP surface

General keeps Home, Company, Agent, Design, Settings, projects, browser/files, launcher and extensions.

General initially hides DSH, QA navigation and header Git controls.

## 5. Coding profile

Coding restores developer-specific controls and remains compatible with the existing coding engine/session architecture.

## 6. Extension architecture direction

ND Extensions remain below both profiles. Future desktop integrations such as wallpaper management, widgets, window management, process inspection and desktop organization must be added as narrow allowlisted host capabilities through the existing manifest + invocation broker + permission model.

Extensions do not gain unrestricted Electron, Node, child-process, shell or native-addon authority merely because they need one OS operation.

## 7. First implementation slice

Task 0044 implements the persisted profile contract, toggle, General filtering, main-process DSH guard and E2E coverage.

## 8. Deferred

- Purpose-designed General file/desktop workspace.
- Wallpaper/window/process/widget host APIs themselves.
- Marketplace publishing and billing.
- Arbitrary extension HTML/React or unrestricted executable plugin runtimes.
- Web/cloud sync and remote administration.
