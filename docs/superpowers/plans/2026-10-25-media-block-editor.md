# Smartsoft media, file upload and block editor — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add generic `smart-file-dropzone`, `smart-media-picker` and `smart-block-editor` components to `@smartsoft001/angular`.

**Architecture:** Standalone Angular components with signal inputs/outputs. Host-supplied adapters isolate CMS-specific upload, media search and block definitions. Components compose existing Smartsoft primitives and Angular CDK drag & drop.

**Tech Stack:** Angular 22.2, TypeScript 6.0.3, Tailwind `smart:` classes, Jest, Storybook, `@angular/cdk/drag-drop`.

**Spec:** `docs/superpowers/specs/2026-10-25-media-block-editor-design.md`

## Global Constraints

- Angular **22.2.3**, TypeScript **6.0.3**, Node **26.x** (repo `.nvmrc` is 26.5.1; local 26.11.1 is acceptable).
- No new UI libraries. Use existing `@smartsoft001/angular` components and Angular CDK.
- Every component is standalone, `ChangeDetectionStrategy.OnPush`, `ViewEncapsulation.None`, selector `smart-*`.
- Use `input()`, `model()`, `output()`, `computed()`, `inject()`.
- Use `smart:`-prefixed Tailwind classes. Do not add global CSS.
- Tests use Jest and run with `npx nx test angular`.
- Build with `npx nx build angular`.
- Add exports to `components/index.ts` and `components/components.module.ts`.
- No CMS-specific imports or routes.

## Review Focus

- A file with a valid extension but wrong MIME type must be rejected by the host policy, not silently uploaded.
- `multiple=false` with several dropped files must keep exactly one.
- Media picker must not emit stale results after a search query changes while a request is in flight.
- Block editor must preserve block ids on move/duplicate (duplicate gets a new id, original keeps its id).
- Readonly mode must not mutate blocks through drag & drop, add, duplicate or delete.

---

### Task 1: `smart-file-dropzone`

**Files:**

- Create: `packages/shared/angular/src/lib/models/file-dropzone.ts`
- Modify: `packages/shared/angular/src/lib/models/index.ts`
- Create: `packages/shared/angular/src/lib/components/file-dropzone/base/base.component.ts`
- Create: `packages/shared/angular/src/lib/components/file-dropzone/file-dropzone.component.ts`
- Create: `packages/shared/angular/src/lib/components/file-dropzone/file-dropzone.component.spec.ts`
- Create: `packages/shared/angular/src/lib/components/file-dropzone/file-dropzone.component.stories.ts`
- Create: `packages/shared/angular/src/lib/components/file-dropzone/index.ts`
- Modify: `packages/shared/angular/src/lib/components/index.ts`
- Modify: `packages/shared/angular/src/lib/components/components.module.ts`

**Interfaces:**

- Produces: `IFileDropzoneOptions`, `IFileDropzoneUploader`, `IFileDropzoneRejection`, `FileDropzoneComponent`.
- Inputs: `options`, `uploader`, `cssClass`.
- Outputs: `filesSelected: File[]`, `uploaded: { file, result }`, `uploadError: { file, error }`, `rejected: IFileDropzoneRejection`.

- [x] **Step 1: Write the failing spec** covering render, file input selection, accept/size rejection, multiple=false, drop, uploader progress, remove and disabled.
- [x] **Step 2: Run `npx nx test angular --testPathPattern=file-dropzone` and confirm failure.**
- [x] **Step 3: Add models and implement the base/component.**
- [x] **Step 4: Run the test until green.**
- [x] **Step 5: Add story and exports; run lint/build.**
- [x] **Step 6: Commit.**

### Task 2: `smart-media-picker`

**Files:**

- Create: `packages/shared/angular/src/lib/models/media-picker.ts`
- Modify: `packages/shared/angular/src/lib/models/index.ts`
- Create: `packages/shared/angular/src/lib/components/media-picker/base/base.component.ts`
- Create: `packages/shared/angular/src/lib/components/media-picker/media-picker.component.ts`
- Create: `packages/shared/angular/src/lib/components/media-picker/media-picker.component.spec.ts`
- Create: `packages/shared/angular/src/lib/components/media-picker/media-picker.component.stories.ts`
- Create: `packages/shared/angular/src/lib/components/media-picker/index.ts`
- Modify: exports/module.

**Interfaces:**

- Produces: `IMediaPickerItem`, `IMediaPickerPage`, `IMediaPickerAdapter`, `IMediaPickerOptions`, `MediaPickerComponent`.
- Inputs: `open` (model), `adapter` (required), `options`, `selected` (model), `cssClass`.
- Outputs: `confirmed`, `cancelled`.

- [x] **Step 1: Write the failing spec** covering load on open, search debounce, single/multiple selection, confirm/cancel, pagination and upload/refresh.
- [x] **Step 2: Run `npx nx test angular --testPathPattern=media-picker` and confirm failure.**
- [x] **Step 3: Add models and implement the base/component using `smart-modal`, `smart-searchbar`, `smart-paging`, `smart-button`, `smart-file-dropzone`.**
- [x] **Step 4: Run the test until green.**
- [x] **Step 5: Add story and exports; run lint/build.**
- [x] **Step 6: Commit.**

### Task 3: `smart-block-editor`

**Files:**

- Create: `packages/shared/angular/src/lib/models/block-editor.ts`
- Modify: `packages/shared/angular/src/lib/models/index.ts`
- Create: `packages/shared/angular/src/lib/components/block-editor/base/base.component.ts`
- Create: `packages/shared/angular/src/lib/components/block-editor/block-editor.component.ts`
- Create: `packages/shared/angular/src/lib/components/block-editor/block-editor.component.spec.ts`
- Create: `packages/shared/angular/src/lib/components/block-editor/block-editor.component.stories.ts`
- Create: `packages/shared/angular/src/lib/components/block-editor/index.ts`
- Modify: exports/module.

**Interfaces:**

- Produces: `IBlockEditorBlock`, `IBlockEditorBlockComponent`, `IBlockEditorType`, `IBlockEditorOptions`, `BlockEditorComponent`.
- Inputs: `blocks` (model), `options` (required), `cssClass`.
- Outputs: `blockAdded`, `blockRemoved`, `blockMoved`, `validityChange`.

- [x] **Step 1: Write the failing spec** covering empty state, add, update via editor outlet, move up/down, duplicate (new id), remove, validation errors, maxBlocks and readonly.
- [x] **Step 2: Run `npx nx test angular --testPathPattern=block-editor` and confirm failure.**
- [x] **Step 3: Add models and implement the base/component with `smart-card`, `smart-dropdown`, `smart-button`, `NgComponentOutlet` and `CdkDrag`.**
- [x] **Step 4: Run the test until green.**
- [x] **Step 5: Add story and exports; run lint/build.**
- [x] **Step 6: Commit.**

### Task 4: Verification

- [x] `npx nx test angular`
- [x] `npx nx build angular`
- [x] `npx nx lint angular`
- [x] Review `git diff` for accidental CMS imports or secrets.
- [x] Commit and push the branch to `origin`.

## Verification (2026-10-25)

- `npx jest --config packages/shared/angular/jest.config.ts --runInBand --testPathPatterns='(file-dropzone|media-picker|block-editor)'` — 37 tests passed.
- `npx nx test angular --runInBand` — 331 suites, 3015 tests passed.
- `npx nx build angular` — passed.
- `npx nx build-storybook angular` — passed.
- `npx eslint` on the new source files — no errors or warnings.
- Pushed to `origin/codex/shop-integration-2.193` as commits `8fda0fc` and `e498a9a`.
