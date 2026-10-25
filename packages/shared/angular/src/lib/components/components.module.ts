import { DragDropModule } from '@angular/cdk/drag-drop';
import { CdkTableModule } from '@angular/cdk/table';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { NgModule } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { DynamicComponent, DynamicModule } from 'ng-dynamic-component';
import { LazyLoadImageModule } from 'ng-lazyload-image';

import { ListMode } from '../models';
import {
  DETAILS_COMPONENT_TOKEN,
  DETAILS_STANDARD_COMPONENT_TOKEN,
  FORM_COMPONENT_TOKEN,
  FORM_STANDARD_COMPONENT_TOKEN,
  LIST_MODE_COMPONENTS_TOKEN,
} from '../shared.inectors';
import {
  AccordionBodyComponent,
  AccordionComponent,
  AccordionDefaultComponent,
  AccordionHeaderComponent,
} from './accordion';
import { BlockEditorComponent } from './block-editor';
import { ButtonComponent, ButtonStandardComponent } from './button';
import { CardComponent, CardStandardComponent } from './card';
import { DateEditComponent, DateEditStandardComponent } from './date-edit';
import {
  DateRangeComponent,
  DateRangeStandardComponent,
  DateRangeModalStandardComponent,
} from './date-range';
import {
  DetailComponent,
  DetailTextComponent,
  DetailFlagComponent,
  DetailEnumComponent,
  DetailEmailComponent,
  DetailAddressComponent,
  DetailObjectComponent,
  DetailColorComponent,
  DetailLogoComponent,
  DetailArrayComponent,
  DetailPdfComponent,
  DetailVideoComponent,
  DetailAttachmentComponent,
  DetailDateRangeComponent,
  DetailImageComponent,
  DetailPhoneNumberPlComponent,
} from './detail';
import { DetailsComponent, DetailsStandardComponent } from './details';
import { SharedDirectivesModule } from '../directives';
import { ExportComponent } from './export';
import { FileDropzoneComponent } from './file-dropzone';
import { FormComponent, FormStandardComponent } from './form';
import { ImportComponent } from './import';
import { InfoComponent, InfoStandardComponent } from './info';
import {
  InputComponent,
  InputIntComponent,
  InputErrorComponent,
  InputTextComponent,
  InputPasswordComponent,
  InputFlagComponent,
  InputEnumComponent,
  InputEmailComponent,
  InputCurrencyComponent,
  InputDateComponent,
  InputDateWithEditComponent,
  InputFileComponent,
  InputRadioComponent,
  InputNipComponent,
  InputStringsComponent,
  InputLongTextComponent,
  InputAddressComponent,
  InputObjectComponent,
  InputColorComponent,
  InputLogoComponent,
  InputCheckComponent,
  InputIntsComponent,
  InputPhoneNumberComponent,
  InputPhoneNumberPlComponent,
  InputPeselComponent,
  InputArrayComponent,
  InputPdfComponent,
  InputVideoComponent,
  InputAttachmentComponent,
  InputDateRangeComponent,
  InputImageComponent,
  InputFloatComponent,
} from './input';
import {
  ListComponent,
  ListMobileComponent,
  ListDesktopComponent,
  ListMasonryGridComponent,
} from './list';
import { LoaderComponent, LoaderStandardComponent } from './loader';
import { MediaPickerComponent } from './media-picker';
import { PageComponent, PageStandardComponent } from './page';
import { PagingComponent, PagingStandardComponent } from './paging';
import {
  PasswordStrengthComponent,
  PasswordStrengthStandardComponent,
} from './password-strength';
import { SearchbarComponent, SearchbarStandardComponent } from './searchbar';
import { SharedPipesModule } from '../pipes/pipes.module';

export const BLOCK_EDITOR_COMPONENTS = [BlockEditorComponent];

export const ACCORDION_COMPONENTS: any[] = [
  AccordionComponent,
  AccordionDefaultComponent,
  AccordionHeaderComponent,
  AccordionBodyComponent,
];

export const BUTTON_COMPONENTS = [ButtonComponent, ButtonStandardComponent];

export const CARD_COMPONENTS = [CardComponent, CardStandardComponent];

export const DETAILS_COMPONENTS = [DetailsComponent, DetailsStandardComponent];

export const EXPORT_COMPONENTS = [ExportComponent];

export const FILE_DROPZONE_COMPONENTS = [FileDropzoneComponent];

export const IMPORT_COMPONENTS = [ImportComponent];

export const DETAIL_COMPONENTS = [
  DetailComponent,
  DetailTextComponent,
  DetailFlagComponent,
  DetailEnumComponent,
  DetailEmailComponent,
  DetailAddressComponent,
  DetailObjectComponent,
  DetailColorComponent,
  DetailLogoComponent,
  DetailArrayComponent,
  DetailPdfComponent,
  DetailVideoComponent,
  DetailAttachmentComponent,
  DetailDateRangeComponent,
  DetailImageComponent,
  DetailPhoneNumberPlComponent,
];

export const FORM_COMPONENTS = [FormStandardComponent, FormComponent];

export const INPUT_COMPONENTS = [
  InputComponent,
  InputIntComponent,
  InputErrorComponent,
  InputTextComponent,
  InputPasswordComponent,
  InputFlagComponent,
  InputEnumComponent,
  InputEmailComponent,
  InputCurrencyComponent,
  InputDateComponent,
  InputDateWithEditComponent,
  InputFileComponent,
  InputRadioComponent,
  InputNipComponent,
  InputStringsComponent,
  InputLongTextComponent,
  InputAddressComponent,
  InputObjectComponent,
  InputColorComponent,
  InputLogoComponent,
  InputCheckComponent,
  InputIntsComponent,
  InputPhoneNumberComponent,
  InputPhoneNumberPlComponent,
  InputPeselComponent,
  InputArrayComponent,
  InputPdfComponent,
  InputVideoComponent,
  InputAttachmentComponent,
  InputDateRangeComponent,
  InputImageComponent,
  InputFloatComponent,
];

export const LIST_COMPONENTS = [
  ListComponent,
  ListMobileComponent,
  ListDesktopComponent,
  ListMasonryGridComponent,
];

export const LOADER_COMPONENTS = [LoaderComponent, LoaderStandardComponent];

export const MEDIA_PICKER_COMPONENTS = [MediaPickerComponent];

export const PAGE_COMPONENTS = [PageComponent, PageStandardComponent];

export const PAGING_COMPONENTS = [PagingComponent, PagingStandardComponent];

export const PASSWORD_STRENGTH_COMPONENTS = [
  PasswordStrengthComponent,
  PasswordStrengthStandardComponent,
];

export const SEARCHBAR_COMPONENTS = [
  SearchbarComponent,
  SearchbarStandardComponent,
];

export const INFO_COMPONENTS = [InfoComponent, InfoStandardComponent];
export const DATE_RANGE_COMPONENTS = [
  DateRangeComponent,
  DateRangeStandardComponent,
  DateRangeModalStandardComponent,
];
export const DATE_EDIT_COMPONENTS = [
  DateEditComponent,
  DateEditStandardComponent,
];

export const DYNAMIC_COMPONENTS = [DynamicComponent];

export const COMPONENTS = [
  ...BLOCK_EDITOR_COMPONENTS,
  ...FORM_COMPONENTS,
  ...INPUT_COMPONENTS,
  ...PAGE_COMPONENTS,
  ...ACCORDION_COMPONENTS,
  ...DATE_RANGE_COMPONENTS,
  ...DATE_EDIT_COMPONENTS,
  ...BUTTON_COMPONENTS,
  ...CARD_COMPONENTS,
  ...LIST_COMPONENTS,
  ...LOADER_COMPONENTS,
  ...MEDIA_PICKER_COMPONENTS,
  ...PAGING_COMPONENTS,
  ...DETAIL_COMPONENTS,
  ...DETAILS_COMPONENTS,
  ...DYNAMIC_COMPONENTS,
  ...INFO_COMPONENTS,
  ...EXPORT_COMPONENTS,
  ...FILE_DROPZONE_COMPONENTS,
  ...IMPORT_COMPONENTS,
  ...PASSWORD_STRENGTH_COMPONENTS,
  ...SEARCHBAR_COMPONENTS,
];

export const IMPORTS = [
  CommonModule,
  ReactiveFormsModule,
  FormsModule,
  TranslateModule,
  RouterModule,
  SharedPipesModule,
  SharedDirectivesModule,
  HttpClientModule,
  LazyLoadImageModule,
  DragDropModule,
  CdkTableModule,
  DynamicModule,
];

@NgModule({
  declarations: [],
  exports: [...COMPONENTS],
  providers: [
    {
      provide: FORM_COMPONENT_TOKEN,
      useValue: FormComponent,
    },
    {
      provide: DETAILS_COMPONENT_TOKEN,
      useValue: DetailsComponent,
    },
    {
      provide: DETAILS_STANDARD_COMPONENT_TOKEN,
      useValue: DetailsStandardComponent,
    },
    {
      provide: FORM_STANDARD_COMPONENT_TOKEN,
      useValue: FormStandardComponent,
    },
    {
      provide: LIST_MODE_COMPONENTS_TOKEN,
      useValue: {
        [ListMode.desktop]: ListDesktopComponent,
        [ListMode.mobile]: ListMobileComponent,
        [ListMode.masonryGrid]: ListMasonryGridComponent,
      },
    },
  ],
  imports: [...IMPORTS, ...COMPONENTS],
})
export class SharedComponentsModule {}
