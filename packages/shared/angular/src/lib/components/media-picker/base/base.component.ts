import {
  Directive,
  input,
  InputSignal,
  model,
  ModelSignal,
  output,
  OutputEmitterRef,
} from '@angular/core';

import {
  DynamicComponentType,
  IMediaPickerAdapter,
  IMediaPickerItem,
  IMediaPickerOptions,
} from '../../../models';

@Directive()
export abstract class MediaPickerBaseComponent {
  static smartType: DynamicComponentType = 'media-picker';

  open: ModelSignal<boolean> = model<boolean>(false);
  adapter: InputSignal<IMediaPickerAdapter> =
    input.required<IMediaPickerAdapter>();
  options: InputSignal<IMediaPickerOptions | undefined> =
    input<IMediaPickerOptions>();
  selected: ModelSignal<IMediaPickerItem[]> = model<IMediaPickerItem[]>([]);
  cssClass: InputSignal<string> = input<string>('', { alias: 'class' });

  confirmed: OutputEmitterRef<IMediaPickerItem[]> =
    output<IMediaPickerItem[]>();
  cancelled: OutputEmitterRef<void> = output<void>();
}
