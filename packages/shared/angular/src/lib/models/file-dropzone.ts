export interface IFileDropzoneOptions {
  /** Comma-separated extensions (`.png`) or MIME types (`image/png`). */
  accept?: string;
  /** Maximum size per file in bytes. `0` or omitted means unlimited. */
  maxSize?: number;
  multiple?: boolean;
  disabled?: boolean;
  label?: string;
  hint?: string;
}

export interface IFileDropzoneUploader {
  upload(file: File, onProgress: (percent: number) => void): Promise<unknown>;
}

export interface IFileDropzoneRejection {
  file: File;
  reason: 'type' | 'size';
}

export interface IFileDropzoneProgress {
  file: File;
  percent: number;
}

export interface IFileDropzoneUploaded {
  file: File;
  result: unknown;
}

export interface IFileDropzoneUploadError {
  file: File;
  error: unknown;
}
