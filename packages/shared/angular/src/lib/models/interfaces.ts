import {
  PipeTransform,
  Signal,
  TemplateRef,
  Type,
  WritableSignal,
} from '@angular/core';
import {
  AbstractControl,
  UntypedFormArray,
  UntypedFormControl,
} from '@angular/forms';
import { Observable } from 'rxjs';

import { IEntity } from '@smartsoft001/domain-core';
import { IFieldOptions, IModelOptions } from '@smartsoft001/models';

import { IAppProvider } from '../providers';
import { InputBaseComponentType } from './forward-types';
import { IStyle } from './style';

export interface IAppOptions {
  provider: IAppProvider;
  logo?: string;
  menu?: {
    showForAnonymous?: boolean;
    items?: IMenuItem[];
  };
  style?: IStyle;
}

export interface ICardOptions {
  title?: string;
  /**
   * @deprecated Has never been rendered by any card variant (standard or
   * preset). Put actions in the header or footer instead: project them with
   * the `[cardHeader]` / `[cardFooter]` slots of `<smart-card>` (set
   * `hasHeader` / `hasFooter`), which reach the variant as `headerTpl` /
   * `footerTpl`.
   */
  buttons?: Array<IIconButtonOptions>;
  grayFooter?: boolean;
  grayBody?: boolean;
}

export interface IIconButtonOptions {
  icon: string;
  text?: string;
  handler?: () => void;
  component?: any;
  type?: 'default' | 'popover';
  disabled$?: Observable<boolean>;
  number?: number;
}

export type DynamicComponentType =
  | 'block-editor'
  | 'file-dropzone'
  | 'media-picker'
  | 'form'
  | 'page'
  | 'page-heading'
  | 'action-panel'
  | 'alert'
  | 'avatar'
  | 'badge'
  | 'breadcrumbs'
  | 'button-group'
  | 'command-palette'
  | 'container'
  | 'divider'
  | 'drawer'
  | 'dropdown'
  | 'list-container'
  | 'media-object'
  | 'modal'
  | 'notification'
  | 'empty-state'
  | 'navbar'
  | 'progress-bars'
  | 'tabs'
  | 'vertical-navigation'
  | 'button'
  | 'calendar'
  | 'card-heading'
  | 'details'
  | 'description-list'
  | 'feed'
  | 'grid-list'
  | 'info'
  | 'list'
  | 'loader'
  | 'multi-column-layout'
  | 'password-strength'
  | 'searchbar'
  | 'section-heading'
  | 'select-menu'
  | 'sign-in-form'
  | 'sidebar-layout'
  | 'sidebar-navigation'
  | 'stacked-layout'
  | 'stacked-list'
  | 'stats'
  | 'table'
  | 'textarea'
  | 'toggle'
  | 'crud-list-page'
  | 'crud-item-page';
export interface IDynamicComponentData {
  key: DynamicComponentType;
  component: Type<any>;
  data?: any;
}

export interface IFormOptions<T> {
  model: T;
  show: boolean;
  treeLevel?: number;
  control?: AbstractControl;
  mode?: 'create' | 'update' | string;
  loading$?: Observable<boolean>;
  uniqueProvider?: (values: Record<keyof T, any>) => Promise<boolean>;
  possibilities?: {
    [key: string]: WritableSignal<
      { id: any; text: string; checked: boolean }[]
    >;
  };
  inputComponents?: {
    [key: string]: InputBaseComponentType<T>;
  };
  fieldOptions?: IFieldOptions;
  modelOptions?: IModelOptions;
}

export type InputOptions<T> = IInputOptions & IInputFromFieldOptions<T>;

export interface IInputOptions {
  treeLevel: number;
  control: UntypedFormControl | UntypedFormArray;
  possibilities?: WritableSignal<{ id: any; text: string; checked: boolean }[]>;
  component?: InputBaseComponentType<any>;
}

export interface IInputFromFieldOptions<T> {
  model: T;
  fieldKey: string;
  mode?: 'create' | 'update' | string;
}

export interface IDetailsComponentFactories<T> {
  top?: Type<any>;
  bottom?: Type<any>;
}

export interface IDetailsOptions<T extends IEntity<string>> {
  title?: string;
  cellPipe?: ICellPipe<T>;
  type: any;
  item: Signal<T>;
  loading?: Signal<boolean>;
  itemHandler?: ((id: string) => void) | null;
  removeHandler?: ((item: T) => void) | null;
  componentFactories?: IDetailsComponentFactories<T>;
}

export interface IMenuItem {
  mode?: 'divider' | 'default';
  route?: string;
  click?: (arg0: IMenuItem) => void;
  caption?: string;
  component?: any;
  icon?: string;
  infos?: Array<{ text: string }>;
}

export type SmartVariant = 'primary' | 'secondary' | 'soft';
export type SmartSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export type SmartColor =
  | 'slate'
  | 'gray'
  | 'zinc'
  | 'neutral'
  | 'stone'
  | 'red'
  | 'orange'
  | 'amber'
  | 'yellow'
  | 'lime'
  | 'green'
  | 'emerald'
  | 'teal'
  | 'cyan'
  | 'sky'
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'purple'
  | 'fuchsia'
  | 'pink'
  | 'rose';

export interface IAccordionOptions {
  /**
   * Initial open state. When `true` on first render and `show` has not been
   * set to `true` by the consumer, the accordion sets `show` to `true` once
   * (in `AccordionBaseComponent.ngOnInit`, so every variant gets it) and
   * emits `showChange`. Later changes to this flag are ignored, and later
   * toggles or a bound `[(show)]` take over. Bind `[(show)]` to a signal when
   * combining it with `open`.
   */
  open?: boolean;
  /** Prevents `toggle()` from changing `show` (the header ignores clicks). */
  disabled?: boolean;
  /**
   * @deprecated No accordion variant (default or preset) animates anything;
   * this flag has no effect.
   */
  animated?: boolean;
}

export type SmartActionPanelLayout =
  | 'simple'
  | 'with-link'
  | 'right-button'
  | 'top-right-button'
  | 'with-toggle'
  | 'with-input'
  | 'well'
  | 'payment-method';

export interface IActionPanelAction {
  id: string;
  label?: string;
  href?: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'link';
  iconTpl?: TemplateRef<unknown>;
}

export interface IActionPanelOptions {
  title?: string;
  description?: string;
  layout?: SmartActionPanelLayout;
  actions?: IActionPanelAction[];
  descriptionTpl?: TemplateRef<unknown>;
  contentTpl?: TemplateRef<unknown>;
}

export type SmartEmptyStateLayout =
  | 'simple'
  | 'dashed-border'
  | 'starting-points'
  | 'with-recommendations'
  | 'with-templates'
  | 'with-recommendations-grid';

export interface IEmptyStateAction {
  id: string;
  label?: string;
  href?: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'link';
  iconTpl?: TemplateRef<unknown>;
}

export interface IEmptyStateItem {
  id: string;
  title?: string;
  description?: string;
  href?: string;
  iconTpl?: TemplateRef<unknown>;
  imageUrl?: string;
  imageAlt?: string;
  meta?: string;
}

export interface IEmptyStateOptions {
  title?: string;
  description?: string;
  layout?: SmartEmptyStateLayout;
  iconTpl?: TemplateRef<unknown>;
  actions?: IEmptyStateAction[];
  items?: IEmptyStateItem[];
  itemsTitle?: string;
  formTpl?: TemplateRef<unknown>;
  footerLinkLabel?: string;
  footerLinkHref?: string;
}

export type SmartNavbarLayout =
  | 'simple'
  | 'simple-with-menu-on-left'
  | 'with-quick-action'
  | 'with-search'
  | 'with-centered-search'
  | 'with-secondary-links'
  | 'with-column-layout';

export interface INavbarItem {
  id: string;
  label?: string;
  href?: string;
  current?: boolean;
  iconTpl?: TemplateRef<unknown>;
}

export interface INavbarOptions {
  layout?: SmartNavbarLayout;
  dark?: boolean;
  menuButtonOnLeft?: boolean;
  logoTpl?: TemplateRef<unknown>;
  logoUrl?: string;
  logoAlt?: string;
  logoHref?: string;
  items?: INavbarItem[];
  secondaryItems?: INavbarItem[];
  searchTpl?: TemplateRef<unknown>;
  actionTpl?: TemplateRef<unknown>;
  notificationTpl?: TemplateRef<unknown>;
  userMenuTpl?: TemplateRef<unknown>;
}

export type SmartTabsLayout =
  | 'underline'
  | 'underline-with-icons'
  | 'underline-with-badges'
  | 'underline-full-width'
  | 'pills'
  | 'pills-on-gray'
  | 'pills-with-brand-color'
  | 'bar-with-underline'
  | 'simple';

export interface ITabItem {
  id: string;
  label?: string;
  href?: string;
  badge?: string | number;
  iconTpl?: TemplateRef<unknown>;
}

export interface ITabsOptions {
  layout?: SmartTabsLayout;
  items?: ITabItem[];
  ariaLabel?: string;
  showMobileSelect?: boolean;
}

export type SmartProgressBarsLayout =
  | 'simple'
  | 'panels'
  | 'bullets'
  | 'panels-with-border'
  | 'circles'
  | 'bullets-and-text'
  | 'circles-with-text'
  | 'progress-bar';

export type SmartProgressStepStatus = 'complete' | 'current' | 'upcoming';

export interface IProgressStep {
  id: string;
  name?: string;
  description?: string;
  status?: SmartProgressStepStatus;
  href?: string;
  iconTpl?: TemplateRef<unknown>;
  index?: string;
}

export interface IProgressBarColumn {
  label: string;
  active?: boolean;
}

export interface IProgressBarsOptions {
  layout?: SmartProgressBarsLayout;
  ariaLabel?: string;
  steps?: IProgressStep[];
  title?: string;
  srOnlyTitle?: string;
  value?: number;
  columns?: IProgressBarColumn[];
}

export type SmartBreadcrumbsLayout =
  | 'contained'
  | 'full-width-bar'
  | 'simple-with-chevrons'
  | 'simple-with-slashes';

export type SmartBreadcrumbsSeparator = 'chevron' | 'slash' | 'arrow';

export interface IBreadcrumbItem {
  id: string;
  label?: string;
  href?: string;
  iconTpl?: TemplateRef<unknown>;
  srOnlyLabel?: string;
  current?: boolean;
}

export interface IBreadcrumbsOptions {
  layout?: SmartBreadcrumbsLayout;
  ariaLabel?: string;
  separator?: SmartBreadcrumbsSeparator;
  items: IBreadcrumbItem[];
}

export type SmartVerticalNavLayout =
  | 'simple'
  | 'with-badges'
  | 'with-icons'
  | 'with-icons-and-badges'
  | 'with-secondary-navigation'
  | 'on-gray';

export interface IVerticalNavItem {
  id: string;
  label?: string;
  href?: string;
  current?: boolean;
  badge?: string | number;
  iconTpl?: TemplateRef<unknown>;
  initial?: string;
}

export interface IVerticalNavGroup {
  id?: string;
  title?: string;
  items: IVerticalNavItem[];
}

export interface IVerticalNavOptions {
  layout?: SmartVerticalNavLayout;
  ariaLabel?: string;
  items?: IVerticalNavItem[];
  groups?: IVerticalNavGroup[];
}

export interface IButtonOptions {
  type?: 'submit' | 'button';
  confirm?: boolean;
  click: () => void;
  loading?: Signal<boolean>;
  variant?: SmartVariant;
  size?: SmartSize;
  color?: SmartColor;
  rounded?: boolean;
  circular?: boolean;
  iconPosition?: 'leading' | 'trailing';
}

export interface IInfoOptions {
  text: string;
}

export interface ISearchbarOptions {
  placeholder?: string;
  label?: string;
  debounceTime?: number;
  showToggleButton?: boolean;
  size?: SmartSize;
  color?: SmartColor;
}

export interface IToggleOptions {
  label?: string;
  description?: string;
  labelPosition?: 'left' | 'right';
  ariaLabel?: string;
}

export type SmartCommandPaletteVariant =
  | 'simple'
  | 'with-padding'
  | 'with-preview'
  | 'with-images'
  | 'with-icons'
  | 'semi-transparent'
  | 'with-groups'
  | 'with-footer';

export interface ICommand {
  id: string;
  label: string;
  icon?: string;
  group?: string;
  href?: string;
  description?: string;
  imageUrl?: string;
}

export interface ICommandPaletteOptions {
  variant?: SmartCommandPaletteVariant;
  placeholder?: string;
  emptyText?: string;
  ariaLabel?: string;
}

export type SmartModalVariant =
  'centered' | 'wide' | 'alert' | 'left-aligned-buttons';

export type SmartModalActionVariant = 'primary' | 'secondary' | 'danger';

export type SmartModalFooterStyle = 'default' | 'gray';

export interface IModalAction {
  id: string;
  label: string;
  variant?: SmartModalActionVariant;
}

export interface IModalOptions {
  variant?: SmartModalVariant;
  withDismiss?: boolean;
  footerStyle?: SmartModalFooterStyle;
  ariaLabel?: string;
}

export interface IAlertButton {
  text: string;
  role?: 'cancel' | 'destructive' | string;
  cssClass?: string | string[];
  handler?: (value?: unknown) => boolean | void | Record<string, unknown>;
}

export interface IAlertOptions {
  header?: string;
  subHeader?: string;
  message?: string;
  /** Click on the backdrop cancels the alert. Defaults to true. */
  backdropDismiss?: boolean;
  buttons?: IAlertButton[];
}

export type SmartDrawerVariant =
  'empty' | 'create-form' | 'user-profile' | 'contact-list' | 'file-details';

export interface IDrawerOptions {
  position?: 'left' | 'right';
  wide?: boolean;
  withOverlay?: boolean;
  brandedHeader?: boolean;
  stickyFooter?: boolean;
  variant?: SmartDrawerVariant;
}

export type SmartNotificationVariant =
  | 'simple'
  | 'condensed'
  | 'with-actions-below'
  | 'with-avatar'
  | 'with-split-buttons'
  | 'with-buttons-below';

export interface INotificationAction {
  id: string;
  label: string;
  variant?: 'primary' | 'secondary';
}

export interface INotificationOptions {
  variant?: SmartNotificationVariant;
  ariaLive?: 'polite' | 'assertive';
}

export type SmartAvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type SmartAvatarShape = 'circle' | 'rounded';

export interface IAvatarItem {
  id: string;
  imageUrl?: string;
  initials?: string;
}

export interface IAvatarOptions {
  /**
   * Fallback shown when there is no `imageUrl` (default `'icon'`).
   * Initials are shown whenever `initials` is set; otherwise
   * `AvatarPresetComponent` renders an SVG icon (`'icon'`) or an empty
   * initials chip (`'initials'`), and `AvatarStandardComponent` renders a `·`
   * placeholder. The standard also exposes the value as the
   * `data-placeholder-type` attribute on its root element.
   */
  placeholderType?: 'icon' | 'initials';
  /**
   * Stacking order of a `group` (default `'top-to-bottom'`). Purely visual:
   * styled by `AvatarPresetComponent` (`'bottom-to-top'` reverses the stack);
   * `AvatarStandardComponent` exposes it as the `data-stack-direction`
   * attribute on the group container.
   */
  stackDirection?: 'top-to-bottom' | 'bottom-to-top';
}

export type SmartBadgeColor =
  'gray' | 'red' | 'yellow' | 'green' | 'blue' | 'indigo' | 'purple' | 'pink';

export interface IBadgeOptions {
  /**
   * Visual style variant (default `'soft'`). Styled by `BadgePresetComponent`:
   * - `solid` — filled background with inverse text
   * - `soft` — tinted background with same-hue text
   * - `outline` — transparent background with colored border + text
   *
   * `BadgeStandardComponent` does not style it; it exposes the value as the
   * `data-variant` attribute on its root element.
   */
  variant?: 'solid' | 'soft' | 'outline';
  /**
   * Fully rounded pill shape (default `true`); `false` renders `rounded-md`
   * corners. Styled by `BadgePresetComponent`; `BadgeStandardComponent`
   * exposes it as `data-pill="true" | "false"` on its root element.
   */
  pill?: boolean;
  withDot?: boolean;
  withRemove?: boolean;
}

export interface IDropdownItem {
  id: string;
  label: string;
  icon?: string;
  href?: string;
  disabled?: boolean;
  divider?: boolean;
}

export type SmartDropdownVariant =
  'simple' | 'with-dividers' | 'with-icons' | 'minimal' | 'with-header';

export interface IDropdownOptions {
  variant?: SmartDropdownVariant;
  headerLabel?: string;
}

export interface IButtonGroupButton {
  id: string;
  label?: string;
  icon?: string;
  disabled?: boolean;
  count?: number;
}

export type SmartButtonGroupVariant =
  | 'basic'
  | 'icon-only'
  | 'with-stat'
  | 'with-dropdown'
  | 'with-checkbox-select';

export interface IButtonGroupOptions {
  variant?: SmartButtonGroupVariant;
}

export interface IContainerOptions {
  mode?: 'full-width' | 'constrained' | 'container';
  padding?: 'none' | 'mobile' | 'always';
  narrow?: boolean;
}

export type SmartListContainerVariant =
  'simple-dividers' | 'card-dividers' | 'separate-cards' | 'flat-card-dividers';

export interface IListContainerOptions {
  variant?: SmartListContainerVariant;
  fullWidthOnMobile?: boolean;
}

export interface IMediaObjectOptions {
  alignment?: 'top' | 'center' | 'bottom' | 'stretched';
  position?: 'left' | 'right';
  responsive?: boolean;
  nested?: boolean;
  wide?: boolean;
}

export type SmartDividerVariant =
  'with-label' | 'with-icon' | 'with-title' | 'with-button' | 'with-toolbar';

export interface IDividerOptions {
  variant?: SmartDividerVariant;
  position?: 'left' | 'center' | 'right';
}

export type SmartStackedLayoutContainerWidth =
  'sm' | 'md' | 'lg' | 'xl' | 'full';

export interface IStackedLayoutOptions {
  title?: string;
  navTpl?: TemplateRef<unknown>;
  headerTpl?: TemplateRef<unknown>;
  containerWidth?: SmartStackedLayoutContainerWidth;
}

export interface ICardHeadingOptions {
  title?: string;
  description?: string;
  avatarTpl?: TemplateRef<unknown>;
  actionsTpl?: TemplateRef<unknown>;
  metaTpl?: TemplateRef<unknown>;
  // Consumed only by CardHeadingPresetComponent; standard component ignores it.
  presentation?: {
    variant?: 'author' | 'stacked' | 'overlay' | 'outline';
  };
}

export interface IPageHeadingOptions {
  title?: string;
  subtitle?: string;
  breadcrumbsTpl?: TemplateRef<unknown>;
  metaTpl?: TemplateRef<unknown>;
  avatarTpl?: TemplateRef<unknown>;
  bannerTpl?: TemplateRef<unknown>;
  actionsTpl?: TemplateRef<unknown>;
  statsTpl?: TemplateRef<unknown>;
  logoTpl?: TemplateRef<unknown>;
  filtersTpl?: TemplateRef<unknown>;
  navTpl?: TemplateRef<unknown>;
  // Consumed only by PageHeadingPresetComponent; standard component ignores it.
  presentation?: {
    layout?: 'links-left' | 'links-center' | 'links-right' | 'user';
  };
}

export type SmartMultiColumnLayoutWidth = 'full' | 'constrained';
export type SmartMultiColumnLayoutSecondaryWidth = 'sm' | 'md' | 'lg';

export interface IMultiColumnLayoutOptions {
  title?: string;
  navTpl?: TemplateRef<unknown>;
  secondaryTpl?: TemplateRef<unknown>;
  headerTpl?: TemplateRef<unknown>;
  width?: SmartMultiColumnLayoutWidth;
  secondaryWidth?: SmartMultiColumnLayoutSecondaryWidth;
}

export interface ISectionHeadingOptions {
  title?: string;
  description?: string;
  label?: string;
  actionsTpl?: TemplateRef<unknown>;
  tabsTpl?: TemplateRef<unknown>;
  inputGroupTpl?: TemplateRef<unknown>;
  badgeTpl?: TemplateRef<unknown>;
  imageTpl?: TemplateRef<unknown>;
  // Consumed only by SectionHeadingPresetComponent; standard component ignores it.
  presentation?: {
    layout?: 'half' | 'narrow' | 'wide' | 'vertical';
  };
}

export interface IDescriptionListItem {
  label: string;
  value?: string;
  valueTpl?: TemplateRef<unknown>;
  actionTpl?: TemplateRef<unknown>;
}

export interface IDescriptionListOptions {
  title?: string;
  description?: string;
  items?: IDescriptionListItem[];
  attachmentsTpl?: TemplateRef<unknown>;
  footerTpl?: TemplateRef<unknown>;
}

export interface IStatItem {
  label: string;
  value: string | number;
  previousValue?: string | number;
  change?: string;
  trend?: 'up' | 'down' | 'neutral';
  iconTpl?: TemplateRef<unknown>;
  actionTpl?: TemplateRef<unknown>;
  ariaLabel?: string;
}

export interface IStatsOptions {
  title?: string;
  items: IStatItem[];
  columns?: 1 | 2 | 3 | 4;
}

export type SmartCalendarView = 'month' | 'week' | 'day' | 'year';

export interface ICalendarEvent {
  id: string | number;
  start: Date;
  end?: Date;
  title?: string;
  meta?: Record<string, unknown>;
}

export interface ICalendarDayCell {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
}

export interface ICalendarOptions {
  view?: SmartCalendarView;
  monthsCount?: 1 | 2 | 12;
  weekStart?: 0 | 1;
  showToolbar?: boolean;
  toolbarActionsTpl?: TemplateRef<unknown>;
  eventListTpl?: TemplateRef<unknown>;
  sidePanelTpl?: TemplateRef<unknown>;
  dayCellTpl?: TemplateRef<unknown>;
  eventTpl?: TemplateRef<unknown>;
}

export interface IStackedListItem {
  id?: string;
  title: string;
  description?: string;
  meta?: string;
  avatarUrl?: string;
  iconTpl?: TemplateRef<unknown>;
  href?: string;
  badgeTpl?: TemplateRef<unknown>;
  actionTpl?: TemplateRef<unknown>;
  ariaLabel?: string;
}

export interface IStackedListOptions {
  title?: string;
  description?: string;
  items?: IStackedListItem[];
  withDividers?: boolean;
  fullWidthOnMobile?: boolean;
  emptyTpl?: TemplateRef<unknown>;
  footerTpl?: TemplateRef<unknown>;
}

export type SmartTextareaVariant =
  | 'simple'
  | 'with-avatar-actions'
  | 'with-underline'
  | 'with-pill-actions'
  | 'with-preview';

export interface ITextareaAction {
  id: string;
  label?: string;
  iconTpl?: TemplateRef<unknown>;
  variant?: 'primary' | 'secondary' | 'ghost';
}

export interface ITextareaOptions {
  rows?: number;
  maxLength?: number;
  variant?: SmartTextareaVariant;
  label?: string;
  name?: string;
  required?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
  actions?: ITextareaAction[];
  avatarTpl?: TemplateRef<unknown>;
  toolbarTpl?: TemplateRef<unknown>;
  previewTpl?: TemplateRef<unknown>;
  footerTpl?: TemplateRef<unknown>;
}

export type SmartSignInFormMode = 'sign-in' | 'sign-up';

export type SmartSignInFormLayout =
  'simple' | 'simple-no-labels' | 'split-screen' | 'card';

export interface ISocialProvider {
  id: string;
  label: string;
  iconTpl?: TemplateRef<unknown>;
  iconUrl?: string;
}

export interface ISignInFormOptions {
  socialProviders?: ISocialProvider[];
  layout?: SmartSignInFormLayout;
  showLabels?: boolean;
  heroImageUrl?: string;
  forgotPasswordHref?: string;
  signUpHref?: string;
  signInHref?: string;
  submitLabel?: string;
  emailPlaceholder?: string;
  passwordPlaceholder?: string;
  extraTpl?: TemplateRef<unknown>;
  ariaLabel?: string;
}

export interface ISignInFormSubmit {
  email: string;
  password: string;
  mode: SmartSignInFormMode;
}

export interface ISignInFormSocialClick {
  providerId: string;
  mode: SmartSignInFormMode;
}

export type SmartSelectMenuVariant =
  | 'native'
  | 'custom'
  | 'with-check'
  | 'with-status'
  | 'with-avatar'
  | 'with-secondary'
  | 'branded';

export interface ISelectMenuItem {
  value: string | number;
  label: string;
  avatarUrl?: string;
  iconTpl?: TemplateRef<unknown>;
  secondary?: string;
  status?: 'online' | 'offline' | 'busy' | string;
  disabled?: boolean;
  ariaLabel?: string;
}

export interface ISelectMenuOptions {
  items?: ISelectMenuItem[];
  placeholder?: string;
  variant?: SmartSelectMenuVariant;
  emptyTpl?: TemplateRef<unknown>;
  ariaLabel?: string;
}

export type SmartFeedVariant = 'simple' | 'with-comments' | 'multiple-types';

export interface IFeedComment {
  id?: string;
  authorName: string;
  authorAvatarUrl?: string;
  content: string;
  timestamp?: string;
}

export interface IFeedEvent {
  id?: string;
  title: string;
  description?: string;
  timestamp?: string;
  iconTpl?: TemplateRef<unknown>;
  avatarUrl?: string;
  href?: string;
  type?: string;
  comments?: IFeedComment[];
  ariaLabel?: string;
}

export interface IFeedOptions {
  title?: string;
  description?: string;
  events?: IFeedEvent[];
  variant?: SmartFeedVariant;
  commentSubmitTpl?: TemplateRef<unknown>;
  emptyTpl?: TemplateRef<unknown>;
  footerTpl?: TemplateRef<unknown>;
}

export type SmartGridListLayout = 'cards' | 'horizontal' | 'logos';
export type SmartGridListColumns = 1 | 2 | 3 | 4 | 5 | 6;

export interface IGridListItem {
  id?: string;
  title: string;
  description?: string;
  imageUrl?: string;
  imageAlt?: string;
  href?: string;
  iconTpl?: TemplateRef<unknown>;
  badgeTpl?: TemplateRef<unknown>;
  actionTpl?: TemplateRef<unknown>;
  ariaLabel?: string;
}

export interface IGridListOptions {
  title?: string;
  description?: string;
  items?: IGridListItem[];
  columns?: SmartGridListColumns;
  gap?: 'sm' | 'md' | 'lg';
  layout?: SmartGridListLayout;
  emptyTpl?: TemplateRef<unknown>;
  footerTpl?: TemplateRef<unknown>;
}

export interface ITableColumn {
  key: string;
  label?: string;
  align?: 'left' | 'center' | 'right';
  sortable?: boolean;
  cellTpl?: TemplateRef<unknown>;
  headerTpl?: TemplateRef<unknown>;
  ariaLabel?: string;
}

export type TableRow = Record<string, unknown>;

export interface ITableOptions {
  title?: string;
  description?: string;
  columns?: ITableColumn[];
  rows?: TableRow[];
  striped?: boolean;
  stickyHeader?: boolean;
  withCheckboxes?: boolean;
  withBorder?: boolean;
  emptyTpl?: TemplateRef<unknown>;
  footerTpl?: TemplateRef<unknown>;
  toolbarTpl?: TemplateRef<unknown>;
}

export type SmartSidebarNavLayout =
  | 'light'
  | 'dark'
  | 'with-expandable-sections'
  | 'with-secondary-navigation'
  | 'brand';

export interface ISidebarNavItem {
  id: string;
  label?: string;
  href?: string;
  current?: boolean;
  badge?: string | number;
  iconTpl?: TemplateRef<unknown>;
  initial?: string;
  expandable?: boolean;
  expanded?: boolean;
  children?: ISidebarNavItem[];
}

export interface ISidebarNavGroup {
  id?: string;
  title?: string;
  items: ISidebarNavItem[];
}

export interface ISidebarNavLogo {
  url?: string;
  urlDark?: string;
  alt?: string;
  href?: string;
  tpl?: TemplateRef<unknown>;
}

export interface ISidebarNavProfile {
  name?: string;
  avatarUrl?: string;
  avatarAlt?: string;
  href?: string;
  srOnlyText?: string;
}

export interface ISidebarNavOptions {
  layout?: SmartSidebarNavLayout;
  ariaLabel?: string;
  logo?: ISidebarNavLogo;
  items?: ISidebarNavItem[];
  groups?: ISidebarNavGroup[];
  profile?: ISidebarNavProfile;
}

export type SmartSidebarLayoutMobileBreakpoint = 'sm' | 'md' | 'lg';

export interface ISidebarLayoutOptions {
  title?: string;
  sidebarTpl?: TemplateRef<unknown>;
  headerTpl?: TemplateRef<unknown>;
  sidebarPosition?: 'left' | 'right';
  mobileBreakpoint?: SmartSidebarLayoutMobileBreakpoint;
  condensed?: boolean;
}

export interface IDetailOptions<T> {
  key: string;
  item?: Signal<T>;
  options: IFieldOptions;
  cellPipe?: ICellPipe<T>;
  loading?: Signal<boolean>;
}

export interface ICellPipe<T> extends PipeTransform {
  transform(
    value: T,
    columnName: string,
    translate?: (val: string) => string,
  ): string;
}

export type SmartPageVariant = 'standard' | (string & {});

export interface IPageOptions {
  title: string;
  hideHeader?: boolean;
  hideMenuButton?: boolean;
  showBackButton?: boolean;
  endButtons?: Array<IIconButtonOptions>;
  search?: { text: Signal<string>; set: (txt: string) => void };
  variant?: SmartPageVariant;
  bodyTpl?: TemplateRef<unknown>;
  breadcrumbsTpl?: TemplateRef<unknown>;
  metaTpl?: TemplateRef<unknown>;
  avatarTpl?: TemplateRef<unknown>;
  bannerTpl?: TemplateRef<unknown>;
  filtersTpl?: TemplateRef<unknown>;
  logoTpl?: TemplateRef<unknown>;
  statsTpl?: TemplateRef<unknown>;
  subtitleTpl?: TemplateRef<unknown>;
  navTpl?: TemplateRef<unknown>;
  sidebarTpl?: TemplateRef<unknown>;
}

export interface IListProvider<T> {
  getData: (filter: any) => void;
  onChangeMultiSelected?: (list: Array<T>) => void;
  onCleanMultiSelected$?: Observable<void>;
  list: Signal<T[]>;
  loading: Signal<boolean>;
}

export interface IListPaginationOptions {
  mode?: PaginationMode;
  limit: number;
  loadNextPage: () => Promise<boolean>;
  loadPrevPage: () => Promise<boolean>;
  page: Signal<number>;
  totalPages: Signal<number>;
}

export enum PaginationMode {
  infiniteScroll = 'infiniteScroll',
  singlePage = 'singlePage',
}

export enum ListMode {
  mobile = 'mobile',
  desktop = 'desktop',
  masonryGrid = 'masonryGrid',
}

export interface IItemOptionsForPage {
  routingPrefix: string;
  edit: boolean;
}

export interface IItemOptionsForCustom {
  select: (id: string) => void;
  edit: boolean;
}

export type ItemOptions = IItemOptionsForPage | IItemOptionsForCustom;

export interface IListComponentFactories<T> {
  top?: Type<any>;
}

export interface IDetailsProvider<T> {
  getData: (id: string) => void;
  clearData: () => void;
  item: Signal<T>;
  loading: Signal<boolean>;
}

export interface IListOptions<T> {
  provider: IListProvider<T>;
  type: any;
  mode?: ListMode;

  pagination?: IListPaginationOptions;

  cellPipe?: ICellPipe<T>;
  componentFactories?: IListComponentFactories<T>;
  sort?:
    | boolean
    | {
        default?: string;
        defaultDesc?: boolean;
      };

  details?:
    | boolean
    | {
        provider?: IDetailsProvider<T>;
        componentFactories?: IDetailsComponentFactories<T>;
        component?: Type<any>;
      };

  item?:
    | boolean
    | {
        options?: ItemOptions;
      };

  remove?:
    | boolean
    | {
        provider?: IRemoveProvider<T>;
      };

  select?: 'multi';

  // Consumed only by the desktop preset (ListDesktopPresetComponent) to pick
  // Preline table styling variations.
  presentation?: {
    variant?: 'default' | 'striped' | 'bordered' | 'borderless';
    hoverable?: boolean;
    header?: 'default' | 'muted' | 'none';
  };
}

export interface IRemoveProvider<T> {
  invoke: (id: string) => void;
  check?: (item: T) => boolean;
}

export interface IListInternalOptions<T> extends IListOptions<T> {
  fields?: Array<{ key: string; options: IFieldOptions }>;
}
