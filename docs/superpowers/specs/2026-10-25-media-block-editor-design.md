# Smartsoft media, file upload and block editor — design

Date: 2026-10-25
Status: implemented on `codex/shop-integration-2.193` (commits `8fda0fc`, `e498a9a`).
Repo: `krzysztofciura/smartsoft001`, branch `codex/shop-integration-2.193`.

## Intent

Add three generic, reusable Angular components to `@smartsoft001/angular`:

- `smart-file-dropzone` — drag & drop file selection and upload with progress.
- `smart-media-picker` — modal media library picker driven by a host adapter.
- `smart-block-editor` — structured block list editor driven by a host registry.

They are building blocks for LuckySemCMS and any other Smartsoft application. They do not know CMS routes, database tables or block types.

## Goals

- Follow Smartsoft conventions: standalone components, `smart-*` selectors, signal inputs/outputs, `smart:` Tailwind classes, `smart-token`-free composition of existing components.
- Keep all three generic: hosts supply upload, media search and block type adapters.
- No new UI libraries. Use existing Smartsoft components and Angular CDK.
- Accessible keyboard and screen-reader behavior.
- Unit tests (Jest) and Storybook stories for every component.

## Non-goals

- No CMS HTTP client, database code or authentication in these components.
- No raw HTML editing. The block editor edits structured data only.
- No image processing or storage policy; the host adapter owns that.
- No drag & drop of files into the block editor beyond the dropzone component.

## Approaches considered

### Block editor

- **A. Registry + form per block (chosen)** — host registers block types with `create`, `validate` and an editor component. Editor renders a list of cards, add/move/duplicate/delete, Angular CDK drag & drop. Structured, testable, aligns with the CMS block model.
- B. WYSIWYG contenteditable — rejected: raw HTML, sanitisation and validation conflict with the block model.
- C. Hybrid inline editing — rejected for the first version: two editing modes and higher complexity.

### Media picker

- **A. Modal + host adapter (chosen)** — adapter provides `search`, optional `upload`; picker renders results and returns selected items. Reusable and testable.
- B. Built-in HTTP client — rejected: couples the component to one backend.
- C. Projection-only modal — rejected: too much duplicated host UI.

### File dropzone

- **A. New component (chosen)** — `smart-file-dropzone` owns drag & drop, validation and progress; upload is a host adapter. Does not risk regressions in `smart-input-file`.
- B. Extend `smart-input-file` — rejected: existing component has a different form-control contract.
- C. CMS-only component — rejected: not reusable.

## Component contracts

### `smart-file-dropzone`

```ts
interface IFileDropzoneOptions {
  accept?: string; // comma-separated extensions or MIME types
  maxSize?: number; // bytes, 0/undefined = unlimited
  multiple?: boolean;
  disabled?: boolean;
  label?: string;
  hint?: string;
}

interface IFileDropzoneUploader {
  upload(file: File, onProgress: (percent: number) => void): Promise<unknown>;
}
```

Inputs: `options`, `uploader`, `cssClass`.
Outputs: `filesSelected`, `uploaded`, `uploadError`, `rejected`.

Behavior:

- Click, Enter or Space opens the hidden file input.
- Drag over highlights; drop validates and accepts files.
- `accept` and `maxSize` are validated before emitting.
- `multiple=false` keeps only the first valid file.
- With `uploader`, files upload automatically; progress is shown per file.
- Without `uploader`, only `filesSelected` is emitted.
- Rejected files emit `{ file, reason }` and never upload.
- Every selected file has a remove button; upload errors are shown inline.

### `smart-media-picker`

```ts
interface IMediaPickerItem {
  id: string;
  url: string;
  thumbnailUrl?: string;
  name?: string;
  alt?: string;
  mimeType?: string;
  width?: number;
  height?: number;
}

interface IMediaPickerPage {
  items: IMediaPickerItem[];
  total: number;
  page: number;
  pageSize: number;
}

interface IMediaPickerAdapter {
  search(
    query: string,
    page: number,
    pageSize: number,
  ): Promise<IMediaPickerPage>;
  upload?(
    file: File,
    onProgress?: (percent: number) => void,
  ): Promise<IMediaPickerItem>;
}

interface IMediaPickerOptions {
  title?: string;
  accept?: string;
  multiple?: boolean;
  pageSize?: number;
}
```

Inputs: `open` (model), `adapter` (required), `options`, `selected` (model), `cssClass`.
Outputs: `confirmed`, `cancelled`.

Behavior:

- On open, loads page 1 with an empty query.
- Search is debounced (300 ms) and resets to page 1.
- Results render as a selectable grid; selected items are marked with a check.
- Single mode replaces selection; multiple mode toggles.
- Paging uses `smart-paging`.
- Upload uses the host adapter and refreshes the result list; uploaded item is selected.
- Confirm emits `confirmed` and closes; cancel/backdrop closes and emits `cancelled`.
- Empty/loading/error states are rendered.

### `smart-block-editor`

```ts
interface IBlockEditorBlock<T = unknown> {
  id: string;
  type: string;
  data: T;
}

interface IBlockEditorBlockComponent<T = unknown> {
  block: InputSignal<IBlockEditorBlock<T>>;
  update: InputSignal<(data: T) => void>;
  errors: InputSignal<string[]>;
}

interface IBlockEditorType<T = unknown> {
  type: string;
  label: string;
  icon?: string;
  create(): T;
  editorComponent: Type<IBlockEditorBlockComponent<T>>;
  validate?(data: T): string[];
}

interface IBlockEditorOptions {
  types: IBlockEditorType[];
  addLabel?: string;
  emptyText?: string;
  readonly?: boolean;
  maxBlocks?: number;
}
```

Inputs: `blocks` (model), `options` (required), `cssClass`.
Outputs: `blockAdded`, `blockRemoved`, `blockMoved`, `validityChange`.

Behavior:

- Empty state when there are no blocks.
- Add menu lists registered types; creates a block with a UUID and type data.
- Each block is a `smart-card` with type label, drag handle and actions: move up, move down, duplicate, delete.
- Reordering uses Angular CDK drag & drop and also keyboard-accessible buttons.
- The body renders the registered editor component via `NgComponentOutlet` with `block`, `update` and `errors` inputs.
- Validation errors from `validate` are displayed per block.
- `maxBlocks` disables adding; `readonly` hides mutations.
- `validityChange` emits `true` when every block validates.

## Integration with LuckySemCMS

LuckySemCMS provides:

- `MediaPickerAdapter` against `/api/v1/media` (search/upload).
- `FileDropzoneUploader` against the media upload endpoint.
- `IBlockEditorType` definitions for CMS blocks (paragraph, heading, image, button, accordion, etc.).
- CMS-specific block editor components in `src/app/panel/`.

The components do not import anything from LuckySemCMS.

## Security and accessibility

- File validation checks extension/MIME and size before upload; the server still validates.
- No `innerHTML` or raw HTML rendering.
- Alt text is passed through and required by the host's media policy.
- Dropzone is keyboard operable and has an accessible name.
- Picker cards are buttons with `aria-pressed`; modal has a title and focus handling from `smart-modal`.
- Block actions have accessible labels; drag & drop has keyboard alternatives.

## Testing

- Jest unit tests for each component: rendering, inputs/outputs, validation, keyboard/drag paths, empty/error states.
- Storybook stories: playground plus key variants.
- `nx test angular` and `nx build angular` must pass.

## Rollout

1. `smart-file-dropzone`
2. `smart-media-picker`
3. `smart-block-editor`
4. Export from `@smartsoft001/angular`, update docs catalogue if required.
5. Build and pack for LuckySemCMS in a later step.
