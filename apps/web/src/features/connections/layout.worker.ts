import { perform, type Work } from "./layoutWork";

// Laying a map out takes long enough to freeze the page, so it happens
// here: a piece of work in, its result back (see layoutPool).
self.onmessage = (event: MessageEvent<Work>) => {
  self.postMessage(perform(event.data));
};
