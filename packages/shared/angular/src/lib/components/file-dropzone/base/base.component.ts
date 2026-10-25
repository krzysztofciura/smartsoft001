import {
  Directive,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
} from '@angular/core';

import {
  DynamicComponentType,
  IFileDropzoneOptions,
  IFileDropzoneRejection,
  IFileDropzoneUploadError,
  IFileDropzoneUploaded,
  IFileDropzoneUploader,
} from '../../../models';

@Directive()
export abstract class FileDropzoneBaseComponent {
  static smartType: DynamicComponentType = 'file-dropzone';

  options: InputSignal<IFileDropzoneOptions | undefined> =
    input<IFileDropzoneOptions>();
  uploader: InputSignal<IFileDropzoneUploader | undefined> =
    input<IFileDropzoneUploader>();
  cssClass: InputSignal<string> = input<string>('', { alias: 'class' });

  filesSelected: OutputEmitterRef<File[]> = output<File[]>();
  uploaded: OutputEmitterRef<IFileDropzoneUploaded> =
    output<IFileDropzoneUploaded>();
  uploadError: OutputEmitterRef<IFileDropzoneUploadError> =
    output<IFileDropzoneUploadError>();
  rejected: OutputEmitterRef<IFileDropzoneRejection> =
    output<IFileDropzoneRejection>();
}
