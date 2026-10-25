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
  IBlockEditorBlock,
  IBlockEditorOptions,
} from '../../../models';

export interface IBlockEditorMove {
  id: string;
  from: number;
  to: number;
}

@Directive()
export abstract class BlockEditorBaseComponent {
  static smartType: DynamicComponentType = 'block-editor';

  blocks: ModelSignal<IBlockEditorBlock[]> = model<IBlockEditorBlock[]>([]);
  options: InputSignal<IBlockEditorOptions> =
    input.required<IBlockEditorOptions>();
  cssClass: InputSignal<string> = input<string>('', { alias: 'class' });

  blockAdded: OutputEmitterRef<IBlockEditorBlock> = output<IBlockEditorBlock>();
  blockRemoved: OutputEmitterRef<string> = output<string>();
  blockMoved: OutputEmitterRef<IBlockEditorMove> = output<IBlockEditorMove>();
  validityChange: OutputEmitterRef<boolean> = output<boolean>();
}
