import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewEncapsulation,
  computed,
  signal,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { IButtonOptions, IFileDropzoneUploader } from '../../models';
import { ButtonComponent } from '../button';
import { FileDropzoneBaseComponent } from './base/base.component';

interface ISelectedFile {
  file: File;
  percent: number;
  uploading: boolean;
  error: unknown;
}

@Component({
  selector: 'smart-file-dropzone',
  template: `
    <div [class]="rootClasses()">
      <div
        [class]="zoneClasses()"
        role="button"
        [attr.tabindex]="disabled() ? -1 : 0"
        [attr.aria-disabled]="disabled()"
        [attr.aria-label]="label()"
        (click)="openFileDialog()"
        (keydown.enter)="openFileDialog()"
        (keydown.space)="openFileDialog(); $event.preventDefault()"
        (dragover)="onDragOver($event)"
        (dragleave)="onDragLeave($event)"
        (drop)="onDrop($event)"
      >
        <svg
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          class="smart:mx-auto smart:size-10 smart:text-gray-400"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 7.5 12 3m0 0L7.5 7.5M12 3v13.5"
          />
        </svg>
        <p
          class="smart:mt-3 smart:text-sm smart:text-gray-600 smart:dark:text-gray-300"
        >
          {{ options()?.label ?? ('INPUT.dropFileHereOr' | translate) }}
          <span
            class="smart:font-semibold smart:text-indigo-600 smart:dark:text-indigo-400"
          >
            {{ 'browse' | translate }}
          </span>
        </p>
        @if (options()?.hint) {
          <p
            class="smart:mt-1 smart:text-xs smart:text-gray-500 smart:dark:text-gray-400"
          >
            {{ options()!.hint }}
          </p>
        }
      </div>

      <input
        #fileInput
        type="file"
        [attr.accept]="options()?.accept ?? null"
        [attr.multiple]="multiple() ? '' : null"
        [hidden]="true"
        (change)="onInputChange($event)"
      />

      @if (files().length > 0) {
        <ul class="smart:mt-3 smart:space-y-2">
          @for (
            entry of files();
            track entry.file.name + entry.file.size + $index
          ) {
            <li
              class="smart:flex smart:items-center smart:justify-between smart:gap-3 smart:rounded-md smart:border smart:border-gray-200 smart:px-3 smart:py-2 smart:dark:border-gray-700"
            >
              <div class="smart:min-w-0 smart:flex-1">
                <p
                  class="smart:truncate smart:text-sm smart:font-medium smart:text-gray-900 smart:dark:text-white"
                >
                  {{ entry.file.name }}
                </p>
                <p
                  class="smart:text-xs smart:text-gray-500 smart:dark:text-gray-400"
                >
                  {{ formatSize(entry.file.size) }}
                  @if (entry.uploading) {
                    · {{ entry.percent }}%
                  }
                  @if (entry.error) {
                    · upload failed
                  }
                </p>
                @if (entry.uploading) {
                  <div
                    class="smart:mt-1 smart:h-1 smart:overflow-hidden smart:rounded smart:bg-gray-200 smart:dark:bg-gray-700"
                  >
                    <div
                      class="smart:h-full smart:bg-indigo-600"
                      [style.width.%]="entry.percent"
                    ></div>
                  </div>
                }
              </div>
              <smart-button [options]="removeOptions($index)">
                {{ 'remove' | translate }}
              </smart-button>
            </li>
          }
        </ul>
      }
    </div>
  `,
  imports: [TranslatePipe, ButtonComponent],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileDropzoneComponent extends FileDropzoneBaseComponent {
  private readonly inputRef =
    viewChild<ElementRef<HTMLInputElement>>('fileInput');
  private readonly dragDepth = signal(0);

  readonly files = signal<ISelectedFile[]>([]);
  readonly disabled = computed(() => this.options()?.disabled === true);
  readonly multiple = computed(() => this.options()?.multiple === true);
  readonly label = computed(
    () => this.options()?.label ?? 'Drop files here or browse',
  );
  readonly dragging = computed(() => this.dragDepth() > 0);

  rootClasses = computed(() => {
    const classes = ['smart:w-full'];
    const extra = this.cssClass();
    if (extra) classes.push(extra);
    return classes.join(' ');
  });

  zoneClasses = computed(() => {
    const classes = [
      'smart:flex',
      'smart:cursor-pointer',
      'smart:flex-col',
      'smart:items-center',
      'smart:justify-center',
      'smart:rounded-lg',
      'smart:border',
      'smart:border-dashed',
      'smart:px-6',
      'smart:py-8',
      'smart:text-center',
      'smart:transition-colors',
    ];
    if (this.disabled()) {
      classes.push('smart:cursor-not-allowed', 'smart:opacity-50');
    } else if (this.dragging()) {
      classes.push(
        'smart:border-indigo-500',
        'smart:bg-indigo-50',
        'smart:dark:bg-indigo-950/30',
      );
    } else {
      classes.push(
        'smart:border-gray-300',
        'smart:hover:border-indigo-400',
        'smart:dark:border-gray-600',
      );
    }
    return classes.join(' ');
  });

  openFileDialog(): void {
    if (this.disabled()) return;
    this.inputRef()?.nativeElement.click();
  }

  onInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectFiles(Array.from(input.files ?? []));
    input.value = '';
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (this.disabled()) return;
    this.dragDepth.update((value) => value + 1);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dragDepth.update((value) => Math.max(0, value - 1));
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragDepth.set(0);
    if (this.disabled()) return;
    this.selectFiles(Array.from(event.dataTransfer?.files ?? []));
  }

  selectFiles(candidates: File[]): void {
    if (this.disabled() || candidates.length === 0) return;

    const accepted: File[] = [];
    for (const file of candidates) {
      const rejection = this.rejection(file);
      if (rejection) {
        this.rejected.emit({ file, reason: rejection });
        continue;
      }
      accepted.push(file);
      if (!this.multiple()) break;
    }

    if (accepted.length === 0) return;

    const entries: ISelectedFile[] = accepted.map((file) => ({
      file,
      percent: 0,
      uploading: !!this.uploader(),
      error: null,
    }));

    this.files.set(this.multiple() ? [...this.files(), ...entries] : entries);
    this.filesSelected.emit(accepted);

    const uploader = this.uploader();
    if (uploader) {
      entries.forEach((entry) => this.upload(entry, uploader));
    }
  }

  remove(index: number): void {
    this.files.update((files) => files.filter((_, i) => i !== index));
  }

  removeOptions(index: number): IButtonOptions {
    return {
      variant: 'primary',
      color: 'red',
      click: () => this.remove(index),
    };
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private rejection(file: File): 'type' | 'size' | null {
    const maxSize = this.options()?.maxSize ?? 0;
    if (maxSize > 0 && file.size > maxSize) return 'size';
    if (!this.matchesAccept(file, this.options()?.accept ?? '')) return 'type';
    return null;
  }

  private matchesAccept(file: File, accept: string): boolean {
    const rules = accept
      .split(',')
      .map((rule) => rule.trim().toLowerCase())
      .filter(Boolean);
    if (rules.length === 0) return true;

    const name = file.name.toLowerCase();
    const type = (file.type || '').toLowerCase();

    return rules.some((rule) => {
      if (rule.startsWith('.')) return name.endsWith(rule);
      if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
      return type === rule || name.endsWith(`.${rule}`);
    });
  }

  private upload(entry: ISelectedFile, uploader: IFileDropzoneUploader): void {
    uploader
      .upload(entry.file, (percent) => {
        this.updateEntry(entry.file, {
          percent: Math.max(0, Math.min(100, Math.round(percent))),
        });
      })
      .then((result) => {
        this.updateEntry(entry.file, { uploading: false, percent: 100 });
        this.uploaded.emit({ file: entry.file, result });
      })
      .catch((error: unknown) => {
        this.updateEntry(entry.file, { uploading: false, error });
        this.uploadError.emit({ file: entry.file, error });
      });
  }

  private updateEntry(file: File, patch: Partial<ISelectedFile>): void {
    this.files.update((files) =>
      files.map((entry) =>
        entry.file === file ? { ...entry, ...patch } : entry,
      ),
    );
  }
}
