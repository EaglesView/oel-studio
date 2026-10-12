import type { SVGProps } from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignRight,
  Archive,
  Asterisk,
  AtSign,
  Attachment,
  BookStack,
  ChatBubble,
  CheckCircle,
  CheckSquare,
  ClipboardCheck,
  Clock,
  ClockRotateRight,
  CloudCheck,
  CloudSync,
  Collapse,
  ColorPicker,
  Copy,
  Crop,
  DesignNib,
  Drag,
  EditPencil,
  Emoji,
  Erase,
  Expand,
  Eye,
  FillColor,
  FloppyDisk,
  HalfMoon,
  Hashtag,
  InputField,
  KeyCommand,
  Language,
  Laptop,
  LineSpace,
  Link,
  LinkSlash,
  List,
  Lock,
  MagicWand,
  MediaImage,
  MediaImageList,
  MoreHoriz,
  MultiplePages,
  NavArrowLeft,
  NavArrowRight,
  Notes,
  NumberedListLeft,
  Page,
  PageEdit,
  PageFlip,
  PagePlus,
  Palette,
  PasteClipboard,
  Presentation,
  Printer,
  QrCode,
  Redo,
  Refresh,
  Scissor,
  Send,
  ShareIos,
  ShieldCheck,
  SidebarExpand,
  SigmaFunction,
  Sparks,
  SplitArea,
  StatsUpSquare,
  Strikethrough,
  SunLight,
  Table2Columns,
  TableRows,
  Text,
  TextSize,
  Type,
  Undo,
  User,
  ViewColumns2,
  ViewGrid,
  ViewStructureDown,
  WifiOff,
  ZoomIn,
  Percentage,
  Dollar,
  BorderOut,
  BorderBottom,
  BorderInner,
  WrapText,
  Filter,
  Sort,
  SortUp,
  SortDown,
  SnowFlake,
  AlignTopBox,
  AlignVerticalCenters,
  AlignBottomBox,
  ViewColumns3,
  Calculator,
  DatabaseCheck,
  Database,
  MathBook,
  Bell,
  BellNotification,
  Square,
  TextBox,
  Pin,
  PinSlash,
  Play,
  PositionAlign,
  AlignHorizontalCenters,
  Timer,
  Axes,
  DataTransferBoth,
  RotateCameraRight,
} from 'iconoir-react';

/**
 * Icon set · 24 grid, 1.75 stroke, round caps/joins.
 *
 * KIT icons are exported verbatim from Figma (page "Embossed Component List",
 * frame "Icons" 52:92); only the stroke colour is swapped to `currentColor`.
 * EXTRA icons are Iconoir icons; the same SVGs are components in that Figma
 * frame too. New icons should come from Iconoir.
 */
const KIT = {
  plus: 'M12 5V12M12 12V19M12 12H5M12 12H19',
  'arrow-right': 'M5 12H19M13 18L19 12L13 6',
  upload:
    'M12 15V4M17 9L12 4L7 9M4 16V19C4 19.2652 4.10536 19.5196 4.29289 19.7071C4.48043 19.8946 4.73478 20 5 20H19C19.2652 20 19.5196 19.8946 19.7071 19.7071C19.8946 19.5196 20 19.2652 20 19V16',
  download:
    'M12 4V15M17 10L12 15L7 10M4 16V19C4 19.2652 4.10536 19.5196 4.29289 19.7071C4.48043 19.8946 4.73478 20 5 20H19C19.2652 20 19.5196 19.8946 19.7071 19.7071C19.8946 19.5196 20 19.2652 20 19V16',
  phone:
    'M11 18H13M8 2.5H16C16.3978 2.5 16.7794 2.65804 17.0607 2.93934C17.342 3.22064 17.5 3.60218 17.5 4V20C17.5 20.3978 17.342 20.7794 17.0607 21.0607C16.7794 21.342 16.3978 21.5 16 21.5H8C7.60218 21.5 7.22064 21.342 6.93934 21.0607C6.65804 20.7794 6.5 20.3978 6.5 20V4C6.5 3.60218 6.65804 3.22064 6.93934 2.93934C7.22064 2.65804 7.60218 2.5 8 2.5Z',
  cloud:
    'M7 18.5H17C18.0036 18.4925 18.9677 18.108 19.701 17.4229C20.4344 16.7377 20.8833 15.8019 20.9589 14.8011C21.0344 13.8003 20.731 12.8077 20.1088 12.0203C19.4866 11.2328 18.5911 10.708 17.6 10.55C17.3173 9.30714 16.6461 8.18665 15.6837 7.3509C14.7214 6.51515 13.518 6.00756 12.2478 5.90171C10.9776 5.79586 9.70671 6.09725 8.61933 6.7622C7.53194 7.42714 6.68456 8.42108 6.2 9.59996C5.12335 9.82841 4.16776 10.4435 3.51398 11.3289C2.8602 12.2143 2.55358 13.3086 2.65211 14.4048C2.75065 15.501 3.24751 16.5231 4.0487 17.2777C4.8499 18.0324 5.89987 18.4672 7 18.5Z',
  folder:
    'M3 7C3 6.46957 3.21071 5.96086 3.58579 5.58579C3.96086 5.21071 4.46957 5 5 5H9L11 7H19C19.5304 7 20.0391 7.21071 20.4142 7.58579C20.7893 7.96086 21 8.46957 21 9V17C21 17.5304 20.7893 18.0391 20.4142 18.4142C20.0391 18.7893 19.5304 19 19 19H5C4.46957 19 3.96086 18.7893 3.58579 18.4142C3.21071 18.0391 3 17.5304 3 17V7Z',
  trash:
    'M4 7H6M6 7H9M6 7L7 19C7 19.5304 7.21071 20.0391 7.58579 20.4142C7.96086 20.7893 8.46957 21 9 21H15C15.5304 21 16.0391 20.7893 16.4142 20.4142C16.7893 20.0391 17 19.5304 17 19L18 7M9 7H15M9 7V4H15V7M15 7H18M18 7H20M10 11V17M14 11V17',
  check: 'M5 12.5L9.5 17L19 7',
  close: 'M6 6L12 12M12 12L18 18M12 12L18 6M12 12L6 18',
  'chevron-down': 'M6 9L12 15L18 9',
  search:
    'M20 20L16 16M11 18C11.9193 18 12.8295 17.8189 13.6788 17.4672C14.5281 17.1154 15.2997 16.5998 15.9497 15.9497C16.5998 15.2997 17.1154 14.5281 17.4672 13.6788C17.8189 12.8295 18 11.9193 18 11C18 10.0807 17.8189 9.17049 17.4672 8.32122C17.1154 7.47194 16.5998 6.70026 15.9497 6.05025C15.2997 5.40024 14.5281 4.88463 13.6788 4.53284C12.8295 4.18106 11.9193 4 11 4C9.14348 4 7.36301 4.7375 6.05025 6.05025C4.7375 7.36301 4 9.14348 4 11C4 12.8565 4.7375 14.637 6.05025 15.9497C7.36301 17.2625 9.14348 18 11 18Z',
  minus: 'M5 12H19',
  'chevron-up': 'M6 15L12 9L18 15',
  'chevron-left': 'M15 6L9 12L15 18',
  'chevron-right': 'M9 6L15 12L9 18',
  calendar:
    'M8 5H5C4.73478 5 4.48043 5.10536 4.29289 5.29289C4.10536 5.48043 4 5.73478 4 6V10M8 5H16M8 5V3M8 5V7M16 5H19C19.2652 5 19.5196 5.10536 19.7071 5.29289C19.8946 5.48043 20 5.73478 20 6V10M16 5V3M16 5V7M20 10V19C20 19.2652 19.8946 19.5196 19.7071 19.7071C19.5196 19.8946 19.2652 20 19 20H5C4.73478 20 4.48043 19.8946 4.29289 19.7071C4.10536 19.5196 4 19.2652 4 19V10M20 10H4',
  info: 'M12 11V16M12 8H12.01M12 21C13.1819 21 14.3522 20.7672 15.4442 20.3149C16.5361 19.8626 17.5282 19.1997 18.364 18.364C19.1997 17.5282 19.8626 16.5361 20.3149 15.4442C20.7672 14.3522 21 13.1819 21 12C21 10.8181 20.7672 9.64778 20.3149 8.55585C19.8626 7.46392 19.1997 6.47177 18.364 5.63604C17.5282 4.80031 16.5361 4.13738 15.4442 3.68508C14.3522 3.23279 13.1819 3 12 3C9.61305 3 7.32387 3.94821 5.63604 5.63604C3.94821 7.32387 3 9.61305 3 12C3 14.3869 3.94821 16.6761 5.63604 18.364C7.32387 20.0518 9.61305 21 12 21Z',
  alert: 'M12 10V14M12 17H12.01M12 4L21 20H3L12 4Z',
  bold: 'M7 12H13C13.9283 12 14.8185 11.6313 15.4749 10.9749C16.1313 10.3185 16.5 9.42826 16.5 8.5C16.5 7.57174 16.1313 6.6815 15.4749 6.02513C14.8185 5.36875 13.9283 5 13 5H7V12ZM7 12H14C14.9283 12 15.8185 12.3687 16.4749 13.0251C17.1313 13.6815 17.5 14.5717 17.5 15.5C17.5 16.4283 17.1313 17.3185 16.4749 17.9749C15.8185 18.6313 14.9283 19 14 19H7V12Z',
  italic: 'M10 5H14M14 5H18M14 5L10 19M6 19H10M10 19H14',
  underline:
    'M7 4V11C7 12.3261 7.52678 13.5979 8.46447 14.5355C9.40215 15.4732 10.6739 16 12 16C13.3261 16 14.5979 15.4732 15.5355 14.5355C16.4732 13.5979 17 12.3261 17 11V4M5 20H19',
  'align-left': 'M4 6H20M4 10H14M4 14H20M4 18H14',
  home: 'M4 11L12 4L20 11V19C20 19.2652 19.8946 19.5196 19.7071 19.7071C19.5196 19.8946 19.2652 20 19 20H15V14H9V20H5C4.73478 20 4.48043 19.8946 4.29289 19.7071C4.10536 19.5196 4 19.2652 4 19V11Z',
  file: 'M18 7L14 3H6C5.73478 3 5.48043 3.10536 5.29289 3.29289C5.10536 3.48043 5 3.73478 5 4V20C5 20.2652 5.10536 20.5196 5.29289 20.7071C5.48043 20.8946 5.73478 21 6 21H17C17.2652 21 17.5196 20.8946 17.7071 20.7071C17.8946 20.5196 18 20.2652 18 20V7ZM14 3V7H18',
  image:
    'M20 16V5C20 4.73478 19.8946 4.48043 19.7071 4.29289C19.5196 4.10536 19.2652 4 19 4H5C4.73478 4 4.48043 4.10536 4.29289 4.29289C4.10536 4.48043 4 4.73478 4 5V16M20 16V19C20 19.2652 19.8946 19.5196 19.7071 19.7071C19.5196 19.8946 19.2652 20 19 20H5C4.73478 20 4.48043 19.8946 4.29289 19.7071C4.10536 19.5196 4 19.2652 4 19V16M20 16L16 12L13 15L9 11L4 16M15 9H15.01',
  settings: 'M4 7H14M18 7H20M4 17H8M12 17H20M16 5V9M10 15V19',
  mail: 'M20 7V6H4V7M20 7V18H4V7M20 7L12 13L4 7',
} as const;

/** Iconoir (https://iconoir.com, MIT), mapped to our names. Drawn at the kit's 1.75 stroke. */
const EXTRA = {
  axes: Axes,
  'switch-rows': DataTransferBoth,
  'rotate-3d': RotateCameraRight,
  'snow-flake': SnowFlake,
  slide: Presentation,
  table: Table2Columns,
  note: Notes,
  pdf: MultiplePages,
  comment: ChatBubble,
  share: ShareIos,
  undo: Undo,
  redo: Redo,
  list: List,
  grid: ViewGrid,
  link: Link,
  expand: Expand,
  pen: DesignNib,
  highlight: EditPencil,
  crop: Crop,
  sparkle: Sparks,
  keyboard: KeyCommand,
  layout: ViewColumns2,
  chart: StatsUpSquare,
  sum: SigmaFunction,
  move: Drag,
  more: MoreHoriz,
  user: User,
  sun: SunLight,
  moon: HalfMoon,
  // Document editor (@oel/docs)
  'align-center': AlignCenter,
  'align-right': AlignRight,
  'align-justify': AlignJustify,
  'list-numbered': NumberedListLeft,
  'checklist': CheckSquare,
  'strikethrough': Strikethrough,
  'text-color': Type,
  'fill-color': FillColor,
  'print': Printer,
  'format-painter': ColorPicker,
  'clear-format': Erase,
  'indent-more': NavArrowRight,
  'indent-less': NavArrowLeft,
  'line-spacing': LineSpace,
  'page-break': PageFlip,
  'footnote': Asterisk,
  'history': ClockRotateRight,
  'zoom': ZoomIn,
  'outline': SidebarExpand,
  'eye': Eye,
  'cloud-check': CloudCheck,
  'cloud-sync': CloudSync,
  'offline': WifiOff,
  'lock': Lock,
  'page': Page,
  'special-chars': Emoji,
  'toc': BookStack,
  'header-footer': PageEdit,
  'copy': Copy,
  'cut': Scissor,
  'paste': PasteClipboard,
  'text-size': TextSize,
  'word-count': Hashtag,
  'link-off': LinkSlash,
  'table-rows': TableRows,
  'merge': SplitArea,
  'refresh': Refresh,
  'new-page': PagePlus,
  'translate': Language,
  'save': FloppyDisk,
  'collapse': Collapse,
  'focus-mode': Eye,
  // Forms (Figma Editor — Behaviors · E)
  'archive': Archive,
  'attachment': Attachment,
  'radio': CheckCircle,
  'form': ClipboardCheck,
  'clock': Clock,
  'input': InputField,
  'laptop': Laptop,
  'media': MediaImage,
  /** Galerie (Figma L, M2 « Galerie vide »): Iconoir MediaImageList. */
  gallery: MediaImageList,
  /** Auto (Figma L1, atelier d’image): Iconoir MagicWand. */
  'magic-wand': MagicWand,
  'palette': Palette,
  'qr': QrCode,
  'send': Send,
  'shield': ShieldCheck,
  'text-block': Text,
  'section': ViewStructureDown,
  // Spreadsheet editor (@oel/sheets)
  'percent': Percentage,
  'currency': Dollar,
  'borders': BorderOut,
  'border-bottom': BorderBottom,
  'border-inner': BorderInner,
  'wrap-text': WrapText,
  'filter': Filter,
  /** Bureau « Ranger » (Figma M1). */
  sort: Sort,
  'sort-asc': SortUp,
  'sort-desc': SortDown,
  'freeze': SnowFlake,
  'valign-top': AlignTopBox,
  'valign-middle': AlignVerticalCenters,
  'valign-bottom': AlignBottomBox,
  'insert-col': ViewColumns3,
  'calculator': Calculator,
  'validation': DatabaseCheck,
  'database': Database,
  'function': MathBook,
  'bell': Bell,
  /** Notes collées (Figma K): « Coller », « Décoller », mentions. */
  pin: Pin,
  'pin-slash': PinSlash,
  'at-sign': AtSign,
  'bell-dot': BellNotification,
  // Presentations (@oel/slides)
  shape: Square,
  'text-box': TextBox,
  play: Play,
  'dock-bottom': AlignBottomBox,
  presenter: Presentation,
  arrange: PositionAlign,
  'align-h-center': AlignHorizontalCenters,
  timer: Timer,
} as const;

export type IconName = keyof typeof KIT | keyof typeof EXTRA;
export const iconNames = [...Object.keys(KIT), ...Object.keys(EXTRA)] as IconName[];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  /** Rendered size in px. Kit uses 16 (small buttons), 18 (nav/toolbar), 20 (icon buttons). */
  size?: number;
  /** Accessible label. Omit for decorative icons (the default), which are hidden from AT. */
  label?: string;
}

export function Icon({ name, size = 20, label, ...rest }: IconProps) {
  const a11y = {
    'aria-hidden': label ? undefined : true,
    role: label ? 'img' : undefined,
    'aria-label': label,
    focusable: 'false' as const,
  };
  if (name in EXTRA) {
    const Glyph = EXTRA[name as keyof typeof EXTRA];
    return <Glyph width={size} height={size} strokeWidth={1.75} color="currentColor" {...a11y} {...rest} />;
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...a11y}
      {...rest}
    >
      <path d={KIT[name as keyof typeof KIT]} />
    </svg>
  );
}
