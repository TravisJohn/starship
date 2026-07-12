import type { StarshipApi } from "../shared/ipc";

declare global {
  interface Window {
    starship: StarshipApi;
  }
}

export {};
