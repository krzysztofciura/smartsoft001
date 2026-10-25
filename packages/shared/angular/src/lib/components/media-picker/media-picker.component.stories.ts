import { TranslateModule } from '@ngx-translate/core';
import type { Meta, StoryObj } from '@storybook/angular';
import { applicationConfig, moduleMetadata } from '@storybook/angular';

import { MediaPickerComponent } from './media-picker.component';
import { provideStorybookTranslations } from '../../../../.storybook/storybook-translations';
import { IMediaPickerAdapter, IMediaPickerItem } from '../../models';

const ITEMS: IMediaPickerItem[] = Array.from({ length: 8 }, (_, index) => ({
  id: String(index + 1),
  url: `https://placehold.co/300x300?text=${index + 1}`,
  thumbnailUrl: `https://placehold.co/300x300?text=${index + 1}`,
  name: `Media ${index + 1}`,
  alt: `Placeholder ${index + 1}`,
}));

const adapter: IMediaPickerAdapter = {
  search: async (query, page, pageSize) => {
    const filtered = ITEMS.filter((item) =>
      (item.name ?? '').toLowerCase().includes(query.toLowerCase()),
    );
    return {
      items: filtered.slice((page - 1) * pageSize, page * pageSize),
      total: filtered.length,
      page,
      pageSize,
    };
  },
};

interface MediaPickerArgs {
  multiple: boolean;
  title: string;
}

const meta: Meta<MediaPickerArgs> = {
  title: 'Components/MediaPicker',
  tags: ['autodocs'],
  decorators: [
    applicationConfig({
      providers: [...provideStorybookTranslations()],
    }),
    moduleMetadata({
      imports: [MediaPickerComponent, TranslateModule],
    }),
  ],
  argTypes: {
    multiple: { control: 'boolean' },
    title: { control: 'text' },
  },
  args: {
    multiple: true,
    title: 'Media library',
  },
};

export default meta;
type Story = StoryObj<MediaPickerArgs>;

export const Playground: Story = {
  render: (args) => ({
    props: {
      adapter,
      open: true,
      selected: [],
      options: { title: args.title, multiple: args.multiple },
    },
    template: `
      <smart-media-picker
        [adapter]="adapter"
        [options]="options"
        [(open)]="open"
        [(selected)]="selected"
      ></smart-media-picker>
    `,
  }),
};

export const SingleSelect: Story = {
  name: 'Single select',
  render: () => ({
    props: {
      adapter,
      open: true,
      selected: [],
      options: { title: 'Choose one image', multiple: false },
    },
    template: `
      <smart-media-picker
        [adapter]="adapter"
        [options]="options"
        [(open)]="open"
        [(selected)]="selected"
      ></smart-media-picker>
    `,
  }),
};
