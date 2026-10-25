import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  ViewEncapsulation,
  computed,
  effect,
  signal,
  untracked,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import {
  IButtonOptions,
  IEmptyStateOptions,
  IFileDropzoneOptions,
  IFileDropzoneUploaded,
  IFileDropzoneUploader,
  IMediaPickerItem,
  IModalAction,
} from '../../models';
import { ButtonComponent } from '../button';
import { EmptyStateComponent } from '../empty-state';
import { FileDropzoneComponent } from '../file-dropzone';
import { ModalComponent, type IModalActionClick } from '../modal';
import { PagingComponent } from '../paging';
import { SearchbarComponent } from '../searchbar';
import { MediaPickerBaseComponent } from './base/base.component';

@Component({
  selector: 'smart-media-picker',
  template: `
    <smart-modal
      [(open)]="open"
      [title]="title()"
      [actions]="actions()"
      (actionClick)="onAction($event)"
      (closed)="cancel()"
    >
      <div [class]="rootClasses()">
        <div class="smart:flex smart:flex-col smart:gap-3">
          <smart-searchbar
            [text]="query()"
            (textChange)="onQueryChange($event)"
            [options]="{ placeholder: 'Search media' }"
          />

          @if (uploader()) {
            <smart-file-dropzone
              [options]="uploadOptions()"
              [uploader]="uploader()"
              (uploaded)="onUploaded($event)"
            />
          }
        </div>

        @if (loading()) {
          <p
            class="smart:py-10 smart:text-center smart:text-sm smart:text-gray-500"
          >
            {{ 'search' | translate }}...
          </p>
        } @else if (error()) {
          <div class="smart:py-10 smart:text-center">
            <p class="smart:text-sm smart:text-red-600">{{ error() }}</p>
            <smart-button [options]="retryOptions()">
              {{ 'prev' | translate }}
            </smart-button>
          </div>
        } @else if (items().length === 0) {
          <smart-empty-state [options]="emptyOptions()" />
        } @else {
          <div
            class="smart:grid smart:grid-cols-2 smart:gap-3 smart:sm:grid-cols-3 smart:md:grid-cols-4"
          >
            @for (item of items(); track item.id) {
              <button
                type="button"
                class="smart:group smart:relative smart:overflow-hidden smart:rounded-lg smart:border smart:border-gray-200 smart:bg-white smart:text-left smart:shadow-sm smart:transition smart:hover:border-indigo-400 smart:focus:outline-none smart:focus-visible:ring-2 smart:focus-visible:ring-indigo-500 smart:dark:border-gray-700 smart:dark:bg-gray-900"
                [class.smart:ring-2]="isSelected(item.id)"
                [class.smart:ring-indigo-500]="isSelected(item.id)"
                [attr.aria-pressed]="isSelected(item.id)"
                (click)="toggle(item)"
              >
                <img
                  [src]="item.thumbnailUrl ?? item.url"
                  [alt]="item.alt ?? item.name ?? ''"
                  class="smart:aspect-square smart:w-full smart:object-cover"
                />
                <span
                  class="smart:block smart:truncate smart:px-2 smart:py-2 smart:text-xs smart:text-gray-700 smart:dark:text-gray-200"
                >
                  {{ item.name ?? item.id }}
                </span>
                @if (isSelected(item.id)) {
                  <span
                    class="smart:absolute smart:right-2 smart:top-2 smart:flex smart:size-6 smart:items-center smart:justify-center smart:rounded-full smart:bg-indigo-600 smart:text-white"
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      class="smart:size-4"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M16.704 5.293a1 1 0 0 1 .003 1.414l-7.5 7.5a1 1 0 0 1-1.414 0l-3.5-3.5a1 1 0 1 1 1.414-1.414l2.793 2.793 6.793-6.793a1 1 0 0 1 1.411 0Z"
                        clip-rule="evenodd"
                      />
                    </svg>
                  </span>
                }
              </button>
            }
          </div>

          @if (totalPages() > 1) {
            <smart-paging
              [currentPage]="page()"
              [totalPages]="totalPages()"
              [pageSize]="pageSize()"
              [totalItems]="total()"
              (pageChange)="load($event, query())"
            />
          }
        }
      </div>
    </smart-modal>
  `,
  imports: [
    TranslatePipe,
    ModalComponent,
    SearchbarComponent,
    FileDropzoneComponent,
    ButtonComponent,
    EmptyStateComponent,
    PagingComponent,
  ],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MediaPickerComponent
  extends MediaPickerBaseComponent
  implements OnDestroy
{
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private requestId = 0;
  private confirmedSelection = false;

  readonly items = signal<IMediaPickerItem[]>([]);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly query = signal('');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly pageSize = computed(() => this.options()?.pageSize ?? 24);
  readonly multiple = computed(() => this.options()?.multiple === true);
  readonly title = computed(() => this.options()?.title ?? 'Media library');
  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.pageSize())),
  );
  readonly actions = computed<IModalAction[]>(() => [
    { id: 'cancel', label: 'Cancel', variant: 'secondary' },
    { id: 'select', label: 'Select', variant: 'primary' },
  ]);
  readonly emptyOptions = computed<IEmptyStateOptions>(() => ({
    title: 'No media found',
    description: 'Try a different search or upload a file.',
  }));
  readonly uploadOptions = computed<IFileDropzoneOptions>(() => ({
    accept: this.options()?.accept,
    multiple: false,
    label: 'Drop a file here or',
    hint: 'The file is uploaded through the media adapter.',
  }));
  readonly uploader = computed<IFileDropzoneUploader | undefined>(() => {
    const upload = this.adapter().upload;
    if (!upload) return undefined;
    return { upload: (file, onProgress) => upload(file, onProgress) };
  });
  readonly retryOptions = computed<IButtonOptions>(() => ({
    variant: 'secondary',
    click: () => this.load(this.page(), this.query()),
  }));

  constructor() {
    super();
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.page.set(1);
        this.load(1, this.query());
      });
    });
  }

  ngOnDestroy(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  onQueryChange(value: string): void {
    this.query.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.load(1, value), 300);
  }

  load(page: number, query: string): void {
    const requestId = ++this.requestId;
    this.loading.set(true);
    this.error.set(null);

    this.adapter()
      .search(query, page, this.pageSize())
      .then((result) => {
        if (requestId !== this.requestId) return;
        this.items.set(result.items);
        this.total.set(result.total);
        this.page.set(result.page);
      })
      .catch(() => {
        if (requestId !== this.requestId) return;
        this.items.set([]);
        this.total.set(0);
        this.error.set('Could not load media.');
      })
      .finally(() => {
        if (requestId === this.requestId) this.loading.set(false);
      });
  }

  toggle(item: IMediaPickerItem): void {
    if (!this.multiple()) {
      this.selected.set([item]);
      return;
    }

    const exists = this.selected().some((selected) => selected.id === item.id);
    this.selected.set(
      exists
        ? this.selected().filter((selected) => selected.id !== item.id)
        : [...this.selected(), item],
    );
  }

  isSelected(id: string): boolean {
    return this.selected().some((item) => item.id === id);
  }

  onUploaded(event: IFileDropzoneUploaded): void {
    const item = event.result as IMediaPickerItem | undefined;
    if (item?.id) {
      this.selected.set(
        this.multiple()
          ? [
              ...this.selected().filter((selected) => selected.id !== item.id),
              item,
            ]
          : [item],
      );
    }
    this.load(1, this.query());
  }

  onAction(event: IModalActionClick): void {
    if (event.actionId === 'cancel') this.cancel();
    if (event.actionId === 'select') this.confirm();
  }

  confirm(): void {
    this.confirmedSelection = true;
    this.confirmed.emit(this.selected());
    this.open.set(false);
  }

  cancel(): void {
    if (this.confirmedSelection) {
      this.confirmedSelection = false;
      return;
    }
    this.cancelled.emit();
    this.open.set(false);
  }

  rootClasses = computed(() => {
    const classes = ['smart:flex', 'smart:flex-col', 'smart:gap-4'];
    const extra = this.cssClass();
    if (extra) classes.push(extra);
    return classes.join(' ');
  });
}
