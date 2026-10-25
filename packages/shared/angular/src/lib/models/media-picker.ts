export interface IMediaPickerItem {
  id: string;
  url: string;
  thumbnailUrl?: string;
  name?: string;
  alt?: string;
  mimeType?: string;
  width?: number;
  height?: number;
}

export interface IMediaPickerPage {
  items: IMediaPickerItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface IMediaPickerAdapter {
  search(
    query: string,
    page: number,
    pageSize: number,
  ): Promise<IMediaPickerPage>;
  upload?(
    file: File,
    onProgress?: (percent: number) => void,
  ): Promise<IMediaPickerItem>;
}

export interface IMediaPickerOptions {
  title?: string;
  accept?: string;
  multiple?: boolean;
  pageSize?: number;
}
