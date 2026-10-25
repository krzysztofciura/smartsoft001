import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';

import { MediaPickerComponent } from './media-picker.component';
import { IMediaPickerAdapter, IMediaPickerItem } from '../../models';

const ITEMS: IMediaPickerItem[] = [
  { id: '1', url: '/1.jpg', name: 'One' },
  { id: '2', url: '/2.jpg', name: 'Two' },
];

const page = (
  items: IMediaPickerItem[],
  pageNumber = 1,
  total = items.length,
) => ({
  items,
  total,
  page: pageNumber,
  pageSize: 24,
});

describe('MediaPickerComponent', () => {
  let fixture: ComponentFixture<MediaPickerComponent>;
  let component: MediaPickerComponent;
  let adapter: jest.Mocked<IMediaPickerAdapter>;

  const flush = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    adapter = {
      search: jest.fn().mockResolvedValue(page(ITEMS, 1, 2)),
    } as jest.Mocked<IMediaPickerAdapter>;

    await TestBed.configureTestingModule({
      imports: [MediaPickerComponent, TranslateModule.forRoot()],
    }).compileComponents();

    fixture = TestBed.createComponent(MediaPickerComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('adapter', adapter);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await flush();
  });

  it('loads the first page when opened', () => {
    expect(adapter.search).toHaveBeenCalledWith('', 1, 24);
    expect(component.items()).toEqual(ITEMS);
    expect(component.total()).toBe(2);
  });

  it('selects a single item in single mode', () => {
    component.toggle(ITEMS[0]);

    expect(component.selected()).toEqual([ITEMS[0]]);
    expect(component.isSelected('1')).toBe(true);
  });

  it('replaces the selection in single mode', () => {
    component.toggle(ITEMS[0]);
    component.toggle(ITEMS[1]);

    expect(component.selected()).toEqual([ITEMS[1]]);
  });

  it('toggles items in multiple mode', () => {
    fixture.componentRef.setInput('options', { multiple: true });
    fixture.detectChanges();

    component.toggle(ITEMS[0]);
    component.toggle(ITEMS[1]);
    expect(component.selected()).toEqual([ITEMS[0], ITEMS[1]]);

    component.toggle(ITEMS[0]);
    expect(component.selected()).toEqual([ITEMS[1]]);
  });

  it('confirms the selection and closes', () => {
    const confirmed: IMediaPickerItem[][] = [];
    component.confirmed.subscribe((items) => confirmed.push(items));
    component.toggle(ITEMS[0]);

    component.confirm();

    expect(confirmed).toEqual([[ITEMS[0]]]);
    expect(component.open()).toBe(false);
  });

  it('cancels and closes without confirming', () => {
    const cancelled: boolean[] = [];
    component.cancelled.subscribe(() => cancelled.push(true));

    component.cancel();

    expect(cancelled).toEqual([true]);
    expect(component.open()).toBe(false);
  });

  it('debounces the search and resets to page one', () => {
    jest.useFakeTimers();
    adapter.search.mockClear();

    component.onQueryChange('cat');
    expect(adapter.search).not.toHaveBeenCalled();

    jest.advanceTimersByTime(300);
    expect(adapter.search).toHaveBeenCalledWith('cat', 1, 24);
    jest.useRealTimers();
  });

  it('loads the requested page', async () => {
    adapter.search.mockResolvedValueOnce(page([ITEMS[1]], 2, 48));

    component.load(2, '');
    await flush();

    expect(adapter.search).toHaveBeenLastCalledWith('', 2, 24);
    expect(component.page()).toBe(2);
  });

  it('ignores stale results', async () => {
    let resolveFirst!: (value: ReturnType<typeof page>) => void;
    let resolveSecond!: (value: ReturnType<typeof page>) => void;
    adapter.search
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveFirst = resolve)),
      )
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveSecond = resolve)),
      );

    component.load(1, 'first');
    component.load(1, 'second');

    resolveSecond(page([ITEMS[1]], 1, 1));
    await flush();
    resolveFirst(page([ITEMS[0]], 1, 1));
    await flush();

    expect(component.items()).toEqual([ITEMS[1]]);
  });

  it('adds an uploaded item to the selection and refreshes', () => {
    const uploaded = { id: '3', url: '/3.jpg', name: 'Three' };
    adapter.search.mockClear();

    component.onUploaded({
      file: new File(['x'], '3.jpg', { type: 'image/jpeg' }),
      result: uploaded,
    });

    expect(component.selected()).toEqual([uploaded]);
    expect(adapter.search).toHaveBeenCalledWith('', 1, 24);
  });

  it('shows an uploader only when the adapter supports upload', () => {
    expect(component.uploader()).toBeUndefined();

    fixture.componentRef.setInput('adapter', {
      search: adapter.search,
      upload: jest.fn(),
    });
    fixture.detectChanges();

    expect(component.uploader()).toBeDefined();
  });

  it('renders an empty state when the adapter returns no items', async () => {
    adapter.search.mockResolvedValueOnce(page([], 1, 0));

    component.load(1, '');
    await flush();

    expect(component.items()).toEqual([]);
    expect(component.loading()).toBe(false);
    expect(
      fixture.nativeElement.querySelector('smart-empty-state'),
    ).toBeTruthy();
  });
});
