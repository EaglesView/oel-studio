/** Bureau ↔ @oel/img: the image worker (one per atelier, created through this function). */
import ImageWorker from '@oel/img/worker?worker';

export const createImageWorker = () => new ImageWorker();
