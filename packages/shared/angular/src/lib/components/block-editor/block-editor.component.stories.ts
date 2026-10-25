import { Component, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import type { Meta, StoryObj } from '@storybook/angular';
import { applicationConfig, moduleMetadata } from '@storybook/angular';

import { BlockEditorComponent } from './block-editor.component';
import { provideStorybookTranslations } from '../../../../.storybook/storybook-translations';
import {
  IBlockEditorBlock,
  IBlockEditorBlockComponent,
  IBlockEditorOptions,
  IBlockEditorType,
} from '../../models';

@Component({
  selector: 'smart-story-block-editor',
  standalone: true,
  template: `
    <label
      class="smart:block smart:text-sm smart:font-medium smart:text-gray-700"
    >
      {{ block().type === 'heading' ? 'Heading' : 'Text' }}
      <input
        class="smart:mt-1 smart:block smart:w-full smart:rounded-md smart:border smart:border-gray-300 smart:px-3 smart:py-2"
        [value]="block().data.text"
        (input)="update()({ text: $any($event.target).value })"
      />
    </label>
    @if (errors().length) {
      <p class="smart:mt-1 smart:text-xs smart:text-red-600">
        {{ errors()[0] }}
      </p>
    }
  `,
})
class StoryBlockComponent implements IBlockEditorBlockComponent<{
  text: string;
}> {
  block = input.required<IBlockEditorBlock<{ text: string }>>();
  update = input.required<(data: { text: string }) => void>();
  errors = input<string[]>([]);
}

const types: IBlockEditorType[] = [
  {
    type: 'text',
    label: 'Text',
    create: () => ({ text: '' }),
    editorComponent: StoryBlockComponent,
    validate: (data) =>
      (data as { text: string }).text.trim() ? [] : ['Text is required'],
  },
  {
    type: 'heading',
    label: 'Heading',
    create: () => ({ text: '' }),
    editorComponent: StoryBlockComponent,
    validate: (data) =>
      (data as { text: string }).text.trim() ? [] : ['Heading is required'],
  },
];

const options: IBlockEditorOptions = {
  types,
  addLabel: 'Add block',
};

interface BlockEditorArgs {
  addLabel: string;
  readonly: boolean;
}

const meta: Meta<BlockEditorArgs> = {
  title: 'Components/BlockEditor',
  tags: ['autodocs'],
  decorators: [
    applicationConfig({
      providers: [...provideStorybookTranslations()],
    }),
    moduleMetadata({
      imports: [BlockEditorComponent, StoryBlockComponent, TranslateModule],
    }),
  ],
  argTypes: {
    addLabel: { control: 'text' },
    readonly: { control: 'boolean' },
  },
  args: {
    addLabel: 'Add block',
    readonly: false,
  },
};

export default meta;
type Story = StoryObj<BlockEditorArgs>;

export const Playground: Story = {
  render: (args) => ({
    props: {
      options: { ...options, addLabel: args.addLabel, readonly: args.readonly },
      blocks: [],
    },
    template: `
      <div style="padding: 40px; max-width: 760px;">
        <smart-block-editor [options]="options" [(blocks)]="blocks"></smart-block-editor>
      </div>
    `,
  }),
};

export const WithBlocks: Story = {
  name: 'With blocks',
  render: () => ({
    props: {
      options,
      blocks: [
        { id: 'one', type: 'heading', data: { text: 'Hello LuckySemCMS' } },
        { id: 'two', type: 'text', data: { text: 'A regular paragraph.' } },
        { id: 'three', type: 'text', data: { text: '' } },
      ] as IBlockEditorBlock[],
    },
    template: `
      <div style="padding: 40px; max-width: 760px;">
        <smart-block-editor [options]="options" [(blocks)]="blocks"></smart-block-editor>
      </div>
    `,
  }),
};

export const Readonly: Story = {
  render: () => ({
    props: {
      options: { ...options, readonly: true },
      blocks: [
        { id: 'one', type: 'heading', data: { text: 'Readonly heading' } },
        { id: 'two', type: 'text', data: { text: 'Readonly paragraph.' } },
      ] as IBlockEditorBlock[],
    },
    template: `
      <div style="padding: 40px; max-width: 760px;">
        <smart-block-editor [options]="options" [(blocks)]="blocks"></smart-block-editor>
      </div>
    `,
  }),
};
