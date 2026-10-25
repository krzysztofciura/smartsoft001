import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';

import { FileDropzoneComponent } from './file-dropzone.component';

const file = (name: string, type: string, size = 4): File =>
  new File([new Uint8Array(size)], name, { type });

describe('FileDropzoneComponent', () => {
  let fixture: ComponentFixture<FileDropzoneComponent>;
  let component: FileDropzoneComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FileDropzoneComponent, TranslateModule.forRoot()],
    }).compileComponents();

    fixture = TestBed.createComponent(FileDropzoneComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders the dropzone and the hidden file input', () => {
    expect(fixture.nativeElement.querySelector('[role="button"]')).toBeTruthy();
    expect(
      fixture.nativeElement.querySelector('input[type="file"]'),
    ).toBeTruthy();
  });

  it('emits selected files when no uploader is configured', () => {
    const selected: File[] = [];
    component.filesSelected.subscribe((files) => selected.push(...files));

    component.selectFiles([file('a.png', 'image/png')]);

    expect(selected).toHaveLength(1);
    expect(component.files()).toHaveLength(1);
  });

  it('keeps only the first file when multiple is false', () => {
    fixture.componentRef.setInput('options', { multiple: false });
    fixture.detectChanges();

    component.selectFiles([
      file('a.png', 'image/png'),
      file('b.png', 'image/png'),
    ]);

    expect(component.files()).toHaveLength(1);
    expect(component.files()[0].file.name).toBe('a.png');
  });

  it('accepts multiple files when enabled', () => {
    fixture.componentRef.setInput('options', { multiple: true });
    fixture.detectChanges();

    component.selectFiles([
      file('a.png', 'image/png'),
      file('b.png', 'image/png'),
    ]);

    expect(component.files()).toHaveLength(2);
  });

  it('rejects a file with a disallowed extension', () => {
    fixture.componentRef.setInput('options', { accept: '.png' });
    fixture.detectChanges();
    const rejected: string[] = [];
    component.rejected.subscribe((event) => rejected.push(event.reason));

    component.selectFiles([file('notes.txt', 'text/plain')]);

    expect(rejected).toEqual(['type']);
    expect(component.files()).toHaveLength(0);
  });

  it('rejects a file above maxSize', () => {
    fixture.componentRef.setInput('options', { maxSize: 2 });
    fixture.detectChanges();
    const rejected: string[] = [];
    component.rejected.subscribe((event) => rejected.push(event.reason));

    component.selectFiles([file('big.png', 'image/png', 10)]);

    expect(rejected).toEqual(['size']);
    expect(component.files()).toHaveLength(0);
  });

  it('accepts a MIME wildcard rule', () => {
    fixture.componentRef.setInput('options', { accept: 'image/*' });
    fixture.detectChanges();

    component.selectFiles([file('photo.jpg', 'image/jpeg')]);

    expect(component.files()).toHaveLength(1);
  });

  it('handles a drop event', () => {
    const preventDefault = jest.fn();
    component.onDrop({
      preventDefault,
      dataTransfer: { files: [file('a.png', 'image/png')] },
    } as unknown as DragEvent);

    expect(preventDefault).toHaveBeenCalled();
    expect(component.files()).toHaveLength(1);
  });

  it('tracks drag state', () => {
    component.onDragOver({ preventDefault: jest.fn() } as unknown as DragEvent);
    expect(component.dragging()).toBe(true);

    component.onDragLeave({
      preventDefault: jest.fn(),
    } as unknown as DragEvent);
    expect(component.dragging()).toBe(false);
  });

  it('uploads via the adapter, reports progress and emits the result', async () => {
    const uploaded: unknown[] = [];
    let reportedProgress = 0;
    fixture.componentRef.setInput('uploader', {
      upload: jest.fn(
        async (
          _file: File,
          onProgress: (percent: number) => void,
        ): Promise<unknown> => {
          onProgress(40);
          reportedProgress = component.files()[0].percent;
          onProgress(100);
          return { id: 'media-1' };
        },
      ),
    });
    fixture.detectChanges();
    component.uploaded.subscribe((event) => uploaded.push(event.result));

    component.selectFiles([file('a.png', 'image/png')]);
    await fixture.whenStable();

    expect(uploaded).toEqual([{ id: 'media-1' }]);
    expect(reportedProgress).toBe(40);
    expect(component.files()[0].uploading).toBe(false);
    expect(component.files()[0].percent).toBe(100);
  });

  it('emits uploadError when the adapter rejects', async () => {
    const errors: unknown[] = [];
    const failure = new Error('nope');
    fixture.componentRef.setInput('uploader', {
      upload: jest.fn(() => Promise.reject(failure)),
    });
    fixture.detectChanges();
    component.uploadError.subscribe((event) => errors.push(event.error));

    component.selectFiles([file('a.png', 'image/png')]);
    await fixture.whenStable();

    expect(errors).toEqual([failure]);
    expect(component.files()[0].error).toBe(failure);
  });

  it('does nothing when disabled', () => {
    fixture.componentRef.setInput('options', { disabled: true });
    fixture.detectChanges();
    const selected: File[] = [];
    component.filesSelected.subscribe((files) => selected.push(...files));

    component.selectFiles([file('a.png', 'image/png')]);

    expect(selected).toEqual([]);
    expect(component.files()).toEqual([]);
  });

  it('removes a selected file', () => {
    fixture.componentRef.setInput('options', { multiple: true });
    fixture.detectChanges();
    component.selectFiles([
      file('a.png', 'image/png'),
      file('b.png', 'image/png'),
    ]);

    component.remove(0);

    expect(component.files()).toHaveLength(1);
    expect(component.files()[0].file.name).toBe('b.png');
  });

  it('formats file sizes', () => {
    expect(component.formatSize(10)).toBe('10 B');
    expect(component.formatSize(2048)).toBe('2 KB');
    expect(component.formatSize(2 * 1024 * 1024)).toBe('2.0 MB');
  });
});
