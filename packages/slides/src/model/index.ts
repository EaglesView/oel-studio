/** React-free model of @oel/slides (also used by apps/collab on the server). */
export * from './types';
export { SlidesDoc, SlidesFormatError, FORMAT_VERSION, LOCAL, type DeckInfo, type SlideData } from './ydoc';
export * from './geometry';
export * from './text';
export * from './ops';
export { toPreview } from './preview';
