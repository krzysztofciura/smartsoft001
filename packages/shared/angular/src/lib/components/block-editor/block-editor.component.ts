import {
  CdkDragDrop,
  DragDropModule,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  effect,
  untracked,
} from '@angular/core';

import {
  IBlockEditorBlock,
  IBlockEditorOptions,
  IBlockEditorType,
  IButtonOptions,
  IDropdownItem,
  IEmptyStateOptions,
} from '../../models';
import { ButtonComponent } from '../button';
import { CardComponent } from '../card';
import { DropdownComponent } from '../dropdown';
import { EmptyStateComponent } from '../empty-state';
import { BlockEditorBaseComponent } from './base/base.component';

@Component({
  selector: 'smart-block-editor',
  template: `
    <div [class]="rootClasses()">
      @if (!isReadonly()) {
        <div class="smart:mb-3 smart:flex smart:justify-end">
          <smart-dropdown
            [items]="addItems()"
            [triggerLabel]="addLabel()"
            (selectedItem)="onAdd($event)"
          />
        </div>
      }

      @if (blocks().length === 0) {
        <smart-empty-state [options]="emptyOptions()" />
      } @else {
        <div
          cdkDropList
          class="smart:flex smart:flex-col smart:gap-3"
          (cdkDropListDropped)="drop($event)"
        >
          @for (block of blocks(); track block.id; let i = $index) {
            <smart-card cdkDrag [hasHeader]="true" [class]="cardClasses()">
              <div cardHeader class="smart:flex smart:items-center smart:gap-2">
                @if (!isReadonly()) {
                  <span
                    cdkDragHandle
                    class="smart:cursor-grab smart:text-gray-400 smart:select-none"
                    aria-hidden="true"
                  >
                    ⠿
                  </span>
                }
                <span
                  class="smart:text-sm smart:font-semibold smart:text-gray-900 smart:dark:text-white"
                >
                  {{ typeFor(block)?.label ?? block.type }}
                </span>
                @if (!isReadonly()) {
                  <div
                    class="smart:ml-auto smart:flex smart:items-center smart:gap-1"
                  >
                    <smart-button
                      [options]="moveUpOptions(i)"
                      [disabled]="i === 0"
                    >
                      <span aria-hidden="true">↑</span>
                      <span class="smart:sr-only">Move up</span>
                    </smart-button>
                    <smart-button
                      [options]="moveDownOptions(i)"
                      [disabled]="i === blocks().length - 1"
                    >
                      <span aria-hidden="true">↓</span>
                      <span class="smart:sr-only">Move down</span>
                    </smart-button>
                    <smart-button [options]="duplicateOptions(block.id)">
                      <span aria-hidden="true">⧉</span>
                      <span class="smart:sr-only">Duplicate</span>
                    </smart-button>
                    <smart-button [options]="removeOptions(block.id)">
                      <span aria-hidden="true">✕</span>
                      <span class="smart:sr-only">Delete</span>
                    </smart-button>
                  </div>
                }
              </div>

              <div [attr.inert]="isReadonly() ? '' : null">
                @if (editorComponent(block); as editor) {
                  <ng-container
                    *ngComponentOutlet="editor; inputs: editorInputs(block)"
                  />
                } @else {
                  <p class="smart:text-sm smart:text-red-600">
                    Unknown block type: {{ block.type }}
                  </p>
                }
              </div>

              @if (errorsFor(block).length > 0) {
                <ul class="smart:mt-2 smart:space-y-1">
                  @for (error of errorsFor(block); track error) {
                    <li class="smart:text-xs smart:text-red-600">
                      {{ error }}
                    </li>
                  }
                </ul>
              }
            </smart-card>
          }
        </div>
      }
    </div>
  `,
  imports: [
    DragDropModule,
    NgComponentOutlet,
    DropdownComponent,
    EmptyStateComponent,
    CardComponent,
    ButtonComponent,
  ],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BlockEditorComponent extends BlockEditorBaseComponent {
  readonly isReadonly = computed(() => this.options().readonly === true);
  readonly addLabel = computed(() => this.options().addLabel ?? 'Add block');
  readonly addItems = computed<IDropdownItem[]>(() =>
    this.options().types.map((type) => ({
      id: type.type,
      label: type.label,
    })),
  );
  readonly emptyOptions = computed<IEmptyStateOptions>(() => ({
    title: this.options().emptyText ?? 'No blocks yet',
    description: 'Add the first block to start building the document.',
  }));
  readonly canAdd = computed(() => {
    if (this.isReadonly()) return false;
    const max = this.options().maxBlocks ?? 0;
    return max === 0 || this.blocks().length < max;
  });

  rootClasses = computed(() => {
    const classes = ['smart:w-full'];
    const extra = this.cssClass();
    if (extra) classes.push(extra);
    return classes.join(' ');
  });

  cardClasses = computed(() =>
    [
      'smart:block',
      'smart:rounded-lg',
      'smart:border',
      'smart:border-gray-200',
      'smart:bg-white',
      'smart:dark:border-gray-700',
      'smart:dark:bg-gray-900',
    ].join(' '),
  );

  constructor() {
    super();
    effect(() => {
      const blocks = this.blocks();
      const options = this.options();
      untracked(() => this.validityChange.emit(this.valid(blocks, options)));
    });
  }

  typeFor(block: IBlockEditorBlock): IBlockEditorType | undefined {
    return this.options().types.find((type) => type.type === block.type);
  }

  editorComponent(block: IBlockEditorBlock) {
    return this.typeFor(block)?.editorComponent;
  }

  editorInputs(block: IBlockEditorBlock): Record<string, unknown> {
    return {
      block,
      update: (data: unknown) => this.update(block.id, data),
      errors: this.errorsFor(block),
    };
  }

  errorsFor(block: IBlockEditorBlock): string[] {
    return this.typeFor(block)?.validate?.(block.data) ?? [];
  }

  onAdd(event: { itemId: string }): void {
    const type = this.options().types.find(
      (candidate) => candidate.type === event.itemId,
    );
    if (type) this.add(type);
  }

  add(type: IBlockEditorType): IBlockEditorBlock | null {
    if (!this.canAdd()) return null;
    const block: IBlockEditorBlock = {
      id: this.newId(),
      type: type.type,
      data: type.create(),
    };
    this.blocks.update((blocks) => [...blocks, block]);
    this.blockAdded.emit(block);
    return block;
  }

  update(id: string, data: unknown): void {
    this.blocks.update((blocks) =>
      blocks.map((block) => (block.id === id ? { ...block, data } : block)),
    );
  }

  remove(id: string): void {
    this.blocks.update((blocks) => blocks.filter((block) => block.id !== id));
    this.blockRemoved.emit(id);
  }

  move(index: number, delta: number): void {
    const target = index + delta;
    const blocks = this.blocks();
    if (target < 0 || target >= blocks.length) return;

    const next = [...blocks];
    [next[index], next[target]] = [next[target], next[index]];
    this.blocks.set(next);
    this.blockMoved.emit({ id: blocks[index].id, from: index, to: target });
  }

  duplicate(id: string): void {
    const blocks = this.blocks();
    const index = blocks.findIndex((block) => block.id === id);
    if (index < 0) return;
    const source = blocks[index];
    const copy: IBlockEditorBlock = {
      id: this.newId(),
      type: source.type,
      data: this.clone(source.data),
    };
    this.blocks.set([
      ...blocks.slice(0, index + 1),
      copy,
      ...blocks.slice(index + 1),
    ]);
    this.blockAdded.emit(copy);
  }

  drop(event: CdkDragDrop<IBlockEditorBlock[]>): void {
    if (this.isReadonly()) return;
    const blocks = [...this.blocks()];
    moveItemInArray(blocks, event.previousIndex, event.currentIndex);
    this.blocks.set(blocks);
    this.blockMoved.emit({
      id: blocks[event.currentIndex].id,
      from: event.previousIndex,
      to: event.currentIndex,
    });
  }

  moveUpOptions(index: number): IButtonOptions {
    return {
      variant: 'secondary',
      click: () => this.move(index, -1),
    };
  }

  moveDownOptions(index: number): IButtonOptions {
    return {
      variant: 'secondary',
      click: () => this.move(index, 1),
    };
  }

  duplicateOptions(id: string): IButtonOptions {
    return {
      variant: 'secondary',
      click: () => this.duplicate(id),
    };
  }

  removeOptions(id: string): IButtonOptions {
    return {
      variant: 'primary',
      color: 'red',
      click: () => this.remove(id),
    };
  }

  private valid(
    blocks: IBlockEditorBlock[],
    options: IBlockEditorOptions,
  ): boolean {
    return blocks.every((block) => {
      const type = options.types.find(
        (candidate) => candidate.type === block.type,
      );
      if (!type) return false;
      return (type.validate?.(block.data) ?? []).length === 0;
    });
  }

  private newId(): string {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
    return `block-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private clone<T>(value: T): T {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value)) as T;
  }
}
