import { TranslateModule } from '@ngx-translate/core';
import type { Meta, StoryObj } from '@storybook/angular';
import { applicationConfig, moduleMetadata } from '@storybook/angular';

import { FileDropzoneComponent } from './file-dropzone.component';
import { provideStorybookTranslations } from '../../../../.storybook/storybook-translations';
import { IFileDropzoneOptions, IFileDropzoneUploader } from '../../models';

interface FileDropzoneArgs {
  accept: string;
  maxSize: number;
  multiple: boolean;
  disabled: boolean;
}

const uploader: IFileDropzoneUploader = {
  upload: (file, onProgress) =>
    new Promise((resolve) => {
      let percent = 0;
      const timer = setInterval(() => {
        percent += 20;
        onProgress(percent);
        if (percent >= 100) {
          clearInterval(timer);
          resolve({ id: file.name, name: file.name });
        }
      }, 150);
    }),
};

const meta: Meta<FileDropzoneArgs> = {
  title: 'Components/FileDropzone',
  tags: ['autodocs'],
  decorators: [
    applicationConfig({
      providers: [...provideStorybookTranslations()],
    }),
    moduleMetadata({
      imports: [FileDropzoneComponent, TranslateModule],
    }),
  ],
  argTypes: {
    accept: { control: 'text' },
    maxSize: { control: 'number' },
    multiple: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
  args: {
    accept: '.png,.jpg,.jpeg,.webp',
    maxSize: 5 * 1024 * 1024,
    multiple: true,
    disabled: false,
  },
};

export default meta;
type Story = StoryObj<FileDropzoneArgs>;

export const Playground: Story = {
  render: (args) => ({
    props: {
      options: {
        accept: args.accept,
        maxSize: args.maxSize,
        multiple: args.multiple,
        disabled: args.disabled,
        hint: 'PNG, JPG or WebP, up to 5 MB.',
      } as IFileDropzoneOptions,
      uploader,
    },
    template: `
      <div style="padding: 40px; max-width: 640px;">
        <smart-file-dropzone [options]="options" [uploader]="uploader"></smart-file-dropzone>
      </div>
    `,
  }),
};

export const NoUploader: Story = {
  name: 'Selection only',
  render: () => ({
    props: {
      options: {
        accept: 'image/*',
        multiple: true,
        hint: 'The component only emits the selected files.',
      } as IFileDropzoneOptions,
    },
    template: `
      <div style="padding: 40px; max-width: 640px;">
        <smart-file-dropzone [options]="options"></smart-file-dropzone>
      </div>
    `,
  }),
};

export const Disabled: Story = {
  render: () => ({
    props: {
      options: {
        accept: 'image/*',
        disabled: true,
      } as IFileDropzoneOptions,
    },
    template: `
      <div style="padding: 40px; max-width: 640px;">
        <smart-file-dropzone [options]="options"></smart-file-dropzone>
      </div>
    `,
  }),
};
