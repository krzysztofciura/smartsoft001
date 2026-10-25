import { CdkDragDrop } from '@angular/cdk/drag-drop';
import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';

import { BlockEditorComponent } from './block-editor.component';
import {
  IBlockEditorBlock,
  IBlockEditorBlockComponent,
  IBlockEditorOptions,
} from '../../models';

@Component({
  selector: 'smart-test-block',
  standalone: true,
  template: `
    <input
      [value]="block().data.text"
      (input)="update()({ text: $any($event.target).value })"
    />
    @if (errors().length) {
      <span class="test-error">{{ errors()[0] }}</span>
    }
  `,
})
class TestBlockComponent implements IBlockEditorBlockComponent<{
  text: string;
}> {
  block = input.required<IBlockEditorBlock<{ text: string }>>();
  update = input.required<(data: { text: string }) => void>();
  errors = input<string[]>([]);
}

const options: IBlockEditorOptions = {
  types: [
    {
      type: 'text',
      label: 'Text',
      create: () => ({ text: '' }),
      editorComponent: TestBlockComponent,
      validate: (data) =>
        (data as { text: string }).text ? [] : ['Text is required'],
    },
    {
      type: 'other',
      label: 'Other',
      create: () => ({ text: '' }),
      editorComponent: TestBlockComponent,
    },
  ],
};

describe('BlockEditorComponent', () => {
  let fixture: ComponentFixture<BlockEditorComponent>;
  let component: BlockEditorComponent;

  const create = async (overrides: Partial<IBlockEditorOptions> = {}) => {
    await TestBed.configureTestingModule({
      imports: [
        BlockEditorComponent,
        TestBlockComponent,
        TranslateModule.forRoot(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BlockEditorComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('options', { ...options, ...overrides });
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await create();
  });

  it('starts with an empty state', () => {
    expect(component.blocks()).toEqual([]);
    expect(
      fixture.nativeElement.querySelector('smart-empty-state'),
    ).toBeTruthy();
  });

  it('adds a block and emits it', () => {
    const added: IBlockEditorBlock[] = [];
    component.blockAdded.subscribe((block) => added.push(block));

    const block = component.add(options.types[0]);

    expect(block).not.toBeNull();
    expect(component.blocks()).toHaveLength(1);
    expect(component.blocks()[0].type).toBe('text');
    expect(added).toEqual(component.blocks());
  });

  it('updates block data without changing the id', () => {
    const block = component.add(options.types[0])!;

    component.update(block.id, { text: 'Hello' });

    expect(component.blocks()[0].id).toBe(block.id);
    expect(component.blocks()[0].data).toEqual({ text: 'Hello' });
  });

  it('moves a block up and down', () => {
    const first = component.add(options.types[0])!;
    const second = component.add(options.types[1])!;

    component.move(0, 1);

    expect(component.blocks().map((block) => block.id)).toEqual([
      second.id,
      first.id,
    ]);

    component.move(1, -1);

    expect(component.blocks().map((block) => block.id)).toEqual([
      first.id,
      second.id,
    ]);
  });

  it('duplicates a block with a new id and a copy of the data', () => {
    const block = component.add(options.types[0])!;
    component.update(block.id, { text: 'Original' });

    component.duplicate(block.id);

    expect(component.blocks()).toHaveLength(2);
    expect(component.blocks()[1].id).not.toBe(block.id);
    expect(component.blocks()[1].data).toEqual({ text: 'Original' });
    expect(component.blocks()[1].data).not.toBe(component.blocks()[0].data);
  });

  it('removes a block and emits its id', () => {
    const block = component.add(options.types[0])!;
    const removed: string[] = [];
    component.blockRemoved.subscribe((id) => removed.push(id));

    component.remove(block.id);

    expect(component.blocks()).toEqual([]);
    expect(removed).toEqual([block.id]);
  });

  it('reports validation errors and validity', () => {
    const validity: boolean[] = [];
    component.validityChange.subscribe((value) => validity.push(value));
    const block = component.add(options.types[0])!;
    fixture.detectChanges();

    expect(component.errorsFor(block)).toEqual(['Text is required']);
    expect(validity[validity.length - 1]).toBe(false);

    component.update(block.id, { text: 'Valid' });
    fixture.detectChanges();

    expect(component.errorsFor(component.blocks()[0])).toEqual([]);
    expect(validity[validity.length - 1]).toBe(true);
  });

  it('respects maxBlocks', () => {
    fixture.componentRef.setInput('options', { ...options, maxBlocks: 1 });
    fixture.detectChanges();
    component.add(options.types[0]);

    expect(component.canAdd()).toBe(false);
    expect(component.add(options.types[1])).toBeNull();
    expect(component.blocks()).toHaveLength(1);
  });

  it('does not mutate in readonly mode', () => {
    fixture.componentRef.setInput('options', { ...options, readonly: true });
    fixture.detectChanges();

    expect(component.canAdd()).toBe(false);
    expect(component.add(options.types[0])).toBeNull();
    expect(component.blocks()).toEqual([]);
  });

  it('renders the registered editor component and forwards updates', async () => {
    const block = component.add(options.types[0])!;
    fixture.detectChanges();
    await fixture.whenStable();

    const input = fixture.nativeElement.querySelector(
      'smart-test-block input',
    ) as HTMLInputElement;
    expect(input).toBeTruthy();

    input.value = 'From the editor';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(component.blocks()[0].id).toBe(block.id);
    expect(component.blocks()[0].data).toEqual({ text: 'From the editor' });
  });

  it('reorders blocks through the CDK drop event', () => {
    const first = component.add(options.types[0])!;
    const second = component.add(options.types[1])!;

    component.drop({
      previousIndex: 0,
      currentIndex: 1,
    } as CdkDragDrop<IBlockEditorBlock[]>);

    expect(component.blocks().map((block) => block.id)).toEqual([
      second.id,
      first.id,
    ]);
  });
});
