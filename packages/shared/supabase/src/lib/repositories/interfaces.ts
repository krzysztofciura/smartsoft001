export interface IItemCreateData {
  id: string;
  type: 'create';
  data: any;
}

export interface IItemUpdateData {
  id: string;
  type: 'update';
  data: {
    removedFields: Array<string>;
    updatedFields: {
      [key: string]: any;
    };
  };
}

export interface IItemDeleteData {
  id: string;
  type: 'delete';
}

export type ItemChangedData =
  IItemCreateData | IItemUpdateData | IItemDeleteData;

export type ItemChangedDataType = 'create' | 'update' | 'delete';
