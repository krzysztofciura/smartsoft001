import type { InputSignal, Type } from '@angular/core';

export interface IBlockEditorBlock<T = any> {
  id: string;
  type: string;
  data: T;
}

export interface IBlockEditorBlockComponent<T = any> {
  block: InputSignal<IBlockEditorBlock<T>>;
  update: InputSignal<(data: T) => void>;
  errors: InputSignal<string[]>;
}

export interface IBlockEditorType<T = any> {
  type: string;
  label: string;
  icon?: string;
  create(): T;
  editorComponent: Type<IBlockEditorBlockComponent<T>>;
  validate?(data: T): string[];
}

export interface IBlockEditorOptions {
  types: IBlockEditorType[];
  addLabel?: string;
  emptyText?: string;
  readonly?: boolean;
  maxBlocks?: number;
}
